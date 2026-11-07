# P0: Electron Upgrade (34.5.8 → 45.2.3)

Date: 2026-11-08. Scope: **Electron upgrade only.** No Phase 7 milestone (M1–M5), sandbox or Job Object work was done. No security setting was changed, and no extension behaviour was touched.

## 1. Versions before and after

| Component | Before | After | Why |
|---|---|---|---|
| **Electron** | 34.5.8 (Chromium 132.0.6834.210, Node 20.19.1, module ABI 132) | **45.2.3** (Chromium 156.0.8078.80, Node 24.22.2, V8 15.6, module ABI 150), pinned exactly | Electron 34 is out of security support. 45.2.3 is the latest stable on 2026-11-08 (npm `latest`; 46 is alpha only) |
| **better-sqlite3** (the only native module) | 11.10.0 (compiled per Electron ABI; no binary exists for ABI 150) | **13.0.3** | 13.x is built on **N-API**: one prebuilt `prebuilds/win32-x64.node` works across Electron versions. No C++ toolchain on this machine, so compiling 11.x/12.x for ABI 150 was impossible. 12.12.0's prebuilds stop at ABI 148 |
| `@electron/get` (transitive, from electron) | 2.0.3 | 5.1.0 | Comes with Electron 45 |
| SQLite (inside better-sqlite3) | 3.4x | 3.53.4 | Comes with better-sqlite3 13. Database files stay compatible (verified, §5) |
| Removed transitively (37) | `prebuild-install`, `tar-fs`, `simple-get`, `rc`, `bindings`, `global-agent`, `extract-zip`, … | — | No longer needed by better-sqlite3 13 / Electron 45 |
| Added transitively (1) | — | `@electron-internal/extract-zip` 1.0.8 | Electron 45's own downloader |
| Unchanged | electron-builder 25.1.8, @electron/rebuild 4.2.0, vite-plugin-electron 0.29.1, vite-plugin-electron-renderer 0.14.7, drizzle-orm 0.45.4, @types/better-sqlite3 7.6.13 | | Worked as-is |

`npm audit --omit=dev`: **0 vulnerabilities** (unchanged). Full audit (dev tooling): 23, down from 39 at Phase 4.

## 2. Configuration changes (all required)

| File | Change | Reason |
|---|---|---|
| `package.json` | `electron` → `45.2.3` (exact); `better-sqlite3` → `^13.0.3` | §1 |
| `package.json` scripts | Removed `postinstall` and `rebuild:electron` (both `electron-rebuild -f -o better-sqlite3`). Added `electron:install` (`install-electron`) | Rebuilding is unnecessary with N-API and would fail without a compiler. **Electron ≥ 44 no longer downloads its binary in its own postinstall**: it downloads it (checksum-verified) the first time `require('electron')` / `npx electron` runs, or explicitly with `npm run electron:install` |
| `.npmrc` (new) | `ignore-scripts=true` | npm 10.9 runs an implicit `node-gyp rebuild` for any package containing `binding.gyp`, **ignoring better-sqlite3's `"gypfile": false`**, so a clean `npm ci` failed on a machine without a C++ toolchain. No package in the tree needs an install script (esbuild resolves its binary from optional dependencies; fsevents is macOS-only). This is the same supply-chain hardening Electron adopted in v44. Scripts run by name (`npm run …`, `npm test`) are unaffected |
| `electron-builder.yml` | `npmRebuild: false` | Same reason: nothing to rebuild, and no toolchain |

**No application source file changed.** (`src/`, preload, IPC and BrowserWindow settings are untouched.)

## 3. Electron breaking changes reviewed (35.0 → 45.0)

Source: Electron's own `docs/breaking-changes.md` at tag `v45.2.3`. Every item that could touch RiuPlay was checked against the code:

