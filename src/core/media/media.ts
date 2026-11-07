// RiuPlay: the core of the unified media model (shared/media.ts) on SQLite - titles of every content
// type, their units, the personal library, per-unit progress and the Continue lists. Ported from the
// original RiuPlay prototype's query layer (legacy/next-app/src/server/queries.ts: findOrCreate-
// MediaItem, addEpisode/addChapter/addTrack, library, progress, continueList) onto hibiki's SQLite +
// drizzle infrastructure. Platform-independent: file access for "file" origin titles lives in
// main/mediaFiles.ts, which hands this module ready-made inputs.
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  LIBRARY_STATUSES,
  LOCAL_SOURCE_ID,
  MEDIA_TYPES,
  UNIT_KIND_FOR,
  type AddMediaInput,
  type AddMediaResult,
  type ContinueEntry,
  type LibraryStatus,
  type MediaDetails,
  type MediaItem,
  type MediaLibraryState,
  type MediaOrigin,
  type MediaPatch,
  type MediaSummary,
  type MediaType,
  type MediaUnit,
  type UnitInput,
  type UnitKind,
  type UnitProgress,
} from "@shared/media";
import { collectionItems, localLibrary, localMedia, localMediaUnits, localProgress } from "../db/schema";
import { getPlatform } from "../platform";
import { addMediaInputSchema, mediaPatchSchema, unitInputSchema, isHttpUrl } from "./validation";

const getDb = () => getPlatform().db.get();

/** A video/track counts as finished past this share of its length (the prototype's completionThreshold). */
export const COMPLETION_THRESHOLD = 0.92;
/** Below this many ms, a saved position is not worth resuming from (the prototype's resumeThreshold). */
export const RESUME_THRESHOLD_MS = 15_000;

export class MediaError extends Error {
  constructor(
    readonly code: "not-found" | "invalid" | "wrong-kind",
    message: string,
  ) {
    super(`${message} (${code})`);
    this.name = "MediaError";
  }
}

// ---------------------------------------------------------------------------------------------
// Row mapping. Titles imported from files store absolute paths; the renderer never sees them - it
// gets riuplay-media:// URLs that the main process resolves back through the database (see
// main/mediaProtocol.ts), so a page can only ever load files the user added.
// ---------------------------------------------------------------------------------------------

export const MEDIA_SCHEME = "riuplay-media";
// RiuPlay M4/M5: "remote:..." marks something on the user's media server - served by the main
// process (main/connections/service.ts) through riuplay-media://remote..., never read as a file.
const isRemote = (value: string): boolean => value.startsWith("remote:");
const isLocalPath = (value: string): boolean => value !== "" && !isRemote(value) && !value.startsWith(`${MEDIA_SCHEME}:`) && !isHttpUrl(value);

