import { ipcMain } from "electron";
import { IPC } from "@shared/ipc";
import type { MarketplaceExtension } from "@shared/types";
import { createExtensionsApi } from "../../core/api/extensions";
import { createRepositoriesApi } from "../../core/api/repositories";
import { findMissingSources, sourcesInData } from "../../core/api/sourceAutoInstall";
import type { ExtensionRuntime } from "../../core/extensions/runtime";

export function registerMarketplaceHandlers(runtime: ExtensionRuntime): void {
  const { repositories, marketplace } = createRepositoriesApi();
  ipcMain.handle(IPC.sourcesRepositoriesList, () => repositories.list());
  ipcMain.handle(IPC.sourcesRepositoriesAdd, (_e, url: string) => repositories.add(url));
  ipcMain.handle(IPC.sourcesRepositoriesRemove, (_e, url: string) => repositories.remove(url));
  ipcMain.handle(IPC.sourcesMarketplaceFetch, (_e, urls: string[]) => marketplace(urls));
  ipcMain.handle(IPC.sourcesRepositoriesDetails, () => repositories.details!());
  ipcMain.handle(IPC.sourcesRepositoriesSetEnabled, (_e, url: string, enabled: boolean) => repositories.setEnabled!(url, enabled));
  ipcMain.handle(IPC.sourcesRepositoriesSetTrust, (_e, url: string, trust: "untrusted" | "trusted") => repositories.setTrust!(url, trust));

  const extensions = createExtensionsApi(runtime);
  ipcMain.handle(IPC.sourcesInstall, (_e, extension: MarketplaceExtension, originUrl: string, consent?: { acceptedPermissions: string[] }) =>
    extensions.install(extension, originUrl, consent && Array.isArray(consent.acceptedPermissions) ? { acceptedPermissions: consent.acceptedPermissions.filter((p) => typeof p === "string") } : undefined),
  );
  ipcMain.handle(IPC.sourcesExtensionStates, () => extensions.extensionStates!());
  ipcMain.handle(IPC.sourcesSetExtensionEnabled, (_e, id: string, enabled: boolean) => extensions.setExtensionEnabled!(id, enabled));
  ipcMain.handle(IPC.sourcesInstalledVersions, () => extensions.installedVersions());
  ipcMain.handle(IPC.sourcesUninstall, (_e, id: string) => extensions.uninstall(id));
  ipcMain.handle(IPC.sourcesMissing, async () => findMissingSources(runtime, await sourcesInData(), { apkFromDefaultOnly: false }));
}
