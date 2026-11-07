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
  extensions,
  downloads,
  searchHistory,
} from "@/db/schema";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { ContentType, LibraryStatus, LibraryProgress } from "@/lib/types";

// ---------------------------------------------------------------------------
// Profile & settings
// ---------------------------------------------------------------------------

export async function getOrCreateDefaultProfile() {
  const existing = await db.select().from(profiles).limit(1);
  if (existing.length > 0) {
    await ensureSettings(existing[0].id);
    return existing[0];
  }
  const [created] = await db
    .insert(profiles)
    .values({ name: "Player One", avatarEmoji: "🎬", avatarColor: "#7c5cff" })
    .returning();
  await ensureSettings(created.id);
  return created;
}

async function ensureSettings(profileId: number) {
  const existing = await db.select().from(settings).where(eq(settings.profileId, profileId)).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(settings).values({ profileId }).returning();
  return created;
}

export async function updateProfile(
  id: number,
  patch: Partial<{ name: string; avatarEmoji: string; avatarColor: string }>,
) {
  const [updated] = await db.update(profiles).set(patch).where(eq(profiles.id, id)).returning();
  return updated;
}

export async function getSettingsForProfile(profileId: number) {
  return ensureSettings(profileId);
}

export async function updateSettingsForProfile(profileId: number, patch: Record<string, unknown>) {
  await ensureSettings(profileId);
  const [updated] = await db
    .update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.profileId, profileId))
    .returning();
  return updated;
}

export async function resetSettingsForProfile(profileId: number) {
  await db.delete(settings).where(eq(settings.profileId, profileId));
  return ensureSettings(profileId);
}

// ---------------------------------------------------------------------------
// Media items + units
// ---------------------------------------------------------------------------

export interface MediaItemInput {
  contentType: ContentType;
  title: string;
  altTitles?: string[];
  description?: string;
  cover?: string;
  genres?: string[];
  releaseInfo?: string;
  sourceType: string;
  sourceId: string;
  sourceItemId: string;
  extra?: Record<string, unknown>;
}

/** Finds an existing media item by stable source identifiers, or creates one. Prevents duplicates. */
export async function findOrCreateMediaItem(input: MediaItemInput) {
  const existing = await db
    .select()
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.sourceType, input.sourceType),
        eq(mediaItems.sourceId, input.sourceId),
        eq(mediaItems.sourceItemId, input.sourceItemId),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db
      .update(mediaItems)
      .set({
        title: input.title,
        description: input.description ?? existing[0].description,
        cover: input.cover ?? existing[0].cover,
        genres: input.genres ?? existing[0].genres,
        altTitles: input.altTitles ?? existing[0].altTitles,
        releaseInfo: input.releaseInfo ?? existing[0].releaseInfo,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, existing[0].id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(mediaItems)
    .values({
      contentType: input.contentType,
      title: input.title,
      altTitles: input.altTitles ?? [],
      description: input.description ?? "",
      cover: input.cover ?? "",
      genres: input.genres ?? [],
      releaseInfo: input.releaseInfo ?? "",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceItemId: input.sourceItemId,
      extra: input.extra ?? {},
    })
    .returning();
  return created;
}

export async function getMediaItemFull(id: number) {
  const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, id)).limit(1);
  if (!item) return null;
  const [eps, chs, trs, [entry]] = await Promise.all([
    db.select().from(episodes).where(eq(episodes.mediaItemId, id)).orderBy(episodes.number),
    db.select().from(chapters).where(eq(chapters.mediaItemId, id)).orderBy(chapters.number),
    db.select().from(tracks).where(eq(tracks.mediaItemId, id)).orderBy(tracks.number),
    db.select().from(libraryEntries).where(eq(libraryEntries.mediaItemId, id)).limit(1),
  ]);
  return { item, episodes: eps, chapters: chs, tracks: trs, libraryEntry: entry ?? null };
}

