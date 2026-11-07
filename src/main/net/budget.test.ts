import { describe, expect, it } from "vitest";
import { Budgets, DEFAULT_BUDGETS } from "./budget";
import { NetError } from "./errors";
import type { Caller } from "./policy";

const ext = (id = "a"): Caller => ({ kind: "extension", sourceId: id });
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof NetError ? e.code : String(e)));

describe("budgets", () => {
  it("limits one caller's requests in flight and hands the slot to the next waiter", async () => {
    const budgets = new Budgets();
    const releases = await Promise.all(Array.from({ length: 8 }, () => budgets.acquire(ext())));
    let ninthStarted = false;
    const ninth = budgets.acquire(ext()).then((release) => ((ninthStarted = true), release));
    await new Promise((r) => setTimeout(r, 10));
    expect(ninthStarted).toBe(false);
    expect(budgets.snapshot(ext())).toMatchObject({ inFlight: 8, queued: 1 });
    releases[0]();
    (await ninth)();
    expect(ninthStarted).toBe(true);
    releases.slice(1).forEach((r) => r());
    expect(budgets.snapshot(ext()).inFlight).toBe(0);
  });

  it("refuses beyond the queue bound with too-many-requests", async () => {
    const budgets = new Budgets({ ...DEFAULT_BUDGETS, extension: { ...DEFAULT_BUDGETS.extension, maxInFlight: 1, maxQueued: 2, rate: null } });
    const first = await budgets.acquire(ext());
    const queued = [budgets.acquire(ext()), budgets.acquire(ext())];
    expect(await codeOf(budgets.acquire(ext()))).toBe("too-many-requests");
    first();
    for (const q of queued) (await q)();
  });

  it("an aborted waiter leaves the queue", async () => {
    const budgets = new Budgets({ ...DEFAULT_BUDGETS, extension: { ...DEFAULT_BUDGETS.extension, maxInFlight: 1, rate: null } });
    const first = await budgets.acquire(ext());
    const controller = new AbortController();
    const waiting = budgets.acquire(ext(), controller.signal);
    controller.abort();
    expect(await codeOf(waiting)).toBe("aborted");
    expect(budgets.snapshot(ext()).queued).toBe(0);
    first();
  });

  it("rate-limits with a token bucket that refills over time", async () => {
    let now = 0;
    const budgets = new Budgets({ ...DEFAULT_BUDGETS, extension: { ...DEFAULT_BUDGETS.extension, rate: { burst: 3, perSecond: 1 } } }, 32, () => now);
    for (let i = 0; i < 3; i++) (await budgets.acquire(ext()))();
    expect(await codeOf(budgets.acquire(ext()))).toBe("rate-limited");
    now += 1_000;
    (await budgets.acquire(ext()))();
    expect(await codeOf(budgets.acquire(ext()))).toBe("rate-limited");
  });

  it("enforces an hourly byte quota per source, isolated between sources, rolling over after an hour", async () => {
    let now = 0;
    const budgets = new Budgets({ ...DEFAULT_BUDGETS, extension: { ...DEFAULT_BUDGETS.extension, bytesPerHour: 1000 } }, 32, () => now);
    budgets.charge(ext(), 600);
    expect(() => budgets.charge(ext(), 600)).toThrowError(/quota-exceeded/);
    expect(await codeOf(budgets.acquire(ext()))).toBe("quota-exceeded");
    expect(await codeOf(budgets.acquire(ext("b")).then((r) => r()))).toBe("ok");
    now += 3_600_001;
    expect(await codeOf(budgets.acquire(ext()).then((r) => r()))).toBe("ok");
  });

  it("caps everything but downloads globally; downloads have their own cap", async () => {
    const budgets = new Budgets(DEFAULT_BUDGETS, 4);
    const held = await Promise.all([1, 2, 3, 4].map((i) => budgets.acquire(ext(`s${i}`))));
    let started = false;
    const fifth = budgets.acquire({ kind: "app", purpose: "x" }).then((r) => ((started = true), r));
    const download = await budgets.acquire({ kind: "download" }); // not blocked by the global cap
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(false);
    held[0]();
    (await fifth)();
    download();
    held.slice(1).forEach((r) => r());
  });

  it("release is idempotent", async () => {
    const budgets = new Budgets();
    const release = await budgets.acquire(ext());
    release();
    release();
    expect(budgets.snapshot(ext()).inFlight).toBe(0);
  });
});
