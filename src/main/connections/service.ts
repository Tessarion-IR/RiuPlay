// RiuPlay M4/M5: connections as the rest of the app sees them - connection management, browsing a
// server, adding a server title to the UNIFIED library (MediaItem/MediaUnits, so progress,
// favourites, collections and Continue Reading/Listening work as for any other title), and the
// riuplay-media://remote... routes that fetch a server's images and audio with the credentials
// added in the main process (the renderer and the database never hold a token).
//
// Stored references (no secrets in them):
//   local_media.origin = "server", origin_ref = "suwayomi:<connectionId>:<mangaId>" | "kikoeru:<connectionId>:<workId>"
//   local_media.cover  = "remote:cover"
//   unit.url           = "remote:suwayomi-chapter:<chapterId>" | "remote:kikoeru-track:<server path>"
//   unit.pages_json    = ["remote:page:<server path>", ...]   (filled when the chapter is first opened)
// A server that is offline (or removed) leaves its titles in the library; opening them shows
// "server unreachable", nothing is deleted.
import { eq } from "drizzle-orm";
import type { AddMediaResult, MediaUnit } from "@shared/media";
import type { RemotePage, RemoteSource, ServerConnection, ServerConnectionInput, ServerTestResult } from "@shared/types";
import { localMediaUnits } from "../../core/db/schema";
import { insertMedia, storedItem, storedUnit, toUnit } from "../../core/media/media";
import { getPlatform } from "../../core/platform";
import { logger } from "../../core/logger";
import type { NetClient } from "../net/client";
import type { ProxyCipher } from "../net/secureProxyStore";
import type { LocalServerAllowance } from "../net/policy";
import { KikoeruClient, ServerError, SuwayomiClient, type SuwayomiBrowseType } from "./clients";
import { ConnectionStore, isLocalAddress } from "./store";

const REMOTE_PAGE = "remote:page:";
const SUWAYOMI_CHAPTER = "remote:suwayomi-chapter:";
const KIKOERU_TRACK = "remote:kikoeru-track:";

function parseRef(originRef: string): { kind: "suwayomi" | "kikoeru"; connectionId: number; ref: string } | null {
  const m = /^(suwayomi|kikoeru):(\d{1,9}):(\d{1,12})$/.exec(originRef);
  return m ? { kind: m[1] as "suwayomi" | "kikoeru", connectionId: Number(m[2]), ref: m[3] } : null;
}

export class ConnectionsService {
  readonly store: ConnectionStore;
  private readonly clients = new Map<number, SuwayomiClient | KikoeruClient>();

  constructor(private readonly http: NetClient, cipher: ProxyCipher, onAllowances: (a: LocalServerAllowance[]) => void) {
    this.store = new ConnectionStore(cipher, onAllowances);
  }

  private async client(id: number): Promise<SuwayomiClient | KikoeruClient> {
    const cached = this.clients.get(id);
    if (cached) return cached;
    const row = await this.store.row(id);
    const ctx = { id: row.id, baseUrl: row.baseUrl, authMode: row.authMode, username: row.username, secret: () => this.store.secret(row.id) };
    const client = row.kind === "suwayomi" ? new SuwayomiClient(ctx, this.http) : new KikoeruClient(ctx, this.http);
    this.clients.set(id, client);
    return client;
  }

  private async suwayomi(id: number): Promise<SuwayomiClient> {
    const c = await this.client(id);
    if (!(c instanceof SuwayomiClient)) throw new ServerError("not a Suwayomi server");
    return c;
  }

  private async kikoeru(id: number): Promise<KikoeruClient> {
    const c = await this.client(id);
    if (!(c instanceof KikoeruClient)) throw new ServerError("not a Kikoeru server");
    return c;
  }

  list(): Promise<ServerConnection[]> {
    return this.store.list();
  }

  private isLocal = (baseUrl: string) => isLocalAddress(baseUrl, { preflight: (url) => this.http.preflight(url, { kind: "app", purpose: "server-setup" }) });

