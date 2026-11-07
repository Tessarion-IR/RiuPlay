// M2: verifies the PRODUCTION sandboxed extension host (src/main/extensions/sandbox/sandboxHost.ts
// + the built worker bundle dist-electron/main/extension-host-worker.js) in a real Electron 45,
// with a throwaway profile, loopback canary servers and synthetic extensions only.
// Usage: npx vite build && node research/m2/verify-sandbox.mjs
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerBundle = path.join(repo, "dist-electron/main/extension-host-worker.js");
if (!fs.existsSync(workerBundle)) {
  console.error("build first: npx vite build");
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-m2-sandbox-"));
const extDir = path.join(tmp, "extensions");
fs.mkdirSync(extDir);
const secretFile = path.join(tmp, "secret.txt");
fs.writeFileSync(secretFile, ["RIUPLAY", "M2", "SECRET"].join("-"));

execFileSync(path.join(repo, "node_modules/.bin/esbuild.cmd"), [path.join(repo, "src/main/extensions/sandbox/sandboxHost.ts"), "--bundle", "--platform=node", "--format=cjs", "--external:electron", `--alias:@shared=${path.join(repo, "src/shared")}`, `--outfile=${path.join(tmp, "host.cjs")}`], { stdio: "ignore", shell: true });

// Reference runtime: hibiki's node:vm path (execute.ts), fed the same canned bytes.
buildSync({ entryPoints: [path.join(repo, "src/main/extensions/execute.ts")], bundle: true, platform: "node", format: "cjs", external: ["cheerio", "sync-fetch", "electron"], alias: { "@shared": path.join(repo, "src/shared") }, define: { "import.meta.url": JSON.stringify(pathToFileURL(path.join(repo, "src/main/extensions/globals.ts")).href) }, outfile: path.join(tmp, "vmref.cjs"), logLevel: "error" });
const spike = fs.readFileSync(path.join(repo, "research/m0/sandbox/spike-main.cjs"), "utf8");
const siteResponseSource = spike.slice(spike.indexOf("function siteResponse(urlText) {"), spike.indexOf("const HOST_HTML"));
const compatSource = fs.readFileSync(path.join(repo, "research/m0/sandbox/fixtures/compat.js"), "utf8").split("__SITE__").join("http://public.test");
fs.writeFileSync(path.join(extDir, "compat.js"), compatSource);
fs.writeFileSync(path.join(extDir, "compat.manifest.json"), JSON.stringify({ id: "compat", name: "Compat", version: "1.0.0" }));

const hostile = (canary) => `
var CANARY = ${JSON.stringify(canary)};
var SECRET_FILE = ${JSON.stringify(secretFile.replace(/\\/g, "/"))};
var MARK = ["RIUPLAY", "M2", "SECRET"].join("-");
function xhr(url) { try { var x = new XMLHttpRequest(); x.open("GET", url, false); x.send(); return { status: x.status, leaked: (x.responseText || "").indexOf(MARK) >= 0, len: (x.responseText || "").length }; } catch (e) { return { threw: e.name }; } }
function attempt(fn) { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.name }; } }
var Provider = {
  getSettings: function () {
    return {
      node: { require: typeof require, process: typeof process, module: typeof module, electron: typeof electron, ipcRenderer: typeof ipcRenderer },
      functionEscape: attempt(function () { return (function () {}).constructor("return typeof process + '/' + typeof require")(); }),
      evalBlocked: attempt(function () { return eval("1 + 1"); }),
      fileXhr: xhr("file:///" + SECRET_FILE),
      winIni: xhr("file:///C:/Windows/win.ini"),
      loopbackXhr: xhr(CANARY + "/xhr"),
      publicXhr: xhr("https://example.com/"),
      traversal: xhr("riuplay-ext-host://host/../../../../Windows/win.ini"),
      otherExtension: xhr("riuplay-ext-host://host/ext.js?id=quiet"),
      unknownRoute: xhr("riuplay-ext-host://host/broker/readFile?path=C:/Windows/win.ini"),
      importRemote: attempt(function () { importScripts(CANARY + "/import.js"); return "imported"; }),
      importFile: attempt(function () { importScripts("file:///" + SECRET_FILE); return "imported"; }),
      // Fire-and-forget: anything that later reaches the canary is counted by the harness.
      started: attempt(function () {
        WorkerGlobalScope.prototype.fetch.call(self, CANARY + "/native-fetch").catch(function () {});
        try { new WebSocket(CANARY.replace("http", "ws") + "/ws"); } catch (e) {}
        try { new Worker(CANARY + "/nested.js"); } catch (e) {}
        try { new EventSource(CANARY + "/sse"); } catch (e) {}
        return "started";
      }),
      bridgeToPrivate: attempt(function () { return fetch("http://169.254.169.254/latest/meta-data/").status; }),
      ownScript: xhr("riuplay-ext-host://host/ext.js").len > 0,
    };
  },
  getById: function (id) { var before = storage.get("k"); storage.set("k", "from-" + id); return { id: id, title: "t", before: before }; },
  latest: function () { for (;;) {} },
  search: function () { var keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random())); },
};`;
const quiet = `var Provider = { getById: function (id) { return { id: id, title: "q", seen: storage.get("k") }; }, getSettings: function () { return { me: "quiet", other: (function(){ var x = new XMLHttpRequest(); x.open("GET", "riuplay-ext-host://host/ext.js", false); x.send(); return x.responseText.indexOf(["SECRET", "_FILE"].join("")) >= 0; })() }; } };`;

const main = path.join(tmp, "main.cjs");
fs.writeFileSync(
  main,
  `
const { app, protocol } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { SandboxedExtensionHost, EXTENSION_HOST_SCHEME, EXTENSION_HOST_PRIVILEGES } = require("./host.cjs");
app.setPath("userData", ${JSON.stringify(path.join(tmp, "profile"))});
protocol.registerSchemesAsPrivileged([{ scheme: EXTENSION_HOST_SCHEME, privileges: EXTENSION_HOST_PRIVILEGES }]);
app.commandLine.appendSwitch("disable-renderer-backgrounding");
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const hits = [];
  const canary = http.createServer((req, res) => { hits.push(req.url); res.end("${["RIUPLAY", "M2", "SECRET"].join("-")}"); });
  canary.on("upgrade", (req, socket) => { hits.push("ws:" + req.url); socket.destroy(); });
  await new Promise((r) => canary.listen(0, "127.0.0.1", r));
  const CANARY = "http://127.0.0.1:" + canary.address().port;
  fs.writeFileSync(${JSON.stringify(path.join(extDir, "hostile.js"))}, ${JSON.stringify(hostile("__CANARY__"))}.split("__CANARY__").join(CANARY));
  fs.writeFileSync(${JSON.stringify(path.join(extDir, "quiet.js"))}, ${JSON.stringify(quiet)});
  const host = new SandboxedExtensionHost({ workerBundlePath: ${JSON.stringify(workerBundle)}, memoryLimitMB: 300 });
  const bridgeCalls = { hostile: [], quiet: [] };
  const bridgeFor = (id) => async (kind, payload) => { bridgeCalls[id].push({ kind, url: payload.url }); if (kind === "netFetch") throw new Error("blocked-address (test broker)"); return null; };
  const call = (id, method, args, storage = {}, timeoutMs = 20000) => host.run({ extensionsDir: ${JSON.stringify(extDir)}, sourceId: id, method, args, storage }, bridgeFor(id), { timeoutMs });
  try {
    const r = await call("hostile", "getSettings", []);
    const s = r.result;
    check("call answered through the sandboxed host", r.ok, r.error);
    check("no Node/Electron globals (require, process, module, electron, ipcRenderer)", s && Object.values(s.node).every((t) => t === "undefined"), s && s.node);
    check("Function-constructor escape finds no Node (refused by the CSP, or no Node behind it)", s && ((!s.functionEscape.ok && s.functionEscape.error === "EvalError") || s.functionEscape.value === "undefined/undefined"), s && s.functionEscape);
    check("eval refused by the CSP", s && !s.evalBlocked.ok, s && s.evalBlocked);
    check("file:// read refused (secret not leaked)", s && !s.fileXhr.leaked && !s.winIni.len, { file: s && s.fileXhr, win: s && s.winIni });
    check("direct loopback XHR refused", s && !(s.loopbackXhr.status === 200), s && s.loopbackXhr);
    check("direct public-internet XHR refused", s && s.publicXhr.status !== 200, s && s.publicXhr);
    check("host path traversal / unknown broker routes give nothing", s && !s.traversal.leaked && s.unknownRoute.status !== 200, { t: s && s.traversal, u: s && s.unknownRoute });
    check("an extension can't read another extension's script", s && s.otherExtension.len > 0 && s.ownScript, s && s.otherExtension);
    check("importScripts from network or file refused", s && !s.importRemote.ok && !s.importFile.ok, { r: s && s.importRemote, f: s && s.importFile });
    check("fetch() goes only to the broker bridge (identity = calling extension)", bridgeCalls.hostile.some((c) => c.kind === "netFetch" && c.url.includes("169.254")) && bridgeCalls.quiet.length === 0, bridgeCalls);
    check("a broker refusal reaches the script as an error", s && !s.bridgeToPrivate.ok, s && s.bridgeToPrivate);
    const q = await call("quiet", "getSettings", []);
    check("each extension is served only its own script", q.ok && q.result.me === "quiet" && q.result.other === false, q);
    const a = await call("hostile", "getById", ["1"], { k: "a-value" });
    const b = await call("quiet", "getById", ["1"], { k: "b-value" });
    check("storage is per extension and per call (snapshot in, writes out)", a.result.before === "a-value" && a.storageWrites.k === "from-1" && b.result.seen === "b-value", { a: a.result, aw: a.storageWrites, b: b.result });
    await new Promise((r) => setTimeout(r, 2500));
    check("no attack reached the loopback canary (native fetch, WebSocket, nested worker, EventSource, XHR)", hits.length === 0, hits);
    const before = host.describe();
    check("memory limit: hosts were put in a Windows Job Object", before.length > 0 && before.every((h) => h.memoryLimited), before);
    const loopStart = Date.now();
    let loop = null;
    try { await call("hostile", "latest", [10], {}, 1500); } catch (e) { loop = e.name; }
    check("an infinite loop times out and its host is destroyed", loop === "TimeoutError" && Date.now() - loopStart < 5000, { loop, ms: Date.now() - loopStart });
    let oom = null;
    const oomStart = Date.now();
    try { await call("hostile", "search", [{ query: "x" }], {}, 60000); } catch (e) { oom = e.message; }
    check("memory: an allocating extension is stopped at the OS limit", oom !== null && Date.now() - oomStart < 60000, { oom, ms: Date.now() - oomStart });
    const again = await call("quiet", "getById", ["2"]);
    check("other extensions keep working after a host was killed", again.ok, again.error);

    // Compatibility: a hibiki-format source gives byte-identical results in the sandbox and in the
    // node:vm path, given the same responses.
    const zlib = require("node:zlib");
    ${siteResponseSource}
    const canned = (url) => { const r = siteResponse(url); return { status: r.status, ok: r.status === 200, body: r.body, headers: r.headers }; };
    const compatBridge = async (kind, payload) => kind === "netFetch" ? canned(payload.url) : kind === "netFetchAll" ? payload.requests.map((r) => canned(r.url)) : null;
    const { executeExtensionCall } = require("./vmref.cjs");
    const calls = [["search", [{ query: "frieren" }]], ["latest", [3]], ["getById", ["42"]], ["getPlaybackGroups", ["42"]], ["getPlayerLinks", ["42", "sub", "1"]], ["getSettings", []]];
    for (const [method, args] of calls) {
      const sandboxed = await host.run({ extensionsDir: ${JSON.stringify(extDir)}, sourceId: "compat", method, args, storage: {} }, compatBridge, { timeoutMs: 20000 });
      let reference;
      const store = new Map();
      try {
        reference = executeExtensionCall({ extensionsDir: ${JSON.stringify(extDir)}, sourceId: "compat", method, args }, { netFetch: { fetch: canned, fetchAll: (reqs) => reqs.map((r) => canned(r.url)) } }, { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) });
      } catch (e) { reference = { error: String(e) }; }
      check("compat " + method + ": sandbox result identical to the node:vm result", sandboxed.ok && JSON.stringify(sandboxed.result) === JSON.stringify(reference), { sandboxed: sandboxed.ok ? undefined : sandboxed.error });
    }
  } catch (e) {
    check("harness", false, String(e && e.stack || e));
  }
  host.dispose();
  process.stdout.write("RESULTS " + JSON.stringify(results) + "\\n");
  app.exit(0);
});
`,
);

const electron = path.join(repo, "node_modules/electron/dist/electron.exe");
const run = spawnSync(electron, [main, `--user-data-dir=${path.join(tmp, "profile")}`], { encoding: "utf8", timeout: 240_000 });
const line = (run.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("RESULTS "));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (!line) {
  console.error("no results", run.status, (run.stderr ?? "").slice(-3000), (run.stdout ?? "").slice(-2000));
  process.exit(1);
}
const results = JSON.parse(line.slice(8));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  ${JSON.stringify(r.detail)}`}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
fs.mkdirSync(path.join(repo, "research/m2/results"), { recursive: true });
fs.writeFileSync(path.join(repo, "research/m2/results/sandbox.json"), JSON.stringify({ electron: "45.2.3", results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
