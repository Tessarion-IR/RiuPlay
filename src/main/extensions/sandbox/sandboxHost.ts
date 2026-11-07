// RiuPlay M2: the production extension host. Productionised from the M0 spike (36/36 isolation
// checks, 6/6 identical results to the node:vm path on Electron 45):
//
//   per extension (and per resolver): a hidden BrowserWindow
//     sandbox, contextIsolation, no nodeIntegration (also not in workers or subframes), no preload,
//     no webview; its OWN in-memory session (partition without "persist:"), so cookies, cache,
//     storage and service workers are never shared with another extension or with the app
//   that session
//     - lets exactly one destination through: riuplay-ext-host://host/ (everything else - http(s),
//       ws, file, data imports, other custom schemes - is cancelled in webRequest)
//     - answers that scheme itself: the host page, the worker bundle, THIS extension's script, and
//       the broker. The broker knows which extension is asking from the session the request
//       arrived on - never from the request body
//     - denies every permission, every navigation, every popup and every download
//   CSP: default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'
//   the page starts a Web Worker that runs hibiki's host API + the script (hostWorker.ts); the
//   script is loaded only after the main process has put the renderer into a memory-limited
//   Windows Job Object (jobGuard.ts), when that is available.
//
// Host calls (fetch, fetchAll, challenge, browserFetch) go to the BridgeHandler of the call in
// flight - the same bridge the node:vm path used, so the network broker (M3), the per-source
// caller identity, budgets, snapshot serving and Cloudflare handling are unchanged. One call at a
// time per host (the worker blocks in a synchronous XHR); a small pool per extension gives
// parallel calls their own host. A call that times out or is aborted destroys its host (which ends
// its renderer process); an idle host is closed after a while.
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, session, type Session } from "electron";
import type { BridgeHandler, BridgeKind, ExtensionHostPort, ExtensionWorkerCall, ExtensionWorkerResult } from "../../../platform/types";
import { logger } from "../../../core/logger";
import { createJobGuard, type JobGuard } from "./jobGuard";

export const EXTENSION_HOST_SCHEME = "riuplay-ext-host";
export const EXTENSION_HOST_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true } as const;
const ORIGIN = `${EXTENSION_HOST_SCHEME}://host/`;

const HOST_HTML = `<!doctype html><meta charset="utf-8"><title>extension host</title><script src="host.js"></script>`;
const HOST_JS = `
const worker = new Worker("worker.js");
let seq = 1; const pending = new Map();
window.__ready = false; window.__errors = [];
worker.onmessage = (e) => {
  if (e.data && e.data.ready) { window.__ready = true; return; }
  const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); }
};
worker.onerror = (e) => { window.__errors.push(String(e.message)); };
window.__send = (msg) => new Promise((resolve) => { const id = seq++; pending.set(id, resolve); worker.postMessage({ id, ...msg }); });`;
const CSP_PAGE = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'";
const CSP_WORKER = "default-src 'none'; script-src 'self'; connect-src 'self'";

/** Host memory cap (per renderer process). Enforced only where the Job Object assignment succeeded. */
export const HOST_MEMORY_LIMIT_MB = 512;
const MAX_HOSTS_PER_EXTENSION = 2;
const IDLE_CLOSE_MS = 3 * 60_000;
const START_TIMEOUT_MS = 15_000;
const MAX_BROKER_BODY = 4 * 1024 * 1024;
const BRIDGE_KINDS: ReadonlySet<string> = new Set(["netFetch", "netFetchAll", "challenge", "browserFetch"]);

interface Host {
  key: string;
  sourceId: string;
  win: BrowserWindow;
  session: Session;
  busy: boolean;
  bridge: BridgeHandler | null;
  idleTimer: NodeJS.Timeout | null;
  scriptStamp: string;
  memoryLimited: boolean;
  closed: boolean;
}

const reply = (status: number, body: unknown, type = "application/json", extra: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type, "cache-control": "no-store", ...extra } });

function stampOf(scriptPath: string): string {
  const stat = fs.statSync(scriptPath);
  return `${stat.mtimeMs}:${stat.size}`;
}

export class SandboxedExtensionHost implements ExtensionHostPort {
  private readonly hosts = new Map<string, Host[]>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly jobGuard: JobGuard;
  private workerBundle: string | null = null;

  constructor(private readonly options: { workerBundlePath: string; jobGuard?: JobGuard; memoryLimitMB?: number }) {
    this.jobGuard = options.jobGuard ?? createJobGuard();
  }

