# Reference Repository Audit

All four repositories were cloned and their source inspected (manifests, entry points, core modules). Every claim below points to a file that was actually read. Paths are relative to each repo root.

---

## 1. Hibiki Desktop — `akkirrai1337/hibiki-desktop` (v3.0.0)

**Important finding:** `akkirrai1337/hibiki` (v3.3.0) is the **same codebase, newer**. `hibiki` contains every file in `hibiki-desktop/src` plus 40+ additional files (APK host, HTTP cache, network config, new-episode checker, skip times, more tests). It also builds the Electron desktop app (same `electron-builder.yml`). **For engineering purposes `hibiki` supersedes `hibiki-desktop`**, so the details are under §2.

| Aspect | Finding |
|---|---|
| License | **GPL-3.0-only** (`package.json` `"license"`, `LICENSE`). |
| Size | ~277 TS/TSX files, ~39.7k lines in `src/`. |

---

## 2. Hibiki — `akkirrai1337/hibiki` (v3.3.0)

| Aspect | Finding (source) |
|---|---|
| Languages | TypeScript (desktop + shared), Kotlin/Java (Android app + `apk-host/`). |
| Frameworks | Electron 34, React 19, Vite 6 (`vite-plugin-electron`), TanStack Router + Query + Virtual, Zustand, Radix UI, Tailwind 3, motion, i18next. Capacitor 8 for Android. |
| Build | `tsc -b && vite build && electron-builder` → **NSIS installer** on Windows (`electron-builder.yml`). Migrations shipped as `extraResources`. |
| Database | **SQLite via better-sqlite3 + Drizzle** (`src/core/db/schema.ts`; 23 SQL migrations in `src/core/db/migrations`). Tables: library, watch_progress, daily_activity, source_repositories, xp_events, downloaded_episodes, cached_anime, cached_playback_groups, title_ratings, sync_*, tracker_links. |
| Entry points | `src/main/index.ts` (main), `src/preload/index.ts` (contextBridge), `src/renderer/src` (React). |
| Layering | `src/core` = platform-independent domain (api/, db/, extensions/, sync/, tracking/), `src/platform/{contract,electron,android}` = ports and adapters, `src/shared` = types + IPC API (`hibikiApi.ts`). This is a clean hexagonal split. |
| Electron security | Main window: `contextIsolation: true, nodeIntegration: false, sandbox: true` (`main/index.ts:156`). Helper windows are sandboxed too. |
| Extension system | Scripted JS sources from "hibiki-sources" repos: `repository/index.json` + `<id>.manifest.json` + `<id>.js` (`core/marketplace.ts`). The manifest has id, name, version, lang, isNsfw, capabilities, resolverDependencies and settings. Runs in **`worker_threads` + `node:vm` contexts** (`platform/electron/extensionHost.ts`, `main/extensions/execute.ts`), with a synchronous host bridge over Atomics, a worker pool with idle TTL, 30 s timeouts, resolver health/decay and Cloudflare challenge windows. |
| Extension security caveat | `node:vm` is **not a security boundary** (Node docs). A malicious script can escape to the worker's Node context. Repositories must be HTTPS, but nothing is signed or hashed. |
| Aniyomi APK sources | `apk-host/` is a **JVM process with Android API shims** (`android/app/*.java`, …) that loads Aniyomi extension APKs and is spoken to over loopback HTTP with a random token (`platform/electron/apkHost.ts`). It needs a Java runtime, bundled or found on PATH. Credits Anikku/yuzono code (**Apache-2.0**). |
| Discovery | Search with filter catalog (select/multi/tristate/text/range), latest, popular, details, related, comments, reviews (`core/extensions/runtime.ts`, `methods.ts`). |
| Playback | `features/player/VideoPlayer.tsx` (2,857 lines): **HTML5 `<video>` + hls.js + dash.js**, MP4, opening/ending skip, quality and speed, subtitle delay (`lib/subtitleDelay.ts`), autoplay next, error recovery across hls/dash/native. **No libmpv.** |
| Library / history | `core/api/library.ts`: statuses, favourites, progress, history, stats, achievements/XP. |
| Downloads | `core/api/downloads.ts` (453 lines) + tests: concurrent queue (`maxDownloads`), HLS segment downloads, subtitles. |
| Network | `core/extensions/netFetch.ts`, `core/networkConfig.ts`: timeout, proxy string, DoH option, traffic tally, HTTP cache. Redirects `follow`; **no private-IP/SSRF guard found**. |
| Sync | LAN device sync with pairing (`core/sync/*`). |
| Tracking | AniList tracker (`core/tracking/anilist.ts`, needs a build-time client id via `scripts/buildSecret.ts`). |
| Other | Discord RPC, deep links `hibiki://`, offline cache, onboarding, i18n (en/ru). |
| Tests | **82 Vitest test files** (core + platform), plus Playwright e2e. |
| UI | Sidebar + Hero + catalog grids + Spotlight search + bottom sheets. Polished and anime-focused. |
| Reusable | Almost the whole desktop shell: main/preload/IPC pattern, SQLite+migrations runner, extension marketplace, worker host, player, downloads, settings/profile pages, build config. |
| Incompatible / not wanted | Anime-only domain types (`AnimeTitle`, `PlaybackGroup`), achievements/XP (optional), AniList secret, Android/Capacitor tree. |
| License | **GPL-3.0-only**. Bundled APK-compat portions Apache-2.0 (GPLv3-compatible). |

