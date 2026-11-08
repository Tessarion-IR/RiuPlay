// RiuPlay M4/M5: API contract tests for the Suwayomi and Kikoeru integrations, against disposable
// fake servers on loopback - reached through the REAL network broker, via the exact local-server
// exception the user's confirmation creates. No live personal server is needed.
import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { on, openDevice, type Db } from "../../core/sync/syncDevices.testkit";
import { localMedia, serverConnections } from "../../core/db/schema";
import { continueList, getMedia, saveProgress, setFavorite } from "../../core/media/media";
import { NetClient } from "../net/client";
import type { LocalServerAllowance } from "../net/policy";
import type { ProxyCipher } from "../net/secureProxyStore";
import { ConnectionsService } from "./service";
import { sameOriginUrl } from "./clients";
import { sanitizeConnectionInput } from "../ipc/connections";

vi.mock("../../core/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const PASSWORD = "Synthetic-Pa55!";
const cipher: ProxyCipher = {
  isAvailable: async () => true,
  encrypt: async (t) => Buffer.concat([Buffer.from("ENC1"), Buffer.from(t).map((b) => b ^ 0x33)]),
  decrypt: async (d) => ({ text: Buffer.from(d.subarray(4).map((b) => b ^ 0x33)).toString(), shouldReEncrypt: false }),
};
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

interface Seen {
  path: string;
  auth: string | null;
}

function listen(handler: http.RequestListener): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    }),
  );
}

const body = (req: http.IncomingMessage) => new Promise<string>((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
const send = (res: http.ServerResponse, status: number, value: unknown, type = "application/json") => res.writeHead(status, { "content-type": type }).end(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));

// --- fake Suwayomi ------------------------------------------------------------------------------
let suwa: Awaited<ReturnType<typeof listen>>;
let suwaMode: "none" | "basic" | "ui_login" = "none";
let suwaMalformed = false;
let suwaForeignPage = false;
let tokenGeneration = 1;
const suwaSeen: Seen[] = [];

function suwaAuthorized(req: http.IncomingMessage): boolean {
  const auth = req.headers.authorization ?? null;
  if (suwaMode === "basic") return auth === `Basic ${Buffer.from(`reader:${PASSWORD}`).toString("base64")}`;
  if (suwaMode === "ui_login") return auth === `Bearer token-${tokenGeneration}`;
  return true;
}

async function suwayomiHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  suwaSeen.push({ path: req.url ?? "", auth: req.headers.authorization ?? null });
  if (req.url === "/api/graphql" && req.method === "POST") {
    const { query, variables } = JSON.parse(await body(req)) as { query: string; variables: Record<string, unknown> };
    if (suwaMalformed) return send(res, 200, "<html>not json", "text/html");
    if (query.includes("login(")) {
      return variables.u === "reader" && variables.p === PASSWORD ? send(res, 200, { data: { login: { accessToken: `token-${tokenGeneration}`, refreshToken: "r" } } }) : send(res, 200, { errors: [{ message: "invalid credentials" }] });
    }
    if (!suwaAuthorized(req)) return send(res, 401, { errors: [{ message: "unauthorized" }] });
    if (query.includes("aboutServer")) return send(res, 200, { data: { aboutServer: { name: "Suwayomi", version: "v2.1.1867", buildType: "Stable" } } });
    if (query.includes("sources")) return send(res, 200, { data: { sources: { nodes: [{ id: "6247824327199706550", name: "Demo", displayName: "Demo (EN)", lang: "en", isNsfw: false }] } } });
    if (query.includes("fetchSourceManga")) return send(res, 200, { data: { fetchSourceManga: { mangas: [{ id: 1, title: "Frieren", thumbnailUrl: "/api/v1/manga/1/thumbnail" }, { id: 2, title: "Mushishi", thumbnailUrl: null }], hasNextPage: variables.page === 1 } } });
    if (query.includes("fetchManga")) return send(res, 200, { data: { fetchManga: { manga: { id: 1, title: "Frieren", description: "An elf mage.", genre: ["Fantasy"], author: "Yamada", status: "ONGOING" } } } });
    if (query.includes("fetchChapters")) return send(res, 200, { data: { fetchChapters: { chapters: [{ id: 12, name: "Chapter 2", chapterNumber: 2, sourceOrder: 2 }, { id: 11, name: "Chapter 1", chapterNumber: 1, sourceOrder: 1 }] } } });
    if (query.includes("fetchChapterPages")) {
      const pages = ["/api/v1/manga/1/chapter/1/page/0", "/api/v1/manga/1/chapter/1/page/1"];
      return send(res, 200, { data: { fetchChapterPages: { pages: suwaForeignPage ? [...pages, "http://evil.example/steal.png"] : pages } } });
    }
    return send(res, 200, { errors: [{ message: "unknown query" }] });
  }
  if (!suwaAuthorized(req)) return send(res, 401, "no");
  if (/^\/api\/v1\/manga\/1\/(thumbnail|chapter\/1\/page\/\d)$/.test(req.url ?? "")) return send(res, 200, PNG, "image/png");
  return send(res, 404, "not found", "text/plain");
}

