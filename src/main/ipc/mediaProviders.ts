// RiuPlay M8: IPC for extensions as media providers (main/extensions/mediaProvider.ts). Every
// argument is checked here; ids and queries are bounded, and the service only follows stored data.
import { ipcMain } from "electron";
import { IPC } from "@shared/ipc";
import { MEDIA_TYPES, type MediaType } from "@shared/media";
import type { ExtensionMediaService } from "../extensions/mediaProvider";

const isType = (v: unknown): v is MediaType => typeof v === "string" && (MEDIA_TYPES as readonly string[]).includes(v);
const isSourceId = (v: unknown): v is string => typeof v === "string" && /^[\w.:-]{1,120}$/.test(v);
const isTitleId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 500;
const isUnitId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e12;

function need<T>(ok: boolean, value: T, what: string): T {
  if (!ok) throw new TypeError(`invalid ${what}`);
  return value;
}

export function registerMediaProviderHandlers(service: () => ExtensionMediaService | null): void {
  const s = () => {
    const current = service();
    if (!current) throw new Error("Extensions are still loading");
    return current;
  };
  ipcMain.handle(IPC.mediaProvidersSources, (_e, type: unknown) => s().sources(need(isType(type), type as MediaType, "media type")));
  ipcMain.handle(IPC.mediaProvidersBrowse, (_e, type: unknown, sourceId: unknown, query: unknown, offset: unknown) =>
    s().browse(
      need(isType(type), type as MediaType, "media type"),
      need(isSourceId(sourceId), sourceId as string, "source"),
      typeof query === "string" ? query.slice(0, 200) : "",
      typeof offset === "number" && Number.isInteger(offset) && offset >= 0 && offset <= 100_000 ? offset : 0,
    ),
  );
  ipcMain.handle(IPC.mediaProvidersDetail, (_e, sourceId: unknown, titleId: unknown) =>
    s().detail(need(isSourceId(sourceId), sourceId as string, "source"), need(isTitleId(titleId), titleId as string, "title")),
  );
  ipcMain.handle(IPC.mediaProvidersOpen, (_e, sourceId: unknown, titleId: unknown) =>
    s().open(need(isSourceId(sourceId), sourceId as string, "source"), need(isTitleId(titleId), titleId as string, "title")),
  );
  ipcMain.handle(IPC.mediaProvidersLoadPages, (_e, unitId: unknown) => s().loadPages(need(isUnitId(unitId), unitId as number, "chapter")));
}