| Change | Version | RiuPlay impact |
|---|---|---|
| Sandboxed preloads lose Node shims (`events`, `timers`, `url`) and `Buffer`/`setImmediate` | 45 | **None.** The preload bundle (`dist-electron/preload/index.mjs`) only does `require("electron")`; no `Buffer`/`setImmediate`. Verified |
| `ipcRenderer`/`process` use a native EventEmitter in sandboxed preloads | 45 | None (same instance API) |
| Synchronous `safeStorage` methods **deprecated** (removed in 46) | 45 | `platform/electron/secureStore.ts` uses them. **Still work in 45** (M0 verified on 45.2.3). **Must move to the async API before Electron 46.** Not changed in P0 (credential handling is out of scope) |
| ASAR: `fs.open` descriptors no longer back a temp copy | 45 | None found. The packaged app (native module inside `app.asar`) starts and uses the database. Recommendation in §7 |
| `window.open()` children of unsandboxed windows get their own process | 45 | None (all windows sandboxed; popups denied) |
| Electron no longer downloads itself in `postinstall` | 44 | Handled (§2) |
| `clipboard` removed from renderers | 44 | None (the renderer has no Electron access) |
| Dialogs default to the **Downloads** folder | 43 | **Behaviour change:** the file picker (Add Media, backups) now opens in Downloads instead of the last-used folder. Not altered in P0; follow-up: remember the last folder |
| `ProtocolResponse.session = null` removed | 37 | None (`protocol.handle` + `Response` everywhere) |
| `app.commandLine` lower-cases switches | 36 | None |
| `console-message` positional arguments deprecated | 35 | `main/index.ts:219` uses them. Deprecated, still supported in 45 and still typed (type-check clean). Follow-up: switch to the event-object form |
| `WebRequestFilter` empty `urls` no longer means all | 35 | None (all filters use explicit patterns or none) |
| Custom protocol URLs with Windows paths (non-special schemes) | 32/35 | None: RiuPlay's schemes are `standard` and use `protocol.handle`. **Verified in the running app** (§4.3) |

## 4. Test results

### 4.1 Automated