// --- fake Kikoeru -------------------------------------------------------------------------------
let kiko: Awaited<ReturnType<typeof listen>>;
const kikoSeen: Seen[] = [];
const AUDIO = Buffer.alloc(10_000, 7);

async function kikoeruHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  kikoSeen.push({ path: req.url ?? "", auth: req.headers.authorization ?? null });
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/health") return send(res, 200, { status: "ok" });
  if (url.pathname === "/api/auth/me" && req.method === "POST") {
    const { name, password } = JSON.parse(await body(req)) as { name: string; password: string };
    return name === "listener" && password === PASSWORD ? send(res, 200, { token: "kiko-token" }) : send(res, 401, { error: "bad credentials" });
  }
  if (req.headers.authorization !== "Bearer kiko-token") return send(res, 401, { error: "unauthorized" });
  if (url.pathname === "/api/works") return send(res, 200, { works: [{ id: 123456, title: "Rain Sounds", circle: { name: "Circle A" } }], pagination: { currentPage: Number(url.searchParams.get("page")), pageSize: 24, totalCount: 30 } });
  if (url.pathname.startsWith("/api/search/")) return send(res, 200, { works: decodeURIComponent(url.pathname.slice(12)) === "rain" ? [{ id: 123456, title: "Rain Sounds" }] : [], pagination: { currentPage: 1, pageSize: 24, totalCount: 1 } });
  if (url.pathname === "/api/work/999") return send(res, 200, { id: 999, title: "Elsewhere" });
  if (url.pathname === "/api/work/123456") return send(res, 200, { id: 123456, title: "Rain Sounds", circle: { name: "Circle A" }, tags: [{ name: "ASMR" }], vas: [{ name: "Voice B" }], release: "2024-01-01" });
  if (url.pathname === "/api/tracks/123456") {
    return send(res, 200, [
      { type: "folder", title: "MP3", children: [
        { type: "audio", title: "01 Intro.mp3", mediaStreamUrl: "/api/media/stream/aaa", duration: 61.5 },
        { type: "text", title: "readme.txt" },
        { type: "audio", title: "02 Rain.mp3", mediaStreamUrl: "/api/media/stream/bbb", duration: 1200 },
      ] },
    ]);
  }
  if (url.pathname === "/api/tracks/999") return send(res, 200, [{ type: "audio", title: "x", mediaStreamUrl: "http://evil.example/stream" }]);
  if (url.pathname === "/api/media/stream/aaa") {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : AUDIO.length - 1;
      return res.writeHead(206, { "content-type": "audio/mpeg", "content-range": `bytes ${start}-${end}/${AUDIO.length}`, "accept-ranges": "bytes" }).end(AUDIO.subarray(start, end + 1));
    }
    return res.writeHead(200, { "content-type": "audio/mpeg", "accept-ranges": "bytes" }).end(AUDIO);
  }
  if (url.pathname === "/api/cover/123456") return send(res, 200, PNG, "image/png");
  return send(res, 404, { error: "not found" });
}

let db: Db;
let allowances: LocalServerAllowance[] = [];
let service: ConnectionsService;

