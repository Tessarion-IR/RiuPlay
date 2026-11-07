// RiuPlay M4/M5: clients for the user's own media servers. Every request goes through the M3
// controlled path as caller "connection:<id>" - so a server on the public internet gets all the
// usual rules, and one on the user's computer/LAN is reachable only through the exact
// scheme/host/port exception the user approved for that connection. Credentials are sent ONLY to
// the connection's own origin: a page or stream URL the server hands back that points anywhere
// else is refused, never followed with the user's password or token.
//
// API contracts (from the servers' source code; see docs/M4_M5_SERVERS.md for what was verified):
//   Suwayomi-Server  POST /api/graphql (aboutServer, sources, fetchSourceManga, fetchManga,
//                    fetchChapters, fetchChapterPages, login); images: the REST paths it returns
//                    (/api/v1/manga/<id>/thumbnail, /api/v1/manga/<id>/chapter/<n>/page/<i>)
//                    auth: none | HTTP Basic | UI login (login mutation -> Bearer access token)
//   Kikoeru          GET /api/health, POST /api/auth/me {name,password} -> {token},
//                    GET /api/works, /api/search/<kw>, /api/work/<id>, /api/tracks/<id>,
//                    /api/cover/<id>; streams: the track's mediaStreamUrl (Range passes through)
//                    auth: none | token (Authorization: Bearer)
import type { RemotePage, RemoteSource, ServerAuthMode } from "@shared/types";
import type { NetClient, StreamedResponse } from "../net/client";
import { NetError } from "../net/errors";

export interface ConnectionContext {
  id: number;
  baseUrl: string;
  authMode: ServerAuthMode;
  username: string | null;
  secret: () => Promise<string | null>;
}

export class ServerError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "ServerError";
  }
}

const caller = (id: number) => ({ kind: "connection" as const, connectionId: String(id) });

/** An absolute URL for a server-relative path, refused when it would leave the server's origin. */
export function sameOriginUrl(baseUrl: string, pathOrUrl: string): string {
  const base = new URL(`${baseUrl}/`);
  const url = new URL(pathOrUrl.startsWith("/") ? `${base.origin}${new URL(baseUrl).pathname.replace(/\/+$/, "")}${pathOrUrl}` : pathOrUrl, base);
  if (url.origin !== base.origin) throw new ServerError("the server pointed to another host; refused (credentials are only ever sent to the server itself)");
  return url.toString();
}

abstract class BaseClient {
  protected bearer: string | null = null;
  constructor(protected readonly ctx: ConnectionContext, protected readonly http: NetClient) {}

  protected async authHeaders(): Promise<Record<string, string>> {
    if (this.ctx.authMode === "basic") {
      const secret = (await this.ctx.secret()) ?? "";
      return { Authorization: `Basic ${Buffer.from(`${this.ctx.username ?? ""}:${secret}`).toString("base64")}` };
    }
    if (this.ctx.authMode === "ui_login" || this.ctx.authMode === "token") {
      if (!this.bearer) this.bearer = await this.login();
      return { Authorization: `Bearer ${this.bearer}` };
    }
    return {};
  }

  protected abstract login(): Promise<string>;

  protected async json<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean; retried?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...(init.auth === false ? {} : await this.authHeaders()) };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.http.request({ url: sameOriginUrl(this.ctx.baseUrl, path), caller: caller(this.ctx.id), method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, timeoutMs: 20_000 });
    } catch (error) {
      throw new ServerError(error instanceof NetError ? describeNetError(error) : "the server could not be reached");
    }
    if (response.status === 401 && this.bearer && !init.retried && init.auth !== false) {
      this.bearer = null; // expired token: sign in again once
      return this.json<T>(path, { ...init, retried: true });
    }
    if (response.status === 401 || response.status === 403) throw new ServerError("the server refused the sign-in (check the user name and password)", response.status);
    if (response.status < 200 || response.status >= 300) throw new ServerError(`the server answered HTTP ${response.status}`, response.status);
    try {
      return JSON.parse(response.body.toString("utf8")) as T;
    } catch {
      throw new ServerError("the server's answer is not valid JSON (is this the right address?)");
    }
  }

  /** Streams an image/audio file from the server (same origin only), passing Range through. */
  async stream(pathOrUrl: string, range: string | null, signal?: AbortSignal): Promise<StreamedResponse> {
    const headers: Record<string, string> = { ...(await this.authHeaders()) };
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    return this.http.stream({ url: sameOriginUrl(this.ctx.baseUrl, pathOrUrl), caller: caller(this.ctx.id), headers, timeoutMs: 30_000, signal });
  }
}