| Check | Result |
|---|---|
| Clean `npm ci` (802 packages) | ✅ 16 s, no compiler needed |
| Electron binary first-use download | ✅ (checksum-verified by Electron's installer) |
| better-sqlite3 in Electron 45 | ✅ loads (ABI 150, SQLite 3.53.4) |
| Type-check (`tsc -b`) against Electron 45 typings | ✅ clean |
| Main/core tests (Node 22), 3 consecutive runs | ✅ 481 passed, 18 skipped (unchanged from before) |
| Renderer tests, 3 runs | ✅ 319/319 |
| Network-broker research tests | ✅ 95/95 |
| Production build (`vite build`) | ✅ |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |

### 4.2 Real app on Electron 45 (development build)

| Check | Result |
|---|---|
| Plain startup (no interaction): window "RiuPlay", log clean, no stderr output, **0 TCP / 0 UDP listeners** | ✅ |
| Database after startup vs before the upgrade: **25/25 migration records identical (hash + timestamp), schema identical, all 22 tables byte-identical**, integrity ok, no pre-migration backup created | ✅ |
| Phase 6 end-to-end suite (onboarding, unified Home, sidebar, add three types, dedupe, `file://` refusal, forged-path refusal, Audio section, details, audio playback + auto-next + completion + status change, manga reader + page progress, Continue rows, Recently added, video player, **real video playback, save on pause, resume**, Collections, Library, Discover) | ✅ **25/25** |

### 4.3 Protocols and window controls (`research/p0/verify-protocols-and-window.mjs`)

| Check | Result |
|---|---|
| Renderer reports `Electron/45.2.3` | ✅ |
| `riuplay-media://` serves an imported local file, with byte ranges (206) and the cover; unknown ids → 404 | ✅ |
| A local file **plays** through `riuplay-media://` on the audio page | ✅ |
| `hibiki-download://` serves inside the downloads folder; `C:\Windows\win.ini` → **403** | ✅ |
| `hibiki-profile://` answers (404 for a missing banner) | ✅ |
| Custom title-bar maximize/restore | ✅ |
| Temporary title and files removed afterwards | ✅ |

**11/11.**

### 4.4 Windows packaging (`npm run build:win`)

| Output | Result |
|---|---|
| `release/RiuPlay-v0.1.0-setup.exe` (NSIS, per-user, one-click) | ✅ 154 MB |
| `release/RiuPlay 0.1.0.exe` (portable) | ✅ 154 MB |
| `release/win-unpacked/RiuPlay.exe` | ✅ Electron 45.2.3, product "RiuPlay", version 0.1.0, RiuPlay icon |
| Migrations shipped (`resources/migrations`, 25 files) | ✅ |
| Code signing | Not signed (no certificate), as expected for a local build |
| Optional APK host bundle | Absent (by design: built separately) |

**Packaged app smoke test** (`research/p0/smoke-packaged.mjs` on `win-unpacked\RiuPlay.exe`): **10/10**.
- It starts, the title is RiuPlay, and it runs Electron 45.2.3.
- **better-sqlite3 works from the packaged app.**
- hibiki's library API answers, the unified Home renders, and `riuplay-media://` is registered.
- LAN sync is off, there are no listeners except the test's own DevTools port, and the log has no errors.

**Final database check** after every run (startup, 25-check end-to-end, protocol checks, packaged app): migration records 25/25 identical, schema identical, all 22 tables unchanged, integrity ok, **no migration re-run**.

## 5. Environment notes (this machine, not the repository)

- **electron-builder's `winCodeSign` cache.** On the first packaging attempt, extracting electron-builder's `winCodeSign-2.6.0.7z` (needed to stamp RiuPlay's icon and version into the .exe) failed: the archive contains macOS symlinks, and Windows only allows symlinks with admin rights or Developer Mode.
  - **This is unrelated to Electron 45.** The project had simply never been packaged before.
  - **Fix used:** I extracted the same archive into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` without its `darwin/` folder. Developer Mode was not enabled, and executable editing was not disabled.
  - **Archive verification:** 4 independent downloads gave an identical SHA-256 (`cdaec715…43a4`), and the size matched the official release asset (5,635,384 bytes). GitHub publishes no digest for that older asset.
  - **Other machines:** contributors will hit the same issue. A durable fix (documented setup step, or an electron-builder upgrade) belongs to the Phase 14 build work.
- **Registry.** Running the *packaged* app registered `riuplay://` under `HKCU\Software\Classes\riuplay`, pointing at `release\win-unpacked`. That's by design for packaged builds. The key did not exist before; it was **removed after the test**.
- `%APPDATA%\hibiki-desktop` was **not read or touched**. `%APPDATA%\Electron` was **not touched** (last modified during M0). Proxy settings and credentials were **not read**.

## 6. Regressions and unresolved issues

| Item | Severity | Status |
|---|---|---|
| File dialogs open in Downloads instead of the last-used folder (Electron 43 behaviour) | Low (UX) | Open. Follow-up: remember the last folder |
| Synchronous `safeStorage` deprecated, removed in Electron 46 | Medium (future) | Open: must migrate before the next major Electron |
| `console-message` positional arguments deprecated | Low | Open: switch to the event-object form |
| Native module packed inside `app.asar` (works via Electron's temporary extraction) | Low | Recommendation: `asarUnpack` for `node_modules/better-sqlite3/prebuilds/*.node` (not strictly required, so not changed in P0) |
| `app.asar` is 255 MB: production `dependencies` (renderer libraries already bundled by Vite) are also copied in | Low (size) | Pre-existing hibiki configuration. Phase 14 packaging work |
| `@electron/rebuild` devDependency no longer used by any script (electron-builder notes the duplicate) | Cosmetic | Left in place (not required to remove) |
| `winCodeSign` symlink extraction on Windows without Developer Mode | Build environment | Worked around locally (§5); Phase 14 |
| `platform/electron/paths.ts` still names `hibiki.db` (pre-existing rebrand leftover; used only by the unshipped Android path) | Cosmetic | Open |
| Real-world features not covered by automation: native file picker click-through, notifications, deep links from other apps, installing via the NSIS installer, self-update | — | Not exercised in P0 (the installer was built, not installed) |

## 7. Recommendations for later (not done in P0)
1. Migrate `secureStore` to `safeStorage.*Async` before Electron 46.
2. Add `asarUnpack` for better-sqlite3's prebuilt binary.
3. Remember the last folder in file dialogs.
4. Address the `winCodeSign` symlink issue for contributors (Phase 14).