beforeAll(async () => {
  suwa = await listen((req, res) => void suwayomiHandler(req, res));
  kiko = await listen((req, res) => void kikoeruHandler(req, res));
});
afterAll(async () => {
  await Promise.all([suwa.close(), kiko.close()]);
});
beforeEach(async () => {
  db = on(await openDevice());
  allowances = [];
  suwaMode = "none";
  suwaMalformed = false;
  suwaForeignPage = false;
  suwaSeen.length = 0;
  kikoSeen.length = 0;
  const client = new NetClient({ allowances: () => allowances, defaultTimeoutMs: 5000, connectTimeoutMs: 2000 });
  service = new ConnectionsService(client, cipher, (a) => (allowances = a));
});

const remote = (url: string, headers: Record<string, string> = {}) => service.handleRemote(new Request(url, { headers }));

describe("connections: setup, local confirmation, secrets", () => {
  it("a server on this computer needs the explicit local confirmation, then only that exact address is allowed", async () => {
    await expect(service.add({ kind: "suwayomi", baseUrl: suwa.url })).rejects.toThrow(/local network/);
    const { connection, test } = await service.add({ kind: "suwayomi", baseUrl: suwa.url, localConfirmed: true });
    expect(test).toEqual({ ok: true, version: "Suwayomi v2.1.1867", error: null });
    expect(connection.local).toBe(true);
    expect(allowances).toEqual([expect.objectContaining({ connectionId: String(connection.id), scheme: "http", host: "127.0.0.1", port: suwa.port })]);
    await service.remove(connection.id);
    expect(allowances).toEqual([]);
  });

  it("refuses duplicate servers, addresses with credentials, and bad types", async () => {
    await service.add({ kind: "suwayomi", baseUrl: suwa.url, localConfirmed: true });
    await expect(service.add({ kind: "suwayomi", baseUrl: `${suwa.url}/`, localConfirmed: true })).rejects.toThrow(/already added/);
    await expect(service.add({ kind: "suwayomi", baseUrl: `http://u:p@127.0.0.1:${suwa.port}`, localConfirmed: true })).rejects.toThrow(/own fields/);
    await expect(service.add({ kind: "suwayomi", baseUrl: "file:///C:/x", localConfirmed: true })).rejects.toThrow(/http/);
    expect(() => sanitizeConnectionInput({ kind: "other", baseUrl: "x" }, false)).toThrow(/server type/);
    expect(() => sanitizeConnectionInput({ kind: "kikoeru", baseUrl: "http://x", password: "a\nb" }, false)).toThrow(/password/);
  });

  it("stores the password only encrypted and never returns it", async () => {
    suwaMode = "basic";
    const { connection, test } = await service.add({ kind: "suwayomi", baseUrl: suwa.url, authMode: "basic", username: "reader", password: PASSWORD, localConfirmed: true });
    expect(test.ok).toBe(true);
    expect(JSON.stringify(await service.list())).not.toContain(PASSWORD);
    expect(connection.hasSecret).toBe(true);
    const row = await db.select().from(serverConnections).get();
    expect(row!.secretCiphertext).not.toContain(PASSWORD);
    expect(Buffer.from(row!.secretCiphertext!, "base64").toString()).not.toContain(PASSWORD);
  });

  it("editing keeps the password unless a new one is given; an invalid server reports a clear error", async () => {
    suwaMode = "basic";
    const { connection } = await service.add({ kind: "suwayomi", baseUrl: suwa.url, authMode: "basic", username: "reader", password: PASSWORD, localConfirmed: true });
    expect((await service.update(connection.id, { name: "Home server" })).test.ok).toBe(true);
    const wrong = await service.update(connection.id, { password: "wrong" });
    expect(wrong.test).toMatchObject({ ok: false, error: expect.stringMatching(/refused the sign-in/) });
    expect((await service.list())[0]).toMatchObject({ name: "Home server", lastError: expect.stringMatching(/sign-in/) });
  });
});

