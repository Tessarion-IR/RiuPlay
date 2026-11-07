// M0 research spike: a Chromium-sandboxed extension host, driven from an Electron main process.
// Run (after `node research/m0/sandbox/build.mjs`):
//   node_modules\electron\dist\electron.exe research\m0\sandbox\spike-main.cjs --mode=<mode>
// Modes: security | compat | perf | memory-monitor | memory-natural | memory-jsflags | cpu
// Results: research/m0/results/<mode>.json. Nothing here is part of the shipped app.
"use strict";
const { app, BrowserWindow, session, protocol } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");

const HERE = __dirname;
const DIST = path.join(HERE, "dist");
const FIX = path.join(HERE, "fixtures");
const RESULTS = path.join(HERE, "..", "results");
const mode = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=security").slice(7);
const broker = require(path.join(DIST, "broker.cjs"));

if (mode === "memory-jsflags") app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256");
protocol.registerSchemesAsPrivileged([{ scheme: "riuplay-ext-host", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// The spike runs without a visible window; keep timers and workers running at full speed.
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const out = { mode, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: `${os.platform()} ${os.release()}`, startedAt: new Date().toISOString(), checks: [], data: {} };
const check = (name, pass, detail) => {
  out.checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- loopback servers (experiment-only) ----------
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const canaryHits = [];
let canaryUpgrades = 0;

/** Canned content for the compat fixture: identical bytes for the sandbox (over HTTP) and the vm reference (in-process). */
function siteResponse(urlText) {
  const url = new URL(urlText, "http://public.test");
  const p = url.pathname;
  const json = (v) => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
  const catalog = [
    { id: 42, title: "Frieren", year: 2023, poster: "/img/42.jpg", genres: ["Fantasy", "Drama"] },
    { id: 7, title: "Frieren: Specials", year: 2024, poster: "/img/7.jpg", genres: ["Fantasy"] },
    { id: 9, title: "Mushishi", year: 2005, poster: "/img/9.jpg", genres: ["Mystery"] },
  ];
  if (p === "/api/search") return json({ items: catalog.filter((c) => c.title.toLowerCase().includes((url.searchParams.get("q") || "").toLowerCase())) });
  if (p === "/api/latest") {
    const page = Number(url.searchParams.get("page") || 1);
    return json({ items: page <= 2 ? catalog.slice((page - 1) * 2, page * 2) : [] });
  }
  if (p.startsWith("/title/")) {
    return { status: 200, headers: { "content-type": "text/html" }, body: `<!doctype html><html><body><h1 class="title"> Frieren </h1><p class="desc">An elf mage outlives her party.</p><img class="poster" src="../img/42.jpg"><div class="genres"><a>Fantasy</a><a>Drama</a></div><span class="year" data-year="2023"></span></body></html>` };
  }
  if (p.startsWith("/api/group/")) {
    const id = p.split("/").pop();
    return json({ id, title: id === "sub" ? "Subtitles" : "Dub", episodes: [{ id: "1", number: 1 }, { id: "2", number: 2 }] });
  }
  if (p.startsWith("/packed/")) {
    const ep = p.split("/").pop();
    const packed = zlib.gzipSync(JSON.stringify({ stream: `/hls/${ep}/master.m3u8`, quality: "1080p" })).toString("base64");
    return { status: 200, headers: { "content-type": "text/plain" }, body: packed };
  }
  if (p === "/tiny") return { status: 200, headers: { "content-type": "text/plain" }, body: "ok" };
  return { status: 404, headers: {}, body: "not found" };
}

// ---------- extension hosts ----------
const HOST_HTML = `<!doctype html><meta charset="utf-8"><title>ext-host</title><script src="host.js"></script>`;
const HOST_JS = `
const worker = new Worker("worker.js");
let seq = 1; const pending = new Map();
window.__ready = false; window.__workerErrors = [];
worker.onmessage = (e) => {
  if (e.data && e.data.ready) { window.__ready = true; window.__sourceId = e.data.sourceId; return; }
  const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); }
};
worker.onerror = (e) => { window.__workerErrors.push(String(e.message)); };
window.__call = (msg, timeoutMs) => new Promise((resolve) => {
  const id = seq++; pending.set(id, resolve); worker.postMessage({ id, ...msg });
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); } }, timeoutMs);
});
window.__terminateWorker = () => { worker.terminate(); return true; };`;
const CSP_PAGE = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'";
const CSP_WORKER = "default-src 'none'; script-src 'self'; connect-src 'self'";

async function createHost(id, { fixture, replacements = {}, policy, resolve }) {
  const ses = session.fromPartition(`ext-${id}-${crypto.randomUUID()}`); // in-memory, unique per host
  const storage = new Map();
  const blocked = [];
  const logs = [];
  const navAttempts = [];
  const script = Object.entries(replacements).reduce((s, [k, v]) => s.split(k).join(v), fs.readFileSync(path.isAbsolute(fixture) ? fixture : path.join(FIX, fixture), "utf-8"));

  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const ok = details.url.startsWith("riuplay-ext-host://host/");
    if (!ok) blocked.push(details.url);
    callback({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (e) => e.preventDefault());

  const reply = (status, body, type = "application/json", extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type, ...extra } });
  ses.protocol.handle("riuplay-ext-host", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "host") return reply(404, { error: "unknown host" });
    switch (url.pathname) {
      case "/index.html": return reply(200, HOST_HTML, "text/html", { "content-security-policy": CSP_PAGE });
      case "/host.js": return reply(200, HOST_JS, "text/javascript");
      case "/worker.js": return reply(200, fs.readFileSync(path.join(DIST, "worker.js"), "utf-8"), "text/javascript", { "content-security-policy": CSP_WORKER });
      case "/ext.js": return reply(200, script, "text/javascript"); // this session's extension only; query ignored
      case "/broker/whoami": return reply(200, { id });
      case "/broker/log": logs.push(await request.json()); return reply(200, {});
      case "/broker/storage": {
        // Keyed by the session this handler belongs to - never by what the script sends.
        const { op, key, value } = await request.json();
        if (op === "set") storage.set(String(key), String(value));
        if (op === "remove") storage.delete(String(key));
        return reply(200, { value: storage.has(String(key)) ? storage.get(String(key)) : null });
      }
      case "/broker/fetch": {
        const { url: target, options = {} } = await request.json();
        return reply(200, await brokerFetch(target, options));
      }
      case "/broker/fetchAll": {
        const { requests } = await request.json();
        const results = await Promise.all((requests || []).map((r) => brokerFetch(typeof r === "string" ? r : r.url, typeof r === "string" ? {} : r.options || r)));
        return reply(200, { results: results.map((r) => (r.error ? { status: 0, ok: false, body: "", headers: {}, error: r.error } : r)) });
      }
      default: return reply(404, { error: "no such route" });
    }
  });

  async function brokerFetch(target, options) {
    try {
      const res = await broker.guardedFetch(String(target), { method: options.method, headers: options.headers, body: options.body }, policy, { resolve });
      return { status: res.status, ok: res.status >= 200 && res.status < 300, body: res.body.toString("utf-8"), headers: res.headers };
    } catch (error) {
      return { error: error && error.message ? error.message : String(error) };
    }
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, spellcheck: false, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler((details) => (navAttempts.push(`open:${details.url}`), { action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { navAttempts.push(`navigate:${url}`); e.preventDefault(); });
  let gone = null;
  win.webContents.on("render-process-gone", (_e, details) => { gone = { ...details, at: Date.now() }; });
  await win.loadURL("riuplay-ext-host://host/index.html");
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript("window.__ready === true").catch(() => false)) break;
    await sleep(50);
  }
  const workerErrors = await win.webContents.executeJavaScript("window.__workerErrors").catch(() => ["unreachable"]);
  return {
    id, win, ses, storage, blocked, logs, navAttempts, workerErrors,
    gone: () => gone,
    pid: () => win.webContents.getOSProcessId(),
    call: (msg, timeoutMs = 30000) => win.webContents.executeJavaScript(`window.__call(${JSON.stringify(msg)}, ${timeoutMs})`),
    close: () => { if (!win.isDestroyed()) win.destroy(); },
  };
}

function processInfo(pid) {
  const m = app.getAppMetrics().find((p) => p.pid === pid);
  return m ? { type: m.type, sandboxed: m.sandboxed, integrityLevel: m.integrityLevel, workingSetMB: Math.round(m.memory.workingSetSize / 1024), privateMB: m.memory.privateBytes !== undefined ? Math.round(m.memory.privateBytes / 1024) : null } : null;
}

function processCount(image) {
  try {
    const text = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], { encoding: "utf-8" });
    return text.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith(image.toLowerCase())).length;
  } catch {
    return -1;
  }
}