  warm(): void {
    // Hosts start on first use: one sandboxed renderer per installed extension at startup would
    // cost memory for sources that may never be opened.
  }

  dispose(): void {
    for (const list of this.hosts.values()) for (const host of list) this.close(host);
    this.hosts.clear();
    this.jobGuard.dispose();
  }

  /** Diagnostics: which hosts run, and whether each is under the OS memory cap. */
  describe(): Array<{ sourceId: string; busy: boolean; memoryLimited: boolean; pid: number }> {
    return [...this.hosts.values()].flat().map((h) => ({ sourceId: h.sourceId, busy: h.busy, memoryLimited: h.memoryLimited, pid: h.win.isDestroyed() ? 0 : h.win.webContents.getOSProcessId() }));
  }

  async run(call: ExtensionWorkerCall, bridge: BridgeHandler, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ExtensionWorkerResult> {
    if (options.signal?.aborted) throw Object.assign(new Error("extension call aborted"), { name: "AbortError" });
    const scriptPath = path.join(call.extensionsDir, `${call.sourceId}.js`);
    if (!/^[a-z0-9._:-]{1,120}$/i.test(call.sourceId) || !fs.existsSync(scriptPath)) throw new Error(`Unknown source: ${call.sourceId}`);
    const host = await this.acquire(call.extensionsDir, call.sourceId, scriptPath, options.signal);
    host.bridge = bridge;
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const answer = await Promise.race([
        host.win.webContents.executeJavaScript(`window.__send(${JSON.stringify({ type: "call", method: call.method, args: call.args, storage: call.storage ?? {} })})`) as Promise<{ ok: boolean; result?: unknown; error?: string; storageWrites?: Record<string, string | null> }>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error(`extension call timed out after ${options.timeoutMs}ms`), { name: "TimeoutError" })), options.timeoutMs);
        }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(Object.assign(new Error("extension call aborted"), { name: "AbortError" }));
          options.signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      this.release(host);
      return { ok: answer.ok, result: answer.result, error: answer.error, storageWrites: answer.storageWrites };
    } catch (error) {
      // Timed out, aborted, or the renderer died: the host is never reused.
      this.close(host);
      throw error;
    } finally {
      clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async acquire(extensionsDir: string, sourceId: string, scriptPath: string, signal?: AbortSignal): Promise<Host> {
    const key = `${extensionsDir}|${sourceId}`;
    const stamp = stampOf(scriptPath);
    for (;;) {
      const list = (this.hosts.get(key) ?? []).filter((h) => !h.closed);
      // An updated script needs a fresh host: close idle ones built from the old file.
      for (const h of list) if (h.scriptStamp !== stamp && !h.busy) this.close(h);
      const current = (this.hosts.get(key) ?? []).filter((h) => !h.closed);
      const idle = current.find((h) => !h.busy && h.scriptStamp === stamp);
      if (idle) {
        idle.busy = true;
        if (idle.idleTimer) clearTimeout(idle.idleTimer);
        return idle;
      }
      if (current.length < MAX_HOSTS_PER_EXTENSION) {
        const host = await this.create(key, sourceId, scriptPath, stamp);
        host.busy = true;
        return host;
      }
      if (signal?.aborted) throw Object.assign(new Error("extension call aborted"), { name: "AbortError" });
      await new Promise<void>((resolve) => this.waiters.set(key, [...(this.waiters.get(key) ?? []), resolve]));
    }
  }

  private release(host: Host): void {
    host.busy = false;
    host.bridge = null;
    host.idleTimer = setTimeout(() => this.close(host), IDLE_CLOSE_MS);
    this.wake(host.key);
  }

  private wake(key: string): void {
    const next = this.waiters.get(key)?.shift();
    next?.();
  }

  private close(host: Host): void {
    if (host.closed) return;
    host.closed = true;
    if (host.idleTimer) clearTimeout(host.idleTimer);
    if (!host.win.isDestroyed()) host.win.destroy();
    this.hosts.set(host.key, (this.hosts.get(host.key) ?? []).filter((h) => h !== host));
    void host.session.clearStorageData().catch(() => undefined);
    this.wake(host.key);
  }

  private bundle(): string {
    this.workerBundle ??= fs.readFileSync(this.options.workerBundlePath, "utf8");
    return this.workerBundle;
  }

  private async create(key: string, sourceId: string, scriptPath: string, stamp: string): Promise<Host> {
    // A partition without "persist:" is in memory only; the random part keeps two hosts of the
    // same extension (and any later host) from ever sharing state.
    const ses = session.fromPartition(`riuplay-ext-${sourceId.replace(/[^a-z0-9]/gi, "_")}-${crypto.randomUUID()}`);
    const script = fs.readFileSync(scriptPath, "utf8");
    const host: Host = { key, sourceId, win: null as unknown as BrowserWindow, session: ses, busy: false, bridge: null, idleTimer: null, scriptStamp: stamp, memoryLimited: false, closed: false };

    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      const ok = details.url.startsWith(ORIGIN);
      if (!ok) logger.warn("ext-host", `${sourceId}: blocked a direct request (${details.resourceType}) - extensions reach the network only through the broker`);
      callback({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    ses.protocol.handle(EXTENSION_HOST_SCHEME, async (request) => {
      const url = new URL(request.url);
      if (url.host !== "host") return reply(404, { error: "unknown host" });
      switch (url.pathname) {
        case "/index.html":
          return reply(200, HOST_HTML, "text/html", { "content-security-policy": CSP_PAGE });
        case "/host.js":
          return reply(200, HOST_JS, "text/javascript");
        case "/worker.js":
          return reply(200, this.bundle(), "text/javascript", { "content-security-policy": CSP_WORKER });
        case "/ext.js":
          return reply(200, script, "text/javascript"); // this session's extension only
        case "/broker/whoami":
          return reply(200, { id: sourceId });
        case "/broker/log": {
          const body = await this.readJson(request);
          const message = String((body as { message?: unknown })?.message ?? "").slice(0, 2000);
          const level = (body as { level?: string })?.level === "error" ? "warn" : "debug";
          logger[level]("ext", `[${sourceId}] ${message}`);
          return reply(200, {});
        }
        case "/broker/bridge": {
          const body = (await this.readJson(request)) as { kind?: unknown; payload?: unknown } | null;
          if (!body || typeof body.kind !== "string" || !BRIDGE_KINDS.has(body.kind) || typeof body.payload !== "object" || body.payload === null) return reply(400, { error: "bad host call" });
          if (!host.bridge) return reply(409, { error: "no call in flight" });
          try {
            const result = await host.bridge(body.kind as BridgeKind, body.payload as Record<string, unknown>);
            return reply(200, { ok: true, result });
          } catch (error) {
            return reply(200, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        default:
          return reply(404, { error: "no such route" });
      }
    });

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: false,
        javascript: true,
        webSecurity: true,
      },
    });
    host.win = win;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-redirect", (event) => event.preventDefault());
    win.webContents.on("render-process-gone", (_event, details) => {
      logger.warn("ext-host", `${sourceId}: host ended (${details.reason}${details.reason === "oom" ? `, over the ${this.options.memoryLimitMB ?? HOST_MEMORY_LIMIT_MB} MB limit` : ""})`);
      this.close(host);
    });
    this.hosts.set(key, [...(this.hosts.get(key) ?? []), host]);

    try {
      await win.loadURL(`${ORIGIN}index.html`);
      const pid = win.webContents.getOSProcessId();
      host.memoryLimited = await this.jobGuard.limit(pid, this.options.memoryLimitMB ?? HOST_MEMORY_LIMIT_MB);
      const deadline = Date.now() + START_TIMEOUT_MS;
      while (!(await win.webContents.executeJavaScript("window.__ready === true").catch(() => false))) {
        if (Date.now() > deadline) throw new Error("extension host did not start");
        await new Promise((r) => setTimeout(r, 25));
      }
      const started = (await win.webContents.executeJavaScript(`window.__send({ type: "start" })`)) as { ok: boolean; error?: string };
      if (!started.ok) throw new Error(`extension failed to load: ${started.error ?? "?"}`);
      logger.debug("ext-host", `${sourceId}: sandboxed host started (pid ${pid}, memory limit ${host.memoryLimited ? `${this.options.memoryLimitMB ?? HOST_MEMORY_LIMIT_MB} MB, enforced by Windows` : "NOT enforced"})`);
      return host;
    } catch (error) {
      this.close(host);
      throw error;
    }
  }

  private async readJson(request: Request): Promise<unknown> {
    const text = await request.text();
    if (text.length > MAX_BROKER_BODY) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
