// M3 follow-up: verifies Chromium proxy parity and proxy authentication in a REAL Electron 45,
// with a throwaway user-data directory and loopback fixture servers only (no real profile, no real
// proxy, synthetic credentials). It runs the production modules src/main/net/chromiumProxy.ts and
// src/main/net/proxy.ts (bundled with esbuild) the way main/network.ts wires them.
// Usage: node research/m3/verify-chromium-proxy.mjs
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-m3-chromium-"));
const bundle = path.join(tmp, "net.mjs");
const entry = path.join(tmp, "entry.ts");
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(repo, "src/main/net/chromiumProxy.ts").replace(/\\/g, "/"))};\nexport * from ${JSON.stringify(path.join(repo, "src/main/net/proxy.ts").replace(/\\/g, "/"))};\n`);
execFileSync(path.join(repo, "node_modules/.bin/esbuild.cmd"), [entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`], { stdio: "ignore", shell: true });

const main = path.join(tmp, "main.mjs");
fs.writeFileSync(
  main,
  `
import { app, BrowserWindow, session } from "electron";
import http from "node:http";
import net from "node:net";
import { createChromiumProxyController, chromiumProxyPlan, CHROMIUM_BLACKHOLE_RULES } from "./net.mjs";

app.setPath("userData", ${JSON.stringify(path.join(tmp, "profile"))});
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

function startTarget() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, authorization: req.headers.authorization ?? null, proxyAuthorization: req.headers["proxy-authorization"] ?? null });
    if (req.url.startsWith("/needs-login")) return res.writeHead(401, { "www-authenticate": 'Basic realm="site"' }).end("login");
    res.writeHead(200, { "content-type": "text/plain" }).end("target ok");
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ port: server.address().port, hits, server })));
}

function startProxy(user, pass) {
  const state = { requests: 0, authorized: 0, challenged: 0 };
  const expected = "Basic " + Buffer.from(user + ":" + pass).toString("base64");
  const authorized = (req) => req.headers["proxy-authorization"] === expected;
  const server = http.createServer((req, res) => {
    state.requests++;
    if (!authorized(req)) { state.challenged++; return res.writeHead(407, { "proxy-authenticate": 'Basic realm="proxy"' }).end(); }
    state.authorized++;
    const target = new URL(req.url);
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  server.on("connect", (req, socket) => {
    state.requests++;
    if (!authorized(req)) { state.challenged++; return socket.end("HTTP/1.1 407 Proxy Authentication Required\\r\\nProxy-Authenticate: Basic realm=\\"proxy\\"\\r\\nContent-Length: 0\\r\\n\\r\\n"); }
    state.authorized++;
    const [h, p] = req.url.split(":");
    const up = net.connect(Number(p), h, () => { socket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n"); up.pipe(socket); socket.pipe(up); });
    up.on("error", () => socket.destroy());
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ port: server.address().port, state, server })));
}

let currentPlan = { mode: "direct", rules: null };
const controller = createChromiumProxyController({ plan: () => currentPlan });
let answered = 0;
let siteAnswers = 0;
app.on("login", (event, _wc, _details, authInfo, callback) => {
  const answer = controller.answerLogin({ isProxy: authInfo.isProxy, scheme: authInfo.scheme, host: authInfo.host, port: authInfo.port });
  process.stderr.write("login " + JSON.stringify({ isProxy: authInfo.isProxy, host: authInfo.host, port: authInfo.port, answered: !!answer }) + String.fromCharCode(10));
  if (!answer) return;
  if (!authInfo.isProxy) siteAnswers++;
  answered++;
  event.preventDefault();
  callback(answer.username, answer.password);
});

async function use(plan, ses) {
  currentPlan = plan;
  controller.resetAttempts();
  // Test harness only: the fixtures live on loopback, which Chromium bypasses by default.
  await controller.apply({ setProxy: (c) => ses.setProxy("proxyRules" in c ? { ...c, proxyBypassRules: "<-loopback>" } : c), closeAllConnections: () => ses.closeAllConnections(), clearAuthCache: () => ses.clearAuthCache() });
}
// A hidden, sandboxed window - the same kind of request the player, posters and sign-in windows
// make (webContents), which is what Electron's "login" event covers.
async function get(ses, url) {
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let status = null;
  win.webContents.on("did-navigate", (_e, _url, code) => { status = code; });
  const timer = setTimeout(() => win.webContents.stop(), 8000);
  try {
    process.stderr.write("load " + url + String.fromCharCode(10));
    await win.loadURL(url);
    const body = await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''");
    return { status, body };
  } catch (e) {
    return { status, error: e.code ?? e.name };
  } finally {
    clearTimeout(timer);
    win.destroy();
    process.stderr.write("done " + status + String.fromCharCode(10));
  }
}

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    const target = await startTarget();
    const proxy = await startProxy("synthetic-user", "synthetic-Pa55");
    const ses = session.fromPartition("riuplay-m3-test-" + Date.now()); // in-memory, isolated
    const url = "http://127.0.0.1:" + target.port + "/hello";

    const good = chromiumProxyPlan({ kind: "http", host: "127.0.0.1", port: proxy.port, username: "synthetic-user", password: "synthetic-Pa55" });
    check("plan never puts credentials in the Chromium rule", good.mode === "proxy" && !good.proxyRules.includes("synthetic"), good.mode === "proxy" ? good.proxyRules : good);
    await use({ ...good, rules: good.proxyRules }, ses);
    const r1 = await get(ses, url);
    check("HTTP proxy with credentials: Chromium authenticates through the login handler", r1.status === 200 && proxy.state.authorized >= 1 && answered >= 1, { r1, proxy: proxy.state, answered });
    check("the target never receives the proxy credentials", target.hits.every((h) => h.proxyAuthorization === null && h.authorization === null), target.hits.length);

    const before = { ...proxy.state };
    answered = 0;
    const wrong = chromiumProxyPlan({ kind: "http", host: "127.0.0.1", port: proxy.port, username: "synthetic-user", password: "WRONG" });
    await use({ ...wrong, rules: wrong.proxyRules }, ses);
    const targetHits = target.hits.length;
    const r2 = await get(ses, url + "?wrong");
    check("wrong proxy password: the request fails, bounded retries, no direct fallback", r2.status !== 200 && answered >= 1 && answered <= 2 && target.hits.length === targetHits, { r2, answered, newProxyRequests: proxy.state.requests - before.requests });

    await use({ mode: "blocked", reason: "test", rules: CHROMIUM_BLACKHOLE_RULES }, ses);
    const hitsBeforeBlocked = target.hits.length;
    const r3 = await get(ses, url + "?blocked");
    check("unusable proxy (blocked plan): Chromium fails instead of going direct", r3.error !== undefined || (r3.status ?? 0) >= 500, { r3 });
    check("blocked plan: the target saw nothing", target.hits.length === hitsBeforeBlocked);

    await use({ ...good, rules: good.proxyRules }, ses);
    answered = 0;
    const r4 = await get(ses, "http://127.0.0.1:" + target.port + "/needs-login");
    check("a website's own login challenge is never answered with the proxy credentials", r4.status === 401 && siteAnswers === 0 && target.hits.every((h) => h.authorization === null), { r4, siteAnswers });

    const socksAuth = chromiumProxyPlan({ kind: "socks5", host: "127.0.0.1", port: 1080, username: "u", password: "p" });
    check("SOCKS5 with credentials is blocked for Chromium (unsupported), never sent direct", socksAuth.mode === "blocked");

    await use({ mode: "direct", rules: null }, ses);
    const proxyBefore = proxy.state.requests;
    const r5 = await get(ses, url + "?direct");
    check("direct mode: no proxy involved", r5.status === 200 && proxy.state.requests === proxyBefore);
  } catch (e) {
    check("harness", false, String(e));
  }
  process.stdout.write("RESULTS " + JSON.stringify(results) + "\\n");
  app.exit(0);
});
`,
);

const electron = path.join(repo, "node_modules/electron/dist/electron.exe");
const run = spawnSync(electron, [main, `--user-data-dir=${path.join(tmp, "profile")}`], { encoding: "utf8", timeout: 120_000 });
if (process.env.M3_DEBUG) console.error(run.stderr);
const line = (run.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("RESULTS "));
fs.rmSync(tmp, { recursive: true, force: true });
if (!line) {
  console.error("no results", run.status, (run.stderr ?? "").slice(-2000));
  process.exit(1);
}
const results = JSON.parse(line.slice(8));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail !== undefined ? `  ${JSON.stringify(r.detail)}` : ""}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
fs.mkdirSync(path.join(repo, "research/m3/results"), { recursive: true });
fs.writeFileSync(path.join(repo, "research/m3/results/chromium-proxy.json"), JSON.stringify({ electron: "45.2.3", results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
