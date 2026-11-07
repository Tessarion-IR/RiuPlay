// P0 verification: start a PACKAGED RiuPlay build and check it really works - window, Electron
// version, the native database module, IPC, the unified Home, the media protocol and the absence of
// listening sockets. Usage: node research/p0/smoke-packaged.mjs <path-to-RiuPlay.exe>
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const exe = process.argv[2];
const PORT = 9361;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logFile = path.join(process.env.APPDATA, "RiuPlay", "logs", "riuplay.log");
const app = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: "ignore" });
let target;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page" && t.url.includes("index.html")); } catch {}
}
check("packaged app starts and opens its window", !!target, target && target.title);
if (!target) { app.kill(); process.exit(1); }
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
  await sleep(3500);
  check("window title is RiuPlay", (await evaluate("document.title")) === "RiuPlay");
  const ua = await evaluate("navigator.userAgent");
  check("packaged build runs Electron 45.2.3", ua.includes("Electron/45.2.3"), ua.match(/Electron\/[\d.]+/)?.[0]);
  const list = await evaluate("hibiki.media.list().then((r) => ({ ok: Array.isArray(r), n: r.length }), (e) => ({ error: String(e) }))");
  check("database (better-sqlite3 N-API) answers over IPC", list.ok === true, list);
  const lib = await evaluate("hibiki.library.list().then((r) => ({ ok: Array.isArray(r) }), (e) => ({ error: String(e) }))");
  check("hibiki's library API answers", lib.ok === true, lib);
  await evaluate('location.hash = "#/"');
  await sleep(1500);
  const home = await evaluate("document.body.innerText");
  check("unified Home renders", /Add video/.test(home) && /Add manga/.test(home) && /Add audio/.test(home));
  const proto = await evaluate("fetch('riuplay-media://unit/999999999').then((r) => r.status, (e) => String(e))");
  check("riuplay-media:// protocol is registered in the packaged build", proto === 404, proto);
  const enabled = await evaluate("hibiki.sync.isEnabled()");
  check("LAN sync is off", enabled === false);
  const pid = app.pid;
  const tree = execFileSync("powershell", ["-NoProfile", "-Command", `$ids = @(${pid}) + (Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | Select-Object -ExpandProperty ProcessId); @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess }).Count + @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess }).Count`], { encoding: "utf-8" }).trim();
  // The DevTools port used by this test is itself a listener; it is the only one allowed.
  check("no listening sockets besides this test's DevTools port", Number(tree) <= 1, { listeners: Number(tree) });
} catch (error) {
  check(`smoke test crashed: ${error && error.stack ? error.stack : error}`, false);
} finally {
  ws.close();
  app.kill();
  await sleep(1500);
  try {
    const tail = fs.readFileSync(logFile, "utf-8").split(/\r?\n/).filter(Boolean).slice(-8);
    check("log has no errors", !tail.some((l) => / ERROR /.test(l)), tail);
  } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
