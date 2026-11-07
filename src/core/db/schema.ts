import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";

export const library = sqliteTable(
  "library",
  {
    animeId: text("anime_id").notNull(),
    sourceId: text("source_id").notNull(),
    category: text("category").notNull(), // watching | planned | completed | dropped | on_hold | favorite | saved
    addedAt: integer("added_at").notNull(),
    animeJson: text("anime_json").notNull(),
    // When the category last changed - what decides between two devices' versions (sync). Set by a
    // trigger, so no writer has to remember it.
    updatedAt: integer("updated_at").notNull().default(0),
    // Local change counter for device sync (core/sync): bumped by triggers on every write.
    changeSeq: integer("change_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.animeId] }), index("library_change_seq").on(t.changeSeq)],
);

export const watchProgress = sqliteTable(
  "watch_progress",
  {
    sourceId: text("source_id").notNull(),
    titleId: text("title_id").notNull(),
    episodeId: text("episode_id").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    // The playback group this episode was watched under - lets a "continue watching" card jump
    // straight into `/watch/$sourceId/$animeId/$groupId/$episodeId` instead of only ever landing
    // on the anime detail page (which has to be told a group anyway before it can build that same
    // URL itself). Null for progress saved before this column existed.
    groupId: text("group_id"),
    quality: text("quality"),
    // The dub studio/player this episode was last watched through (see watch route's `link`) -
    // resuming picks a matching link over the source's default priority order when one's
    // available, so switching to "Английская озвучка" once actually sticks across episodes/
    // sessions instead of quietly reverting the next time this title's watched.
    translation: text("translation"),
    playerName: text("player_name"),
    positionMs: integer("position_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    watched: integer("watched", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull(),
    // A JPEG data URL of the last frame seen for this episode (see VideoPlayer's
    // onCaptureThumbnail) - powers the history page's per-episode thumbnails. Null until the first
    // capture, and for episodes saved before this column existed.
    thumbnailDataUrl: text("thumbnail_data_url"),
    changeSeq: integer("change_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.titleId, t.episodeId] }), index("watch_progress_change_seq").on(t.changeSeq)],
);

export const dailyActivity = sqliteTable(
  "daily_activity",
  {
    date: text("date").notNull(), // YYYY-MM-DD
    // Which device watched: each one counts only its own, and a day's total is their sum - so two
    // devices' minutes add up instead of one overwriting the other when they sync.
    deviceId: text("device_id").notNull().default(""),
    watchedMs: integer("watched_ms").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    changeSeq: integer("change_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.deviceId] }), index("daily_activity_change_seq").on(t.changeSeq)],
);

export const sourceRepositories = sqliteTable("source_repositories", {
  url: text("url").primaryKey(),
  addedAt: integer("added_at").notNull(),
});

// RiuPlay M1 (migration 0025): what RiuPlay knows about a repository beyond its address, in a table
// of its own so the existing source_repositories rows stay exactly as they were. Adding a
// repository is discovery, not trust: it starts "untrusted" (added by the user, reviewed by
// nobody). Marking it trusted changes what installs from it are told, never what an extension may
// do. A disabled repository is not fetched and nothing installs from it.
export const repositoryState = sqliteTable("repository_state", {
  url: text("url").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  trust: text("trust", { enum: ["untrusted", "trusted"] }).notNull().default("untrusted"),
  trustedAt: integer("trusted_at"),
  name: text("name"),
  lastCheckedAt: integer("last_checked_at"),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
});

// RiuPlay M1 (migration 0025): per-extension state the files on disk don't hold - whether it is
// enabled, and which permissions the user saw and accepted when installing it (JSON). Removing an
// extension removes its row; nothing in the library, history or media tables refers to it.
export const extensionState = sqliteTable("extension_state", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  grantedPermissions: text("granted_permissions"),
  grantedAt: integer("granted_at"),
  updatedAt: integer("updated_at").notNull(),
});

// One row per achievement tier actually cleared (see achievements.ts's tiersClearedInRange) - the
// only genuinely discrete "+N XP" moments in the whole system. The steady per-hour-watched trickle
// (levelProgress.ts) isn't logged here at all - it's a continuous total, not a series of events,
// and would just be noise at one entry every 6 minutes of watching.
export const xpEvents = sqliteTable(
  "xp_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(), // an achievement tier id, e.g. "collector_10"
    xp: integer("xp").notNull(),
    createdAt: integer("created_at").notNull(),
    // The same event on every device: the local id differs from one database to another.
    uid: text("uid"),
    changeSeq: integer("change_seq").notNull().default(0),
  },
  (t) => [uniqueIndex("xp_events_uid").on(t.uid), index("xp_events_change_seq").on(t.changeSeq)],
);

// One row per episode a download actually finished for (see main/ipc/downloads.ts) - the
// foundation offline viewing is built on. `filePath` points at wherever it landed under this
// app's own userData/downloads folder.
export const downloadedEpisodes = sqliteTable(
  "downloaded_episodes",
  {
    sourceId: text("source_id").notNull(),
    animeId: text("anime_id").notNull(),
    groupId: text("group_id").notNull(),
    episodeId: text("episode_id").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    episodeLabel: text("episode_label").notNull(),
    filePath: text("file_path").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    // Summed from the source HLS playlist's own #EXTINF values while downloading (see
    // downloadHls) - null for a DIRECT_MP4 download (that container reports its own real duration
    // natively, no synthetic playlist/wrapper ever needed for it) or for an episode downloaded
    // before this column existed.
    durationMs: integer("duration_ms"),
    // The PlayerLink's own `quality` at the time it was downloaded (e.g. "720p") - lets offline
    // playback show what quality the file actually is instead of a dash, and mark that row as
    // fixed/non-switchable rather than offering picks from the live source's quality list, which
    // doesn't apply to a file already on disk. Null for an episode downloaded before this column
    // existed, or from a source whose links never carried a quality label to begin with.
    quality: text("quality"),
    // The episode's subtitle tracks saved beside the video, converted to WebVTT: a JSON array of
    // { filePath, label, language } (DownloadedSubtitle). Null when there were none.
    subtitles: text("subtitles"),
    // Files beside `filePath` that playback also needs: a separate audio track and the fMP4 init
    // segments of either stream. A JSON DownloadedParts; null when the episode is one file.
    parts: text("parts"),
    downloadedAt: integer("downloaded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.animeId, t.episodeId] })],
);

// A snapshot of an anime's own detail (description, genres, poster, ...) taken the moment one of
// its episodes finishes downloading - lets the title page still show something meaningful (short
// of playback of anything not itself downloaded) when the source it came from isn't reachable.
// Deliberately excludes relatedAnime/franchiseAnime/similarAnime (see sources.ts's own stripping
// before this gets written) - those aren't useful offline anyway (nothing to navigate to) and
// would otherwise be the single biggest thing bloating this table.
export const cachedAnime = sqliteTable(
  "cached_anime",
  {
    sourceId: text("source_id").notNull(),
    animeId: text("anime_id").notNull(),
    animeJson: text("anime_json").notNull(),
    cachedAt: integer("cached_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.animeId] })],
);

// Same idea as cachedAnime, but for its playback groups/episode list - the title page's episode
// grid needs this to render offline too, not just the description above it.
export const cachedPlaybackGroups = sqliteTable(
  "cached_playback_groups",
  {
    sourceId: text("source_id").notNull(),
    animeId: text("anime_id").notNull(),
    groupsJson: text("groups_json").notNull(),
    cachedAt: integer("cached_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.animeId] })],
);

// What the user rated a title, on the source's own scale (YummyAnime and every other site here
// rate out of 10).
//
// Its own table rather than a column on `library`, because rating a title and keeping it in a list
// are separate acts on every source that has both: rating something is not a reason to add it to a
// library, and removing it from the library is not a reason to forget what it was rated.
export const titleRatings = sqliteTable(
  "title_ratings",
  {
    sourceId: text("source_id").notNull(),
    animeId: text("anime_id").notNull(),
    rating: integer("rating").notNull(),
    ratedAt: integer("rated_at").notNull(),
    changeSeq: integer("change_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.animeId] }), index("title_ratings_change_seq").on(t.changeSeq)],
);

// --- Device sync (core/sync) ----------------------------------------------------------------------

/** This database's own facts for sync: its device id and its change counter ("seq"). */
export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Rows deleted from synced tables, so the deletion reaches the other devices too. Written by triggers. */
export const syncTombstones = sqliteTable(
  "sync_tombstones",
  {
    tbl: text("tbl").notNull(),
    key: text("key").notNull(),
    deletedAt: integer("deleted_at").notNull(),
    changeSeq: integer("change_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tbl, t.key] }), index("sync_tombstones_change_seq").on(t.changeSeq)],
);

/** Devices this one is paired with, and how far each side has seen the other's changes. */
export const syncPeers = sqliteTable("sync_peers", {
  deviceId: text("device_id").primaryKey(),
  name: text("name").notNull(),
  // The shared key, encrypted with the platform's secure store (base64 ciphertext).
  keyCiphertext: text("key_ciphertext").notNull(),
  // Our own change counter as of the last batch the peer acknowledged.
  sentSeq: integer("sent_seq").notNull().default(0),
  // The peer's change counter as of the last batch applied here.
  receivedSeq: integer("received_seq").notNull().default(0),
  lastAddress: text("last_address"),
  lastSyncAt: integer("last_sync_at"),
  pairedAt: integer("paired_at").notNull(),
  // This device reaches out to that one (it paired by entering that one's code), rather than waiting
  // to be reached. Only these are synced from here; the others sync with this one themselves.
  connects: integer("connects", { mode: "boolean" }).notNull().default(false),
  // A replacement picked at pairing, until the first exchange carries it out: "send" - that device's
  // data is replaced by this one's; "take" - this device's data is replaced by that one's.
  pendingReplace: text("pending_replace"),
});

// Which entry on a tracker (AniList) a title of a source is. One row per title and tracker, also for
// a title that was searched for and not found (remoteId null), so it is not searched again on every
// library change - see core/tracking. Only identifiers and the name shown on the title page: what a
// tracker says about the show is never stored as the title's own data.
export const trackerLinks = sqliteTable(
  "tracker_links",
  {
    tracker: text("tracker").notNull(),
    sourceId: text("source_id").notNull(),
    animeId: text("anime_id").notNull(),
    remoteId: integer("remote_id"),
    remoteTitle: text("remote_title"),
    // "auto" (matched by the app) or "user" (picked by hand, never replaced automatically).
    linkedBy: text("linked_by").notNull(),
    checkedAt: integer("checked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tracker, t.sourceId, t.animeId] })],
);

// New-episode notices (core/newEpisodes): what is known about each title being watched for new
// episodes, and when to look next. This device's own - another device keeps its own and notifies
// for itself - so it is not part of device sync.
export const episodeWatch = sqliteTable(
  "episode_watch",
  {
    sourceId: text("source_id").notNull(),
    animeId: text("anime_id").notNull(),
    // "on" / "off" from the title page's bell; null = follow the library (an ongoing in "Watching").
    bell: text("bell"),
    groupId: text("group_id"),
    knownCount: integer("known_count"),
    knownMax: real("known_max"),
    // JSON array of ms timestamps: when new episodes came out, newest last.
    arrivals: text("arrivals").notNull().default("[]"),
    waitingSince: integer("waiting_since"),
    nextEpisodeAt: integer("next_episode_at"),
    failures: integer("failures").notNull().default(0),
    nextCheckAt: integer("next_check_at").notNull().default(0),
    checkedAt: integer("checked_at"),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.animeId] }), index("episode_watch_next_check").on(t.nextCheckAt)],
);

// ---------------------------------------------------------------------------------------------
// RiuPlay additions (migration 0023_riuplay_merged_schema). Additive only: no hibiki table or
// column is changed, so existing data and device sync are untouched. These carry over the model of
// the original RiuPlay prototype (legacy/next-app/src/db/schema.ts): app settings readable by the
// main process, locally added media of every content type, and user collections. None of these
// tables take part in device sync (core/sync), which only knows the hibiki tables it lists.
// ---------------------------------------------------------------------------------------------

/** Key/value settings the main process needs before any window exists (e.g. LAN sync opt-in).
 * `value` is JSON. Renderer-only preferences stay in the renderer's own stores. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const MEDIA_CONTENT_TYPES = ["video", "manga", "audio"] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

/** Media the user added themselves (direct URL, local file, manual entry, Suwayomi import) rather
 * than browsed from an installed source. One row per title; (origin, originRef) prevents duplicates,
 * as the prototype's media_items_source_idx did. */
export const localMedia = sqliteTable(
  "local_media",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contentType: text("content_type").notNull(),
    title: text("title").notNull(),
    altTitlesJson: text("alt_titles_json").notNull().default("[]"),
    description: text("description").notNull().default(""),
    cover: text("cover").notNull().default(""),
    genresJson: text("genres_json").notNull().default("[]"),
    releaseInfo: text("release_info").notNull().default(""),
    // direct | file | manual | suwayomi
    origin: text("origin").notNull(),
    // What identifies the title within its origin (a URL, a file path, a Suwayomi manga id...).
    originRef: text("origin_ref").notNull(),
    extraJson: text("extra_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("local_media_origin_idx").on(t.origin, t.originRef),
    index("local_media_type_idx").on(t.contentType),
    check("local_media_content_type_check", sql`${t.contentType} in ('video', 'manga', 'audio')`),
  ],
);

/** Episodes, chapters and tracks of a local_media title (the prototype's three tables, unified). */
export const localMediaUnits = sqliteTable(
  "local_media_units",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mediaId: integer("media_id")
      .notNull()
      .references(() => localMedia.id, { onDelete: "cascade" }),
    // episode | chapter | track
    kind: text("kind").notNull(),
    number: real("number").notNull(),
    title: text("title").notNull().default(""),
    // Video/audio location for episodes and tracks; empty for chapters.
    url: text("url").notNull().default(""),
    subtitleUrl: text("subtitle_url"),
    // JSON array of page image URLs, for chapters.
    pagesJson: text("pages_json").notNull().default("[]"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("local_media_units_media_idx").on(t.mediaId, t.number),
    check("local_media_units_kind_check", sql`${t.kind} in ('episode', 'chapter', 'track')`),
  ],
);

/** User-made collections ("Rewatch list", "Summer 2026"...), across sources. */
export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** A title in a collection, identified the way the library identifies titles (sourceId + titleId;
 * local media use sourceId "local" and their local_media id). */
export const collectionItems = sqliteTable(
  "collection_items",
  {
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    titleId: text("title_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.sourceId, t.titleId] }), index("collection_items_title_idx").on(t.sourceId, t.titleId)],
);

// ---------------------------------------------------------------------------------------------
// RiuPlay Phase 6 (migration 0024_riuplay_local_library): the personal-library and progress side of
// local_media - the prototype's library_entries and per-unit progress (legacy/next-app schema),
// kept in tables of their own rather than hibiki's library/watch_progress: those two take part in
// device sync and are keyed by an extension source, and a local title's id means nothing on another
// device. Additive only.
// ---------------------------------------------------------------------------------------------

/** A local_media title in the user's library. Absent row = not in the library. */
export const localLibrary = sqliteTable(
  "local_library",
  {
    mediaId: integer("media_id")
      .primaryKey()
      .references(() => localMedia.id, { onDelete: "cascade" }),
    // active | planned | completed | on_hold | dropped - shown per type as Watching/Reading/Listening...
    status: text("status").notNull(),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("local_library_status_idx").on(t.status),
    check("local_library_status_check", sql`${t.status} in ('active', 'planned', 'completed', 'on_hold', 'dropped')`),
  ],
);

/** Where the user is in one unit: milliseconds for episodes and tracks, a page index for chapters. */
export const localProgress = sqliteTable(
  "local_progress",
  {
    unitId: integer("unit_id")
      .primaryKey()
      .references(() => localMediaUnits.id, { onDelete: "cascade" }),
    mediaId: integer("media_id")
      .notNull()
      .references(() => localMedia.id, { onDelete: "cascade" }),
    position: real("position").notNull().default(0),
    duration: real("duration").notNull().default(0),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("local_progress_media_idx").on(t.mediaId, t.updatedAt), index("local_progress_updated_idx").on(t.updatedAt)],
);

// RiuPlay M4/M5 (migration 0026): the user's own media servers (Suwayomi for manga, Kikoeru for
// audio). The password or token is stored only as safeStorage ciphertext. A server on the user's
// computer or local network is reachable only after they confirmed it (local_approved_at): that
// creates the exact scheme/host/port exception in the network broker for this connection alone.
export const serverConnections = sqliteTable(
  "server_connections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["suwayomi", "kikoeru"] }).notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    authMode: text("auth_mode", { enum: ["none", "basic", "ui_login", "token"] }).notNull().default("none"),
    username: text("username"),
    secretCiphertext: text("secret_ciphertext"),
    localApprovedAt: integer("local_approved_at"),
    lastOkAt: integer("last_ok_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("server_connections_kind_url_idx").on(t.kind, t.baseUrl)],
);
