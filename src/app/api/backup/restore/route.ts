import { z } from "zod";
import { db } from "@/db";
import {
  profiles,
  settings,
  mediaItems,
  episodes,
  chapters,
  tracks,
  libraryEntries,
  historyEntries,
  repositories,
  searchHistory,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const BackupSchema = z.object({
  formatVersion: z.number(),
  app: z.literal("RiuPlay"),
  data: z.object({
    profiles: z.array(z.record(z.string(), z.unknown())),
    settings: z.array(z.record(z.string(), z.unknown())),
    mediaItems: z.array(z.record(z.string(), z.unknown())),
    episodes: z.array(z.record(z.string(), z.unknown())),
    chapters: z.array(z.record(z.string(), z.unknown())),
    tracks: z.array(z.record(z.string(), z.unknown())),
    libraryEntries: z.array(z.record(z.string(), z.unknown())),
    historyEntries: z.array(z.record(z.string(), z.unknown())),
    repositories: z.array(z.record(z.string(), z.unknown())),
    searchHistory: z.array(z.record(z.string(), z.unknown())),
  }),
});

/** Validates and restores a previously exported RiuPlay backup. Replaces current data atomically. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BackupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "This file is not a valid RiuPlay backup (schema mismatch)." },
      { status: 400 },
    );
  }
  if (parsed.data.formatVersion !== 1) {
    return Response.json(
      { error: `Unsupported backup format version: ${parsed.data.formatVersion}.` },
      { status: 400 },
    );
  }

  const { data } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      // Delete children first to respect foreign keys, then parents.
      await tx.delete(searchHistory);
      await tx.delete(historyEntries);
      await tx.delete(libraryEntries);
      await tx.delete(episodes);
      await tx.delete(chapters);
      await tx.delete(tracks);
      await tx.delete(mediaItems);
      await tx.delete(repositories);
      await tx.delete(settings);
      await tx.delete(profiles);

      if (data.profiles.length) await tx.insert(profiles).values(data.profiles as never);
      if (data.settings.length) await tx.insert(settings).values(data.settings as never);
      if (data.repositories.length) await tx.insert(repositories).values(data.repositories as never);
      if (data.mediaItems.length) await tx.insert(mediaItems).values(data.mediaItems as never);
      if (data.episodes.length) await tx.insert(episodes).values(data.episodes as never);
      if (data.chapters.length) await tx.insert(chapters).values(data.chapters as never);
      if (data.tracks.length) await tx.insert(tracks).values(data.tracks as never);
      if (data.libraryEntries.length) await tx.insert(libraryEntries).values(data.libraryEntries as never);
      if (data.historyEntries.length) await tx.insert(historyEntries).values(data.historyEntries as never);
      if (data.searchHistory.length) await tx.insert(searchHistory).values(data.searchHistory as never);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed.";
    return Response.json({ error: `Restore failed and was rolled back: ${message}` }, { status: 500 });
  }

  return Response.json({ ok: true });
}
