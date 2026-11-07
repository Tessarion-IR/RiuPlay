// RiuPlay: building a title from local files the user picked - the original RiuPlay's "import a local
// file" (legacy/next-app/src/app/api/upload + storage.ts), reworked for a desktop app: files are
// referenced where they are instead of copied (videos and albums are large), and only paths the
// native picker returned in this session are accepted (see PickedPaths).
//
//   video: one or more video files -> one episode each, in natural order; a same-named .vtt beside a
//          file becomes its subtitles.
//   audio: audio files, or a folder of them (two levels deep) -> one track each; a same-named .lrc
//          or .vtt is kept as the track's lyrics (shown from Phase 8); cover.jpg/folder.jpg -> cover.
//   manga: one folder -> its images are one chapter, or each subfolder of images is a chapter.
import fs from "node:fs/promises";
import path from "node:path";
import type { AddFilesInput, LibraryStatus, MediaType } from "@shared/media";
import type { StoredMediaInput } from "../core/media/media";

export const VIDEO_EXTENSIONS = [".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ogv"];
export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wav", ".weba"];
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"];
const COVER_NAMES = ["cover", "folder", "front", "album", "artwork"];
const MAX_UNITS = 5000;
const MAX_PAGES = 2000;

export class MediaFilesError extends Error {
  constructor(message: string) {
    super(`${message} (invalid)`);
    this.name = "MediaFilesError";
  }
}

/** Paths the native picker returned this session. A path is accepted if it is one of them, or lies
 * inside a picked folder - so a page can't make the app read files the user never chose. */
export class PickedPaths {
  private readonly files = new Set<string>();
  private readonly folders = new Set<string>();
  private key = (p: string) => path.resolve(p).toLowerCase();

  remember(paths: string[], mode: "files" | "folder"): void {
    for (const p of paths) (mode === "folder" ? this.folders : this.files).add(this.key(p));
  }

  allows(p: string): boolean {
    if (!path.isAbsolute(p)) return false;
    const key = this.key(p);
    if (this.files.has(key) || this.folders.has(key)) return true;
    for (const folder of this.folders) if (key.startsWith(folder + path.sep)) return true;
    return false;
  }
}

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
const hasExt = (file: string, list: string[]) => list.includes(path.extname(file).toLowerCase());
const baseTitle = (p: string) => path.basename(p, path.extname(p)).replace(/[_.]+/g, " ").trim() || path.basename(p);

async function isDir(p: string) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function list(dir: string): Promise<{ files: string[]; dirs: string[] }> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) dirs.push(full);
    else if (entry.isFile()) files.push(full);
  }
  files.sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));
  dirs.sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));
  return { files, dirs };
}

async function sibling(file: string, extensions: string[]): Promise<string | null> {
  const stem = path.join(path.dirname(file), path.basename(file, path.extname(file)));
  for (const ext of extensions) {
    try {
      await fs.access(stem + ext);
      return stem + ext;
    } catch {
      // not there
    }
  }
  return null;
}

async function coverIn(dir: string): Promise<string> {
  const { files } = await list(dir);
  return files.find((f) => hasExt(f, IMAGE_EXTENSIONS) && COVER_NAMES.includes(path.basename(f, path.extname(f)).toLowerCase())) ?? "";
}

/** Files of the given kinds from the picked paths: files as they are, folders expanded `depth` levels. */
async function collect(paths: string[], extensions: string[], depth: number): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, level: number) => {
    const { files, dirs } = await list(dir);
    out.push(...files.filter((f) => hasExt(f, extensions)));
    if (level < depth) for (const d of dirs) await walk(d, level + 1);
  };
  for (const p of paths) {
    if (await isDir(p)) await walk(p, 1);
    else if (hasExt(p, extensions)) out.push(path.resolve(p));
  }
  return out;
}

export async function buildFromFiles(input: AddFilesInput): Promise<StoredMediaInput> {
  const { type } = input;
  const paths = input.paths.map((p) => path.resolve(p));
  if (paths.length === 0) throw new MediaFilesError("Pick at least one file or folder");
  const title = input.title?.trim().slice(0, 300);
  const libraryStatus = input.libraryStatus as LibraryStatus | undefined;

  if (type === "manga") {
    if (paths.length !== 1 || !(await isDir(paths[0]))) throw new MediaFilesError("Pick one folder for a manga");
    const root = paths[0];
    const { files, dirs } = await list(root);
    const ownPages = files.filter((f) => hasExt(f, IMAGE_EXTENSIONS));
    const chapters: StoredMediaInput["units"] = [];
    if (ownPages.length > 0 && dirs.length === 0) {
      chapters.push({ number: 1, title: path.basename(root), pages: ownPages.slice(0, MAX_PAGES) });
    } else {
      for (const dir of dirs) {
        const pages = (await list(dir)).files.filter((f) => hasExt(f, IMAGE_EXTENSIONS));
        if (pages.length) chapters.push({ number: chapters.length + 1, title: path.basename(dir), pages: pages.slice(0, MAX_PAGES) });
      }
    }
    if (chapters.length === 0) throw new MediaFilesError("No images found in that folder");
    const cover = (await coverIn(root)) || chapters[0].pages![0];
    return { type, title: title || path.basename(root), origin: "file", originRef: root, cover, units: chapters.slice(0, MAX_UNITS), libraryStatus };
  }

  const extensions = type === "video" ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS;
  const files = (await collect(paths, extensions, type === "audio" ? 2 : 1)).slice(0, MAX_UNITS);
  if (files.length === 0) throw new MediaFilesError(type === "video" ? "No video files found" : "No audio files found");
  if (paths.length > 1 || !(await isDir(paths[0]))) files.sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));
  const units: StoredMediaInput["units"] = [];
  for (const [index, file] of files.entries()) {
    const subtitle = await sibling(file, type === "video" ? [".vtt"] : [".lrc", ".vtt"]);
    units.push({ number: index + 1, title: baseTitle(file), url: file, subtitleUrl: subtitle });
  }
  const folder = (await isDir(paths[0])) ? paths[0] : path.dirname(files[0]);
  const defaultTitle = (await isDir(paths[0])) ? path.basename(paths[0]) : files.length === 1 ? baseTitle(files[0]) : path.basename(folder);
  const cover = type === "audio" ? await coverIn(folder) : "";
  return { type, title: title || defaultTitle, origin: "file", originRef: (await isDir(paths[0])) ? paths[0] : files[0], cover, units, libraryStatus };
}

/** The picker's filter for each content type. */
export function pickerFilters(type: MediaType): Electron.FileFilter[] {
  if (type === "video") return [{ name: "Video", extensions: VIDEO_EXTENSIONS.map((e) => e.slice(1)) }];
  if (type === "audio") return [{ name: "Audio", extensions: AUDIO_EXTENSIONS.map((e) => e.slice(1)) }];
  return [{ name: "Images", extensions: IMAGE_EXTENSIONS.map((e) => e.slice(1)) }];
}
