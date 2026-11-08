// Release gate (0.1.0-alpha.2): real anime PLAYBACK and PROGRESS through Hibiki's anime pipeline, in the REAL
// app on an isolated profile, driven over the Chrome DevTools Protocol.
//
// Hibiki's own repositories only contain sources that read unofficial streaming sites, so none of them can
// serve a legally accessible test title. The pipeline is the same for any source in Hibiki's format: this
// gate installs a Hibiki-format source (a manifest WITHOUT contentType, so it runs as Hibiki's anime
// pipeline: Video section -> anime title page -> episodes -> Hibiki's player -> watch_progress -> resume)
// whose titles are the Blender Foundation's open movies on archive.org (Creative Commons BY 3.0). The
// script is RiuPlay's own Internet Archive code; only the catalogue query and the manifest differ.
//
// Checks: the source runs in the anime pipeline; titles in Video; the anime title page lists the episode;
// playback starts from a usable stream; pause, seek and mute work; progress is saved; Home's Continue
// Watching shows it; reopening the episode resumes at the saved position.
//
// Usage: RIUPLAY_USER_DATA_DIR=<empty absolute temp dir> node research/k6/verify-anime-playback.mjs <repoDir> [outDir] [appExe]
// (appExe: a packaged RiuPlay.exe instead of the repo's Electron)
import { spawn, spawnSync } from "node:child_process";
// The whole tree: a portable build's launcher stub exits on its own and leaves the app running.
const killTree = (child) => { if (process.platform === "win32" && child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); else child?.kill(); };
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
const out = process.argv[3] ?? path.join(process.env.TEMP ?? ".", "riuplay-anime-shots");
const appExe = process.argv[4] ?? null;
const profile = process.env.RIUPLAY_USER_DATA_DIR;
if (!repo || !profile || !path.isAbsolute(profile)) {
  console.error("usage: RIUPLAY_USER_DATA_DIR=<absolute temp dir> node verify-anime-playback.mjs <repoDir> [outDir] [appExe]");
  process.exit(2);
}
if (fs.existsSync(profile) && fs.readdirSync(profile).length > 0) {
  console.error("RIUPLAY_USER_DATA_DIR must be empty: this test never touches an existing profile");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

// --- the fixture: a Hibiki-format source, written straight into the isolated profile's extensions folder ---
const ID = "riuplay-test.blender-open-movies";
const NAME = "Blender Open Movies (Hibiki format)";
const iaScript = fs.readFileSync(path.join(repo, "extensions", "official", "riuplay.ia-video.js"), "utf8");
const marker = /var COLLECTIONS = [^\n]*\n/;
if (!marker.test(iaScript)) throw new Error("the IA script changed: COLLECTIONS not found");
const script = iaScript.replace(marker, 'var COLLECTIONS = "identifier:(BigBuckBunny_124 OR ElephantsDream OR Sintel) AND mediatype:movies";\n');
const extensions = path.join(profile, "extensions");
fs.mkdirSync(extensions, { recursive: true });
fs.writeFileSync(path.join(extensions, `${ID}.js`), script);
fs.writeFileSync(path.join(extensions, `${ID}.manifest.json`), JSON.stringify({
  id: ID, name: NAME, version: "1.0.0", lang: "en", isNsfw: false,
  capabilities: ["LATEST_RELEASES", "PLAYBACK"], website: "https://archive.org",
  permissions: { hosts: ["archive.org", "*.archive.org"], browser: false },
}, null, 2));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 9353;
const launch = () => appExe
  ? spawn(appExe, [`--remote-debugging-port=${PORT}`], { stdio: "ignore", env: process.env })
  : spawn(path.join(repo, "node_modules/electron/dist/electron.exe"), [".", `--remote-debugging-port=${PORT}`], { cwd: repo, stdio: "ignore" });

let app = launch();
let ws;
let seq = 0;
const pending = new Map();
async function connect() {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === "page" && t.url.includes("index.html"));
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error("could not reach the app");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
  return res.result?.result?.value;
};
const shot = async (name) => {
  const res = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(res.result.data, "base64"));
};
const go = async (hash, wait = 1500) => { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(wait); };
const waitFor = async (expression, timeoutMs = 45_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const v = await evaluate(expression); if (v) return v; } catch { /* page changing */ }
    await sleep(500);
  }
  return null;
};
const VIS = `((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"))`;
const clickByText = (labels) => evaluate(`(() => { const want = ${JSON.stringify(labels)}; const b = [...document.querySelectorAll("button")].find((el) => want.includes(el.innerText.trim()) && !el.disabled); if (b) { b.click(); return b.innerText.trim(); } return null; })()`);
const video = `(document.querySelector("video"))`;

