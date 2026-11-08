// Phase 8 acceptance (docs/PRODUCT_GAP_ANALYSIS.md §4): for Video, Manga and Audio, in the REAL
// app on an isolated profile, driven through the UI over the Chrome DevTools Protocol:
//   1. the built-in RiuPlay repository is visible under Sources;
//   2. the category's extension is installed from the UI (Install + the permission dialog);
//   3. its content appears in the right section with no further steps;
//   4. search and the title page work;
//   5. one real item is consumed in the native player/reader (bytes actually decoded);
//   6. progress is saved and the title shows in Continue Watching/Reading/Listening.
// The sources are RiuPlay's own built-in extensions, hitting the real, openly licensed services
// (Internet Archive, Pepper&Carrot, LibriVox), then the mandatory ecosystems (KikoFlu's asmr.one, Hibiki,
// Keiyoushi) - this needs network access.
//
// Usage: set RIUPLAY_USER_DATA_DIR=<empty temp dir> & node research/m8/verify-extension-slices.mjs <repoDir> [outDir]
// (refuses to run without RIUPLAY_USER_DATA_DIR, so a real profile is never used).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repo = process.argv[2];
const out = process.argv[3] ?? path.join(process.env.TEMP ?? ".", "riuplay-m8-shots");
if (!repo || !process.env.RIUPLAY_USER_DATA_DIR || !path.isAbsolute(process.env.RIUPLAY_USER_DATA_DIR)) {
  console.error("usage: RIUPLAY_USER_DATA_DIR=<absolute temp dir> node verify-extension-slices.mjs <repoDir> [outDir]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 9352;
const app = spawn(path.join(repo, "node_modules/electron/dist/electron.exe"), [".", `--remote-debugging-port=${PORT}`], { cwd: repo, stdio: "ignore" });
let target;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = list.find((t) => t.type === "page" && t.url.includes("index.html"));
  } catch { /* not up yet */ }
}
if (!target) { console.log("FAIL could not reach the app"); app.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
  return res.result?.result?.value;
};
const shot = async (name) => {
  const res = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(res.result.data, "base64"));
};
const go = async (hash, wait = 1500) => { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(wait); };
const text = () => evaluate("document.body.innerText");
const waitFor = async (expression, timeoutMs = 45_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const v = await evaluate(expression); if (v) return v; } catch { /* page changing */ }
    await sleep(500);
  }
  return null;
};
// Sections the user visited stay mounted (hidden) for instant switching: only VISIBLE elements count.
const VIS = `((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"))`;
const clickByText = (labels) => evaluate(`(() => { const want = ${JSON.stringify(labels)}; const b = [...document.querySelectorAll("button")].find((el) => want.includes(el.innerText.trim()) && !el.disabled); if (b) { b.click(); return b.innerText.trim(); } return null; })()`);

const SLICES = [
  { type: "video", name: "Internet Archive: Open Films & Animation", query: "chaplin", route: "play", continueText: "Continue Watching" },
  { type: "manga", name: "Pepper&Carrot", query: "witch", route: "read", continueText: "Continue Reading" },
  { type: "audio", name: "LibriVox Audiobooks", query: "alice", route: "listen", continueText: "Continue Listening" },
  // Phase 8 mandatory ecosystem: KikoFlu's content source (asmr.one), all-ages works by default.
  { type: "audio", name: "asmr.one (KikoFlu source)", query: "耳かき", route: "listen", continueText: "Continue Listening" },
];
const ONLY = process.env.SLICES ? process.env.SLICES.split(",") : null;
// Phase 8 mandatory ecosystem: Keiyoushi's manga extensions, run in the confined APK host (K1-K5). Arknights
// Comics is the publisher's own official comics site and reachable from where this was checked.
const KEIYOUSHI = { type: "manga", name: "Arknights Comics", query: "Prelude", route: "read", continueText: "Continue Reading", dialog: /sandbox/, dialogLine: /Runs Android[^\n]*/ };