describe("Suwayomi contract", () => {
  async function connect(extra: Record<string, unknown> = {}) {
    return (await service.add({ kind: "suwayomi", baseUrl: suwa.url, localConfirmed: true, ...extra })).connection;
  }

  it("lists sources, browses with paging, and searches", async () => {
    const c = await connect();
    expect(await service.suwayomiSources(c.id)).toEqual([{ id: "6247824327199706550", name: "Demo (EN)", lang: "en", isNsfw: false }]);
    const page1 = await service.suwayomiBrowse(c.id, "6247824327199706550", "POPULAR", 1);
    expect(page1).toMatchObject({ hasNextPage: true, items: [{ ref: "1", title: "Frieren", cover: `riuplay-media://remote-thumb/${c.id}/1` }, { ref: "2" }] });
    expect((await service.suwayomiBrowse(c.id, "6247824327199706550", "SEARCH", 2, "frieren")).hasNextPage).toBe(false);
  });

  it("adds a title to the unified library with chapters in order; pages, covers and progress work", async () => {
    const c = await connect();
    const { item, existed } = await service.addToLibrary(c.id, "1");
    expect(existed).toBe(false);
    expect(item).toMatchObject({ type: "manga", title: "Frieren", origin: "server", cover: `riuplay-media://remote-cover/${item.id}` });
    const details = (await getMedia(item.id))!;
    expect(details.units.map((u) => u.title)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(details.units[0].url).toBe(`riuplay-media://remote/${details.units[0].id}`);
    expect(details.library?.status).toBe("planned");
    expect((await service.addToLibrary(c.id, "1")).existed).toBe(true); // no duplicate

    const unit = await service.loadPages(details.units[0].id);
    expect(unit.pages).toEqual([`riuplay-media://remote/${unit.id}/page/0`, `riuplay-media://remote/${unit.id}/page/1`]);
    const page = await remote(unit.pages[1]);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await page.arrayBuffer())).toEqual(PNG);
    expect((await remote(`riuplay-media://remote-cover/${item.id}`)).status).toBe(200);

    await saveProgress(unit.id, 1, 2);
    await setFavorite(item.id, true);
    const cont = await continueList("manga");
    expect(cont.map((e) => e.item.id)).toContain(item.id);
    expect((await getMedia(item.id))!.library?.favorite).toBe(true);
  });

  it("UI-login: signs in, sends the bearer token, and signs in again once when it expires", async () => {
    suwaMode = "ui_login";
    const c = await connect({ authMode: "ui_login", username: "reader", password: PASSWORD });
    expect((await service.test(c.id)).ok).toBe(true);
    tokenGeneration++; // the server forgot the old token
    expect((await service.suwayomiSources(c.id)).length).toBe(1);
    expect(suwaSeen.filter((s) => s.auth?.startsWith("Bearer")).length).toBeGreaterThan(0);
    tokenGeneration++;
  });

  it("credentials are only sent to the server itself: a page on another host is refused", async () => {
    suwaMode = "basic";
    const c = await connect({ authMode: "basic", username: "reader", password: PASSWORD });
    const { item } = await service.addToLibrary(c.id, "1");
    suwaForeignPage = true;
    const unitId = (await getMedia(item.id))!.units[0].id;
    await expect(service.loadPages(unitId)).rejects.toThrow(/another host/);
    expect(() => sameOriginUrl(suwa.url, "http://evil.example/x")).toThrow(/another host/);
    // A protocol-relative-looking path stays a path ON the server: nothing leaves its origin.
    expect(new URL(sameOriginUrl(suwa.url, "//evil.example/x")).origin).toBe(suwa.url);
    expect(() => sameOriginUrl(`${suwa.url}/base`, "https://127.0.0.1:1/x")).toThrow(/another host/);
  });

  it("malformed and unavailable servers give clear errors, never a crash", async () => {
    const c = await connect();
    suwaMalformed = true;
    expect(await service.test(c.id)).toMatchObject({ ok: false, error: expect.stringMatching(/not valid JSON/) });
    suwaMalformed = false;
    const dead = await listen(() => undefined);
    const port = dead.port;
    await dead.close();
    const gone = await service.add({ kind: "suwayomi", baseUrl: `http://127.0.0.1:${port}`, localConfirmed: true });
    expect(gone.test).toMatchObject({ ok: false, error: expect.stringMatching(/did not answer|could not be reached/) });
  });
});

