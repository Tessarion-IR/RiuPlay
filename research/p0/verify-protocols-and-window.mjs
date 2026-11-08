// P0 (Electron upgrade) verification: the app's custom protocols and window controls in the real,
// running app - the areas Electron's breaking changes flagged (Windows custom-protocol URL
// handling) that the Phase 6 end-to-end run did not reach (it used http URLs only).
//
// Usage (app must be closed): node research/p0/verify-protocols-and-window.mjs <repoDir>
// It inserts ONE temporary local-file audio title into %APPDATA%\RiuPlay\riuplay.db and one file
// into %APPDATA%\RiuPlay\downloads, then removes both. Nothing else is read or written.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";

const repo = process.argv[2];
const userData = process.env.RIUPLAY_USER_DATA_DIR || path.join(process.env.APPDATA, "RiuPlay");
const dbFile = path.join(userData, "riuplay.db");
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- temporary files ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-p0-"));
function wav(seconds) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 330) * 1500), 44 + i * 2);
  return b;
}
function png() {
  const t = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (x) => { let c = 0xffffffff; for (const v of x) c = t[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const h = Buffer.alloc(13); h.writeUInt32BE(8, 0); h.writeUInt32BE(8, 4); h[8] = 8; h[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", h), chunk("IDAT", zlib.deflateSync(Buffer.alloc(8 * 25, 120))), chunk("IEND", Buffer.alloc(0))]);
}
const wavFile = path.join(tmp, "p0-track.wav");
const coverFile = path.join(tmp, "cover.png");
fs.writeFileSync(wavFile, wav(4));
fs.writeFileSync(coverFile, png());
const downloadsDir = path.join(userData, "downloads");
const createdDownloadsDir = !fs.existsSync(downloadsDir);
fs.mkdirSync(downloadsDir, { recursive: true });
const downloadFile = path.join(downloadsDir, "riuplay-p0-test.vtt");
fs.writeFileSync(downloadFile, "WEBVTT\n\n00:00.000 --> 00:01.000\nP0\n");

// --- temporary title (app closed) --------------------------------------------------------------
const now = Date.now();
// A fresh, isolated profile (RIUPLAY_USER_DATA_DIR) has no database yet: start the app once so it
// creates and migrates one, then stop it.
const hasTables = () => {
  try {
    const probe = new DatabaseSync(dbFile, { readOnly: true });
    const ok = probe.prepare("SELECT 1 FROM sqlite_master WHERE name = 'local_media'").get() !== undefined;
    probe.close();
    return ok;
  } catch {
    return false;
  }
};
if (!hasTables()) {
  const first = spawn(path.join(repo, "node_modules/electron/dist/electron.exe"), ["."], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 120 && !hasTables(); i++) await new Promise((r) => setTimeout(r, 250));
  first.kill();
  await new Promise((r) => setTimeout(r, 1500));
}
let db = new DatabaseSync(dbFile);
const media = db.prepare("INSERT INTO local_media (content_type, title, origin, origin_ref, cover, created_at, updated_at) VALUES ('audio', 'P0 protocol check', 'file', ?, ?, ?, ?)").run(tmp, coverFile, now, now);
const mediaId = Number(media.lastInsertRowid);
const unit = db.prepare("INSERT INTO local_media_units (media_id, kind, number, title, url, created_at) VALUES (?, 'track', 1, 'P0 track', ?, ?)").run(mediaId, wavFile, now);
const unitId = Number(unit.lastInsertRowid);
db.close();

// --- app + DevTools protocol -------------------------------------------------------------------
const PORT = 9353;
const app = spawn(path.join(repo, "node_modules/electron/dist/electron.exe"), [".", `--remote-debugging-port=${PORT}`], { cwd: repo, stdio: "ignore" });
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page" && t.url.includes("index.html")); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

try {
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await sleep(3000);
  const ua = await evaluate("navigator.userAgent");
  check("renderer runs on Electron 45", /Electron\/45\./.test(ua), ua.match(/Electron\/[\d.]+/)?.[0]);

  const probe = (url, init) => `fetch(${JSON.stringify(url)}${init ? `, ${JSON.stringify(init)}` : ""}).then(async (r) => ({ status: r.status, type: r.headers.get("content-type"), range: r.headers.get("content-range"), bytes: (await r.arrayBuffer()).byteLength }), (e) => ({ error: String(e) }))`;
  const full = await evaluate(probe(`riuplay-media://unit/${unitId}`));
  check("riuplay-media:// serves an imported local file (full)", full.status === 200 && full.bytes === fs.statSync(wavFile).size && full.type === "audio/wav", full);
  const part = await evaluate(probe(`riuplay-media://unit/${unitId}`, { headers: { range: "bytes=0-99" } }));
  check("riuplay-media:// honours byte ranges", part.status === 206 && part.bytes === 100 && part.range === `bytes 0-99/${fs.statSync(wavFile).size}`, part);
  const cover = await evaluate(probe(`riuplay-media://cover/${mediaId}`));
  check("riuplay-media:// serves the cover image", cover.status === 200 && cover.type === "image/png", cover);
  const unknown = await evaluate(probe("riuplay-media://unit/999999999"));
  check("riuplay-media:// refuses unknown ids", unknown.status === 404, unknown);

  const dl = await evaluate(probe(`hibiki-download://local/${encodeURIComponent(downloadFile)}`));
  check("hibiki-download:// serves a file inside the downloads folder", dl.status === 200 && dl.type?.startsWith("text/vtt"), dl);
  const outside = await evaluate(probe(`hibiki-download://local/${encodeURIComponent("C:\\Windows\\win.ini")}`));
  check("hibiki-download:// refuses a file outside the downloads folder", outside.status === 403 || outside.status === 404, outside);
  const profile = await evaluate(probe("hibiki-profile://local/riuplay-p0-missing.png"));
  check("hibiki-profile:// answers (404 for a missing banner)", profile.status === 404, profile);

  // A fresh (isolated) profile shows the first-run onboarding over every page: go through it first.
  for (let i = 0; i < 6; i++) {
    const clicked = await evaluate(`(() => { const want = ["Get started", "Next", "Done", "Skip for now", "Continue"]; const b = [...document.querySelectorAll("button")].find((el) => want.includes(el.innerText.trim()) && !el.disabled); if (b) { b.click(); return true; } return false; })()`);
    if (!clicked) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await evaluate(`location.hash = "#/listen/${mediaId}/${unitId}"`);
  await sleep(1500);
  await evaluate(`(() => { const a = document.querySelector("audio"); if (a && a.paused) a.play(); return !!a; })()`);
  await sleep(2000);
  const audio = await evaluate(`(() => { const a = document.querySelector("audio"); return a ? { t: a.currentTime, src: a.currentSrc, err: a.error && a.error.code } : null; })()`);
  check("a local file plays through riuplay-media:// in the audio page", audio && audio.t > 0.5 && audio.src === `riuplay-media://unit/${unitId}` && !audio.err, audio);
  await evaluate(`location.hash = "#/"`);
  await sleep(800);

  const was = await evaluate("hibiki.window.isMaximized()");
  await evaluate("hibiki.window.toggleMaximize()");
  await sleep(800);
  const toggled = await evaluate("hibiki.window.isMaximized()");
  await evaluate("hibiki.window.toggleMaximize()");
  await sleep(800);
  const back = await evaluate("hibiki.window.isMaximized()");
  check("custom title-bar maximize/restore works", toggled === !was && back === was, { was, toggled, back });
} catch (error) {
  check(`verification crashed: ${error && error.stack ? error.stack : error}`, false);
} finally {
  ws.close();
  app.kill();
  await sleep(1500);
  db = new DatabaseSync(dbFile);
  db.prepare("DELETE FROM local_media WHERE id = ?").run(mediaId); // cascades to units/progress/library
  const left = db.prepare("SELECT count(*) AS n FROM local_media WHERE id = ?").get(mediaId).n;
  db.close();
  fs.rmSync(downloadFile, { force: true });
  if (createdDownloadsDir) fs.rmSync(downloadsDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  check("temporary title and files removed", left === 0 && !fs.existsSync(downloadFile));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
