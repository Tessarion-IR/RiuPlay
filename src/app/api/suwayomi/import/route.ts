import { z } from "zod";
import { getOrCreateDefaultProfile, getSettingsForProfile, addChapter, findOrCreateMediaItem } from "@/server/queries";
import { suwayomiGetChapters, suwayomiGetManga, suwayomiPageUrl } from "@/server/providers";
import { NetError, sanitizeText } from "@/server/net";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sourceId: z.string().min(1),
  mangaId: z.string().min(1),
});

/**
 * Imports a manga from a connected Suwayomi Server into the local library.
 * Field names follow Suwayomi-Server's REST v1 MangaDataClass / ChapterDataClass
 * as documented in the project's CONTRIBUTING.md and public API explorer
 * (/api/swagger-ui). We could not verify this against a live server instance
 * in this development environment (none was running), so field access is
 * defensive and errors are surfaced rather than guessed at — see README
 * "Manga server integration" for exact verification status.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "sourceId and mangaId are required." }, { status: 400 });

  const profile = await getOrCreateDefaultProfile();
  const settings = await getSettingsForProfile(profile.id);
  if (!settings.suwayomiBaseUrl) {
    return Response.json({ error: "No Suwayomi server is configured in Settings." }, { status: 400 });
  }

  try {
    const manga = (await suwayomiGetManga(settings.suwayomiBaseUrl, parsed.data.mangaId, settings.proxy)) as Record<
      string,
      unknown
    >;
    const chaptersRaw = (await suwayomiGetChapters(
      settings.suwayomiBaseUrl,
      parsed.data.mangaId,
      settings.proxy,
    )) as Array<Record<string, unknown>>;

    const item = await findOrCreateMediaItem({
      contentType: "manga",
      title: sanitizeText(manga.title, 300) || `Manga #${parsed.data.mangaId}`,
      description: sanitizeText(manga.description, 5000),
      cover: typeof manga.thumbnailUrl === "string" ? manga.thumbnailUrl : "",
      genres:
        typeof manga.genre === "string"
          ? manga.genre.split(",").map((g) => sanitizeText(g, 60)).filter(Boolean)
          : Array.isArray(manga.genre)
            ? (manga.genre as unknown[]).map((g) => sanitizeText(g, 60))
            : [],
      releaseInfo: sanitizeText(manga.status, 60),
      sourceType: "suwayomi",
      sourceId: parsed.data.sourceId,
      sourceItemId: String(parsed.data.mangaId),
      extra: { suwayomiBaseUrl: settings.suwayomiBaseUrl },
    });

    let imported = 0;
    for (const ch of chaptersRaw) {
      const index = typeof ch.index === "number" ? ch.index : imported;
      const pageCount = typeof ch.pageCount === "number" && ch.pageCount > 0 ? ch.pageCount : 0;
      const pages = pageCount
        ? Array.from({ length: pageCount }, (_, i) =>
            suwayomiPageUrl(settings.suwayomiBaseUrl, String(parsed.data.mangaId), String(index), i),
          )
        : [];
      if (pages.length === 0) continue; // Skip chapters whose page count is unknown rather than fabricating pages.
      await addChapter(item.id, {
        number: typeof ch.chapterNumber === "number" ? ch.chapterNumber : imported + 1,
        title: sanitizeText(ch.name, 200),
        pages,
        sourceChapterId: String(ch.id ?? index),
      });
      imported += 1;
    }

    return Response.json({ item, chaptersImported: imported, chaptersSeen: chaptersRaw.length });
  } catch (err) {
    const message = err instanceof NetError ? err.message : "Failed to import manga from the Suwayomi server.";
    return Response.json({ error: message }, { status: 502 });
  }
}
