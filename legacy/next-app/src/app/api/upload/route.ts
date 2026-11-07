import fs from "fs/promises";
import { safeUploadPath } from "@/server/storage";

export const dynamic = "force-dynamic";

const ALLOWED_PREFIXES = ["video/", "audio/", "image/"];
const MAX_SIZE_BYTES = 800 * 1024 * 1024; // 800MB local import cap

/** Accepts a local file (video, audio, or image) and stores it under the managed storage directory. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "misc");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "No file was provided." }, { status: 400 });
  }
  if (file.size === 0) return Response.json({ error: "File is empty." }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) {
    return Response.json({ error: "File exceeds the 800MB local import limit." }, { status: 413 });
  }
  const type = file.type || "";
  if (type && !ALLOWED_PREFIXES.some((p) => type.startsWith(p))) {
    return Response.json({ error: `Unsupported file type: ${type || "unknown"}.` }, { status: 415 });
  }

  const { absPath, relPath } = safeUploadPath(kind, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absPath, buffer);

  return Response.json({
    url: `/api/files/${relPath}`,
    fileName: file.name,
    size: file.size,
    mime: type,
  });
}
