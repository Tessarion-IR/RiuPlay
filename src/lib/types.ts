export type ContentType = "anime" | "manga" | "audio";

export type LibraryStatus =
  | "planning"
  | "watching"
  | "reading"
  | "listening"
  | "on_hold"
  | "paused"
  | "completed"
  | "dropped";

export const STATUS_LABELS: Record<LibraryStatus, string> = {
  planning: "Planning",
  watching: "Watching",
  reading: "Reading",
  listening: "Listening",
  on_hold: "On Hold",
  paused: "Paused",
  completed: "Completed",
  dropped: "Dropped",
};

/** Statuses that make sense for a given content type. */
export const STATUSES_FOR_TYPE: Record<ContentType, LibraryStatus[]> = {
  anime: ["planning", "watching", "on_hold", "paused", "completed", "dropped"],
  manga: ["planning", "reading", "on_hold", "paused", "completed", "dropped"],
  audio: ["planning", "listening", "on_hold", "paused", "completed", "dropped"],
};

export type ExtensionFormat = "apk" | "jar" | "native-direct" | "native-suwayomi";
export type ExtensionInstallStatus = "available" | "installed" | "disabled" | "unsupported" | "error";

export interface ProxySettings {
  mode: "none" | "http" | "https" | "socks5";
  host: string;
  port: number | null;
  username: string;
  hasPassword: boolean;
  passwordEnc: string | null;
}

export interface PlayerDefaults {
  autoplayNext: boolean;
  defaultVolume: number;
  resumeThreshold: number;
  completionThreshold: number;
  preferredSubtitleLang: string;
}

export interface ReaderDefaults {
  mode: "single" | "continuous";
  direction: "ltr" | "rtl";
  fit: "width" | "height";
  zoom: number;
}

export interface LibraryProgress {
  unitId: number | null;
  unitType: "episode" | "chapter" | "track" | null;
  position: number;
  duration: number;
  page: number;
  percentage: number;
}
