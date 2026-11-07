import { z } from "zod";
import { addChapter, addEpisode, addTrack, findOrCreateMediaItem, listMediaItems } from "@/server/queries";
import { isHttpUrl } from "@/server/net";
import type { ContentType } from "@/lib/types";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contentType = (searchParams.get("contentType") as ContentType | null) ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const items = await listMediaItems(contentType || undefined, search || undefined);
  return Response.json({ items });
}

const EpisodeSchema = z.object({
  number: z.number(),
  title: z.string().max(200).optional().default(""),
  videoUrl: z.string().url(),
  subtitleUrl: z.string().url().optional().nullable(),
  durationSeconds: z.number().optional().nullable(),
});

const ChapterSchema = z.object({
  number: z.number(),
  title: z.string().max(200).optional().default(""),
  pages: z.array(z.string().url()).min(1),
});

const TrackSchema = z.object({
  number: z.number(),
  title: z.string().max(200).optional().default(""),
  audioUrl: z.string().url(),
  durationSeconds: z.number().optional().nullable(),
});

const BodySchema = z.object({
  contentType: z.enum(["anime", "manga", "audio"]),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().default(""),
  cover: z.string().optional().default(""),
  genres: z.array(z.string().max(60)).optional().default([]),
  releaseInfo: z.string().max(200).optional().default(""),
  sourceType: z.enum(["direct", "manual"]).default("direct"),
  episodes: z.array(EpisodeSchema).optional().default([]),
  chapters: z.array(ChapterSchema).optional().default([]),
  tracks: z.array(TrackSchema).optional().default([]),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid media payload.", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  if (data.cover && !isHttpUrl(data.cover)) {
    return Response.json({ error: "Cover must be a valid http(s) URL or left empty." }, { status: 400 });
  }

  const sourceItemId = crypto
    .createHash("sha1")
    .update(`${data.title}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);

  const item = await findOrCreateMediaItem({
    contentType: data.contentType,
    title: data.title,
    description: data.description,
    cover: data.cover,
    genres: data.genres,
    releaseInfo: data.releaseInfo,
    sourceType: data.sourceType,
    sourceId: data.sourceType,
    sourceItemId,
  });

  if (data.contentType === "anime") {
    for (const ep of data.episodes) {
      await addEpisode(item.id, ep);
    }
  } else if (data.contentType === "manga") {
    for (const ch of data.chapters) {
      await addChapter(item.id, { ...ch, sourceChapterId: "" });
    }
  } else if (data.contentType === "audio") {
    for (const tr of data.tracks) {
      await addTrack(item.id, tr);
    }
  }

  return Response.json({ item });
}