describe("Kikoeru contract", () => {
  async function connect() {
    return (await service.add({ kind: "kikoeru", baseUrl: kiko.url, authMode: "token", username: "listener", password: PASSWORD, localConfirmed: true })).connection;
  }

  it("signs in with the token flow, browses and searches", async () => {
    const c = await connect();
    expect((await service.test(c.id)).ok).toBe(true);
    expect(await service.kikoeruBrowse(c.id, 1)).toMatchObject({ hasNextPage: true, items: [{ ref: "123456", title: "Rain Sounds", subtitle: "Circle A" }] });
    expect((await service.kikoeruBrowse(c.id, 1, "rain")).items).toHaveLength(1);
    expect((await service.kikoeruBrowse(c.id, 1, "nothing")).items).toHaveLength(0);
    expect(kikoSeen.filter((s) => s.path.startsWith("/api/works")).every((s) => s.auth === "Bearer kiko-token")).toBe(true);
  });

  it("wrong credentials fail with a clear message", async () => {
    const { test } = await service.add({ kind: "kikoeru", baseUrl: kiko.url, authMode: "token", username: "listener", password: "wrong", localConfirmed: true });
    expect(test).toMatchObject({ ok: false, error: expect.stringMatching(/refused the sign-in/) });
  });

  it("adds a work as audio tracks in folder order and streams them with Range through the main process", async () => {
    const c = await connect();
    const { item } = await service.addToLibrary(c.id, "123456");
    const details = (await getMedia(item.id))!;
    expect(details.item).toMatchObject({ type: "audio", title: "Rain Sounds", genres: ["ASMR"] });
    expect(details.units.map((u) => [u.title, u.durationMs])).toEqual([["MP3 / 01 Intro.mp3", 61500], ["MP3 / 02 Rain.mp3", 1200000]]);
    const ranged = await remote(details.units[0].url, { range: "bytes=100-199" });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 100-199/${AUDIO.length}`);
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);
    const whole = await remote(details.units[0].url);
    expect(whole.status).toBe(200);
    expect((await whole.arrayBuffer()).byteLength).toBe(AUDIO.length);
    // The token is added by the main process; the stored unit holds only a server path.
    const row = await db.select().from(localMedia).get();
    expect(JSON.stringify(row)).not.toContain("kiko-token");
    await saveProgress(details.units[0].id, 30, 61.5);
    expect((await continueList("audio")).map((e) => e.item.id)).toContain(item.id);
  });

  it("a track list pointing at another host is refused before anything is stored", async () => {
    const c = await connect();
    await expect(service.addToLibrary(c.id, "999")).rejects.toThrow(/another host/);
    expect(await db.select().from(localMedia).all()).toHaveLength(0);
  });
});

describe("media protocol: no SSRF route", () => {
  it("only stored references are served; anything else is 404", async () => {
    const c = (await service.add({ kind: "suwayomi", baseUrl: suwa.url, localConfirmed: true })).connection;
    for (const url of [
      "riuplay-media://remote/999999",
      "riuplay-media://remote/abc",
      `riuplay-media://remote-thumb/${c.id}/..%2F..%2Fadmin`,
      `riuplay-media://remote-thumb/${c.id}/http:%2F%2F169.254.169.254`,
      "riuplay-media://remote-cover/1",
      "riuplay-media://remote-elsewhere/1",
    ]) {
      expect((await remote(url)).status).toBe(404);
    }
  });

  it("an unreachable server answers 502, not an exception", async () => {
    const c = (await service.add({ kind: "kikoeru", baseUrl: kiko.url, authMode: "token", username: "listener", password: PASSWORD, localConfirmed: true })).connection;
    const { item } = await service.addToLibrary(c.id, "123456");
    const unitUrl = (await getMedia(item.id))!.units[0].url;
    allowances = []; // as if the local exception were gone: the broker refuses the address
    expect((await remote(unitUrl)).status).toBe(502);
  });
});
