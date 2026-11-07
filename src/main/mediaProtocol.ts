// RiuPlay: the riuplay-media:// scheme - how the page plays, shows and reads files of titles imported
// from disk. It resolves each URL through the database (core/media/resolve.ts), so only files the
// user imported are ever served, and streams them with HTTP Range support so <video>/<audio> can
// seek. Ported from the original RiuPlay's /api/files/[...path] route (Range + traversal guard).
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_SCHEME } from "../core/media/media";
import { resolveMediaUrl } from "../core/media/resolve";

export { MEDIA_SCHEME };

export const MEDIA_SCHEME_PRIVILEGES = { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } as const;

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".vtt": "text/vtt; charset=utf-8",
  ".lrc": "text/plain; charset=utf-8",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Parses a single `bytes=start-end` range against a file size; null for none, "invalid" for unsatisfiable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export async function handleMediaRequest(request: Request): Promise<Response> {
  const file = await resolveMediaUrl(request.url);
  if (!file) return new Response("Not found", { status: 404 });
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response("File missing", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  const type = contentTypeFor(file);
  const range = parseRange(request.headers.get("range"), stat.size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (range) {
    const stream = Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`, "Content-Length": String(range.end - range.start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });
}