try {
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);
  for (let i = 0; i < 6; i++) {
    const clicked = await clickByText(["Get started", "Next", "Done", "Skip for now", "Continue"]);
    if (!clicked) break;
    await sleep(1200);
  }

  // 1. The built-in repository is visible.
  await go("#/sources", 2500);
  await clickByText(["Repositories"]);
  const repoText = await waitFor(`document.body.innerText.includes("RiuPlay (built-in)") && document.body.innerText`, 20_000);
  check("1. Sources shows the built-in RiuPlay repository", Boolean(repoText));
  await shot("m8-01-repositories");
  await clickByText(["Extensions"]);
  await sleep(1500);

  async function runSlice(slice) {
    const label = `${slice.type[0].toUpperCase() + slice.type.slice(1)} [${slice.name.split(" ")[0]}]`;
    // 2. Install from the UI: the card's Install button, then the permission dialog.
    await go("#/sources", 2000);
    const listed = await waitFor(`document.body.innerText.includes(${JSON.stringify(slice.name)})`, 30_000);
    check(`${label} 2a. "${slice.name}" is listed with its media type`, listed);
    if (!listed) await shot(`m8-${slice.type}-fail-listing`);
    const pressed = await evaluate(`(() => {
      const name = ${JSON.stringify(slice.name)};
      const nodes = [...document.querySelectorAll("p, span, h3, div")].filter((n) => n.childElementCount === 0 && n.textContent.trim() === name);
      for (const n of nodes) {
        let card = n;
        for (let i = 0; i < 8 && card; i++, card = card.parentElement) {
          const b = [...card.querySelectorAll("button")].find((x) => x.innerText.trim() === "Install" && !x.disabled);
          if (b) { b.click(); return true; }
        }
      }
      return false;
    })()`);
    const dialog = pressed && (await waitFor(`document.querySelector('[data-testid="accept-permissions"]') && document.body.innerText`, 10_000));
    const wanted = slice.dialog ?? /Connects only to/;
    check(`${label} 2b. Install opens the permission dialog ${slice.dialog ? "saying how it is confined" : "listing the hosts"}`, dialog && wanted.test(dialog), dialog ? dialog.match(slice.dialogLine ?? /Connects only to:[^\n]*/)?.[0] : "no dialog");
    await evaluate(`document.querySelector('[data-testid="accept-permissions"]')?.click()`);
    const installed = await waitFor(`hibiki.sources.list().then((l) => l.some((s) => s.name === ${JSON.stringify(slice.name)}))`, slice.dialog ? 120_000 : 30_000);
    check(`${label} 2c. The extension is installed and enabled`, installed);

    // 3. Its content appears in the section by itself.
    await go(`#/${slice.type}`, 2500);
    // Wait out the page transition: the previous section stays mounted while it animates away.
    await waitFor(`${VIS}('[data-testid="from-extensions"]').length === 1 && ${VIS}('[data-testid="provider-chip"]').some((c) => c.innerText.trim() === ${JSON.stringify(slice.name)})`, 30_000);
    const titles = await waitFor(`${VIS}('[data-testid="provider-title"]').length`, 60_000);
    check(`${label} 3. The ${slice.type} section shows titles from the new source`, titles > 0, `${titles ?? 0} titles`);
    await shot(`m8-${slice.type}-02-section`);

    // 4. Search, then the title page.
    await evaluate(`(() => { const input = ${VIS}('[data-testid="provider-search"]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, ${JSON.stringify(slice.query)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.form.requestSubmit(); })()`);
    await sleep(1500);
    const found = await waitFor(`(() => { const t = ${VIS}('[data-testid="provider-title"]'); return t.length ? t.map((x) => x.title).slice(0, 3).join(" | ") : null; })()`, 60_000);
    check(`${label} 4a. Search "${slice.query}" returns results`, Boolean(found), found ?? "none");
    await evaluate(`${VIS}('[data-testid="provider-title"]')[0].click()`);
    const mediaId = Number(await waitFor(`(location.hash.match(/#\\/media\\/(\\d+)/) || [])[1]`, 60_000));
    const details = mediaId ? await evaluate(`hibiki.media.get(${mediaId})`) : null;
    check(`${label} 4b. Opening a result shows its RiuPlay title page`, details && details.item.origin === "extension" && details.units.length > 0, details ? `${details.item.title} (${details.units.length} units)` : "no title");
    await sleep(1500);
    await shot(`m8-${slice.type}-03-title`);
    if (!details) return;

    // 5. Consume one unit in the native player/reader.
    const unit = details.units[0];
    await go(`#/${slice.route}/${mediaId}/${unit.id}`, 3000);
    let consumed = null;
    if (slice.type === "manga") {
      consumed = await waitFor(`(() => { const imgs = [...document.querySelectorAll("img")].filter((i) => i.src.startsWith("riuplay-media://ext/") && i.complete && i.naturalWidth > 0); return imgs.length ? imgs.length + " pages decoded, first " + imgs[0].naturalWidth + "x" + imgs[0].naturalHeight : null; })()`, 60_000);
      // Scroll through the chapter so the reader records progress.
      await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
      for (let i = 0; i < 4; i++) { await evaluate(`(document.scrollingElement || document.body).scrollBy(0, 2000); document.querySelectorAll("main, [class*=overflow-y]").forEach((el) => el.scrollBy && el.scrollBy(0, 2000))`); await sleep(700); }
    } else {
      const tag = slice.type === "video" ? "video" : "audio";
      await evaluate(`(() => { const m = ${VIS}("${tag}")[0] || document.querySelector("${tag}"); if (m) { m.muted = true; m.play().catch(() => {}); } })()`);
      consumed = await waitFor(`(() => { const m = document.querySelector("${tag}"); return m && m.currentTime > 2 && m.readyState >= 2 ? "${tag} at " + m.currentTime.toFixed(1) + "s of " + Math.round(m.duration) + "s, src " + (m.currentSrc || "").slice(0, 40) : null; })()`, 90_000);
      await sleep(4000);
    }
    check(`${label} 5. A real ${slice.type} item plays/reads in the native ${slice.route === "read" ? "reader" : "player"}`, Boolean(consumed), consumed ?? "nothing decoded");
    await shot(`m8-${slice.type}-04-consume`);

    // 6. Progress is saved and the title is in Continue ...
    await go(`#/${slice.type}`, 2500);
    const after = await evaluate(`hibiki.media.get(${mediaId})`);
    const progress = after.progress.find((p) => p.unitId === unit.id);
    const continuing = await evaluate(`hibiki.media.continueList(${JSON.stringify(slice.type)}).then((l) => l.some((e) => e.item.id === ${mediaId}))`);
    const sectionText = await text();
    check(`${label} 6. Progress is saved and the title is in ${slice.continueText}`, progress && progress.position > 0 && continuing && sectionText.includes(slice.continueText), progress ? `position ${progress.position}` : "no progress");
    await shot(`m8-${slice.type}-05-continue`);
  }

  for (const slice of SLICES.filter((x) => !ONLY || ONLY.some((o) => x.name.toLowerCase().includes(o.toLowerCase())))) await runSlice(slice);

  // Phase 8 mandatory ecosystem: Hibiki's anime sources - one click from the catalog, no address typed.
  if (!ONLY || ONLY.includes("hibiki")) {
    const label = "Anime [Hibiki]";
    await go("#/sources", 2000);
    await clickByText(["Repositories"]);
    await waitFor(`document.body.innerText.includes("Hibiki anime sources")`, 20_000);
    const added = await evaluate(`(() => { const name = [...document.querySelectorAll("p")].find((p) => p.innerText.trim() === "Hibiki anime sources"); let card = name; for (let i = 0; i < 6 && card; i++, card = card.parentElement) { const b = [...card.querySelectorAll("button")].find((x) => x.innerText.trim() === "Add repository" && !x.disabled); if (b) { b.click(); return true; } } return false; })()`);
    const listed = added && (await waitFor(`hibiki.sources.repositories.list().then((l) => l.some((u) => u.includes("hibiki-sources")))`, 60_000));
    check(`${label} 1-2a. Hibiki's repository is added with one click from Discover`, listed);
    await clickByText(["Extensions"]);
    const ids = await evaluate(`hibiki.sources.repositories.list().then((u) => hibiki.sources.marketplace(u)).then((r) => r.filter((x) => x.url.includes("hibiki-sources")).flatMap((x) => x.ok ? x.extensions : []).filter((e) => e.type === "source" && !e.isNsfw && e.lang === "en").map((e) => e.name))`);
    check(`${label} 2b. Its English anime sources are listed under Extensions`, ids?.length > 0, ids?.join(", "));
    let opened = null;
    for (const name of ids ?? []) {
      await go("#/sources", 1500);
      await waitFor(`document.body.innerText.includes(${JSON.stringify(name)})`, 20_000);
      await evaluate(`(() => { const nodes = [...document.querySelectorAll("p, span, h3, div")].filter((n) => n.childElementCount === 0 && n.textContent.trim() === ${JSON.stringify(name)}); for (const n of nodes) { let card = n; for (let i = 0; i < 8 && card; i++, card = card.parentElement) { const b = [...card.querySelectorAll("button")].find((x) => x.innerText.trim() === "Install" && !x.disabled); if (b) { b.click(); return true; } } } return false; })()`);
      await waitFor(`document.querySelector('[data-testid="accept-permissions"]')`, 10_000);
      await evaluate(`document.querySelector('[data-testid="accept-permissions"]')?.click()`);
      const ok = await waitFor(`hibiki.sources.list().then((l) => l.some((s) => s.name === ${JSON.stringify(name)}))`, 60_000);
      if (!ok) continue;
      await go("#/video", 2500);
      await evaluate(`${VIS}('[data-testid="provider-chip"]').find((c) => c.innerText.trim() === ${JSON.stringify(name)})?.click()`);
      const count = await waitFor(`${VIS}('[data-testid="from-extensions"]').length === 1 && ${VIS}('[data-testid="provider-title"]').length`, 60_000);
      if (!count) { console.log(`  (${name}: no titles, trying the next source)`); continue; }
      check(`${label} 3. Video section shows titles from "${name}"`, true, `${count} titles`);
      await shot("m8-hibiki-01-video");
      await evaluate(`${VIS}('[data-testid="provider-title"]')[0].click()`);
      opened = await waitFor(`location.hash.startsWith("#/anime/") && location.hash`, 30_000);
      const episodes = opened && (await waitFor(`/Episode|Серия|Серія|EP\s?\d/i.test(document.body.innerText) && document.body.innerText.length`, 60_000));
      check(`${label} 4. A title opens on the native anime title page with its episodes`, Boolean(episodes), opened || "no title page");
      await shot("m8-hibiki-02-title");
      break;
    }
    if (!opened) check(`${label} 3-4. Some installed Hibiki source returned titles`, false);
  }

  if (!ONLY || ONLY.includes("keiyoushi")) {
    const label = "Manga [Keiyoushi]";
    await go("#/sources", 2000);
    await clickByText(["Repositories"]);
    await waitFor(`document.body.innerText.includes("Keiyoushi manga extensions")`, 20_000);
    const added = await evaluate(`(() => { const name = [...document.querySelectorAll("p")].find((p) => p.innerText.trim() === "Keiyoushi manga extensions"); let card = name; for (let i = 0; i < 6 && card; i++, card = card.parentElement) { const b = [...card.querySelectorAll("button")].find((x) => x.innerText.trim() === "Add repository" && !x.disabled); if (b) { b.click(); return true; } } return false; })()`);
    const listed = added && (await waitFor(`hibiki.sources.repositories.list().then((l) => l.some((u) => u.includes("keiyoushi")))`, 90_000));
    check(`${label} 1. Keiyoushi's repository is added with one click from Discover`, listed);
    const offered = await evaluate(`hibiki.sources.repositories.list().then((u) => hibiki.sources.marketplace(u)).then((r) => r.filter((x) => x.url.includes("keiyoushi")).map((x) => x.ok ? x.extensions.length + " extensions, signer " + (x.extensions[0]?.signingFingerprint ?? "?").slice(0, 12) : "error: " + x.error)[0])`);
    check(`${label} 2. Its extensions are read from the v2 (protobuf) index`, /^\d{3,} extensions/.test(offered ?? ""), offered);
    await clickByText(["Extensions"]);
    await runSlice({ ...KEIYOUSHI, name: KEIYOUSHI.name });
  }
} catch (error) {
  check("run completed without an exception", false, String(error?.stack ?? error).slice(0, 400));
} finally {
  ws.close();
  app.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
