import path from "node:path";
import { app, shell, type BrowserWindow } from "electron";
import { ApkHostProcess, apkSourcesPort, locateApkHost, setApkHost, systemLocateOptions } from "./apkHost";
import { PageBridge } from "./apkPages";
import { createElectronPageDriver } from "./apkPageWindow";
import { desktopUpdateKey } from "@shared/appUpdateSelection";
import { electronSyncTransport } from "./syncTransport";
import type { Platform } from "../types";
import { electronAppInstaller } from "./appInstaller";
import { electronBrowser } from "./browser";
import { electronDb } from "./db";
import { electronDownloadTransfer } from "./downloadTransfer";
import { ElectronExtensionHost } from "./extensionHost";
import { apkRuntimeEnabled } from "./apkOptIn";
import { netClient } from "../../main/net/state";
import type { Caller } from "../../main/net/policy";

/** Repository files for APK sources (Keiyoushi's repo.json, index.pb and signed jars), through NetClient. */
async function fetchRepositoryBytes(url: string): Promise<Buffer> {
  const response = await netClient.request({ url, caller: { kind: "app", purpose: "extension-repository" }, timeoutMs: 60_000 });
  if (response.status < 200 || response.status >= 300) throw new Error(`Repository request failed: HTTP ${response.status}`);
  return response.body;
}

/** Who the confined APK host's connections are checked as (an APK id: any public host, never private ones). */
const APK_HOST_CALLER: Caller = { kind: "extension", sourceId: "apk:host" };
import { SandboxedExtensionHost } from "../../main/extensions/sandbox/sandboxHost";
import { fileURLToPath } from "node:url";

import { electronFiles } from "./files";
import { electronHttp } from "./http";
import { electronPaths } from "./paths";
import { electronPlayer } from "./player";
import { electronSecureStore } from "./secureStore";

/** `getWindow` is read at emit time: the window can be recreated (macOS `activate`) while the
 * backend keeps running. */
export function createElectronPlatform(getWindow: () => BrowserWindow | null): Platform {
  // APK sources run in a JVM process of their own (see apkHost.ts); an install without the jars or
  // a Java to run them simply has none, and the rest of the app does not know the difference.
  const apkLocation = locateApkHost(systemLocateOptions(app.getAppPath(), app.isPackaged ? process.resourcesPath : null));
  // RiuPlay K4: the host runs confined (AppContainer + Job Object, network only through the broker), so it
  // is available unless the person switched it off (apkOptIn.ts). Without confinement, locateApkHost is null.
  const apkHost = apkLocation && apkRuntimeEnabled(app.getPath("userData"))
    ? new ApkHostProcess(apkLocation, path.join(app.getPath("userData"), "apk-host"), (host, port, signal) => netClient.openTunnel(APK_HOST_CALLER, host, port, signal))
    : null;
  setApkHost(apkHost);
  // The pages APK sources load (a player embed whose requests give away the video) run as hidden windows here.
  if (apkHost) new PageBridge(apkHost, createElectronPageDriver);
  return {
    kind: "electron",
    capabilities: {
      windowControls: true,
      zoom: true,
      discordPresence: true,
      hardwareAccelerationToggle: true,
      revealLogFolder: true,
    },
    paths: electronPaths(),
    files: electronFiles,
    secureStore: electronSecureStore,
    http: electronHttp,
    downloads: electronDownloadTransfer,
    db: electronDb,
    browser: electronBrowser,
    player: electronPlayer,
    events: {
      emit(channel, payload) {
        const window = getWindow();
        if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
      },
    },
    app: {
      version: () => app.getVersion(),
      updateKey: () => desktopUpdateKey(process.platform, process.arch),
      openExternal: (url) => shell.openExternal(url),
      relaunch() {
        app.relaunch();
        app.exit();
      },
    },
    // RiuPlay M2: extensions run in Chromium-sandboxed hosts (main/extensions/sandbox). The old
    // in-process node:vm worker is NOT a sandbox; it is kept only as an explicit developer
    // fallback (RIUPLAY_LEGACY_EXTENSION_RUNTIME=1) and is never selected otherwise.
    extensionHost: process.env.RIUPLAY_LEGACY_EXTENSION_RUNTIME === "1"
      ? new ElectronExtensionHost()
      : new SandboxedExtensionHost({ workerBundlePath: path.join(path.dirname(fileURLToPath(import.meta.url)), "extension-host-worker.js") }),
    appInstaller: electronAppInstaller,
    // Reaching another computer for device sync; this one also listens (main/sync.ts).
    syncTransport: electronSyncTransport,
    apkSources: apkHost ? apkSourcesPort(apkHost, fetchRepositoryBytes) : undefined,
  };
}
