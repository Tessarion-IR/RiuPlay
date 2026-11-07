// RiuPlay: the media part of the backend over IPC (shared/media.ts MediaApi), plus the two pieces that
// need the operating system: the native file picker and building a title from picked files.
import { BrowserWindow, dialog, ipcMain } from "electron";
import { IPC } from "@shared/ipc";
import { MEDIA_TYPES, type AddFilesInput, type AddMediaInput, type LibraryStatus, type MediaPatch, type MediaRef, type MediaType, type UnitInput } from "@shared/media";
import { createMediaApi } from "../../core/media";
import { insertMedia } from "../../core/media/media";
import { buildFromFiles, MediaFilesError, PickedPaths, pickerFilters } from "../mediaFiles";

const picked = new PickedPaths();

function mediaType(value: unknown): MediaType {
  if (typeof value !== "string" || !MEDIA_TYPES.includes(value as MediaType)) throw new TypeError("unknown media type");
  return value as MediaType;
}
function intId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError("id must be a positive integer");
  return value;
}

export async function addFromFiles(input: AddFilesInput) {
  const type = mediaType(input?.type);
  const paths = Array.isArray(input?.paths) ? input.paths.filter((p): p is string => typeof p === "string") : [];
  if (paths.length === 0 || paths.length > 5000) throw new MediaFilesError("Pick between 1 and 5000 files");
  // Only what the native picker handed out this session - never a path the page made up.
  if (!paths.every((p) => picked.allows(p))) throw new MediaFilesError("These files were not chosen in the file picker");
  const built = await buildFromFiles({ type, paths, title: typeof input.title === "string" ? input.title : undefined, libraryStatus: input.libraryStatus });
  return insertMedia(built);
}

export function registerMediaHandlers(): void {
  const media = createMediaApi();

  ipcMain.handle(IPC.mediaList, (_e, filter?: { type?: MediaType; search?: string; inLibrary?: boolean }) => media.list(filter ?? {}));
  ipcMain.handle(IPC.mediaGet, (_e, id: unknown) => media.get(intId(id)));
  ipcMain.handle(IPC.mediaAdd, (_e, input: AddMediaInput) => media.add(input));
  ipcMain.handle(IPC.mediaAddFiles, (_e, input: AddFilesInput) => addFromFiles(input));
  ipcMain.handle(IPC.mediaPickFiles, async (event, rawType: unknown, rawMode: unknown) => {
    const type = mediaType(rawType);
    const mode = rawMode === "folder" ? "folder" : "files";
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options: Electron.OpenDialogOptions = {
      title: type === "manga" ? "Choose a manga folder" : type === "audio" ? "Choose audio files or a folder" : "Choose video files",
      properties: mode === "folder" ? ["openDirectory"] : ["openFile", "multiSelections"],
      filters: mode === "files" ? pickerFilters(type) : undefined,
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    picked.remember(result.filePaths, mode);
    return result.filePaths;
  });
  ipcMain.handle(IPC.mediaUpdate, (_e, id: unknown, patch: MediaPatch) => media.update(intId(id), patch));
  ipcMain.handle(IPC.mediaRemove, (_e, id: unknown) => media.remove(intId(id)));
  ipcMain.handle(IPC.mediaAddUnit, (_e, mediaId: unknown, unit: UnitInput) => media.addUnit(intId(mediaId), unit));
  ipcMain.handle(IPC.mediaRemoveUnit, (_e, unitId: unknown) => media.removeUnit(intId(unitId)));
  ipcMain.handle(IPC.mediaSetLibrary, (_e, mediaId: unknown, state: { status: LibraryStatus; favorite?: boolean } | null) => media.setLibrary(intId(mediaId), state));
  ipcMain.handle(IPC.mediaSetFavorite, (_e, mediaId: unknown, favorite: unknown) => media.setFavorite(intId(mediaId), favorite === true));
  ipcMain.handle(IPC.mediaSaveProgress, (_e, unitId: unknown, position: number, duration: number) => media.saveProgress(intId(unitId), Number(position), Number(duration)));
  ipcMain.handle(IPC.mediaSetUnitCompleted, (_e, unitId: unknown, completed: unknown) => media.setUnitCompleted(intId(unitId), completed === true));
  ipcMain.handle(IPC.mediaContinue, (_e, type: unknown, limit?: number) => media.continueList(mediaType(type), typeof limit === "number" ? limit : 12));
  ipcMain.handle(IPC.mediaRecent, (_e, limit?: number) => media.recentlyAdded(typeof limit === "number" ? limit : 12));

  ipcMain.handle(IPC.collectionsList, () => media.collections.list());
  ipcMain.handle(IPC.collectionsCreate, (_e, name: string, description?: string) => media.collections.create(name, description));
  ipcMain.handle(IPC.collectionsUpdate, (_e, id: unknown, patch: { name?: string; description?: string }) => media.collections.update(intId(id), patch ?? {}));
  ipcMain.handle(IPC.collectionsRemove, (_e, id: unknown) => media.collections.remove(intId(id)));
  ipcMain.handle(IPC.collectionsItems, (_e, id: unknown) => media.collections.items(intId(id)));
  ipcMain.handle(IPC.collectionsAddItem, (_e, id: unknown, ref: MediaRef) => media.collections.addItem(intId(id), ref));
  ipcMain.handle(IPC.collectionsRemoveItem, (_e, id: unknown, ref: MediaRef) => media.collections.removeItem(intId(id), ref));
  ipcMain.handle(IPC.collectionsOf, (_e, ref: MediaRef) => media.collections.of(ref));
}