let saved = null;
let watchHash = null;
try {
  await connect();
  await sleep(2500);
  for (let i = 0; i < 6; i++) { if (!(await clickByText(["Get started", "Next", "Done", "Skip for now", "Continue"]))) break; await sleep(1200); }

  const source = await evaluate(`hibiki.sources.list().then((l) => l.find((s) => s.id === ${JSON.stringify(ID)}) ?? null)`);
  check("A1. The Hibiki-format source is installed and runs in the anime pipeline", Boolean(source) && (source.pipeline ?? "anime") === "anime", source ? `pipeline=${source.pipeline}, contentType=${source.contentType}` : "not listed");

  await go("#/video", 2500);
  await evaluate(`${VIS}('[data-testid="provider-chip"]').find((c) => c.innerText.trim() === ${JSON.stringify(NAME)})?.click()`);
  const titles = await waitFor(`${VIS}('[data-testid="from-extensions"]').length === 1 && ${VIS}('[data-testid="provider-title"]').map((t) => t.title).join(" | ")`, 60_000);
  check("A2. Its titles appear in the Video section", Boolean(titles), titles ?? "none");
  await shot("anime-01-video");

  // Search, then the anime title page.
  await evaluate(`(() => { const input = ${VIS}('[data-testid="provider-search"]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "Sintel"); input.dispatchEvent(new Event("input", { bubbles: true })); input.form.requestSubmit(); })()`);
  const found = await waitFor(`(() => { const t = ${VIS}('[data-testid="provider-title"]'); return t.some((x) => x.title.includes("Sintel")) ? t.map((x) => x.title).join(" | ") : null; })()`, 60_000);
  check("A3. Search finds the title", Boolean(found), found ?? "none");
  await evaluate(`(${VIS}('[data-testid="provider-title"]').find((x) => x.title.includes("Sintel")) ?? ${VIS}('[data-testid="provider-title"]')[0]).click()`);
  const opened = await waitFor(`location.hash.startsWith("#/anime/") && location.hash`, 30_000);
  const episodeLink = opened && (await waitFor(`(() => { const a = [...document.querySelectorAll("a")].find((x) => (x.getAttribute("href") || "").includes("/watch/")); return a ? a.getAttribute("href") : null; })()`, 60_000));
  check("A4. The anime title page opens with its episode", Boolean(episodeLink), opened ? `${decodeURIComponent(opened)} -> ${episodeLink}` : "no title page");
  await shot("anime-02-title");

  // Playback through Hibiki's player.
  watchHash = episodeLink.startsWith("#") ? episodeLink : `#${episodeLink.replace(/^.*#/, "")}`;
  await go(watchHash, 3000);
  await evaluate(`(() => { const v = ${video}; if (v) { v.muted = true; v.play().catch(() => {}); } })()`);
  const playing = await waitFor(`(() => { const v = ${video}; return v && v.currentTime > 5 && v.readyState >= 3 && v.videoWidth > 0 ? { t: v.currentTime, d: v.duration, w: v.videoWidth, h: v.videoHeight, src: (v.currentSrc || "").slice(0, 60) } : null; })()`, 120_000);
  check("A5. An episode plays from a usable stream (frames decoded)", Boolean(playing), playing ? `${playing.w}x${playing.h}, at ${playing.t.toFixed(1)}s of ${Math.round(playing.d)}s, src ${playing.src}` : "no playback");
  await shot("anime-03-playing");

  // Controls: pause, seek, play, mute.
  await evaluate(`${video}.pause()`);
  await sleep(800);
  const pausedAt = await evaluate(`${video}.paused && ${video}.currentTime`);
  await sleep(1500);
  const stillPaused = await evaluate(`${video}.paused && Math.abs(${video}.currentTime - ${pausedAt}) < 0.05`);
  await evaluate(`(() => { const v = ${video}; v.currentTime = 300; })()`);
  const seeked = await waitFor(`(() => { const v = ${video}; return !v.seeking && Math.abs(v.currentTime - 300) < 2 ? v.currentTime : null; })()`, 30_000);
  await evaluate(`${video}.play()`);
  const resumed = await waitFor(`(() => { const v = ${video}; return !v.paused && v.currentTime > 302 ? v.currentTime : null; })()`, 30_000);
  const muteToggles = await evaluate(`(() => { const v = ${video}; const before = v.muted; v.muted = !before; const changed = v.muted !== before; v.muted = true; return changed; })()`);
  check("A6. Playback controls work (pause holds, seek to 5:00, play resumes, mute toggles)", pausedAt !== false && stillPaused && seeked && resumed && muteToggles, { pausedAt, stillPaused, seeked, resumed, muteToggles });

  // Let the player save, then leave.
  await sleep(12_000);
  const position = await evaluate(`${video}.currentTime`);
  await go("#/", 3000);
  const progressRows = await evaluate(`hibiki.progress.listRecent(10)`);
  saved = (progressRows ?? []).find((p) => p.sourceId === ID) ?? null;
  check("A7. Progress is persisted (watch_progress)", saved && saved.positionMs > 300_000, saved ? `positionMs ${saved.positionMs} (player was at ${Math.round(position * 1000)})` : "no progress row");

  const watched = decodeURIComponent(opened).includes("Sintel") ? "Sintel" : decodeURIComponent(opened).includes("ElephantsDream") ? "Elephants Dream" : "Big Buck Bunny";
  const homeText = await waitFor(`document.body.innerText.includes(${JSON.stringify(watched)}) && document.body.innerText`, 20_000);
  check("A8. Home's Continue Watching shows the title", Boolean(homeText) && /continue watching/i.test(homeText), homeText ? `${watched} listed` : `${watched} not on Home`);
  await shot("anime-04-home-continue");
} catch (error) {
  check("run completed without an exception", false, String(error?.stack ?? error).slice(0, 400));
}