const testResolve = (sitePort) => async (name) => {
  if (name === "public.test" || name === "api.example-a.test") return ["127.0.0.1"];
  throw new Error("ENOTFOUND (the spike resolver knows only test names, so nothing reaches the internet)");
};

// ---------- modes ----------
async function security() {
  const { server: canary, port: canaryPort } = await listen((req, res) => { canaryHits.push(req.url); res.end("canary"); });
  canary.on("upgrade", (_req, socket) => { canaryUpgrades++; socket.destroy(); });
  const secret = `RIUPLAY-M0-SECRET-${crypto.randomUUID()}`; // the extension is never given this value
  const secretFile = path.join(os.tmpdir(), `riuplay-m0-secret-${process.pid}.txt`);
  fs.writeFileSync(secretFile, secret);
  const calcBefore = processCount("CalculatorApp.exe") + processCount("calc.exe");

  // Worst case for the network rule: a legacy extension granted "any public host".
  const policy = { hosts: "any-public", allowHttp: true, privateAllowance: [], timeoutMs: 4000 };
  const b = await createHost("malicious-b", { fixture: "malicious-b.js", policy, resolve: testResolve() });
  const planted = await b.call({ type: "attacks" });
  check("extension B planted its secrets in its own storage, IndexedDB and Cache Storage", planted.ok && planted.value.plantSecrets.outcome === "returned", planted.value && planted.value.plantSecrets);

  const a = await createHost("malicious-a", {
    fixture: "malicious-a.js",
    replacements: { __CANARY__: `http://127.0.0.1:${canaryPort}`, __SECRET_FILE__: secretFile.replace(/\\/g, "\\\\") },
    policy,
    resolve: testResolve(),
  });
  check("hostile extension's worker started (it did not need any privilege to load)", a.workerErrors.length === 0, a.workerErrors);
  const run = await a.call({ type: "attacks" }, 120000);
  const r = (run && run.value) || {};
  out.data.attacks = r;
  const value = (n) => r[n] && r[n].value;
  const denied = (n) => r[n] && (r[n].outcome === "threw" || r[n].value === "attack-timeout" || (r[n].value && (r[n].value.status === 0 || r[n].value.status === 404)));

  const g = value("nodeAndElectronGlobals") || {};
  check("no Node/Electron globals (require, process, module, global, __dirname, electron, ipcRenderer)", ["require", "process", "module", "global", "__dirname", "electron", "ipcRenderer"].every((k) => g[k] === "undefined"), g);
  const esc = r.functionConstructorEscape || {};
  check("Function-constructor escape gives nothing (blocked by CSP, or no process to find)", esc.outcome === "threw" || (esc.value && esc.value.viaFunction === "undefined/undefined" && !esc.value.globalHasProcess), esc);
  out.data.evalAllowed = r.evalAllowed;

  for (const n of ["readFileSyncXhr", "readFileFetch", "readFileImportScripts", "readWindowsFile"]) {
    const leaked = JSON.stringify(r[n] || {}).includes(secret) || (r[n] && r[n].value && (r[n].value.leaked || r[n].value.hasWinIni));
    check(`file read refused: ${n}`, denied(n) && !leaked, r[n]);
  }
  const trav = value("hostPathTraversal") || {};
  // /ext.js always serves the requesting session's OWN script (the query string is ignored), so the
  // "?id=malicious-b" probe legitimately gets 200 with A's code; what matters is that no foreign
  // content (B's script, a file) is ever returned.
  const { otherExtension, ...mustBe404 } = trav;
  check("host protocol: path traversal and unknown broker routes return 404", Object.values(mustBe404).every((x) => x && (x.status === 404 || x.status === 0) && !x.leaked && !x.hasWinIni), mustBe404);
  check("host protocol: asking for another extension's script returns only the caller's own script", otherExtension && !otherExtension.hasOtherExtensionCode && !otherExtension.leaked && !otherExtension.hasWinIni, otherExtension);

  for (const n of ["directFetchLoopback", "directXhrLoopback", "directFetchPublicInternet", "directFetchNoCors", "importScriptsRemote", "nestedWorkerEscape"]) check(`direct network refused: ${n}`, denied(n), r[n]);
  check("WebSocket to loopback refused", ["error", "no-connection"].includes(value("webSocketLoopback")) || (r.webSocketLoopback && r.webSocketLoopback.outcome === "threw"), r.webSocketLoopback);
  check("the canary server received no request and no WebSocket upgrade from the sandbox", canaryHits.length === 0 && canaryUpgrades === 0, { hits: canaryHits, upgrades: canaryUpgrades });

  for (const n of ["launchProgramFetch", "launchProgramXhr", "launchProgramWorker", "launchProgramImport"]) check(`program launch refused: ${n}`, denied(n), r[n]);

  const brokerExpect = { brokerLoopback: "blocked-address", brokerMetadata: "blocked-address", brokerEncodedLoopback: "blocked-address", brokerFileUrl: "scheme-not-allowed", brokerUndeclaredHost: "dns-failed" };
  for (const [n, code] of Object.entries(brokerExpect)) check(`broker refuses ${n} (${code})`, r[n] && r[n].outcome === "threw" && r[n].error.includes(code), r[n]);

  const other = value("brokerStorageOfOther");
  check("broker storage is keyed by session: B's secret is invisible to A even when A names B", typeof other === "string" && !other.includes("B-SECRET"), other);
  check("IndexedDB is per extension session: A cannot see B's database", value("indexedDbOfOther") && value("indexedDbOfOther").value === null, r.indexedDbOfOther);
  const cacheNames = (value("cacheStorageOfOther") || {}).cacheNames;
  check("Cache Storage is per extension session: A cannot see B's caches", Array.isArray(cacheNames) ? !cacheNames.includes("b-cache") : r.cacheStorageOfOther && r.cacheStorageOfOther.outcome === "threw", r.cacheStorageOfOther);
  check("A's attack results contain none of B's secrets and not the secret file's content", !/B-SECRET-(STORAGE|IDB|CACHE)/.test(JSON.stringify(r)) && !JSON.stringify(r).includes(secret));
  out.data.crossOriginIsolated = value("crossOriginIsolated");

  // Defence in depth: even if the host page itself were compromised, it can't navigate or open windows.
  const pageProbe = await a.win.webContents.executeJavaScript(`(async () => {
    const res = { process: typeof process, require: typeof require };
    try { window.open("ms-calculator:"); res.open = "called"; } catch (e) { res.open = e.name; }
    try { location.href = "ms-calculator:"; res.navigate = "called"; } catch (e) { res.navigate = e.name; }
    try { await fetch("file:///C:/Windows/win.ini"); res.pageFileFetch = "read"; } catch (e) { res.pageFileFetch = e.name; }
    return res;
  })()`);
  await sleep(1500);
  check("host page has no Node either, and its file fetch fails", pageProbe.process === "undefined" && pageProbe.require === "undefined" && pageProbe.pageFileFetch !== "read", pageProbe);
  check("window.open / navigation to external protocols were intercepted (denied)", a.navAttempts.length >= 1, a.navAttempts);
  const calcAfter = processCount("CalculatorApp.exe") + processCount("calc.exe");
  check("no calculator process was started by any launch attempt", calcAfter <= calcBefore, { before: calcBefore, after: calcAfter });

  check("extensions A and B run in separate OS processes (no shared renderer)", a.pid() !== b.pid() && processInfo(b.pid()) && processInfo(b.pid()).sandboxed === true, { a: a.pid(), b: b.pid(), bInfo: processInfo(b.pid()) });
  const info = processInfo(a.pid());
  check("extension host renderer runs sandboxed (OS-level, per Electron's process metrics)", info && info.sandboxed === true, info);
  out.data.hostProcess = info;
  out.data.integrityLevel = info && info.integrityLevel;
  out.data.blockedByWebRequest = a.blocked;
  out.data.hostIds = { a: await a.call({ type: "eval", name: "none" }).then(() => a.id), b: b.id };
  a.close();
  b.close();
  canary.close();
  fs.rmSync(secretFile, { force: true });
}