export function describeNetError(error: NetError): string {
  switch (error.code) {
    case "blocked-address":
      return "this address is on your computer or local network and was not confirmed for this server";
    case "dns-failed":
      return "the server's name could not be resolved";
    case "connect-failed":
    case "timeout":
      return "the server did not answer";
    case "proxy-failed":
    case "proxy-invalid":
    case "proxy-unavailable":
      return "the configured proxy failed";
    default:
      return `request refused (${error.code})`;
  }
}

// --- Suwayomi -----------------------------------------------------------------------------------

interface GraphQLAnswer<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export type SuwayomiBrowseType = "POPULAR" | "LATEST" | "SEARCH";

export class SuwayomiClient extends BaseClient {
  protected async login(): Promise<string> {
    const answer = await this.json<GraphQLAnswer<{ login?: { accessToken?: string } }>>("/api/graphql", {
      auth: false,
      body: { query: "mutation Login($u: String!, $p: String!) { login(input: { username: $u, password: $p }) { accessToken refreshToken } }", variables: { u: this.ctx.username ?? "", p: (await this.ctx.secret()) ?? "" } },
    });
    const token = answer.data?.login?.accessToken;
    if (!token) throw new ServerError(answer.errors?.[0]?.message ? `sign-in failed: ${answer.errors[0].message.slice(0, 200)}` : "sign-in failed");
    return token;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const answer = await this.json<GraphQLAnswer<T>>("/api/graphql", { body: { query, variables } });
    if (answer.errors?.length) throw new ServerError(`the server reported: ${String(answer.errors[0].message ?? "error").slice(0, 200)}`);
    if (!answer.data) throw new ServerError("the server returned no data");
    return answer.data;
  }

  async about(): Promise<string> {
    const data = await this.graphql<{ aboutServer: { name?: string; version?: string; buildType?: string } }>("query { aboutServer { name version buildType } }");
    return `${data.aboutServer.name ?? "Suwayomi"} ${data.aboutServer.version ?? ""}`.trim();
  }

  async sources(): Promise<RemoteSource[]> {
    const data = await this.graphql<{ sources: { nodes: Array<{ id: string; name: string; displayName?: string; lang?: string; isNsfw?: boolean }> } }>("query { sources { nodes { id name displayName lang isNsfw } } }");
    // Source "0" is Suwayomi's "Local source" (files on the server): kept, it's the user's own.
    return data.sources.nodes.map((s) => ({ id: String(s.id), name: s.displayName ?? s.name, lang: s.lang ?? "", isNsfw: s.isNsfw === true }));
  }

  async browse(sourceId: string, type: SuwayomiBrowseType, page: number, query?: string): Promise<RemotePage> {
    const data = await this.graphql<{ fetchSourceManga: { mangas: Array<{ id: number; title: string; thumbnailUrl?: string | null }>; hasNextPage: boolean } }>(
      "mutation Browse($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String) { fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query }) { mangas { id title thumbnailUrl } hasNextPage } }",
      { source: sourceId, type, page: Math.max(1, Math.floor(page)), query: type === "SEARCH" ? (query ?? "") : null },
    );
    return {
      items: data.fetchSourceManga.mangas.map((m) => ({ ref: String(m.id), title: m.title, cover: `riuplay-media://remote-thumb/${this.ctx.id}/${m.id}` })),
      hasNextPage: data.fetchSourceManga.hasNextPage === true,
    };
  }

  async manga(id: string): Promise<{ title: string; description: string; genres: string[]; author: string | null; status: string | null }> {
    const data = await this.graphql<{ fetchManga: { manga: { title: string; description?: string | null; genre?: string[] | null; author?: string | null; status?: string | null } } }>(
      "mutation Manga($id: Int!) { fetchManga(input: { id: $id }) { manga { id title description genre author status } } }",
      { id: Number(id) },
    );
    const m = data.fetchManga.manga;
    return { title: m.title, description: m.description ?? "", genres: m.genre ?? [], author: m.author ?? null, status: m.status ?? null };
  }

  async chapters(mangaId: string): Promise<Array<{ id: string; name: string; number: number; sourceOrder: number }>> {
    const data = await this.graphql<{ fetchChapters: { chapters: Array<{ id: number; name: string; chapterNumber?: number | null; sourceOrder?: number | null }> } }>(
      "mutation Chapters($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters { id name chapterNumber sourceOrder } } }",
      { id: Number(mangaId) },
    );
    return data.fetchChapters.chapters
      .map((c) => ({ id: String(c.id), name: c.name, number: typeof c.chapterNumber === "number" && c.chapterNumber >= 0 ? c.chapterNumber : (c.sourceOrder ?? 0), sourceOrder: c.sourceOrder ?? 0 }))
      .sort((a, b) => a.sourceOrder - b.sourceOrder || a.number - b.number);
  }