// Restart the app: the position must survive it and the player must resume there.
try {
  ws?.close();
  killTree(app);
  await sleep(3000);
  if (saved && watchHash) {
    app = launch();
    await connect();
    await sleep(2500);
    const afterRestart = await evaluate(`hibiki.progress.get(${JSON.stringify(saved.sourceId)}, ${JSON.stringify(saved.titleId)}, ${JSON.stringify(saved.episodeId)})`);
    check("A9. The saved position survives a restart", afterRestart && Math.abs(afterRestart.positionMs - saved.positionMs) < 1000, afterRestart ? `positionMs ${afterRestart.positionMs}` : "gone");
    await go(watchHash, 3000);
    await evaluate(`(() => { const v = ${video}; if (v) { v.muted = true; v.play().catch(() => {}); } })()`);
    const resumedAt = await waitFor(`(() => { const v = ${video}; return v && v.readyState >= 2 && v.currentTime > 0 ? v.currentTime : null; })()`, 90_000);
    check("A10. Reopening the episode resumes at the saved position", resumedAt && Math.abs(resumedAt * 1000 - saved.positionMs) < 15_000, resumedAt ? `resumed at ${resumedAt.toFixed(1)}s, saved ${(saved.positionMs / 1000).toFixed(1)}s` : "no playback");
    await shot("anime-05-resumed");
  }
} catch (error) {
  check("restart run completed without an exception", false, String(error?.stack ?? error).slice(0, 400));
} finally {
  ws?.close();
  killTree(app);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
