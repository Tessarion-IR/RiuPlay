import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import checkDiskSpace from "check-disk-space";

// All application-managed files live under STORAGE_ROOT (defaults to ./storage
// next to the project). This keeps user-imported media and downloads outside
// of the Next.js build/public output, and documents exactly where data lives
// (see README "Where data is stored").
export const STORAGE_ROOT = process.env.RIUPLAY_STORAGE_DIR
  ? path.resolve(process.env.RIUPLAY_STORAGE_DIR)
  : path.resolve(process.cwd(), "storage");

export const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");
export const DOWNLOADS_DIR = path.join(STORAGE_ROOT, "downloads");
export const CACHE_DIR = path.join(STORAGE_ROOT, "cache");
export const BACKUPS_DIR = path.join(STORAGE_ROOT, "backups");

export function ensureDirs() {
  for (const dir of [UPLOADS_DIR, DOWNLOADS_DIR, CACHE_DIR, BACKUPS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const SAFE_SUBDIRS = new Set(["anime", "audio", "manga", "avatars", "misc"]);

export function safeUploadPath(subdir: string, originalName: string) {
  ensureDirs();
  const dir = SAFE_SUBDIRS.has(subdir) ? subdir : "misc";
  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
  const id = crypto.randomBytes(12).toString("hex");
  const targetDir = path.join(UPLOADS_DIR, dir);
  fs.mkdirSync(targetDir, { recursive: true });
  const fileName = `${id}${ext}`;
  return { absPath: path.join(targetDir, fileName), relPath: path.posix.join("uploads", dir, fileName) };
}

export function resolveStoredFile(relPath: string): string | null {
  // Defend against path traversal: resolve and verify the result stays inside STORAGE_ROOT.
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(STORAGE_ROOT, normalized);
  if (!abs.startsWith(STORAGE_ROOT + path.sep) && abs !== STORAGE_ROOT) return null;
  return abs;
}

export async function getFreeDiskSpace(targetPath: string) {
  ensureDirs();
  try {
    const info = await checkDiskSpace(targetPath);
    return info;
  } catch {
    return null;
  }
}

export function downloadFilePath(mediaItemId: number, unitId: number | null, suggestedName: string) {
  ensureDirs();
  const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
  const fileName = `${mediaItemId}_${unitId ?? "x"}_${safeName}`;
  return path.join(DOWNLOADS_DIR, fileName);
}

export async function fileExists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