function parseJsonArray(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

type MediaRow = typeof localMedia.$inferSelect;
type UnitRow = typeof localMediaUnits.$inferSelect;
type LibraryRow = typeof localLibrary.$inferSelect;
type ProgressRow = typeof localProgress.$inferSelect;

export function toItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    type: row.contentType as MediaType,
    title: row.title,
    altTitles: parseJsonArray(row.altTitlesJson),
    description: row.description,
    cover: isRemote(row.cover) ? `${MEDIA_SCHEME}://remote-cover/${row.id}` : isLocalPath(row.cover) ? `${MEDIA_SCHEME}://cover/${row.id}` : row.cover,
    genres: parseJsonArray(row.genresJson),
    releaseInfo: row.releaseInfo,
    origin: row.origin as MediaOrigin,
    originRef: row.origin === "file" ? "" : row.originRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toUnit(row: UnitRow): MediaUnit {
  return {
    id: row.id,
    mediaId: row.mediaId,
    kind: row.kind as UnitKind,
    number: row.number,
    title: row.title,
    url: isRemote(row.url) ? `${MEDIA_SCHEME}://remote/${row.id}` : isLocalPath(row.url) ? `${MEDIA_SCHEME}://unit/${row.id}` : row.url,
    subtitleUrl: row.subtitleUrl && isLocalPath(row.subtitleUrl) ? `${MEDIA_SCHEME}://subtitle/${row.id}` : row.subtitleUrl,
    pages: parseJsonArray(row.pagesJson).map((page, index) => (isRemote(page) ? `${MEDIA_SCHEME}://remote/${row.id}/page/${index}` : isLocalPath(page) ? `${MEDIA_SCHEME}://page/${row.id}/${index}` : page)),
    durationMs: row.durationMs,
  };
}

const toLibrary = (row: LibraryRow | undefined | null): MediaLibraryState | null =>
  row ? { status: row.status as LibraryStatus, favorite: row.favorite, addedAt: row.addedAt, updatedAt: row.updatedAt } : null;

const toProgress = (row: ProgressRow): UnitProgress => ({
  unitId: row.unitId,
  mediaId: row.mediaId,
  position: row.position,
  duration: row.duration,
  completed: row.completed,
  updatedAt: row.updatedAt,
});

/** Episodes and tracks are ordered by number; equal numbers keep the order they were added in. */
const unitOrder = [asc(localMediaUnits.number), asc(localMediaUnits.id)] as const;

// ---------------------------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------------------------

async function itemRow(id: number): Promise<MediaRow> {
  const row = await getDb().select().from(localMedia).where(eq(localMedia.id, id)).get();
  if (!row) throw new MediaError("not-found", `No media with id ${id}`);
  return row;
}

/** Raw stored values, for the main process's file protocol only. */
export async function storedItem(id: number): Promise<MediaRow | null> {
  return (await getDb().select().from(localMedia).where(eq(localMedia.id, id)).get()) ?? null;
}
export async function storedUnit(id: number): Promise<UnitRow | null> {
  return (await getDb().select().from(localMediaUnits).where(eq(localMediaUnits.id, id)).get()) ?? null;
}

export interface StoredMediaInput {
  type: MediaType;
  title: string;
  origin: MediaOrigin;
  originRef: string;
  description?: string;
  cover?: string;
  genres?: string[];
  altTitles?: string[];
  releaseInfo?: string;
  units: Array<Required<Pick<UnitInput, "number">> & UnitInput>;
  libraryStatus?: LibraryStatus;
}

/** Inserts a title with its units, or returns the existing one with the same (origin, originRef) -
 * the prototype's findOrCreateMediaItem dedupe. All-or-nothing: a failing unit leaves no title. */
export async function insertMedia(input: StoredMediaInput): Promise<AddMediaResult> {
  const db = getDb();
  const existing = await db
    .select()
    .from(localMedia)
    .where(and(eq(localMedia.origin, input.origin), eq(localMedia.originRef, input.originRef)))
    .get();
  if (existing) return { item: toItem(existing), existed: true };

  const now = Date.now();
  const kind = UNIT_KIND_FOR[input.type];
  const inserted = await db
    .insert(localMedia)
    .values({
      contentType: input.type,
      title: input.title,
      altTitlesJson: JSON.stringify(input.altTitles ?? []),
      description: input.description ?? "",
      cover: input.cover ?? "",
      genresJson: JSON.stringify(input.genres ?? []),
      releaseInfo: input.releaseInfo ?? "",
      origin: input.origin,
      originRef: input.originRef,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  try {
    for (const unit of input.units) {
      await db
        .insert(localMediaUnits)
        .values({
          mediaId: inserted.id,
          kind,
          number: unit.number,
          title: unit.title ?? "",
          url: unit.url ?? "",
          subtitleUrl: unit.subtitleUrl ?? null,
          pagesJson: JSON.stringify(unit.pages ?? []),
          durationMs: unit.durationMs ?? null,
          createdAt: now,
        })
        .run();
    }
    if (input.libraryStatus) await setLibrary(inserted.id, { status: input.libraryStatus });
  } catch (error) {
    await db.delete(localMedia).where(eq(localMedia.id, inserted.id)).run();
    throw error;
  }
  return { item: toItem(inserted), existed: false };
}

/** Adds a title from the Add Media dialog: by direct URL(s) or entered by hand. */
export async function addMedia(raw: AddMediaInput): Promise<AddMediaResult> {
  const parsed = addMediaInputSchema.safeParse(raw);
  if (!parsed.success) throw new MediaError("invalid", parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  const input = parsed.data;
  const units = (input.units ?? []).map((unit, index) => ({ ...unit, number: unit.number ?? index + 1 }));
  const firstLocation = units[0]?.url || units[0]?.pages?.[0] || "";
  const originRef =
    input.origin === "direct"
      ? firstLocation
      : // A hand-entered title has nothing external to identify it by; each entry is its own title.
        `manual:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  return insertMedia({ ...input, originRef, units });
}

export async function getMedia(id: number): Promise<MediaDetails | null> {
  const db = getDb();
  const row = await db.select().from(localMedia).where(eq(localMedia.id, id)).get();
  if (!row) return null;
  const units = await db.select().from(localMediaUnits).where(eq(localMediaUnits.mediaId, id)).orderBy(...unitOrder).all();
  const lib = await db.select().from(localLibrary).where(eq(localLibrary.mediaId, id)).get();
  const progress = await db.select().from(localProgress).where(eq(localProgress.mediaId, id)).all();
  const inCollections = await db
    .select({ id: collectionItems.collectionId })
    .from(collectionItems)
    .where(and(eq(collectionItems.sourceId, LOCAL_SOURCE_ID), eq(collectionItems.titleId, String(id))))
    .all();
  return {
    item: toItem(row),
    units: units.map(toUnit),
    library: toLibrary(lib),
    progress: progress.map(toProgress),
    collectionIds: inCollections.map((c) => c.id),
  };
}

async function summaries(rows: MediaRow[]): Promise<MediaSummary[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({ mediaId: localMediaUnits.mediaId, count: sql<number>`count(*)` })
    .from(localMediaUnits)
    .where(inArray(localMediaUnits.mediaId, ids))
    .groupBy(localMediaUnits.mediaId)
    .all();
  const libs = await db.select().from(localLibrary).where(inArray(localLibrary.mediaId, ids)).all();
  const countBy = new Map(counts.map((c) => [c.mediaId, Number(c.count)]));
  const libBy = new Map(libs.map((l) => [l.mediaId, l]));
  return rows.map((row) => ({ item: toItem(row), unitCount: countBy.get(row.id) ?? 0, library: toLibrary(libBy.get(row.id)) }));
}

export async function listMedia(filter: { type?: MediaType; search?: string; inLibrary?: boolean } = {}): Promise<MediaSummary[]> {
  const conditions = [];
  if (filter.type) {
    if (!MEDIA_TYPES.includes(filter.type)) throw new MediaError("invalid", `Unknown media type ${String(filter.type)}`);
    conditions.push(eq(localMedia.contentType, filter.type));
  }
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(sql`${localMedia.title} like ${pattern} escape '\\'`, sql`${localMedia.altTitlesJson} like ${pattern} escape '\\'`));
  }
  if (filter.inLibrary) conditions.push(sql`${localMedia.id} in (select media_id from local_library)`);
  const rows = await getDb()
    .select()
    .from(localMedia)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(localMedia.updatedAt), desc(localMedia.id))
    .all();
  return summaries(rows);
}

export async function recentlyAdded(limit = 12): Promise<MediaSummary[]> {
  const rows = await getDb().select().from(localMedia).orderBy(desc(localMedia.createdAt), desc(localMedia.id)).limit(clampLimit(limit)).all();
  return summaries(rows);
}

export async function updateMedia(id: number, rawPatch: MediaPatch): Promise<MediaItem> {
  const parsed = mediaPatchSchema.safeParse(rawPatch);
  if (!parsed.success) throw new MediaError("invalid", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  const patch = parsed.data;
  await itemRow(id);
  const row = await getDb()
    .update(localMedia)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.cover !== undefined && { cover: patch.cover }),
      ...(patch.genres !== undefined && { genresJson: JSON.stringify(patch.genres) }),
      ...(patch.altTitles !== undefined && { altTitlesJson: JSON.stringify(patch.altTitles) }),
      ...(patch.releaseInfo !== undefined && { releaseInfo: patch.releaseInfo }),
      updatedAt: Date.now(),
    })
    .where(eq(localMedia.id, id))
    .returning()
    .get();
  return toItem(row);
}

/** Removes the title, its units, library entry, progress and collection memberships. Files on disk
 * are never touched: RiuPlay only ever referenced them. */
export async function removeMedia(id: number): Promise<void> {
  await itemRow(id);
  const db = getDb();
  await db.delete(collectionItems).where(and(eq(collectionItems.sourceId, LOCAL_SOURCE_ID), eq(collectionItems.titleId, String(id)))).run();
  await db.delete(localMedia).where(eq(localMedia.id, id)).run();
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

export async function addUnit(mediaId: number, raw: UnitInput): Promise<MediaUnit> {
  const media = await itemRow(mediaId);
  const type = media.contentType as MediaType;
  const parsed = unitInputSchema(type).safeParse(raw);
  if (!parsed.success) throw new MediaError("invalid", parsed.error.issues.map((issue) => `${issue.path.join(".") || "unit"}: ${issue.message}`).join("; "));
  const unit = parsed.data;
  const db = getDb();
  let number = unit.number;
  if (number === undefined) {
    const last = await db.select({ max: sql<number | null>`max(${localMediaUnits.number})` }).from(localMediaUnits).where(eq(localMediaUnits.mediaId, mediaId)).get();
    number = Math.floor(Number(last?.max ?? 0)) + 1;
  }
  const row = await db
    .insert(localMediaUnits)
    .values({
      mediaId,
      kind: UNIT_KIND_FOR[type],
      number,
      title: unit.title ?? "",
      url: unit.url ?? "",
      subtitleUrl: unit.subtitleUrl ?? null,
      pagesJson: JSON.stringify(unit.pages ?? []),
      durationMs: unit.durationMs ?? null,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  await db.update(localMedia).set({ updatedAt: Date.now() }).where(eq(localMedia.id, mediaId)).run();
  return toUnit(row);
}

export async function removeUnit(unitId: number): Promise<void> {
  const unit = await storedUnit(unitId);
  if (!unit) throw new MediaError("not-found", `No unit with id ${unitId}`);
  await getDb().delete(localMediaUnits).where(eq(localMediaUnits.id, unitId)).run();
}

// ---------------------------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------------------------

export async function setLibrary(mediaId: number, state: { status: LibraryStatus; favorite?: boolean } | null): Promise<MediaLibraryState | null> {
  await itemRow(mediaId);
  const db = getDb();
  if (state === null) {
    await db.delete(localLibrary).where(eq(localLibrary.mediaId, mediaId)).run();
    return null;
  }
  if (!LIBRARY_STATUSES.includes(state.status)) throw new MediaError("invalid", `Unknown library status ${String(state.status)}`);
  const now = Date.now();
  const existing = await db.select().from(localLibrary).where(eq(localLibrary.mediaId, mediaId)).get();
  const favorite = state.favorite ?? existing?.favorite ?? false;
  const row = await db
    .insert(localLibrary)
    .values({ mediaId, status: state.status, favorite, addedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: localLibrary.mediaId, set: { status: state.status, favorite, updatedAt: now } })
    .returning()
    .get();
  return toLibrary(row);
}

/** Marking a favourite puts a title not yet in the library into it as "planned", as the prototype did. */
export async function setFavorite(mediaId: number, favorite: boolean): Promise<MediaLibraryState> {
  const existing = await getDb().select().from(localLibrary).where(eq(localLibrary.mediaId, mediaId)).get();
  return (await setLibrary(mediaId, { status: (existing?.status as LibraryStatus | undefined) ?? "planned", favorite }))!;
}

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------

/** Whether a position finishes the unit: the threshold share for time-based units, the last page for chapters. */
export function isUnitComplete(kind: UnitKind, position: number, duration: number): boolean {
  if (!(duration > 0)) return false;
  if (kind === "chapter") return position >= duration - 1;
  return position / duration >= COMPLETION_THRESHOLD;
}

async function writeProgress(unit: UnitRow, position: number, duration: number, completed: boolean): Promise<UnitProgress> {
  const db = getDb();
  const now = Date.now();
  const row = await db
    .insert(localProgress)
    .values({ unitId: unit.id, mediaId: unit.mediaId, position, duration, completed, updatedAt: now })
    .onConflictDoUpdate({ target: localProgress.unitId, set: { position, duration, completed, updatedAt: now } })
    .returning()
    .get();
  // Starting a title moves it to "active" in the library, if it is there as "planned" - the
  // prototype's behaviour (updateLibraryProgress); it never adds a title on its own.
  await db
    .update(localLibrary)
    .set({ status: "active", updatedAt: now })
    .where(and(eq(localLibrary.mediaId, unit.mediaId), eq(localLibrary.status, "planned")))
    .run();
  return toProgress(row);
}

/** Saves where the user is in a unit (ms for episodes/tracks, page index + page count for chapters). */
export async function saveProgress(unitId: number, position: number, duration: number): Promise<UnitProgress> {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration < 0) {
    throw new MediaError("invalid", "Progress must be finite and not negative");
  }
  const unit = await storedUnit(unitId);
  if (!unit) throw new MediaError("not-found", `No unit with id ${unitId}`);
  const existing = await getDb().select().from(localProgress).where(eq(localProgress.unitId, unitId)).get();
  // Once finished, a unit stays finished when it is re-watched from the start (as hibiki's watched flag).
  const completed = (existing?.completed ?? false) || isUnitComplete(unit.kind as UnitKind, position, duration);
  return writeProgress(unit, position, duration, completed);
}

export async function setUnitCompleted(unitId: number, completed: boolean): Promise<UnitProgress> {
  const unit = await storedUnit(unitId);
  if (!unit) throw new MediaError("not-found", `No unit with id ${unitId}`);
  const existing = await getDb().select().from(localProgress).where(eq(localProgress.unitId, unitId)).get();
  const duration = existing?.duration ?? 0;
  return writeProgress(unit, completed ? duration : 0, duration, completed);
}

/** Where to resume a unit: null when there is nothing worth resuming (near the start, or finished). */
export function resumePosition(kind: UnitKind, progress: UnitProgress | null | undefined): number | null {
  if (!progress || progress.completed) return null;
  if (kind === "chapter") return progress.position > 0 ? progress.position : null;
  return progress.position >= RESUME_THRESHOLD_MS ? progress.position : null;
}

const clampLimit = (limit: number) => Math.max(1, Math.min(100, Math.floor(limit) || 12));

/**
 * Continue Watching / Reading / Listening for one content type: per title, the most recently touched
 * unit - itself if unfinished, else the next one in order. Titles whose last-touched unit was the
 * final one and is finished drop out (there is nothing to continue).
 */
export async function continueList(type: MediaType, limit = 12): Promise<ContinueEntry[]> {
  if (!MEDIA_TYPES.includes(type)) throw new MediaError("invalid", `Unknown media type ${String(type)}`);
  const db = getDb();
  const recent = await db
    .select({ progress: localProgress })
    .from(localProgress)
    .innerJoin(localMedia, eq(localMedia.id, localProgress.mediaId))
    .where(eq(localMedia.contentType, type))
    .orderBy(desc(localProgress.updatedAt))
    .all();
  const latestPerTitle = new Map<number, ProgressRow>();
  for (const { progress } of recent) if (!latestPerTitle.has(progress.mediaId)) latestPerTitle.set(progress.mediaId, progress);

  const entries: ContinueEntry[] = [];
  for (const progress of latestPerTitle.values()) {
    if (entries.length >= clampLimit(limit)) break;
    const units = await db.select().from(localMediaUnits).where(eq(localMediaUnits.mediaId, progress.mediaId)).orderBy(...unitOrder).all();
    const index = units.findIndex((u) => u.id === progress.unitId);
    if (index < 0) continue;
    const item = await db.select().from(localMedia).where(eq(localMedia.id, progress.mediaId)).get();
    if (!item) continue;
    const after = units[index + 1] ?? null;
    if (progress.completed) {
      if (!after) continue;
      const afterProgress = await db.select().from(localProgress).where(eq(localProgress.unitId, after.id)).get();
      entries.push({
        item: toItem(item),
        unit: toUnit(after),
        progress: afterProgress ? toProgress(afterProgress) : { unitId: after.id, mediaId: item.id, position: 0, duration: 0, completed: false, updatedAt: progress.updatedAt },
        next: units[index + 2] ? toUnit(units[index + 2]) : null,
      });
    } else {
      entries.push({ item: toItem(item), unit: toUnit(units[index]), progress: toProgress(progress), next: after ? toUnit(after) : null });
    }
  }
  return entries;
}

