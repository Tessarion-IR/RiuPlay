import { z } from "zod";
import { addChapter, addEpisode, addTrack, deleteMediaItem, getMediaItemFull } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getMediaItemFull(Number(id));
  if (!full) return Response.json({ error: "Media item not found." }, { status: 404 });
  return Response.json(full);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteMediaItem(Number(id));
  return Response.json({ ok: true });
}

const AddUnitSchema = z.object({
  kind: z.enum(["episode", "chapter", "track"]),
  number: z.number(),
  title: z.string().max(200).optional().default(""),
  videoUrl: z.string().url().optional(),
  subtitleUrl: z.string().url().optional().nullable(),
  audioUrl: z.string().url().optional(),
  durationSeconds: z.number().optional().nullable(),
  pages: z.array(z.string().url()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mediaItemId = Number(id);
  const body = await req.json().catch(() => null);
  const parsed = AddUnitSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid unit payload." }, { status: 400 });
  const data = parsed.data;

  if (data.kind === "episode") {
    if (!data.videoUrl) return Response.json({ error: "videoUrl is required for episodes." }, { status: 400 });
    const created = await addEpisode(mediaItemId, {
      number: data.number,
      title: data.title,
      videoUrl: data.videoUrl,
      subtitleUrl: data.subtitleUrl,
      durationSeconds: data.durationSeconds,
    });
    return Response.json({ unit: created });
  }
  if (data.kind === "chapter") {
    if (!data.pages?.length) return Response.json({ error: "At least one page URL is required." }, { status: 400 });
    const created = await addChapter(mediaItemId, { number: data.number, title: data.title, pages: data.pages });
    return Response.json({ unit: created });
  }
  if (!data.audioUrl) return Response.json({ error: "audioUrl is required for tracks." }, { status: 400 });
  const created = await addTrack(mediaItemId, {
    number: data.number,
    title: data.title,
    audioUrl: data.audioUrl,
    durationSeconds: data.durationSeconds,
  });
  return Response.json({ unit: created });
}
