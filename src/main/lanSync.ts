// RiuPlay: LAN device sync is opt-in. Nothing listens on the network, answers discovery probes or
// reaches out to other devices until the user turns it on in Settings > Sync, and turning it off
// closes the sockets, the pairing window and the background syncs at once. hibiki started all of it
// unconditionally at launch.
//
// The controller takes its effects as dependencies so the tests can check exactly what it opens.
import { logger } from "../core/logger";
import type { SyncServerHandle } from "./sync";

export interface LanSyncDeps {
  readEnabled(): Promise<boolean>;
  writeEnabled(enabled: boolean): Promise<void>;
  /** Opens the listening sockets (main/sync.ts startSyncServer). */
  startServer(): Promise<SyncServerHandle>;
  /** Syncs with the devices this one reaches out to; failures are expected and ignored. */
  syncNow(): Promise<void>;
  /** Closes an open pairing window. */
  stopPairing(): void;
  /** Delay before the first background sync, and the interval after. */
  firstSyncDelayMs?: number;
  syncIntervalMs?: number;
}

export class LanSyncDisabledError extends Error {
  constructor() {
    super("LAN sync is turned off. Turn it on in Settings > Sync first. (lan-sync-disabled)");
    this.name = "LanSyncDisabledError";
  }
}

export interface LanSyncController {
  /** Applies the stored setting at launch: starts everything only if the user turned sync on. */
  init(): Promise<void>;
  isEnabled(): boolean;
  /** Persists the choice, then starts or stops everything to match. Returns the new state. */
  setEnabled(enabled: boolean): Promise<boolean>;
  /** Throws LanSyncDisabledError unless sync is on - for every action that touches the network. */
  assertEnabled(): void;
  /** Closes everything, e.g. at quit. Does not change the stored setting. */
  shutdown(): Promise<void>;
  /** The open sockets, or null. For tests and diagnostics. */
  server(): SyncServerHandle | null;
}

export function createLanSyncController(deps: LanSyncDeps): LanSyncController {
  const firstDelay = deps.firstSyncDelayMs ?? 5_000;
  const interval = deps.syncIntervalMs ?? 3 * 60 * 1000;
  let enabled = false;
  let handle: SyncServerHandle | null = null;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  // Serialises start/stop so a quick on-off-on can't leave two servers or a stray one behind.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const quietly = () => void deps.syncNow().catch(() => undefined);

  async function start() {
    if (handle) return;
    handle = await deps.startServer();
    timers = [setTimeout(quietly, firstDelay), setInterval(quietly, interval)];
    logger.info("sync", "LAN sync on");
  }

  async function stop() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    deps.stopPairing();
    const open = handle;
    handle = null;
    if (open) {
      await open.close();
      logger.info("sync", "LAN sync off");
    }
  }

  return {
    init: () =>
      serial(async () => {
        enabled = await deps.readEnabled().catch((error: unknown) => {
          logger.warn("sync", `could not read the LAN sync setting, keeping it off: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        });
        if (enabled) await start();
        else logger.info("sync", "LAN sync is off; no network sockets opened");
      }),
    isEnabled: () => enabled,
    setEnabled: (next) =>
      serial(async () => {
        await deps.writeEnabled(next);
        enabled = next;
        if (next) await start();
        else await stop();
        return enabled;
      }),
    assertEnabled() {
      if (!enabled) throw new LanSyncDisabledError();
    },
    shutdown: () => serial(stop),
    server: () => handle,
  };
}
