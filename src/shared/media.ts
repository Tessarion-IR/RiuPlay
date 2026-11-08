// RiuPlay's unified media model: one shape for video/anime, manga/manhwa and audio/ASMR, shared by
// the core API, the IPC contract and the renderer. Carries over the original RiuPlay prototype's
// model (legacy/next-app/src/db/schema.ts + src/lib/types.ts): a title with episodes, chapters or
// tracks, a personal library with per-type statuses, per-unit progress and collections.
//
// Titles browsed from extension sources (hibiki's AnimeTitle) are not stored here; they meet this
// model in the views that show both (Home, Library, Collections) through MediaRef.

export const MEDIA_TYPES = ["video", "manga", "audio"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const UNIT_KINDS = ["episode", "chapter", "track"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** The unit kind each content type is made of. */
export const UNIT_KIND_FOR: Record<MediaType, UnitKind> = { video: "episode", manga: "chapter", audio: "track" };

/** Where a locally added title came from. */
// "server": a title on the user's Suwayomi/Kikoeru server (RiuPlay M4/M5); originRef "<kind>:<connectionId>:<ref>".
// "extension": a title from an installed extension (RiuPlay M8); originRef "<sourceId>:<titleId>".
export const MEDIA_ORIGINS = ["direct", "file", "manual", "server", "extension"] as const;
export type MediaOrigin = (typeof MEDIA_ORIGINS)[number];

/** Library statuses, shared by every type; the words differ per type (Watching / Reading / Listening). */
export const LIBRARY_STATUSES = ["active", "planned", "completed", "on_hold", "dropped"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** The source id local titles use wherever a (sourceId, titleId) pair is expected (collections). */
export const LOCAL_SOURCE_ID = "local";

export interface MediaItem {
  id: number;
  type: MediaType;
  title: string;
  altTitles: string[];
  description: string;
  /** An http(s) URL, a riuplay-media:// URL for a local cover, or "" for none. */
  cover: string;
  genres: string[];
  releaseInfo: string;
  origin: MediaOrigin;
  /** What identifies the title within its origin (the first URL, the imported folder...). */
  originRef: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaUnit {
  id: number;
  mediaId: number;
  kind: UnitKind;
  number: number;
  title: string;
  /** Playable location for episodes and tracks: an http(s) URL, or riuplay-media://unit/<id> for a local file. */
  url: string;
  subtitleUrl: string | null;
  /** Page image locations for chapters (http(s) or riuplay-media://page/<unitId>/<index>). */
  pages: string[];
  durationMs: number | null;
}

export interface MediaLibraryState {
  status: LibraryStatus;
  favorite: boolean;
  addedAt: number;
  updatedAt: number;
}

/** Where the user is in a unit: ms for episodes/tracks, a page index for chapters. */
export interface UnitProgress {
  unitId: number;
  mediaId: number;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
}

export interface MediaDetails {
  item: MediaItem;
  units: MediaUnit[];
  library: MediaLibraryState | null;
  progress: UnitProgress[];
  /** Collections this title is in. */
  collectionIds: number[];
}

/** A title as it appears in lists, with what the lists show about it. */
export interface MediaSummary {
  item: MediaItem;
  unitCount: number;
  library: MediaLibraryState | null;
}

/** One row of Continue Watching / Reading / Listening: the unit to resume and where. */
export interface ContinueEntry {
  item: MediaItem;
  unit: MediaUnit;
  progress: UnitProgress;
  /** The unit after this one, when the one in progress is finished. */
  next: MediaUnit | null;
}

/** A title anywhere in RiuPlay: a local one, or one from an extension source. */
export interface MediaRef {
  sourceId: string;
  titleId: string;
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionItem extends MediaRef {
  addedAt: number;
  /** Resolved for display: a local title, or what is known of a source title (library/cache). */
  local: MediaItem | null;
  remote: { title: string; cover: string | null } | null;
}

// --- Input shapes (validated in core with zod before they touch the database) ---

export interface UnitInput {
  number?: number;
  title?: string;
  url?: string;
  subtitleUrl?: string | null;
  pages?: string[];
  durationMs?: number | null;
}

export interface AddMediaInput {
  type: MediaType;
  title: string;
  origin: "direct" | "manual";
  description?: string;
  cover?: string;
  genres?: string[];
  altTitles?: string[];
  releaseInfo?: string;
  units?: UnitInput[];
  /** Put it straight into the library with this status. */
  libraryStatus?: LibraryStatus;
}

/** Local files picked in the native dialog, turned into a title by the main process. */
export interface AddFilesInput {
  type: MediaType;
  /** Absolute paths: files (video/audio) or one folder (manga: images, or subfolders of images). */
  paths: string[];
  title?: string;
  libraryStatus?: LibraryStatus;
}

export interface AddMediaResult {
  item: MediaItem;
  /** True when the same title (same origin and reference) already existed and was returned instead. */
  existed: boolean;
}

export interface MediaPatch {
  title?: string;
  description?: string;
  cover?: string;
  genres?: string[];
  altTitles?: string[];
  releaseInfo?: string;
}

/** The part of `window.hibiki` for RiuPlay's own media (src/preload). */
/** RiuPlay: activity in the unified library, per type (counts only - progress units differ by type). */
export interface MediaStats {
  byType: Record<MediaType, { titles: number; inLibrary: number; favorites: number; unitsStarted: number; unitsCompleted: number }>;
}

export interface MediaApi {
  list(filter?: { type?: MediaType; search?: string; inLibrary?: boolean }): Promise<MediaSummary[]>;
  get(id: number): Promise<MediaDetails | null>;
  add(input: AddMediaInput): Promise<AddMediaResult>;
  addFiles(input: AddFilesInput): Promise<AddMediaResult>;
  /** Opens the native picker; resolves with the chosen paths, or [] when cancelled. */
  pickFiles(type: MediaType, mode: "files" | "folder"): Promise<string[]>;
  update(id: number, patch: MediaPatch): Promise<MediaItem>;
  remove(id: number): Promise<void>;
  addUnit(mediaId: number, unit: UnitInput): Promise<MediaUnit>;
  removeUnit(unitId: number): Promise<void>;
  setLibrary(mediaId: number, state: { status: LibraryStatus; favorite?: boolean } | null): Promise<MediaLibraryState | null>;
  setFavorite(mediaId: number, favorite: boolean): Promise<MediaLibraryState>;
  saveProgress(unitId: number, position: number, duration: number): Promise<UnitProgress>;
  setUnitCompleted(unitId: number, completed: boolean): Promise<UnitProgress>;
  continueList(type: MediaType, limit?: number): Promise<ContinueEntry[]>;
  recentlyAdded(limit?: number): Promise<MediaSummary[]>;
  /** RiuPlay: per-type counts of the unified library and its progress. */
  stats?(): Promise<MediaStats>;
  collections: {
    list(): Promise<Collection[]>;
    create(name: string, description?: string): Promise<Collection>;
    update(id: number, patch: { name?: string; description?: string }): Promise<Collection>;
    remove(id: number): Promise<void>;
    items(id: number): Promise<CollectionItem[]>;
    addItem(id: number, ref: MediaRef): Promise<void>;
    removeItem(id: number, ref: MediaRef): Promise<void>;
    /** Collections a title is in. */
    of(ref: MediaRef): Promise<number[]>;
  };
}

// --- RiuPlay M8: installed extensions as media providers --------------------------------------

/** An installed, enabled extension that provides one media type. */
export interface ProviderSource {
  id: string;
  name: string;
  contentType: MediaType;
  lang: string | null;
}

/** A title as a section's browse row shows it (straight from the extension, not stored). */
export interface ProviderTitle {
  sourceId: string;
  id: string;
  title: string;
  cover: string;
  year: number | null;
  description: string;
}

export interface ProviderUnit {
  groupId: string;
  episodeId: string;
  number: number;
  title: string;
  durationMs: number | null;
}

export interface ProviderDetail extends ProviderTitle {
  genres: string[];
  units: ProviderUnit[];
}
