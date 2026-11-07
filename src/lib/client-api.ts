"use client";

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = body?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  get: <T,>(url: string) => fetch(url).then((r) => handle<T>(r)),
  post: <T,>(url: string, body?: unknown) =>
    fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),
  patch: <T,>(url: string, body?: unknown) =>
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then((r) => handle<T>(r)),
  del: <T,>(url: string) => fetch(url, { method: "DELETE" }).then((r) => handle<T>(r)),
};

export interface Profile {
  id: number;
  name: string;
  avatarEmoji: string;
  avatarColor: string;
  createdAt: string;
}

export interface ProxySettings {
  mode: "none" | "http" | "https" | "socks5";
  host: string;
  port: number | null;
  username: string;
  hasPassword: boolean;
}

export interface Settings {
  id: number;
  profileId: number;
  theme: "dark" | "light" | "system";
  accentColor: string;
  language: string;
  startupView: string;
  homeSections: string[];
  playerDefaults: {
    autoplayNext: boolean;
    defaultVolume: number;
    resumeThreshold: number;
    completionThreshold: number;
    preferredSubtitleLang: string;
  };
  readerDefaults: {
    mode: "single" | "continuous";
    direction: "ltr" | "rtl";
    fit: "width" | "height";
    zoom: number;
  };
  proxy: ProxySettings;
  suwayomiBaseUrl: string;
}

export interface MediaItem {
  id: number;
  contentType: "anime" | "manga" | "audio";
  title: string;
  altTitles: string[];
  description: string;
  cover: string;
  genres: string[];
  releaseInfo: string;
  sourceType: string;
  sourceId: string;
  sourceItemId: string;
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryEntry {
  id: number;
  mediaItemId: number;
  status: string;
  favorite: boolean;
  rating: number | null;
  notes: string;
  progress: {
    unitId: number | null;
    unitType: "episode" | "chapter" | "track" | null;
    position: number;
    duration: number;
    page: number;
    percentage: number;
  };
  addedAt: string;
  lastActivityAt: string;
}

export interface Episode {
  id: number;
  mediaItemId: number;
  number: number;
  title: string;
  videoUrl: string;
  subtitleUrl: string | null;
  durationSeconds: number | null;
}

export interface Chapter {
  id: number;
  mediaItemId: number;
  number: number;
  title: string;
  pages: string[];
  sourceChapterId: string;
}

export interface Track {
  id: number;
  mediaItemId: number;
  number: number;
  title: string;
  audioUrl: string;
  durationSeconds: number | null;
}

export interface HistoryRow {
  history: {
    id: number;
    mediaItemId: number;
    type: "video" | "manga" | "audio";
    unitId: number | null;
    unitLabel: string;
    position: number;
    duration: number;
    page: number | null;
    completed: boolean;
    occurredAt: string;
  };
  media: MediaItem;
}

export interface LibraryRow {
  entry: LibraryEntry;
  media: MediaItem;
}

export interface Repository {
  id: number;
  name: string;
  baseUrl: string;
  repoType: "anime" | "manga";
  status: "pending" | "ok" | "error";
  errorMessage: string | null;
  extensionCount: number;
  lastRefreshedAt: string | null;
  createdAt: string;
}

export interface ExtensionRow {
  id: number;
  repositoryId: number;
  pkgName: string;
  name: string;
  version: string;
  lang: string;
  author: string;
  contentType: "anime" | "manga";
  iconUrl: string | null;
  nsfw: boolean;
  format: string;
  installStatus: "available" | "installed" | "disabled" | "unsupported" | "error";
  installError: string | null;
}

export interface DownloadRow {
  download: {
    id: number;
    mediaItemId: number;
    unitId: number | null;
    unitType: string;
    title: string;
    sourceUrl: string;
    filePath: string | null;
    status: string;
    progressBytes: number;
    totalBytes: number;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  media: MediaItem;
}
