import { z } from "zod";
import { getOrCreateDefaultProfile, getSettingsForProfile, listDownloads } from "@/server/queries";
import { startDownload } from "@/server/downloadManager";
import { isHttpUrl } from "@/server/net";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listDownloads();
  return Response.json({ items });
}

const BodySchema = z.object({
  mediaItemId: z.number().int(),
  unitId: z.number().int().nullable(),
  unitType: z.enum(["episode", "track"]),
  title: z.string().max(200),
  sourceUrl: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid download request." }, { status: 400 });
  const sourceUrlValue: string = parsed.data.sourceUrl;
  const isLocalFile = sourceUrlValue.startsWith("/api/files/");
  if (!isLocalFile && !isHttpUrl(sourceUrlValue)) {
    return Response.json({ error: "Only http(s) or local managed file URLs can be downloaded." }, { status: 400 });
  }

  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);

  try {
    const sourceUrl = parsed.data.sourceUrl.startsWith("/api/files/")
      ? `http://127.0.0.1:${process.env.PORT ?? 3000}${parsed.data.sourceUrl}`
      : parsed.data.sourceUrl;
    const record = await startDownload(
      parsed.data.mediaItemId,
      parsed.data.unitId,
      parsed.data.unitType,
      parsed.data.title,
      sourceUrl,
      settings.proxy,
    );
    return Response.json({ download: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start download.";
    return Response.json({ error: message }, { status: 400 });
  }
}