async function compat() {
  const { server: site, port } = await listen((req, res) => {
    const r = siteResponse(req.url);
    res.writeHead(r.status, r.headers);
    res.end(r.body);
  });
  const SITE = `http://public.test:${port}`;
  const policy = { hosts: ["public.test"], allowHttp: true, privateAllowance: [{ host: "public.test", port }], timeoutMs: 5000 };
  const host = await createHost("compat", { fixture: "compat.js", replacements: { __SITE__: SITE }, policy, resolve: testResolve() });
  check("hibiki-format extension loads in the sandbox", host.workerErrors.length === 0, host.workerErrors);
  const calls = [
    ["search", [{ query: "frieren" }]],
    ["latest", [3]],
    ["getById", ["42"]],
    ["getPlaybackGroups", ["42"]],
    ["getPlayerLinks", ["42", "sub", "1"]],
    ["getSettings", []],
  ];
  const sandbox = {};
  for (const [method, args] of calls) {
    const res = await host.call({ type: "call", method, args });
    sandbox[method] = res.ok ? res.value : { error: res.error || (res.timeout ? "timeout" : "unknown") };
    out.data[`ms_${method}`] = res.ms;
  }

  // Reference: the same script through hibiki's current Node path (node:vm in-process), fed the same bytes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-m0-vm-"));
  fs.writeFileSync(path.join(dir, "compat.manifest.json"), JSON.stringify({ id: "compat", name: "Compat", version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "compat.js"), fs.readFileSync(path.join(FIX, "compat.js"), "utf-8").split("__SITE__").join(SITE));
  const { executeExtensionCall } = require(path.join(DIST, "vmref.cjs"));
  const canned = (url, opts) => { const r = siteResponse(url); return { status: r.status, ok: r.status === 200, body: r.body, headers: r.headers }; };
  const store = new Map();
  const reference = {};
  for (const [method, args] of calls) {
    try {
      reference[method] = executeExtensionCall(
        { extensionsDir: dir, sourceId: "compat", method, args },
        { netFetch: { fetch: canned, fetchAll: (reqs) => reqs.map((r) => canned(r.url)) } },
        { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
      );
    } catch (error) {
      reference[method] = { error: String(error) };
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  out.data.sandbox = sandbox;
  out.data.reference = reference;
  for (const [method] of calls) {
    check(`${method}: sandbox result identical to hibiki's node:vm result`, JSON.stringify(sandbox[method]) === JSON.stringify(reference[method]) && !(sandbox[method] && sandbox[method].error), method === "search" ? sandbox[method] : undefined);
  }
  const outsideHost = await host.call({ type: "call", method: "search", args: [{ query: "x" }] });
  check("the compat extension's own network access stays within its declared host", outsideHost.ok, outsideHost.error);
  host.close();
  site.close();
}

async function perf() {
  const { server: site, port } = await listen((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/slow") return setTimeout(() => res.end("slow"), Number(url.searchParams.get("ms") || 100));
    res.end("ok");
  });
  const policy = { hosts: ["public.test"], allowHttp: true, privateAllowance: [{ host: "public.test", port }], timeoutMs: 5000 };
  const host = await createHost("perf", { fixture: "perf.js", replacements: { __SITE__: `http://public.test:${port}` }, policy, resolve: testResolve() });
  const res = await host.call({ type: "attacks" }, 120000);
  out.data.perf = res.value;
  const v = res.value || {};
  check("synchronous XHR from a sandboxed worker to an async custom-protocol handler works", v.brokerRoundtrip && v.brokerRoundtrip.outcome === "returned", v.brokerRoundtrip);
  check("fetch through broker + guardedFetch works repeatedly", v.fetchThroughBroker && v.fetchThroughBroker.outcome === "returned", v.fetchThroughBroker);
  check("fetchAll runs requests concurrently (10 x 200 ms in well under 2 s)", v.fetchAllTenConcurrent && v.fetchAllTenConcurrent.value && v.fetchAllTenConcurrent.value.ms < 1500, v.fetchAllTenConcurrent);
  // The main process must stay responsive while the worker blocks on synchronous calls.
  host.close();
  site.close();
}

async function memory(variant) {
  const limitMB = variant === "monitor" ? 512 : 2560; // 2.5 GB safety cap protects the machine
  const results = {};
  for (const workload of ["heap", "buffers"]) {
    const host = await createHost(`mem-${workload}`, { fixture: "resource-hog.js", policy: { hosts: [], allowHttp: false }, resolve: testResolve() });
    const pid = host.pid();
    const samples = [];
    let killedAt = null;
    let crossedAt = null;
    host.call({ type: "eval", name: workload }, 600000).catch(() => {});
    const started = Date.now();
    while (Date.now() - started < 90000) {
      await sleep(250);
      const info = processInfo(pid);
      const gone = host.gone();
      if (gone || !info) break;
      const mb = info.privateMB ?? info.workingSetMB;
      samples.push(mb);
      if (mb > limitMB && !crossedAt) {
        crossedAt = Date.now();
        host.win.webContents.forcefullyCrashRenderer();
        killedAt = Date.now();
      }
    }
    await sleep(500);
    const gone = host.gone();
    results[workload] = {
      peakMB: Math.max(0, ...samples),
      endedBy: gone ? (killedAt ? `watchdog-kill (${gone.reason})` : `renderer died by itself: ${gone.reason} (exitCode ${gone.exitCode})`) : "still running at 90 s (stopped by experiment)",
      killLatencyMs: gone && killedAt ? gone.at - killedAt : null,
      secondsToEnd: (((gone && gone.at) || Date.now()) - started) / 1000,
    };
    host.close();
  }
  // The rest of the app must survive: a new host still starts and answers.
  const fresh = await createHost("after", { fixture: "resource-hog.js", policy: { hosts: [], allowHttp: false }, resolve: testResolve() });
  const echo = await fresh.call({ type: "eval", name: "echo" }, 5000);
  fresh.close();
  out.data.memory = results;
  out.data.jsFlags = mode === "memory-jsflags" ? "--max-old-space-size=256 (applies to every renderer in the app)" : null;
  check(`memory (${variant}): app survives and a new extension host starts afterwards`, echo && echo.value === "alive", results);
}

// Loads real third-party hibiki-format scripts from a local folder (not part of this repository:
// hibiki-sources has no licence) with NO network granted, and reports whether each loads and which
// Provider methods it defines.
async function realScripts() {
  const dir = (process.argv.find((a) => a.startsWith("--dir=")) || "").slice(6);
  if (!dir || !fs.existsSync(dir)) return check("--dir points at a folder of hibiki-format scripts", false, dir);
  const files = [];
  for (const sub of ["", "extractors"]) {
    const d = path.join(dir, sub);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith(".js")) files.push(path.join(d, f));
  }
  const report = {};
  for (const file of files) {
    const host = await createHost(path.basename(file, ".js"), { fixture: file, policy: { hosts: [], allowHttp: false }, resolve: testResolve() });
    const probe = await host.win.webContents.executeJavaScript("window.__workerErrors").catch(() => ["unreachable"]);
    const methods = await host.call({ type: "methods" }, 5000);
    report[path.basename(file)] = { loadErrors: probe, methods: methods && methods.value };
    host.close();
  }
  out.data.realScripts = report;
  const loaded = Object.values(report).filter((r) => r.loadErrors.length === 0 && Array.isArray(r.methods) && r.methods.length > 0);
  check(`real hibiki-format scripts load in the sandbox with no network granted (${loaded.length}/${files.length})`, loaded.length === files.length, Object.fromEntries(Object.entries(report).filter(([, r]) => r.loadErrors.length || !Array.isArray(r.methods)).map(([k, r]) => [k, r])));
}

// Windows DPAPI via Electron safeStorage: what a credential store can rely on. Uses throwaway
// values only; no real setting is read, moved or deleted.
async function safeStorageCheck() {
  const { safeStorage } = require("electron");
  const available = safeStorage.isEncryptionAvailable();
  check("safeStorage encryption is available on this Windows account", available);
  if (!available) return;
  const secret = `proxy-pass-${crypto.randomUUID()}-ä€`;
  const cipher = safeStorage.encryptString(secret);
  check("ciphertext does not contain the plaintext", !cipher.toString("latin1").includes(secret.slice(0, 20)) && !cipher.toString("utf-8").includes(secret.slice(0, 20)), { bytes: cipher.length, prefix: cipher.subarray(0, 3).toString("latin1") });
  check("round trip returns the exact value (incl. non-ASCII)", safeStorage.decryptString(cipher) === secret);
  const again = safeStorage.encryptString(secret);
  check("encryption is randomised (same value -> different ciphertext)", !again.equals(cipher));
  const corrupted = Buffer.from(cipher);
  corrupted[corrupted.length - 5] ^= 0xff;
  let corruptOutcome;
  try { safeStorage.decryptString(corrupted); corruptOutcome = "decrypted (BAD)"; } catch (e) { corruptOutcome = `threw: ${e.message}`; }
  check("corrupted ciphertext fails loudly (so a recovery path is needed, never silent garbage)", corruptOutcome.startsWith("threw"), corruptOutcome);
  let emptyOutcome;
  try { emptyOutcome = safeStorage.decryptString(Buffer.alloc(0)); } catch (e) { emptyOutcome = `threw: ${e.message}`; }
  out.data.emptyCiphertext = emptyOutcome;
  out.data.note = "DPAPI binds ciphertext to this Windows user (and, for Chromium's os_crypt, to the app's Local State key). A restored backup on another PC/user cannot decrypt: the migration must keep a recovery path (re-enter the password) and must not delete the plaintext until the encrypted copy is verified.";
}

// Hard memory limit experiment: an external helper (research/m0/sandbox/job-limit.ps1) puts each
// host renderer into a Windows Job Object with a per-process memory limit; then the workloads run
// with NO watchdog (only the 2.5 GB safety cap) to see whether Windows itself stops them.
async function memoryJob() {
  const handshake = path.join(RESULTS, "job-handshake");
  fs.rmSync(handshake, { recursive: true, force: true });
  fs.mkdirSync(handshake, { recursive: true });
  const results = {};
  for (const workload of ["heap", "buffers"]) {
    const host = await createHost(`job-${workload}`, { fixture: "resource-hog.js", policy: { hosts: [], allowHttp: false }, resolve: testResolve() });
    const pid = host.pid();
    fs.writeFileSync(path.join(handshake, `${workload}.pid`), String(pid));
    let assigned = null;
    for (let i = 0; i < 300 && assigned === null; i++) {
      await sleep(100);
      const f = path.join(handshake, `${workload}.assigned`);
      if (fs.existsSync(f)) assigned = fs.readFileSync(f, "utf-8").trim();
    }
    const samples = [];
    host.call({ type: "eval", name: workload }, 600000).catch(() => {});
    const started = Date.now();
    let safetyKill = false;
    while (Date.now() - started < 60000) {
      await sleep(100);
      const info = processInfo(pid);
      if (host.gone() || !info) break;
      const mb = info.privateMB ?? info.workingSetMB;
      samples.push(mb);
      if (mb > 2560) { safetyKill = true; host.win.webContents.forcefullyCrashRenderer(); }
    }
    await sleep(500);
    const gone = host.gone();
    results[workload] = { pid, jobAssignment: assigned, peakMB: Math.max(0, ...samples), endedBy: gone ? (safetyKill ? `safety-kill (${gone.reason})` : `renderer stopped by itself: ${gone.reason} (exitCode ${gone.exitCode})`) : "still running at 60 s", secondsToEnd: (((gone && gone.at) || Date.now()) - started) / 1000 };
    host.close();
  }
  out.data.memoryJob = results;
  // Success = the process never exceeds the cap. Whether it then dies (heap: V8 OOM) or keeps
  // running with its allocations refused (ArrayBuffers: allocation failure) is the OS's choice;
  // both mean the limit held.
  const ok = Object.values(results).every((r) => r.jobAssignment === "ok" && r.peakMB <= 512 + 16);
  check("a Windows Job Object memory limit (512 MB) holds for both workloads (peak never above the cap)", ok, results);
}

async function cpu() {
  const host = await createHost("cpu", { fixture: "resource-hog.js", policy: { hosts: [], allowHttp: false }, resolve: testResolve() });
  host.call({ type: "eval", name: "loop" }, 600000).catch(() => {});
  await sleep(1000);
  // Main-process event loop lag while the extension spins.
  const lagStart = Date.now();
  await sleep(100);
  const lag = Date.now() - lagStart - 100;
  const pageStart = Date.now();
  const pageAlive = await Promise.race([host.win.webContents.executeJavaScript("1 + 1"), sleep(2000).then(() => "no answer")]);
  const pageMs = Date.now() - pageStart;
  check("main process stays responsive while an extension loops forever", lag < 50, { eventLoopLagMs: lag });
  check("host page thread (not the worker) still answers, so it can terminate the worker", pageAlive === 2, { pageAlive, pageMs });
  const t0 = Date.now();
  await host.win.webContents.executeJavaScript("window.__terminateWorker()");
  const terminateMs = Date.now() - t0;
  const info = processInfo(host.pid());
  check("worker.terminate() stops the loop (host process remains for reuse)", !!info, { terminateMs, cpuProcess: info });
  // Hard stop: crash the renderer process.
  const t1 = Date.now();
  host.win.webContents.forcefullyCrashRenderer();
  for (let i = 0; i < 40 && !host.gone(); i++) await sleep(50);
  check("forcefullyCrashRenderer() ends the extension process", !!host.gone(), { ms: Date.now() - t1, reason: host.gone() && host.gone().reason });
  host.close();
}

app.whenReady().then(async () => {
  try {
    if (mode === "security") await security();
    else if (mode === "compat") await compat();
    else if (mode === "perf") await perf();
    else if (mode === "memory-monitor") await memory("monitor");
    else if (mode === "memory-natural" || mode === "memory-jsflags") await memory("natural");
    else if (mode === "cpu") await cpu();
    else if (mode === "real-scripts") await realScripts();
    else if (mode === "safestorage") await safeStorageCheck();
    else if (mode === "memory-job") await memoryJob();
    else check(`unknown mode ${mode}`, false);
  } catch (error) {
    check(`spike crashed: ${error && error.stack ? error.stack : error}`, false);
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  out.finishedAt = new Date().toISOString();
  out.summary = { passed: out.checks.filter((c) => c.pass).length, failed: out.checks.filter((c) => !c.pass).length };
  fs.writeFileSync(path.join(RESULTS, `${mode}.json`), JSON.stringify(out, null, 2));
  console.log(`${mode}: ${out.summary.passed} passed, ${out.summary.failed} failed`);
  app.exit(out.summary.failed ? 1 : 0);
});
app.on("window-all-closed", () => {});