  async add(input: ServerConnectionInput): Promise<{ connection: ServerConnection; test: ServerTestResult }> {
    const connection = await this.store.add(input, this.isLocal);
    return { connection, test: await this.test(connection.id) };
  }

  async update(id: number, patch: Partial<ServerConnectionInput>): Promise<{ connection: ServerConnection; test: ServerTestResult }> {
    this.clients.delete(id); // new address or credentials: no cached sign-in
    const connection = await this.store.update(id, patch, this.isLocal);
    return { connection, test: await this.test(id) };
  }

  async remove(id: number): Promise<void> {
    this.clients.delete(id);
    await this.store.remove(id);
  }

  async test(id: number): Promise<ServerTestResult> {
    try {
      const c = await this.client(id);
      const version = c instanceof SuwayomiClient ? await c.about() : await c.health();
      // A Kikoeru server can answer /api/health without a sign-in: check one real list too.
      if (c instanceof KikoeruClient) await c.works(1);
      await this.store.recordResult(id, true);
      return { ok: true, version, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      await this.store.recordResult(id, false, message).catch(() => undefined);
      return { ok: false, version: null, error: message };
    }
  }

  suwayomiSources(id: number): Promise<RemoteSource[]> {
    return this.suwayomi(id).then((c) => c.sources());
  }

  suwayomiBrowse(id: number, sourceId: string, type: SuwayomiBrowseType, page: number, query?: string): Promise<RemotePage> {
    if (!["POPULAR", "LATEST", "SEARCH"].includes(type)) throw new ServerError("unknown browse type");
    return this.suwayomi(id).then((c) => c.browse(sourceId, type, page, query));
  }

  kikoeruBrowse(id: number, page: number, query?: string): Promise<RemotePage> {
    return this.kikoeru(id).then((c) => (query && query.trim() ? c.search(query.trim(), page) : c.works(page)));
  }

  /** Adds a server title to the unified library (or returns the one already added). */
  async addToLibrary(id: number, ref: string): Promise<AddMediaResult> {
    if (!/^\d{1,12}$/.test(ref)) throw new ServerError("invalid title id");
    const row = await this.store.row(id);
    if (row.kind === "suwayomi") {
      const c = await this.suwayomi(id);
      const [manga, chapters] = await Promise.all([c.manga(ref), c.chapters(ref)]);
      return insertMedia({
        type: "manga",
        title: manga.title,
        origin: "server",
        originRef: `suwayomi:${id}:${ref}`,
        description: manga.description,
        cover: "remote:cover",
        genres: manga.genres,
        releaseInfo: [manga.author, manga.status].filter(Boolean).join(" · "),
        units: chapters.map((ch, index) => ({ number: Number.isFinite(ch.number) && ch.number > 0 ? ch.number : index + 1, title: ch.name, url: `${SUWAYOMI_CHAPTER}${ch.id}`, pages: [] })),
        libraryStatus: "planned",
      });
    }
    const c = await this.kikoeru(id);
    const [work, tracks] = await Promise.all([c.work(ref), c.tracks(ref)]);
    return insertMedia({
      type: "audio",
      title: work.title,
      origin: "server",
      originRef: `kikoeru:${id}:${ref}`,
      description: [work.circle, work.vas.length ? `CV: ${work.vas.join(", ")}` : ""].filter(Boolean).join(" · "),
      cover: "remote:cover",
      genres: work.tags.slice(0, 20),
      releaseInfo: work.release ?? "",
      units: tracks.map((t, index) => ({ number: index + 1, title: t.folder ? `${t.folder} / ${t.title}` : t.title, url: `${KIKOERU_TRACK}${t.streamPath}`, durationMs: t.durationMs })),
      libraryStatus: "planned",
    });
  }

  /** A Suwayomi chapter's pages, fetched from the server the first time it is opened. */
  async loadPages(unitId: number): Promise<MediaUnit> {
    const unit = await storedUnit(unitId);
    if (!unit || !unit.url.startsWith(SUWAYOMI_CHAPTER)) throw new ServerError("not a server chapter");
    const media = await storedItem(unit.mediaId);
    const parsed = media ? parseRef(media.originRef) : null;
    if (!parsed || parsed.kind !== "suwayomi") throw new ServerError("not a server chapter");
    const pages = await (await this.suwayomi(parsed.connectionId)).pages(unit.url.slice(SUWAYOMI_CHAPTER.length));
    const pagesJson = JSON.stringify(pages.map((p) => `${REMOTE_PAGE}${p}`));
    await getPlatform().db.get().update(localMediaUnits).set({ pagesJson }).where(eq(localMediaUnits.id, unitId)).run();
    return toUnit({ ...unit, pagesJson });
  }

  /**
   * riuplay-media://remote/<unitId>                 a Kikoeru track (Range passes through)
   * riuplay-media://remote/<unitId>/page/<index>     a Suwayomi chapter page
   * riuplay-media://remote-cover/<mediaId>           a server title's cover
   * riuplay-media://remote-thumb/<connectionId>/<ref> a browse result's cover (before adding)
   * Everything is looked up from stored data; nothing in the URL becomes a server path directly.
   */
  async handleRemote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const num = (v: string | undefined) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);
    try {
      if (url.hostname === "remote-thumb") {
        const id = num(parts[0]);
        const ref = parts[1];
        if (id === null || !ref || !/^\d{1,12}$/.test(ref)) return notFound();
        const c = await this.client(id);
        return await this.pipe(c, c instanceof SuwayomiClient ? c.thumbnailPath(ref) : c.coverPath(ref), null, request.signal);
      }
      if (url.hostname === "remote-cover") {
        const media = num(parts[0]) !== null ? await storedItem(num(parts[0])!) : null;
        const parsed = media?.origin === "server" ? parseRef(media.originRef) : null;
        if (!parsed) return notFound();
        const c = await this.client(parsed.connectionId);
        return await this.pipe(c, c instanceof SuwayomiClient ? c.thumbnailPath(parsed.ref) : c.coverPath(parsed.ref), null, request.signal);
      }
      if (url.hostname === "remote") {
        const unit = num(parts[0]) !== null ? await storedUnit(num(parts[0])!) : null;
        const media = unit ? await storedItem(unit.mediaId) : null;
        const parsed = media?.origin === "server" ? parseRef(media.originRef) : null;
        if (!unit || !parsed) return notFound();
        const c = await this.client(parsed.connectionId);
        if (parts[1] === "page") {
          const index = num(parts[2]);
          const pages = JSON.parse(unit.pagesJson) as unknown[];
          const page = index !== null ? pages[index] : undefined;
          if (typeof page !== "string" || !page.startsWith(REMOTE_PAGE)) return notFound();
          return await this.pipe(c, page.slice(REMOTE_PAGE.length), null, request.signal);
        }
        if (parts.length !== 1 || !unit.url.startsWith(KIKOERU_TRACK)) return notFound();
        return await this.pipe(c, unit.url.slice(KIKOERU_TRACK.length), request.headers.get("range"), request.signal);
      }
      return notFound();
    } catch (error) {
      logger.warn("connections", `remote media request failed: ${error instanceof Error ? error.message : "error"}`);
      return new Response("Server unreachable", { status: 502, headers: { "content-type": "text/plain" } });
    }
  }

  private async pipe(c: SuwayomiClient | KikoeruClient, path: string, range: string | null, signal?: AbortSignal): Promise<Response> {
    const upstream = await c.stream(path, range, signal);
    if (upstream.status >= 400) {
      upstream.body.destroy();
      return new Response("Server error", { status: upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status });
    }
    const headers = new Headers({ "cache-control": "private, max-age=600" });
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const value = upstream.headers[name]?.[0];
      if (value) headers.set(name, value);
    }
    const { Readable } = await import("node:stream");
    return new Response(Readable.toWeb(upstream.body) as ReadableStream, { status: upstream.status, headers });
  }
}

const notFound = () => new Response("Not found", { status: 404 });
