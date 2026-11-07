import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  real,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Profiles & Settings
// ---------------------------------------------------------------------------

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Player One"),
  avatarEmoji: text("avatar_emoji").notNull().default("🎬"),
  avatarColor: text("avatar_color").notNull().default("#7c5cff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"), // dark | light | system
  accentColor: text("accent_color").notNull().default("#7c5cff"),
  language: text("language").notNull().default("en"),
  startupView: text("startup_view").notNull().default("home"),
  homeSections: jsonb("home_sections")
    .$type<string[]>()
    .notNull()
    .default(["continue", "recent", "favorites", "featured"]),
  playerDefaults: jsonb("player_defaults")
    .$type<{
      autoplayNext: boolean;
      defaultVolume: number;
      resumeThreshold: number;
      completionThreshold: number;
      preferredSubtitleLang: string;
    }>()
    .notNull()
    .default({
      autoplayNext: true,
      defaultVolume: 0.8,
      resumeThreshold: 15,
      completionThreshold: 0.92,
      preferredSubtitleLang: "off",
    }),
  readerDefaults: jsonb("reader_defaults")
    .$type<{
      mode: "single" | "continuous";
      direction: "ltr" | "rtl";
      fit: "width" | "height";
      zoom: number;
    }>()
    .notNull()
    .default({ mode: "continuous", direction: "ltr", fit: "width", zoom: 1 }),
  proxy: jsonb("proxy")
    .$type<{
      mode: "none" | "http" | "https" | "socks5";
      host: string;
      port: number | null;
      username: string;
      hasPassword: boolean;
      passwordEnc: string | null;
    }>()
    .notNull()
    .default({ mode: "none", host: "", port: null, username: "", hasPassword: false, passwordEnc: null }),
  suwayomiBaseUrl: text("suwayomi_base_url").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  profileIdx: uniqueIndex("settings_profile_idx").on(t.profileId),
}));

// ---------------------------------------------------------------------------
// Repositories & Extensions (source provider architecture)
// ---------------------------------------------------------------------------

export const repositories = pgTable("repositories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  repoType: text("repo_type").notNull(), // anime | manga
  status: text("status").notNull().default("pending"), // pending | ok | error
  errorMessage: text("error_message"),
  extensionCount: integer("extension_count").notNull().default(0),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  urlIdx: uniqueIndex("repositories_url_idx").on(t.baseUrl),
}));

export const extensions = pgTable("extensions", {
  id: serial("id").primaryKey(),
  repositoryId: integer("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  pkgName: text("pkg_name").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull().default("0.0.0"),
  lang: text("lang").notNull().default("en"),
  author: text("author").notNull().default("Unknown"),
  contentType: text("content_type").notNull(), // anime | manga
  iconUrl: text("icon_url"),
  nsfw: boolean("nsfw").notNull().default(false),
  format: text("format").notNull(), // apk | jar | native-direct | native-suwayomi
  installStatus: text("install_status").notNull().default("available"),
  installError: text("install_error"),
  rawMeta: jsonb("raw_meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pkgIdx: uniqueIndex("extensions_repo_pkg_idx").on(t.repositoryId, t.pkgName),
}));

// ---------------------------------------------------------------------------
// Unified media model
// ---------------------------------------------------------------------------

export const mediaItems = pgTable("media_items", {
  id: serial("id").primaryKey(),
  contentType: text("content_type").notNull(), // anime | manga | audio
  title: text("title").notNull(),
  altTitles: jsonb("alt_titles").$type<string[]>().notNull().default([]),
  description: text("description").notNull().default(""),
  cover: text("cover").notNull().default(""),
  genres: jsonb("genres").$type<string[]>().notNull().default([]),
  releaseInfo: text("release_info").notNull().default(""),
  sourceType: text("source_type").notNull(), // direct | manual | suwayomi
  sourceId: text("source_id").notNull(), // extension pkgName or 'direct' / 'manual' / 'suwayomi'
  sourceItemId: text("source_item_id").notNull(),
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dedupeIdx: uniqueIndex("media_items_source_idx").on(t.sourceType, t.sourceId, t.sourceItemId),
  typeIdx: index("media_items_type_idx").on(t.contentType),
}));

export const episodes = pgTable("episodes", {
  id: serial("id").primaryKey(),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" }),
  number: real("number").notNull(),
  title: text("title").notNull().default(""),
  videoUrl: text("video_url").notNull(),
  subtitleUrl: text("subtitle_url"),
  durationSeconds: real("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mediaIdx: index("episodes_media_idx").on(t.mediaItemId),
}));

export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" }),
  number: real("number").notNull(),
  title: text("title").notNull().default(""),
  pages: jsonb("pages").$type<string[]>().notNull().default([]),
  sourceChapterId: text("source_chapter_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mediaIdx: index("chapters_media_idx").on(t.mediaItemId),
}));

export const tracks = pgTable("tracks", {
  id: serial("id").primaryKey(),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" }),
  number: real("number").notNull(),
  title: text("title").notNull().default(""),
  audioUrl: text("audio_url").notNull(),
  durationSeconds: real("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mediaIdx: index("tracks_media_idx").on(t.mediaItemId),
}));

// ---------------------------------------------------------------------------
// Library, history, downloads, search history
// ---------------------------------------------------------------------------

export const libraryEntries = pgTable("library_entries", {
  id: serial("id").primaryKey(),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("planning"),
  favorite: boolean("favorite").notNull().default(false),
  rating: integer("rating"),
  notes: text("notes").notNull().default(""),
  progress: jsonb("progress")
    .$type<{
      unitId: number | null;
      unitType: "episode" | "chapter" | "track" | null;
      position: number;
      duration: number;
      page: number;
      percentage: number;
    }>()
    .notNull()
    .default({ unitId: null, unitType: null, position: 0, duration: 0, page: 0, percentage: 0 }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mediaIdx: uniqueIndex("library_entries_media_idx").on(t.mediaItemId),
  statusIdx: index("library_entries_status_idx").on(t.status),
}));

export const historyEntries = pgTable("history_entries", {
  id: serial("id").primaryKey(),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // video | manga | audio
  unitId: integer("unit_id"),
  unitLabel: text("unit_label").notNull().default(""),
  position: real("position").notNull().default(0),
  duration: real("duration").notNull().default(0),
  page: integer("page"),
  completed: boolean("completed").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mediaIdx: index("history_entries_media_idx").on(t.mediaItemId),
  typeIdx: index("history_entries_type_idx").on(t.type),
}));

export const downloads = pgTable("downloads", {
  id: serial("id").primaryKey(),
  mediaItemId: integer("media_item_id")
    .notNull()
    .references(() => mediaItems.id, { onDelete: "cascade" }),
  unitId: integer("unit_id"),
  unitType: text("unit_type").notNull(), // episode | track
  title: text("title").notNull().default(""),
  sourceUrl: text("source_url").notNull(),
  filePath: text("file_path"),
  status: text("status").notNull().default("queued"), // queued | downloading | completed | failed | canceled
  progressBytes: real("progress_bytes").notNull().default(0),
  totalBytes: real("total_bytes").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mediaIdx: index("downloads_media_idx").on(t.mediaItemId),
}));

export const searchHistory = pgTable("search_history", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  contentType: text("content_type").notNull().default("all"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  profileIdx: index("search_history_profile_idx").on(t.profileId),
}));
