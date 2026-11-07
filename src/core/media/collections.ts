// RiuPlay: user collections across every kind of title - local media (sourceId "local") and titles
// from extension sources alike - the original RiuPlay's planned custom collections, on the
// collections / collection_items tables of migration 0023. Later phases reuse them for KikoFlu-style
// playlists and Suwayomi-style update categories.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { LOCAL_SOURCE_ID, type Collection, type CollectionItem, type MediaRef } from "@shared/media";
import type { AnimeTitle } from "@shared/types";
import { cachedAnime, collectionItems, collections, library, localMedia } from "../db/schema";
import { getPlatform } from "../platform";
import { MediaError, toItem } from "./media";
import { collectionDescriptionSchema, collectionNameSchema } from "./validation";

const getDb = () => getPlatform().db.get();

function checkRef(ref: MediaRef): MediaRef {
  const sourceId = typeof ref?.sourceId === "string" ? ref.sourceId.trim() : "";
  const titleId = typeof ref?.titleId === "string" ? ref.titleId.trim() : "";
  if (!sourceId || !titleId || sourceId.length > 300 || titleId.length > 1000) throw new MediaError("invalid", "A title reference needs a source id and a title id");
  return { sourceId, titleId };
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new MediaError("invalid", result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}

async function withCount(row: typeof collections.$inferSelect): Promise<Collection> {
  const count = await getDb().select({ n: sql<number>`count(*)` }).from(collectionItems).where(eq(collectionItems.collectionId, row.id)).get();
  return { ...row, itemCount: Number(count?.n ?? 0) };
}

async function collectionRow(id: number) {
  const row = await getDb().select().from(collections).where(eq(collections.id, id)).get();
  if (!row) throw new MediaError("not-found", `No collection with id ${id}`);
  return row;
}

export async function listCollections(): Promise<Collection[]> {
  const rows = await getDb().select().from(collections).orderBy(asc(collections.sortOrder), asc(collections.name)).all();
  return Promise.all(rows.map(withCount));
}

export async function createCollection(name: string, description = ""): Promise<Collection> {
  const now = Date.now();
  const last = await getDb().select({ max: sql<number | null>`max(${collections.sortOrder})` }).from(collections).get();
  const row = await getDb()
    .insert(collections)
    .values({
      name: parse(collectionNameSchema, name),
      description: parse(collectionDescriptionSchema, description),
      sortOrder: Number(last?.max ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return withCount(row);
}

export async function updateCollection(id: number, patch: { name?: string; description?: string }): Promise<Collection> {
  await collectionRow(id);
  const row = await getDb()
    .update(collections)
    .set({
      ...(patch.name !== undefined && { name: parse(collectionNameSchema, patch.name) }),
      ...(patch.description !== undefined && { description: parse(collectionDescriptionSchema, patch.description) }),
      updatedAt: Date.now(),
    })
    .where(eq(collections.id, id))
    .returning()
    .get();
  return withCount(row);
}

/** Deletes the collection only - never the titles in it. */
export async function removeCollection(id: number): Promise<void> {
  await collectionRow(id);
  await getDb().delete(collections).where(eq(collections.id, id)).run();
}

export async function addToCollection(id: number, rawRef: MediaRef): Promise<void> {
  await collectionRow(id);
  const ref = checkRef(rawRef);
  if (ref.sourceId === LOCAL_SOURCE_ID) {
    const exists = await getDb().select({ id: localMedia.id }).from(localMedia).where(eq(localMedia.id, Number(ref.titleId))).get();
    if (!exists) throw new MediaError("not-found", `No media with id ${ref.titleId}`);
  }
  const now = Date.now();
  await getDb().insert(collectionItems).values({ collectionId: id, sourceId: ref.sourceId, titleId: ref.titleId, addedAt: now }).onConflictDoNothing().run();
  await getDb().update(collections).set({ updatedAt: now }).where(eq(collections.id, id)).run();
}

export async function removeFromCollection(id: number, rawRef: MediaRef): Promise<void> {
  const ref = checkRef(rawRef);
  await getDb()
    .delete(collectionItems)
    .where(and(eq(collectionItems.collectionId, id), eq(collectionItems.sourceId, ref.sourceId), eq(collectionItems.titleId, ref.titleId)))
    .run();
}

export async function collectionsOf(rawRef: MediaRef): Promise<number[]> {
  const ref = checkRef(rawRef);
  const rows = await getDb()
    .select({ id: collectionItems.collectionId })
    .from(collectionItems)
    .where(and(eq(collectionItems.sourceId, ref.sourceId), eq(collectionItems.titleId, ref.titleId)))
    .all();
  return rows.map((r) => r.id);
}

function animeSummary(json: string | undefined): { title: string; cover: string | null } | null {
  if (!json) return null;
  try {
    const anime = JSON.parse(json) as AnimeTitle;
    return { title: anime.englishName || anime.originalName || anime.russianName || anime.id, cover: anime.posterUrl ?? null };
  } catch {
    return null;
  }
}

/** A collection's titles, newest first, each resolved for display: local titles from local_media,
 * source titles from what this device knows of them (the library entry, else the title cache). */
export async function collectionItemsOf(id: number): Promise<CollectionItem[]> {
  await collectionRow(id);
  const db = getDb();
  const rows = await db.select().from(collectionItems).where(eq(collectionItems.collectionId, id)).orderBy(desc(collectionItems.addedAt)).all();
  const localIds = rows.filter((r) => r.sourceId === LOCAL_SOURCE_ID).map((r) => Number(r.titleId)).filter(Number.isFinite);
  const locals = localIds.length ? await db.select().from(localMedia).where(inArray(localMedia.id, localIds)).all() : [];
  const localById = new Map(locals.map((row) => [String(row.id), toItem(row)]));

  const items: CollectionItem[] = [];
  for (const row of rows) {
    if (row.sourceId === LOCAL_SOURCE_ID) {
      items.push({ sourceId: row.sourceId, titleId: row.titleId, addedAt: row.addedAt, local: localById.get(row.titleId) ?? null, remote: null });
      continue;
    }
    const lib = await db.select({ json: library.animeJson }).from(library).where(and(eq(library.sourceId, row.sourceId), eq(library.animeId, row.titleId))).get();
    const cached = lib ? undefined : await db.select({ json: cachedAnime.animeJson }).from(cachedAnime).where(and(eq(cachedAnime.sourceId, row.sourceId), eq(cachedAnime.animeId, row.titleId))).get();
    items.push({ sourceId: row.sourceId, titleId: row.titleId, addedAt: row.addedAt, local: null, remote: animeSummary(lib?.json ?? cached?.json) });
  }
  return items;
}
