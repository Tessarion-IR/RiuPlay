import { ipcMain } from "electron";
import { IPC } from "@shared/ipc";
import type { SyncCandidate, SyncPairMode } from "@shared/types";
import { createSyncServerApi } from "../../core/api/sync";
import { getAppSetting, setAppSetting } from "../../core/appSettings";
import { stopPairing } from "../../core/sync/server";
import { createLanSyncController, type LanSyncController } from "../lanSync";
import { startSyncServer } from "../sync";

let controller: LanSyncController | null = null;

/** The computer's side of device sync. RiuPlay: everything that touches the network is opt-in (see
 * lanSync.ts) - listing and forgetting paired devices only reads local data and always works. */
export function registerSyncHandlers(): LanSyncController {
  const sync = createSyncServerApi();
  const lan = createLanSyncController({
    readEnabled: () => getAppSetting("lanSync.enabled"),
    writeEnabled: (enabled) => setAppSetting("lanSync.enabled", enabled),
    startServer: () => startSyncServer(),
    syncNow: () => sync.syncNow!(),
    stopPairing,
  });
  controller = lan;

  const guarded =
    <A extends unknown[], R>(action: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      lan.assertEnabled();
      return action(...args);
    };

  ipcMain.handle(IPC.syncDevices, () => sync.devices());
  ipcMain.handle(IPC.syncRemove, (_e, deviceId: string) => sync.remove(deviceId));
  ipcMain.handle(IPC.syncIsEnabled, () => lan.isEnabled());
  ipcMain.handle(IPC.syncSetEnabled, async (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
    return lan.setEnabled(enabled);
  });
  ipcMain.handle(IPC.syncStartPairing, guarded(() => sync.startPairing!()));
  ipcMain.handle(IPC.syncStopPairing, () => sync.stopPairing!());
  ipcMain.handle(IPC.syncPairingInfo, () => sync.pairingInfo!());
  ipcMain.handle(IPC.syncDiscover, guarded(() => sync.discover!()));
  ipcMain.handle(IPC.syncPair, guarded((_e: unknown, candidate: SyncCandidate, code: string, mode: SyncPairMode) => sync.pair!(candidate, code, mode)));
  ipcMain.handle(IPC.syncNow, guarded(() => sync.syncNow!()));

  void lan.init();
  return lan;
}

/** Closes the LAN sockets at quit. */
export function shutdownSync(): Promise<void> {
  return controller?.shutdown() ?? Promise.resolve();
}
