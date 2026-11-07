// RiuPlay M3: how much each caller may ask of the network. Per caller (one extension = one
// caller): requests in flight, a bounded wait queue, a token-bucket request rate and an hourly byte
// quota; plus one global in-flight cap shared by everything except downloads (which stream for
// minutes and have their own cap, so a long download can't starve source requests, and a burst of
// source requests can't stall a download). A refusal is a NetError with a clear code:
// "too-many-requests" (queue full), "rate-limited" (no tokens), "quota-exceeded" (bytes).
import { NetError } from "./errors";
import type { Caller } from "./policy";
import { callerKey } from "./policy";

export interface CallerBudget {
  maxInFlight: number;
  maxQueued: number;
  /** Token bucket: capacity and refill per second; null = no rate limit. */
  rate: { burst: number; perSecond: number } | null;
  /** Raw response bytes per rolling hour; null = no quota. */
  bytesPerHour: number | null;
}

export const DEFAULT_BUDGETS: Record<Caller["kind"], CallerBudget> = {
  extension: { maxInFlight: 8, maxQueued: 64, rate: { burst: 60, perSecond: 2 }, bytesPerHour: 256 * 1024 * 1024 },
  app: { maxInFlight: 16, maxQueued: 256, rate: null, bytesPerHour: null },
  connection: { maxInFlight: 8, maxQueued: 128, rate: { burst: 120, perSecond: 10 }, bytesPerHour: null },
  download: { maxInFlight: 16, maxQueued: 1024, rate: null, bytesPerHour: null },
};

export const GLOBAL_MAX_IN_FLIGHT = 32;

class Semaphore {
  private active = 0;
  private readonly waiting: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  constructor(
    readonly limit: number,
    private readonly maxQueued: number,
  ) {}

  get inFlight(): number {
    return this.active;
  }
  get queued(): number {
    return this.waiting.length;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) return Promise.reject(new NetError("too-many-requests", "too many requests waiting for this caller"));
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new NetError("aborted", "request aborted while queued"));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next.resolve(); // the slot passes straight to the next waiter
    else this.active = Math.max(0, this.active - 1);
  }
}

interface CallerState {
  budget: CallerBudget;
  slots: Semaphore;
  tokens: number;
  refilledAt: number;
  /** [timestamp, bytes] entries within the last hour. */
  bytes: Array<[number, number]>;
  bytesTotal: number;
}

export class Budgets {
  private readonly callers = new Map<string, CallerState>();
  private readonly global: Semaphore;

  constructor(
    private readonly budgets: Record<Caller["kind"], CallerBudget> = DEFAULT_BUDGETS,
    globalMax = GLOBAL_MAX_IN_FLIGHT,
    private readonly now: () => number = Date.now,
  ) {
    this.global = new Semaphore(globalMax, Number.MAX_SAFE_INTEGER);
  }

  private state(caller: Caller): CallerState {
    const key = callerKey(caller);
    let state = this.callers.get(key);
    if (!state) {
      const budget = this.budgets[caller.kind];
      state = { budget, slots: new Semaphore(budget.maxInFlight, budget.maxQueued), tokens: budget.rate?.burst ?? 0, refilledAt: this.now(), bytes: [], bytesTotal: 0 };
      this.callers.set(key, state);
    }
    return state;
  }

  private takeToken(state: CallerState): void {
    const rate = state.budget.rate;
    if (!rate) return;
    const now = this.now();
    state.tokens = Math.min(rate.burst, state.tokens + ((now - state.refilledAt) / 1000) * rate.perSecond);
    state.refilledAt = now;
    if (state.tokens < 1) throw new NetError("rate-limited", "this source is making requests too fast");
    state.tokens -= 1;
  }

  private pruneBytes(state: CallerState): void {
    const cutoff = this.now() - 3_600_000;
    while (state.bytes.length && state.bytes[0][0] < cutoff) state.bytesTotal -= state.bytes.shift()![1];
  }

  /** Waits for a slot (caller first, then global) and takes one rate token. Returns the release. */
  async acquire(caller: Caller, signal?: AbortSignal): Promise<() => void> {
    const state = this.state(caller);
    this.takeToken(state);
    if (state.budget.bytesPerHour !== null) {
      this.pruneBytes(state);
      if (state.bytesTotal >= state.budget.bytesPerHour) throw new NetError("quota-exceeded", "this source has used its hourly data allowance");
    }
    await state.slots.acquire(signal);
    const usesGlobal = caller.kind !== "download";
    if (usesGlobal) {
      try {
        await this.global.acquire(signal);
      } catch (error) {
        state.slots.release();
        throw error;
      }
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (usesGlobal) this.global.release();
      state.slots.release();
    };
  }

  /** Counts received bytes; throws "quota-exceeded" once the hourly allowance is used up. */
  charge(caller: Caller, bytes: number): void {
    const state = this.state(caller);
    if (state.budget.bytesPerHour === null || bytes <= 0) return;
    this.pruneBytes(state);
    const last = state.bytes[state.bytes.length - 1];
    const now = this.now();
    if (last && now - last[0] < 1000) last[1] += bytes;
    else state.bytes.push([now, bytes]);
    state.bytesTotal += bytes;
    if (state.bytesTotal > state.budget.bytesPerHour) throw new NetError("quota-exceeded", "this source has used its hourly data allowance");
  }

  /** For tests and diagnostics. */
  snapshot(caller: Caller): { inFlight: number; queued: number; bytesThisHour: number; globalInFlight: number } {
    const state = this.state(caller);
    this.pruneBytes(state);
    return { inFlight: state.slots.inFlight, queued: state.slots.queued, bytesThisHour: state.bytesTotal, globalInFlight: this.global.inFlight };
  }
}