export async function listMediaItems(contentType?: ContentType, search?: string) {
  const conditions = [];
  if (contentType) conditions.push(eq(mediaItems.contentType, contentType));
  if (search) conditions.push(ilike(mediaItems.title, `%${search}%`));
  const where = conditions.length ? and(...conditions) : undefined;
  return db
    .select()
    .from(mediaItems)
    .where(where)
    .orderBy(desc(mediaItems.createdAt))
    .limit(200);
}

export async function addEpisode(mediaItemId: number, data: {
  number: number;
  title?: string;
  videoUrl: string;
  subtitleUrl?: string | null;
  durationSeconds?: number | null;
}) {
  const [created] = await db
    .insert(episodes)
    .values({ mediaItemId, ...data })
    .returning();
  return created;
}

export async function addChapter(mediaItemId: number, data: {
  number: number;
  title?: string;
  pages: string[];
  sourceChapterId?: string;
}) {
  const [created] = await db
    .insert(chapters)
    .values({ mediaItemId, ...data })
    .returning();
  return created;
}

export async function addTrack(mediaItemId: number, data: {
  number: number;
  title?: string;
  audioUrl: string;
  durationSeconds?: number | null;
}) {
  const [created] = await db
    .insert(tracks)
    .values({ mediaItemId, ...data })
    .returning();
  return created;
}

