import fs from "fs/promises";
import { z } from "zod";
import { deleteDownloadRecord, getDownload, getOrCreateDefaultProfile, getSettingsForProfile } from "@/server/queries";
import { cancelDownload, retryDownload } from "@/server/downloadManager";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ action: z.enum(["cancel", "retry"]) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const downloadId = Number(id);
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "action must be cancel or retry." }, { status: 400 });

  if (parsed.data.action === "cancel") {
    const ok = await cancelDownload(downloadId);
    return Response.json({ ok });
  }

  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);
  await retryDownload(downloadId, settings.proxy);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getDownload(Number(id));
  if (record?.filePath) {
    await fs.unlink(record.filePath).catch(() => undefined);
  }
  await deleteDownloadRecord(Number(id));
  return Response.json({ ok: true });
}
