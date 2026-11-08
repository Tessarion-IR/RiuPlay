// RiuPlay M8: installed extensions as media providers of the unified catalog.
//
// Repository -> Extension Manager -> Extension Runtime (M2 sandbox) -> THIS ADAPTER -> MediaItem /
// MediaUnits -> the native player, reader and audio player.
//
// - browse/detail answer the section screens straight from the extension (nothing stored).
// - open() stores the title as an ordinary MediaItem (origin "extension", origin_ref
//   "<sourceId>:<titleId>") with one unit per episode, chapter or track - no manual matching, and
//   progress, favourites, collections and Continue Watching/Reading/Listening work as for any title.
// - Content is fetched by the MAIN process through the controlled network client as caller
//   extension:<sourceId>, so an extension's declared hosts bind its streams and pages too, every
//   redirect is re-checked, and the proxy applies. The page never gets a raw third-party URL.
//
// Stored references:
//   unit.url        = "ext:unit:" + JSON [groupId, episodeId]
//   unit.pages_json = ["ext:page:<https url>", ...]   (filled the first time a chapter is opened)
import { eq } from "drizzle-orm";
import type { AddMediaResult, MediaType, MediaUnit, ProviderDetail, ProviderSource, ProviderTitle, ProviderUnit } from "@shared/media";
import type { AnimeTitle, ExtensionContentType, PlayerLink, SourceInfo } from "@shared/types";

export type { ProviderDetail, ProviderSource, ProviderTitle, ProviderUnit };
import { localMediaUnits } from "../../core/db/schema";
import { insertMedia, storedItem, storedUnit, toUnit } from "../../core/media/media";
import type { ExtensionRuntime } from "../../core/extensions/runtime";
import { getPlatform } from "../../core/platform";
import { logger } from "../../core/logger";
import type { NetClient } from "../net/client";
import type { Caller } from "../net/policy";

export const EXT_UNIT = "ext:unit:";
export const EXT_PAGE = "ext:page:";

const httpUrl = (value: unknown): string => (typeof value === "string" && /^https?:\/\//i.test(value) ? value : "");
const titleText = (t: AnimeTitle): string => t.englishName || t.originalName || t.russianName || t.id;

function toProviderTitle(sourceId: string, t: AnimeTitle): ProviderTitle {
  return { sourceId, id: String(t.id), title: titleText(t).slice(0, 500), cover: httpUrl(t.posterUrl), year: typeof t.year === "number" ? t.year : null, description: String(t.description ?? "").slice(0, 4000) };
}

export function parseUnitRef(url: string): { groupId: string; episodeId: string } | null {
  if (!url.startsWith(EXT_UNIT)) return null;
  try {
    const value = JSON.parse(url.slice(EXT_UNIT.length)) as unknown;
    return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "string") ? { groupId: value[0], episodeId: value[1] } : null;
  } catch {
    return null;
  }
}

export function parseOriginRef(originRef: string): { sourceId: string; titleId: string } | null {
  const at = originRef.indexOf(":");
  return at > 0 ? { sourceId: originRef.slice(0, at), titleId: originRef.slice(at + 1) } : null;
}