  async pages(chapterId: string): Promise<string[]> {
    const data = await this.graphql<{ fetchChapterPages: { pages: string[] } }>("mutation Pages($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }", { id: Number(chapterId) });
    // Pages are server paths; anything pointing at another host is refused here, before storing.
    return data.fetchChapterPages.pages.map((page) => {
      sameOriginUrl(this.ctx.baseUrl, page);
      return page;
    });
  }

  thumbnailPath(mangaId: string): string {
    if (!/^\d{1,12}$/.test(mangaId)) throw new ServerError("invalid title id");
    return `/api/v1/manga/${mangaId}/thumbnail`;
  }
}

// --- Kikoeru ------------------------------------------------------------------------------------

interface KikoeruWork {
  id: number;
  title: string;
  name?: string;
  circle?: { name?: string } | null;
  tags?: Array<{ name?: string }> | null;
  vas?: Array<{ name?: string }> | null;
  release?: string | null;
}

export interface KikoeruTrack {
  title: string;
  /** Folder path inside the work, for ordering and display. */
  folder: string;
  streamPath: string;
  durationMs: number | null;
}

interface KikoeruNode {
  type?: string;
  title?: string;
  children?: KikoeruNode[];
  mediaStreamUrl?: string;
  duration?: number;
}

export class KikoeruClient extends BaseClient {
  protected async login(): Promise<string> {
    const answer = await this.json<{ token?: string }>("/api/auth/me", { auth: false, body: { name: this.ctx.username ?? "", password: (await this.ctx.secret()) ?? "" } });
    if (!answer.token) throw new ServerError("sign-in failed");
    return answer.token;
  }

  async health(): Promise<string> {
    await this.json<unknown>("/api/health", { auth: false });
    return "Kikoeru";
  }

  private toPage(answer: { works?: KikoeruWork[]; pagination?: { currentPage?: number; pageSize?: number; totalCount?: number } }): RemotePage {
    const works = answer.works ?? [];
    const p = answer.pagination;
    const hasNextPage = p && typeof p.currentPage === "number" && typeof p.pageSize === "number" && typeof p.totalCount === "number" ? p.currentPage * p.pageSize < p.totalCount : works.length > 0;
    return { items: works.map((w) => ({ ref: String(w.id), title: w.title ?? w.name ?? `RJ${w.id}`, subtitle: w.circle?.name ?? null, cover: `riuplay-media://remote-thumb/${this.ctx.id}/${w.id}` })), hasNextPage };
  }

  async works(page: number): Promise<RemotePage> {
    return this.toPage(await this.json(`/api/works?order=create_date&sort=desc&page=${Math.max(1, Math.floor(page))}&pageSize=24`));
  }

  async search(keyword: string, page: number): Promise<RemotePage> {
    return this.toPage(await this.json(`/api/search/${encodeURIComponent(keyword.slice(0, 200))}?page=${Math.max(1, Math.floor(page))}&pageSize=24`));
  }

  async work(id: string): Promise<{ title: string; circle: string | null; tags: string[]; vas: string[]; release: string | null }> {
    if (!/^\d{1,12}$/.test(id)) throw new ServerError("invalid work id");
    const w = await this.json<KikoeruWork>(`/api/work/${id}`);
    return { title: w.title ?? `RJ${id}`, circle: w.circle?.name ?? null, tags: (w.tags ?? []).map((t) => t.name ?? "").filter(Boolean), vas: (w.vas ?? []).map((v) => v.name ?? "").filter(Boolean), release: w.release ?? null };
  }

  /** The work's audio files, depth-first in the server's folder order. */
  async tracks(id: string): Promise<KikoeruTrack[]> {
    if (!/^\d{1,12}$/.test(id)) throw new ServerError("invalid work id");
    const tree = await this.json<KikoeruNode[]>(`/api/tracks/${id}`);
    const out: KikoeruTrack[] = [];
    const walk = (nodes: KikoeruNode[], folder: string) => {
      for (const node of nodes ?? []) {
        if (node.type === "folder") walk(node.children ?? [], folder ? `${folder}/${node.title ?? ""}` : (node.title ?? ""));
        else if (node.type === "audio" && typeof node.mediaStreamUrl === "string") {
          sameOriginUrl(this.ctx.baseUrl, node.mediaStreamUrl); // refused before storing if it leaves the server
          out.push({ title: node.title ?? "Track", folder, streamPath: node.mediaStreamUrl, durationMs: typeof node.duration === "number" ? Math.round(node.duration * 1000) : null });
        }
      }
    };
    walk(Array.isArray(tree) ? tree : [], "");
    return out;
  }

  coverPath(id: string): string {
    if (!/^\d{1,12}$/.test(id)) throw new ServerError("invalid work id");
    return `/api/cover/${id}?type=main`;
  }
}