---

## 3. KikoFlu — `pa-jesusf/KikoFlu`

| Aspect | Finding |
|---|---|
| What it is | A **Flutter** client for "doujin voice" (ASMR) works from self-hosted **Kikoeru** servers (`README_EN.md`). |
| Languages | Dart (370 files), platform runners (Windows/macOS/Linux/Android/iOS). |
| Key deps (`pubspec.yaml`) | `media_kit` (**libmpv**) + `just_audio` + `just_audio_media_kit` (locally patched in `third_party/`), `audio_service`, `smtc_windows` (Windows media transport controls), `dio`, riverpod/provider. |
| Player | `lib/src/services/audio_player_service.dart` (1,558 lines): queue building (`audio_track_queue_builder.dart`), playback plan, session restore (`playback_session_store.dart`), gain settings, SMTC integration. |
| Subtitles / lyrics | A large subsystem: `subtitle_library_service.dart` (2,046), `subtitle_matching.dart`, `subtitle_match_loader.dart`, `subtitle_database.dart`, `floating_lyric_service.dart`. It matches LRC/VTT/SRT files to tracks by name rules, keeps a local subtitle library and shows floating lyrics. |
| Caching | `cache_service.dart` (1,220), `caching_stream_audio_source.dart` (stream-while-caching). |
| Proxy | `proxy_config.dart`. |
| Downloads | `download_service.dart` (1,837): queue, path service, state scanner. |
| History | `playback_history_service.dart` / `_store.dart`, `history_database.dart`. |
| Reuse | **No code can be reused directly** (Dart/Flutter vs TS/Electron). Reuse means **re-implementing algorithms and patterns**: queue builder, subtitle↔track matching rules, playback-session restore, stream caching, SMTC (Electron gets SMTC through the `navigator.mediaSession` API). |
| License | **GPL-3.0**. Even a faithful *translation* of its code is a derivative work, so if RiuPlay ports its algorithms closely, RiuPlay must be GPL-3.0 (consistent with adopting Hibiki). |

---

## 4. Suwayomi Server — `Suwayomi/Suwayomi-Server`

| Aspect | Finding |
|---|---|
| What it is | A Kotlin/JVM server that runs **Tachiyomi/Mihon manga extensions (APK → JAR via dex2jar)** and exposes REST + GraphQL + WebUI. |
| Languages | Kotlin (667), Java (292, `AndroidCompat/` shims). Gradle build. |
| Extension lifecycle | `server/.../manga/impl/extension/Extension.kt` (802 lines): download APK → verify **lib-version range** (`LIB_VERSION_MIN..MAX`, line 402) → dex2jar → parse AndroidManifest → extract icon/assets → load classes → register sources. Also uninstall, update and deferred file deletion on startup. |
| Repositories | `ExtensionsList.kt`, `github/NetworkExtensionStore.kt`, `NetworkLegacyExtensionRepo.kt`: fetch `index.min.json` per repo, diff installed vs available, flag `hasUpdate`/`obsolete`. |
| Backup | `manga/impl/backup/` (Mihon protobuf backup compatibility). |
| Reuse | **Not as code.** Two kinds of reuse: (a) **as a service**: RiuPlay already has a REST client for a user-run Suwayomi server, which is the legitimate way to get manga sources; (b) **as design**: lib-version compatibility windows, update/obsolete detection, deferred deletion, repository diffing. Those ideas are applied to RiuPlay's own extension spec. |
| License | **MPL-2.0** (file-level copyleft). Copying no files triggers no obligations. Calling its HTTP API creates no derivative work. |

---

## 5. Cross-repo comparison

| Capability | RiuPlay (local) | Hibiki | KikoFlu | Suwayomi |
|---|---|---|---|---|
| Desktop shell | ❌ (web server) | ✅ Electron | ✅ Flutter | ❌ (server + WebUI) |
| Local DB | Postgres ❌ | SQLite ✅ | SQLite (sqflite) ✅ | H2/Postgres |
| Content types | anime/manga/audio (model only) | anime | audio (ASMR) | manga |
| Executable extensions | ❌ | ✅ JS + APK host | ❌ (Kikoeru API) | ✅ APK→JAR |
| Video player | basic HTML5+hls | ✅ advanced HTML5/hls/dash | media_kit (libmpv) | – |
| Audio player | basic | – | ✅ advanced | – |
| Subtitles | single URL | delay, tracks | ✅ library + matching + lyrics | – |
| Downloads | basic | ✅ queue, HLS | ✅ | ✅ chapters |
| SSRF protection | ❌ | ❌ | n/a | n/a |
| Tests | 0 | 82 files | some | yes |
| License | none | GPL-3.0-only | GPL-3.0 | MPL-2.0 |