/** The playable link for an audio or video unit: a direct file the main process can stream. */
export function pickDirectLink(links: PlayerLink[], type: MediaType): PlayerLink | null {
  const wanted = type === "audio" ? ["DIRECT_AUDIO", "DIRECT_MP4"] : ["DIRECT_MP4"];
  return links.find((l) => wanted.includes(l.type) && /^https?:\/\//i.test(l.url)) ?? null;
}

const LINK_TTL_MS = 10 * 60_000;

export class ExtensionMediaService {
  private readonly links = new Map<number, { link: PlayerLink; at: number }>();

  constructor(private readonly runtime: ExtensionRuntime, private readonly net: NetClient) {}

  /** Installed, enabled script extensions that provide `type` (APK sources are not part of this). */
  sources(type: MediaType): ProviderSource[] {
    return this.runtime
      .list()
      .filter((s: SourceInfo) => s.runtime !== undefined && !s.id.startsWith("apk:") && (s.contentType ?? "video") === type)
      .map((s) => ({ id: s.id, name: s.name, contentType: (s.contentType ?? "video") as MediaType, lang: s.lang ?? null }));
  }

  private assertProvides(sourceId: string, type?: MediaType): ExtensionContentType {
    const source = this.runtime.list().find((s) => s.id === sourceId);
    if (!source) throw new Error("This source is not installed or is disabled");
    const provided = source.contentType ?? "video";
    if (type && provided !== type) throw new Error(`This source does not provide ${type}`);
    return provided;
  }

  async browse(type: MediaType, sourceId: string, query: string, offset: number): Promise<ProviderTitle[]> {
    this.assertProvides(sourceId, type);
    const q = query.trim().slice(0, 200);
    const titles = q || offset > 0
      ? await this.runtime.search(sourceId, { query: q, offset, limit: 30 })
      : await this.runtime.latest(sourceId, 30);
    return titles.map((t) => toProviderTitle(sourceId, t));
  }

  async detail(sourceId: string, titleId: string): Promise<ProviderDetail> {
    this.assertProvides(sourceId);
    const [title, groups] = await Promise.all([this.runtime.getById(sourceId, titleId), this.runtime.getPlaybackGroups(sourceId, titleId)]);
    const units: ProviderUnit[] = [];
    for (const group of groups) {
      for (const episode of group.episodes ?? []) {
        units.push({
          groupId: String(group.id),
          episodeId: String(episode.id),
          number: Number.isFinite(episode.number) && episode.number > 0 ? episode.number : units.length + 1,
          title: String(episode.title ?? "").slice(0, 500),
          durationMs: typeof episode.durationMs === "number" && episode.durationMs > 0 ? episode.durationMs : null,
        });
      }
    }
    return { ...toProviderTitle(sourceId, title), genres: (title.genres ?? []).slice(0, 20).map(String), units: units.slice(0, 5000) };
  }

  /** Stores the title in the unified library (or returns the one already stored). */
  async open(sourceId: string, titleId: string): Promise<AddMediaResult> {
    const type = this.assertProvides(sourceId) as MediaType;
    const detail = await this.detail(sourceId, titleId);
    return insertMedia({
      type,
      title: detail.title,
      origin: "extension",
      originRef: `${sourceId}:${titleId}`,
      description: detail.description,
      cover: detail.cover,
      genres: detail.genres,
      releaseInfo: detail.year ? String(detail.year) : "",
      units: detail.units.map((u) => ({ number: u.number, title: u.title, url: `${EXT_UNIT}${JSON.stringify([u.groupId, u.episodeId])}`, pages: [], durationMs: u.durationMs })),
    });
  }

  private async unitContext(unitId: number) {
    const unit = await storedUnit(unitId);
    const media = unit ? await storedItem(unit.mediaId) : null;
    const origin = media?.origin === "extension" ? parseOriginRef(media.originRef) : null;
    const ref = unit ? parseUnitRef(unit.url) : null;
    if (!unit || !media || !origin || !ref) return null;
    return { unit, media, origin, ref };
  }

  /** A manga chapter's pages, asked of the extension the first time the chapter is opened. */
  async loadPages(unitId: number): Promise<MediaUnit> {
    const ctx = await this.unitContext(unitId);
    if (!ctx || ctx.media.contentType !== "manga") throw new Error("not an extension chapter");
    const pages = await this.runtime.getPages(ctx.origin.sourceId, ctx.origin.titleId, ctx.ref.groupId, ctx.ref.episodeId);
    if (pages.length === 0) throw new Error("This chapter has no pages");
    const pagesJson = JSON.stringify(pages.map((p) => `${EXT_PAGE}${p.url}`));
    await getPlatform().db.get().update(localMediaUnits).set({ pagesJson }).where(eq(localMediaUnits.id, unitId)).run();
    return toUnit({ ...ctx.unit, pagesJson });
  }

  private async linkFor(ctx: NonNullable<Awaited<ReturnType<ExtensionMediaService["unitContext"]>>>, fresh: boolean): Promise<PlayerLink> {
    const cached = this.links.get(ctx.unit.id);
    if (!fresh && cached && Date.now() - cached.at < LINK_TTL_MS) return cached.link;
    const links = await this.runtime.getPlayerLinks(ctx.origin.sourceId, ctx.origin.titleId, ctx.ref.groupId, ctx.ref.episodeId);
    const link = pickDirectLink(links, ctx.media.contentType as MediaType);
    if (!link) throw new Error("The source returned nothing this player can play");
    this.links.set(ctx.unit.id, { link, at: Date.now() });
    return link;
  }

  /**
   * riuplay-media://ext/<unitId>                a video or audio unit (Range passes through)
   * riuplay-media://ext/<unitId>/page/<index>   a manga page
   * Only stored references are followed; nothing in the URL becomes an upstream address.
   */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const num = (v: string | undefined) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);
    const unitId = num(parts[0]);
    const ctx = unitId !== null ? await this.unitContext(unitId) : null;
    if (!ctx) return notFound();
    const caller: Caller = { kind: "extension", sourceId: ctx.origin.sourceId };
    try {
      if (parts[1] === "page") {
        const index = num(parts[2]);
        const pages = JSON.parse(ctx.unit.pagesJson) as unknown[];
        const page = index !== null ? pages[index] : undefined;
        if (typeof page !== "string" || !page.startsWith(EXT_PAGE)) return notFound();
        return await this.pipe(page.slice(EXT_PAGE.length), caller, null, {}, request.signal);
      }
      if (parts.length !== 1 || ctx.media.contentType === "manga") return notFound();
      const range = request.headers.get("range");
      let link = await this.linkFor(ctx, false);
      let response = await this.pipe(link.url, caller, range, link.headers ?? {}, request.signal);
      if (response.status === 403 || response.status === 404 || response.status === 410) {
        // A signed or moved link: ask the extension once more.
        link = await this.linkFor(ctx, true);
        response = await this.pipe(link.url, caller, range, link.headers ?? {}, request.signal);
      }
      return response;
    } catch (error) {
      logger.warn("ext-media", `extension media request failed: ${error instanceof Error ? error.message : "error"}`);
      return new Response("Source unavailable", { status: 502, headers: { "content-type": "text/plain" } });
    }
  }

  private async pipe(target: string, caller: Caller, range: string | null, extra: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(extra)) if (/^(referer|origin|user-agent|accept)$/i.test(name) && typeof value === "string") headers[name] = value;
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    const upstream = await this.net.stream({ url: target, caller, headers, timeoutMs: 30_000, signal });
    if (upstream.status >= 400) {
      upstream.body.destroy();
      return new Response("Source error", { status: upstream.status });
    }
    const out = new Headers({ "cache-control": "private, max-age=600" });
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const value = upstream.headers[name]?.[0];
      if (value) out.set(name, value);
    }
    const { Readable } = await import("node:stream");
    return new Response(Readable.toWeb(upstream.body) as ReadableStream, { status: upstream.status, headers: out });
  }
}

const notFound = () => new Response("Not found", { status: 404 });
