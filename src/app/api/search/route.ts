import { ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems } from "@/db/schema";
import type { ContentType } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Unified local search across everything RiuPlay has indexed: media items
 * previously added via Direct URL / Manual import, or imported from a
 * connected Suwayomi server. This reflects what the app can actually search
 * today — see README for why live scraping of yuzono/keiyoushi sources is
 * not performed in-process.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const contentType = searchParams.get("contentType") as ContentType | null;

  if (!q) return Response.json({ items: [], query: q });

  const conditions = [ilike(mediaItems.title, `%${q}%`)];
  const genreMatch = sql`${mediaItems.genres}::text ilike ${"%" + q + "%"}`;

  const where = contentType
    ? sql`${mediaItems.contentType} = ${contentType} and (${or(...conditions)} or ${genreMatch})`
    : sql`(${or(...conditions)} or ${genreMatch})`;

  const items = await db.select().from(mediaItems).where(where).limit(60);
  return Response.json({ items, query: q });
}
