// RiuPlay: renderer helpers for the unified media model (shared/media.ts) - what every Video, Manga
// and Audio screen shares, so the three sections behave and read the same way while keeping each
// type's own words (Watching / Reading / Listening, episode / chapter / track).
import { Clapperboard, BookOpen, Headphones } from "lucide-react";
import type { LibraryStatus, MediaType, MediaUnit, UnitInput, UnitProgress } from "@shared/media";

export const MEDIA_TYPE_ICONS: Record<MediaType, typeof Clapperboard> = { video: Clapperboard, manga: BookOpen, audio: Headphones };
export const MEDIA_SECTION_PATH: Record<MediaType, "/video" | "/manga" | "/audio"> = { video: "/video", manga: "/manga", audio: "/audio" };

/** React Query keys, so a change anywhere refreshes every screen that shows media. */
export const mediaKeys = {
  all: ["media"] as const,
  list: (filter: object) => ["media", "list", filter] as const,
  detail: (id: number) => ["media", "detail", id] as const,
  continue: (type: MediaType) => ["media", "continue", type] as const,
  recent: ["media", "recent"] as const,
  collections: ["collections"] as const,
  collectionItems: (id: number) => ["collections", "items", id] as const,
};

/** i18n key of a library status, in the words of the content type ("Watching" / "Reading" / "Listening"). */
export function statusLabelKey(type: MediaType, status: LibraryStatus): string {
  return status === "active" ? `media.status.active.${type}` : `media.status.${status}`;
}

export const unitLabelKey = (type: MediaType) => `media.unit.${type}`;
export const continueTitleKey = (type: MediaType) => `media.continue.${type}`;

/**
 * Turns what the user typed into the Add Media dialog into units. One location per line; for manga,
 * a blank line starts a new chapter (each line of a chapter is one page). Lines that are not
 * http(s) URLs are reported, not silently dropped.
 */
export function parseUnitLines(type: MediaType, text: string): { units: UnitInput[]; invalid: string[] } {
  const invalid: string[] = [];
  const isUrl = (line: string) => {
    try {
      const url = new URL(line);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };
  if (type === "manga") {
    const chapters: UnitInput[] = [];
    let pages: string[] = [];
    const flush = () => {
      if (pages.length) chapters.push({ pages });
      pages = [];
    };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        flush();
        continue;
      }
      if (isUrl(line)) pages.push(line);
      else invalid.push(line);
    }
    flush();
    return { units: chapters, invalid };
  }
  const units: UnitInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (isUrl(line)) units.push({ url: line });
    else invalid.push(line);
  }
  return { units, invalid };
}

/** A sensible title from a URL when the user leaves the title empty: the file name, without extension. */
export function titleFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    const name = last.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_.-]+/g, " ").trim();
    return name || url.hostname;
  } catch {
    return "";
  }
}

/** 0..1, for progress bars: time share for episodes/tracks, page share for chapters. */
export function progressFraction(progress: Pick<UnitProgress, "position" | "duration" | "completed"> | null | undefined, kind: MediaUnit["kind"]): number {
  if (!progress) return 0;
  if (progress.completed) return 1;
  if (!(progress.duration > 0)) return 0;
  const done = kind === "chapter" ? progress.position + 1 : progress.position;
  return Math.max(0, Math.min(1, done / progress.duration));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "Episode 3", "Chapter 12.5", "Track 1" - or the unit's own title when it has one. */
export function unitName(unit: Pick<MediaUnit, "number" | "title">, kindLabel: string): string {
  const number = Number.isInteger(unit.number) ? String(unit.number) : String(Math.round(unit.number * 100) / 100);
  return unit.title ? `${number}. ${unit.title}` : `${kindLabel} ${number}`;
}

/** The player link type for a playable URL: HLS by extension, otherwise a direct file. */
export function playerLinkTypeFor(url: string): "DIRECT_HLS" | "DIRECT_DASH" | "DIRECT_MP4" {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (path.endsWith(".m3u8")) return "DIRECT_HLS";
  if (path.endsWith(".mpd")) return "DIRECT_DASH";
  return "DIRECT_MP4";
}
