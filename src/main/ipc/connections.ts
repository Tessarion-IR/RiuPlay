// RiuPlay M4/M5: IPC for the user's Suwayomi / Kikoeru servers. One narrow handler per operation,
// every argument validated here. Passwords go in (add / update) and never come back: listings carry
// `hasSecret` only. Reading and playback go through riuplay-media://remote..., which the main
// process serves with the credentials (main/connections/service.ts); progress, favourites and
// collections use the existing media API, since server titles are ordinary MediaItems.
import { ipcMain } from "electron";
import { IPC } from "@shared/ipc";
import type { ServerConnectionInput } from "@shared/types";
import type { ConnectionsService } from "../connections/service";
import type { SuwayomiBrowseType } from "../connections/clients";

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9;
const isRef = (v: unknown): v is string => typeof v === "string" && /^\d{1,12}$/.test(v);
const pageOf = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10_000 ? v : 1);
const optText = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

function need<T>(ok: boolean, value: T, what: string): T {
  if (!ok) throw new TypeError(`invalid ${what}`);
  return value;
}

export function sanitizeConnectionInput(raw: unknown, partial: boolean): Partial<ServerConnectionInput> {
  if (!raw || typeof raw !== "object") throw new TypeError("invalid server settings");
  const r = raw as Record<string, unknown>;
  const out: Partial<ServerConnectionInput> = {};
  if (r.kind !== undefined || !partial) out.kind = need(r.kind === "suwayomi" || r.kind === "kikoeru", r.kind as ServerConnectionInput["kind"], "server type");
  if (r.baseUrl !== undefined || !partial) out.baseUrl = need(typeof r.baseUrl === "string" && r.baseUrl.length > 0 && r.baseUrl.length < 500, r.baseUrl as string, "server address");
  if (r.name !== undefined) out.name = optText(r.name, 80) ?? "";
  if (r.authMode !== undefined) out.authMode = need(["none", "basic", "ui_login", "token"].includes(r.authMode as string), r.authMode as ServerConnectionInput["authMode"], "sign-in mode");
  if (r.username !== undefined) out.username = r.username === null ? null : need(typeof r.username === "string" && r.username.length <= 255 && !/[\r\n]/.test(r.username), r.username as string, "user name");
  if (r.password !== undefined) out.password = r.password === null ? null : need(typeof r.password === "string" && r.password.length <= 1024 && !/[\r\n]/.test(r.password), r.password as string, "password");
  if (r.localConfirmed !== undefined) out.localConfirmed = r.localConfirmed === true;
  return out;
}

export function registerConnectionHandlers(service: ConnectionsService): void {
  ipcMain.handle(IPC.connectionsList, () => service.list());
  ipcMain.handle(IPC.connectionsAdd, (_e, input: unknown) => service.add(sanitizeConnectionInput(input, false) as ServerConnectionInput));
  ipcMain.handle(IPC.connectionsUpdate, (_e, id: unknown, patch: unknown) => service.update(need(isId(id), id as number, "connection"), sanitizeConnectionInput(patch, true)));
  ipcMain.handle(IPC.connectionsRemove, async (_e, id: unknown) => {
    await service.remove(need(isId(id), id as number, "connection"));
    return service.list();
  });
  ipcMain.handle(IPC.connectionsTest, (_e, id: unknown) => service.test(need(isId(id), id as number, "connection")));
  ipcMain.handle(IPC.connectionsSuwayomiSources, (_e, id: unknown) => service.suwayomiSources(need(isId(id), id as number, "connection")));
  ipcMain.handle(IPC.connectionsSuwayomiBrowse, (_e, id: unknown, sourceId: unknown, type: unknown, page: unknown, query: unknown) =>
    service.suwayomiBrowse(
      need(isId(id), id as number, "connection"),
      need(typeof sourceId === "string" && /^-?\d{1,20}$/.test(sourceId), sourceId as string, "source"),
      need(type === "POPULAR" || type === "LATEST" || type === "SEARCH", type as SuwayomiBrowseType, "browse type"),
      pageOf(page),
      optText(query, 200),
    ),
  );
  ipcMain.handle(IPC.connectionsKikoeruBrowse, (_e, id: unknown, page: unknown, query: unknown) => service.kikoeruBrowse(need(isId(id), id as number, "connection"), pageOf(page), optText(query, 200)));
  ipcMain.handle(IPC.connectionsAddToLibrary, (_e, id: unknown, ref: unknown) => service.addToLibrary(need(isId(id), id as number, "connection"), need(isRef(ref), ref as string, "title")));
  ipcMain.handle(IPC.connectionsLoadPages, (_e, unitId: unknown) => service.loadPages(need(isId(unitId), unitId as number, "chapter")));
}
