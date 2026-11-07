// RiuPlay: the sync IPC as the app registers it at launch. With the stored setting off (the
// default), registration must not start the sync server, and every network action must be refused.
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) } }));
vi.mock("../../core/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const setting = { value: false };
vi.mock("../../core/appSettings", () => ({
  getAppSetting: vi.fn(async () => setting.value),
  setAppSetting: vi.fn(async (_key: string, value: boolean) => void (setting.value = value)),
}));

const api = {
  devices: vi.fn(async () => []),
  remove: vi.fn(async () => {}),
  startPairing: vi.fn(async () => ({ code: "123456", expiresAt: 0, closesAt: 0 })),
  stopPairing: vi.fn(async () => {}),
  pairingInfo: vi.fn(async () => null),
  discover: vi.fn(async () => []),
  pair: vi.fn(async () => ({})),
  syncNow: vi.fn(async () => {}),
};
vi.mock("../../core/api/sync", () => ({ createSyncServerApi: () => api }));
vi.mock("../../core/sync/server", () => ({ stopPairing: vi.fn() }));

const close = vi.fn(async () => {});
const startSyncServer = vi.fn(async () => ({ tcpPort: 47652, udpPort: 47653, close }));
vi.mock("../sync", () => ({ startSyncServer }));

const { IPC } = await import("@shared/ipc");
const { registerSyncHandlers } = await import("./sync");

const call = (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!({}, ...args));

beforeEach(() => {
  handlers.clear();
  setting.value = false;
  vi.clearAllMocks();
});

describe("sync IPC at launch", () => {
  it("does not start the sync server while LAN sync is off", async () => {
    const lan = registerSyncHandlers();
    await lan.init(); // registerSyncHandlers already started it; this waits for it to settle
    expect(startSyncServer).not.toHaveBeenCalled();
    expect(await call(IPC.syncIsEnabled)).toBe(false);
    await lan.shutdown();
  });

  it("refuses pairing, discovery, pairing with a device and syncing while off", async () => {
    const lan = registerSyncHandlers();
    await lan.init();
    for (const channel of [IPC.syncStartPairing, IPC.syncDiscover, IPC.syncPair, IPC.syncNow]) {
      await expect(call(channel)).rejects.toThrow(/lan-sync-disabled/);
    }
    expect(api.startPairing).not.toHaveBeenCalled();
    expect(api.discover).not.toHaveBeenCalled();
    expect(api.pair).not.toHaveBeenCalled();
    expect(api.syncNow).not.toHaveBeenCalled();
    // Local data stays reachable: listing and forgetting paired devices.
    await expect(call(IPC.syncDevices)).resolves.toEqual([]);
    await lan.shutdown();
  });

  it("starts the server once turned on, and closes it when turned off", async () => {
    const lan = registerSyncHandlers();
    await lan.init();
    expect(await call(IPC.syncSetEnabled, true)).toBe(true);
    expect(setting.value).toBe(true);
    expect(startSyncServer).toHaveBeenCalledTimes(1);
    await expect(call(IPC.syncStartPairing)).resolves.toMatchObject({ code: "123456" });
    expect(await call(IPC.syncSetEnabled, false)).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    await lan.shutdown();
  });

  it("rejects a non-boolean from the page", async () => {
    const lan = registerSyncHandlers();
    await lan.init();
    await expect(call(IPC.syncSetEnabled, "yes")).rejects.toThrow(TypeError);
    expect(startSyncServer).not.toHaveBeenCalled();
    await lan.shutdown();
  });
});