export async function deleteMediaItem(id: number) {
  await db.delete(mediaItems).where(eq(mediaItems.id, id));
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface LibraryFilters {
  contentType?: ContentType;
  status?: LibraryStatus;
  favorite?: boolean;
  search?: string;
  sort?: "title" | "added" | "activity" | "status";
}

export async function listLibrary(filters: LibraryFilters = {}) {
  const conditions = [];
  if (filters.contentType) conditions.push(eq(mediaItems.contentType, filters.contentType));
  if (filters.status) conditions.push(eq(libraryEntries.status, filters.status));
  if (filters.favorite) conditions.push(eq(libraryEntries.favorite, true));
  if (filters.search) conditions.push(ilike(mediaItems.title, `%${filters.search}%`));
  const where = conditions.length ? and(...conditions) : undefined;

  let orderBy = desc(libraryEntries.lastActivityAt);
  if (filters.sort === "title") orderBy = mediaItems.title as unknown as typeof orderBy;
  if (filters.sort === "added") orderBy = desc(libraryEntries.addedAt);
  if (filters.sort === "status") orderBy = libraryEntries.status as unknown as typeof orderBy;

  const rows = await db
    .select({ entry: libraryEntries, media: mediaItems })
    .from(libraryEntries)
    .innerJoin(mediaItems, eq(libraryEntries.mediaItemId, mediaItems.id))
    .where(where)
    .orderBy(orderBy)
    .limit(500);
  return rows;
}

export async function getLibraryEntryByMedia(mediaItemId: number) {
  const [row] = await db
    .select()
    .from(libraryEntries)
    .where(eq(libraryEntries.mediaItemId, mediaItemId))
    .limit(1);
  return row ?? null;
}

export async function addToLibrary(mediaItemId: number, status: LibraryStatus) {
  const existing = await getLibraryEntryByMedia(mediaItemId);
  if (existing) return existing;
  const [created] = await db
    .insert(libraryEntries)
    .values({ mediaItemId, status })
    .returning();
  return created;
}

export async function updateLibraryEntry(
  id: number,
  patch: Partial<{
    status: LibraryStatus;
    favorite: boolean;
    rating: number | null;
    notes: string;
  }>,
) {
  const [updated] = await db
    .update(libraryEntries)
    .set({ ...patch, lastActivityAt: new Date() })
    .where(eq(libraryEntries.id, id))
    .returning();
  return updated;
}

export async function removeFromLibrary(id: number) {
  await db.delete(libraryEntries).where(eq(libraryEntries.id, id));
}

export async function updateLibraryProgress(mediaItemId: number, progress: LibraryProgress) {
  const existing = await getLibraryEntryByMedia(mediaItemId);
  if (!existing) return null;
  const [updated] = await db
    .update(libraryEntries)
    .set({ progress, lastActivityAt: new Date() })
    .where(eq(libraryEntries.id, existing.id))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryInput {
  mediaItemId: number;
  type: "video" | "manga" | "audio";
  unitId?: number | null;
  unitLabel?: string;
  position?: number;
  duration?: number;
  page?: number | null;
  completed?: boolean;
}

export async function addHistoryEntry(input: HistoryInput) {
  const [created] = await db
    .insert(historyEntries)
    .values({
      mediaItemId: input.mediaItemId,
      type: input.type,
      unitId: input.unitId ?? null,
      unitLabel: input.unitLabel ?? "",
      position: input.position ?? 0,
      duration: input.duration ?? 0,
      page: input.page ?? null,
      completed: input.completed ?? false,
    })
    .returning();
  return created;
}

export async function listHistory(type?: "video" | "manga" | "audio") {
  const where = type ? eq(historyEntries.type, type) : undefined;
  const rows = await db
    .select({ history: historyEntries, media: mediaItems })
    .from(historyEntries)
    .innerJoin(mediaItems, eq(historyEntries.mediaItemId, mediaItems.id))
    .where(where)
    .orderBy(desc(historyEntries.occurredAt))
    .limit(300);
  return rows;
}

export async function removeHistoryEntry(id: number) {
  await db.delete(historyEntries).where(eq(historyEntries.id, id));
}

export async function clearHistory(type?: "video" | "manga" | "audio") {
  if (type) {
    await db.delete(historyEntries).where(eq(historyEntries.type, type));
  } else {
    await db.delete(historyEntries);
  }
}

/** Most recent, not-yet-completed entry per media item — used for Continue sections. */
export async function continueList(type?: "video" | "manga" | "audio", limit = 12) {
  const rows = await listHistory(type);
  const seen = new Set<number>();
  const result: typeof rows = [];
  for (const row of rows) {
    if (row.history.completed) continue;
    if (seen.has(row.media.id)) continue;
    seen.add(row.media.id);
    result.push(row);
    if (result.length >= limit) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Repositories & Extensions
// ---------------------------------------------------------------------------

export async function listRepositories() {
  return db.select().from(repositories).orderBy(desc(repositories.createdAt));
}

export async function addRepository(name: string, baseUrl: string, repoType: "anime" | "manga") {
  const [created] = await db
    .insert(repositories)
    .values({ name, baseUrl, repoType, status: "pending" })
    .returning();
  return created;
}

export async function removeRepository(id: number) {
  await db.delete(repositories).where(eq(repositories.id, id));
}

export async function setRepositoryStatus(
  id: number,
  status: "pending" | "ok" | "error",
  errorMessage: string | null,
  extensionCount: number,
) {
  const [updated] = await db
    .update(repositories)
    .set({ status, errorMessage, extensionCount, lastRefreshedAt: new Date() })
    .where(eq(repositories.id, id))
    .returning();
  return updated;
}

export async function replaceExtensionsForRepository(
  repositoryId: number,
  contentType: "anime" | "manga",
  parsed: Array<{
    pkgName: string;
    name: string;
    version: string;
    lang: string;
    author: string;
    iconUrl: string | null;
    nsfw: boolean;
    format: "apk";
    rawMeta: Record<string, unknown>;
  }>,
) {
  await db.transaction(async (tx) => {
    const existingRows = await tx
      .select({ pkgName: extensions.pkgName, installStatus: extensions.installStatus })
      .from(extensions)
      .where(eq(extensions.repositoryId, repositoryId));
    const existingByPkg = new Map(existingRows.map((r) => [r.pkgName, r.installStatus]));
    await tx.delete(extensions).where(eq(extensions.repositoryId, repositoryId));
    if (parsed.length === 0) return;
    await tx.insert(extensions).values(
      parsed.map((p) => ({
        repositoryId,
        pkgName: p.pkgName,
        name: p.name,
        version: p.version,
        lang: p.lang,
        author: p.author,
        contentType,
        iconUrl: p.iconUrl,
        nsfw: p.nsfw,
        format: p.format,
        // APKs cannot run inside the Node/Next.js process -> always unsupported here.
        installStatus: existingByPkg.get(p.pkgName) === "disabled" ? "disabled" : "unsupported",
        installError:
          "Android APK extensions (Aniyomi/Mihon format) cannot execute inside RiuPlay's Next.js runtime. Metadata is shown for browsing only.",
        rawMeta: p.rawMeta,
      })),
    );
  });
}

export async function listExtensions(repositoryId?: number) {
  const where = repositoryId ? eq(extensions.repositoryId, repositoryId) : undefined;
  return db.select().from(extensions).where(where).orderBy(extensions.name);
}

export async function setExtensionEnabled(id: number, enabled: boolean) {
  const [row] = await db.select().from(extensions).where(eq(extensions.id, id)).limit(1);
  if (!row) return null;
  const nextStatus = enabled ? (row.installError ? "unsupported" : "available") : "disabled";
  const [updated] = await db
    .update(extensions)
    .set({ installStatus: nextStatus })
    .where(eq(extensions.id, id))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export async function listDownloads() {
  const rows = await db
    .select({ download: downloads, media: mediaItems })
    .from(downloads)
    .innerJoin(mediaItems, eq(downloads.mediaItemId, mediaItems.id))
    .orderBy(desc(downloads.createdAt));
  return rows;
}

export async function createDownloadRecord(input: {
  mediaItemId: number;
  unitId: number | null;
  unitType: "episode" | "track";
  title: string;
  sourceUrl: string;
}) {
  const [created] = await db
    .insert(downloads)
    .values({ ...input, status: "queued" })
    .returning();
  return created;
}

export async function updateDownloadRecord(
  id: number,
  patch: Partial<{
    status: string;
    progressBytes: number;
    totalBytes: number;
    filePath: string | null;
    errorMessage: string | null;
  }>,
) {
  const [updated] = await db
    .update(downloads)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(downloads.id, id))
    .returning();
  return updated;
}

export async function getDownload(id: number) {
  const [row] = await db.select().from(downloads).where(eq(downloads.id, id)).limit(1);
  return row ?? null;
}

export async function deleteDownloadRecord(id: number) {
  await db.delete(downloads).where(eq(downloads.id, id));
}

// ---------------------------------------------------------------------------
// Search history
// ---------------------------------------------------------------------------

export async function addSearchHistory(profileId: number, query: string, contentType: string) {
  if (!query.trim()) return;
  await db.insert(searchHistory).values({ profileId, query: query.trim(), contentType });
  // Keep only the most recent 50 entries per profile.
  const rows = await db
    .select({ id: searchHistory.id })
    .from(searchHistory)
    .where(eq(searchHistory.profileId, profileId))
    .orderBy(desc(searchHistory.createdAt));
  if (rows.length > 50) {
    const toDelete = rows.slice(50).map((r) => r.id);
    if (toDelete.length) await db.delete(searchHistory).where(inArray(searchHistory.id, toDelete));
  }
}

export async function listSearchHistory(profileId: number) {
  return db
    .select()
    .from(searchHistory)
    .where(eq(searchHistory.profileId, profileId))
    .orderBy(desc(searchHistory.createdAt))
    .limit(50);
}

export async function clearSearchHistory(profileId: number) {
  await db.delete(searchHistory).where(eq(searchHistory.profileId, profileId));
}

export async function countLibraryByStatus(contentType?: ContentType) {
  const where = contentType ? eq(mediaItems.contentType, contentType) : undefined;
  const rows = await db
    .select({ status: libraryEntries.status, count: sql<number>`count(*)` })
    .from(libraryEntries)
    .innerJoin(mediaItems, eq(libraryEntries.mediaItemId, mediaItems.id))
    .where(where)
    .groupBy(libraryEntries.status);
  return rows;
}
