# RiuPlay Feature Integration Matrix

Status: **living document**. Last full review: 2026-11-07, at commit `e189e48`. Phase 6 rows updated 2026-11-08, at commit `6bde960`. The architecture is **not complete** until every row below is either "Done" or deliberately "Excluded".

RiuPlay is one product built from four inputs:

| Input | What it brings to RiuPlay | Tech | License |
|---|---|---|---|
| **Original RiuPlay** (`legacy/next-app/`) | Product identity. Anime, manga and audio in one model. Direct-URL, manual and local media. Suwayomi server client. Proxy settings including SOCKS5. Honest "no fake content" UX. Backup format. | Next.js, Postgres | GPL-3.0 (owner's code) |
| **Hibiki** (v3.3.0 @ `132a71e`) | Desktop infrastructure: Electron shell, SQLite with migrations, scripted-extension runtime, APK host, video player, downloads, library, history, tests | Electron, TS | GPL-3.0-only |
| **KikoFlu** (@ `d8a8c61`) | Audio experience: queue, loop and shuffle, sleep timer, session restore, gain, synced lyrics and subtitles, subtitle library and matching, stream caching, Kikoeru server client | Flutter, Dart | GPL-3.0 |
| **Suwayomi-Server** (@ `7b061be`) | Source and extension lifecycle: repository store, update and obsolete detection, version compatibility window, deferred deletion, library update scheduler, categories, chapter downloads, backups, tracking | Kotlin | MPL-2.0 |

## How to read the matrix

**Integration modes:**
- **Reuse:** the code is in the repo, adapted. Only possible from GPL-compatible TypeScript, which in practice means Hibiki and the original RiuPlay.
- **Port:** the original RiuPlay's own code is moved into the Electron architecture.
- **Reimplement:** the behaviour is rebuilt in TypeScript from studying the reference. Origin is credited in the file header. For KikoFlu (GPL-3.0) a close translation is a derivative work, which is fine because RiuPlay is GPL-3.0. For Suwayomi (MPL-2.0), only ideas and designs are taken and no files are copied.
- **Service:** RiuPlay talks to the reference's server over its public API. The user runs that server.
- **Exclude:** deliberately not taken. The reason is given.

**Status:**
- ✅ Done (in the running app and tested)
- 🟡 Partial
- 🔴 Not started

The **Unified as** column says how each row fits RiuPlay's single model, so nothing ships as a disconnected module.

---

## 1. Platform and infrastructure

| Feature | Orig. RiuPlay | Hibiki | KikoFlu | Suwayomi | Decision | Unified as | Status |
|---|---|---|---|---|---|---|---|
| Desktop shell, secure window, IPC | web server | ✅ Electron, sandboxed renderer | Flutter desktop | server + WebUI | **Reuse** Hibiki | Main process + typed preload API | ✅ |
| Local DB + migrations | Postgres, no migrations | ✅ SQLite + drizzle | sqflite | H2/Postgres + Exposed | **Reuse** Hibiki, **port** RiuPlay model | One SQLite DB, `riuplay.db` | ✅ (0023 merged schema) |
| Pre-migration backups | – | – | – | – | RiuPlay original | `backups/pre-migration` | ✅ |
| App settings readable by main process | `settings` table | renderer localStorage | SharedPreferences | server config | **Port** RiuPlay concept | `app_settings` table | 🟡 (LAN sync only) |
| Logging + export | console | ✅ file log + export | ✅ in-app log + export | file log | **Reuse** Hibiki, **reimplement** KikoFlu's in-app log viewer | One log, viewable in Settings | 🟡 |
| HTTP client with timeouts and size caps | ✅ `safeFetch` | ✅ `netFetch` | dio | OkHttp | **Port** RiuPlay caps into Hibiki netFetch | `main/net/client.ts` (M3): body/decoded caps, deadlines, per-caller budgets | ✅ |
| SSRF protection (private IP, DNS, redirects) | – | – | – | – | RiuPlay original (new) | `main/net/client.ts` (M3): all main-process requests; Chromium-side requests are M2 | ✅ |
| Proxy HTTP/HTTPS | ✅ | ✅ (string) | ✅ `proxy_config` | ✅ | **Port** RiuPlay model | One pinned connector, fail closed (M3); downloads and the player probe now honour it | 🟡 (transport done; settings UI with the approved migration) |
| Proxy SOCKS5 + auth, encrypted password | ✅ (handshake test) | – | – | ✅ SOCKS | **Port** RiuPlay + real SOCKS dispatch | SOCKS5 + auth in the connector, DNS via DoH through the proxy, async-`safeStorage` store (M3) | 🟡 (no UI; legacy migration awaits approval) |
| Credential storage | AES with hard-coded fallback key | `safeStorage` | – | – | **Reuse** Hibiki `safeStorage` | `secureStore` | 🟡 |
| Cloudflare challenge handling | – | ✅ challenge windows | – | FlareSolverr | **Reuse** Hibiki, **Exclude** FlareSolverr (needs an external service) | Per-source challenge window | ✅ |
| In-app updater | – | ✅ (repointed to RiuPlay) | ✅ checker | WebUI updater | **Reuse** Hibiki | GitHub releases of RiuPlay | 🟡 (no releases yet) |
| LAN device sync | – | ✅ | – | – | **Reuse**, made opt-in | Settings → Sync | ✅ (opt-in) |
| i18n | en | ru/en/uk | zh/en/ja/ru | many | **Reuse** Hibiki i18next, English default | One locale set | 🟡 |
| Android / mobile | – | Capacitor | ✅ | – | **Exclude** for now (Windows first). Code kept, not built | – | – |

## 2. Media model and content types (the core of RiuPlay's identity)

| Feature | Orig. RiuPlay | Hibiki | KikoFlu | Suwayomi | Decision | Unified as | Status |
|---|---|---|---|---|---|---|---|
| Video and anime titles with episodes | ✅ model | ✅ `AnimeTitle`/`PlaybackGroup` | – | – | **Port** RiuPlay model for local/URL video. Source anime keep hibiki's types but meet the model in every shared view (Home, Video section, Library, Collections) | `MediaItem{type:'video'}` + `Unit{kind:'episode'}`; source anime via `MediaRef` | 🟡 local/URL video ✅; extension sources still use `AnimeTitle` internally |
| Manga and manhwa with chapters and pages | ✅ model (`chapters.pages`) | – | – | ✅ Manga/Chapter/Page | **Port** RiuPlay model, **reimplement** Suwayomi chapter/page semantics | `type:'manga'`, `Unit{kind:'chapter', pages}` | ✅ local folders + page URLs (Phase 6). Extension/server manga: Phase 7 |
| Audio and ASMR works with tracks | ✅ model (`tracks`) | – | ✅ Work/Track tree | – | **Port** RiuPlay model; KikoFlu's folder tree → nested folders (2 levels) on import | `type:'audio'`, `Unit{kind:'track'}`; `.lrc` lyrics kept per track | ✅ local files/folders + track URLs (Phase 6). Kikoeru server: Phase 7 |
| Direct URL / manual / local-file media | ✅ AddMediaModal, upload | – | ✅ local import + metadata scan | local source | **Port** RiuPlay (dialog, dedupe), adapted: files referenced in place, picker-only paths, `riuplay-media://` protocol | Add Media dialog in every section | ✅ (Phase 6; tests + e2e). Metadata scan from tags: later |
| Same title from several sources, duplicate detection | ✅ unique `(source, id)` | per-source | – | per-source | RiuPlay original | `(origin, originRef)` unique ✅; cross-source `media_source_links` 🔴 | 🟡 same-origin dedupe only |
| Universal metadata (title, alt titles, genres, cover, status, year) | ✅ | ✅ | ✅ tags, VA, rating | ✅ | **Unify** | `MediaItem` fields, editable on the title page | ✅ for local titles |

## 3. Sources, extensions and repositories

| Feature | Orig. RiuPlay | Hibiki | KikoFlu | Suwayomi | Decision | Unified as | Status |
|---|---|---|---|---|---|---|---|
| Scripted source extensions (JS) | – | ✅ manifest + js, worker runtime | – | – | **Reuse** Hibiki | Provider type `script` | ✅ |
| Aniyomi / Tachiyomi APK extensions | index parsing only | ✅ JVM apk-host (anime) | – | ✅ dex2jar (manga) | **Reuse** Hibiki apk-host. Manga APKs through **Service** (Suwayomi) first | Provider type `apk` | 🟡 (anime, needs Java 17+) |
| Repository index parsing, strict validation | ✅ zod schemas | ✅ | – | ✅ | **Port** RiuPlay zod validation into Hibiki marketplace | `core/marketplace` | 🟡 |
| Repository store table (one row per repo, metadata) | ✅ `repositories` | URL list | – | ✅ `ExtensionStoreTable` | **Reimplement** Suwayomi design | `source_repositories` + name, status, error, lastRefreshed | 🔴 |
| Update detection (`hasUpdate`) | – | ✅ in renderer | – | ✅ in DB, on refresh | **Reimplement** Suwayomi (core, persisted) | Extension record flags | 🟡 |
| Obsolete detection (gone from repo) | – | – | – | ✅ `isObsolete` | **Reimplement** Suwayomi | Same | 🔴 |
| API compatibility window | – | ✅ host-API gate | – | ✅ lib version min..max | **Reimplement** Suwayomi window on top of Hibiki gate | `riuplayApi: ">=1 <2"` in manifest | 🟡 |
| Integrity hash and signature | – | – | – | – | RiuPlay original (new) | `sha256` per file in index | 🔴 |
| Install consent showing permissions | trust copy | ✅ trust prompt on repo add | – | – | **Extend** Hibiki prompt to per-install permissions | Consent dialog | 🟡 |
| Out-of-process isolation | – | `worker_threads` + `vm` (not a sandbox) | – | separate JVM | RiuPlay original (new) | Electron `utilityProcess`, brokered network | 🔴 |
| Deferred deletion and safe uninstall | – | immediate | – | ✅ delete-on-startup | **Reimplement** Suwayomi | Pending-delete list at startup | 🔴 |
| Per-source settings, login windows | – | ✅ | – | ✅ source prefs | **Reuse** Hibiki | Source settings dialog | ✅ |
| Remote media servers: Suwayomi (manga) | ✅ REST client | – | – | the server | **Port** RiuPlay client + **Service** | Provider type `server:suwayomi` | 🔴 (legacy only) |
| Remote media servers: Kikoeru (audio) | – | – | ✅ client (official + self-hosted) | – | **Reimplement** KikoFlu client (self-hosted first) | Provider type `server:kikoeru` | 🔴 |
| Generic feeds: RSS/Atom, JSON-LD, OpenGraph | planned | – | – | – | RiuPlay original | Provider type `feed` | 🔴 |
| No preinstalled third-party repository | – | seeded | – | – | RiuPlay decision | Empty list + trust prompt | ✅ |

## 4. Consumption: watch, read, listen

| Feature | Orig. RiuPlay | Hibiki | KikoFlu | Suwayomi | Decision | Unified as | Status |
|---|---|---|---|---|---|---|---|
| Video player (HLS/DASH/MP4, quality, speed, skip OP/ED) | basic HTML5 + hls | ✅ advanced | media_kit | – | **Reuse** Hibiki | `PlaybackEngine` → HtmlMediaEngine | ✅ |
| External engine for MKV/HEVC/ASS | – | – | libmpv (media_kit) | – | **Reimplement** the KikoFlu engine idea as optional `mpv.exe` over IPC | `MpvEngine` | 🔴 |
| Audio player with background playback | ✅ context + mini bar | – | ✅ | – | **Port** RiuPlay player, **reimplement** KikoFlu player service | `/listen` page now; persistent mini player across pages in Phase 8 | 🟡 page player (play/seek/prev/next/volume/speed/auto-next/resume); no background mini player yet |
| Queue, loop (one/all), shuffle | – | autoplay next | ✅ queue builder | – | **Reimplement** KikoFlu | Shared `PlayQueue` for audio and video | 🔴 |
| Playlists | – | – | ✅ | – | **Reimplement** KikoFlu | `collections` (kind = playlist) | 🔴 |
| Sleep timer | – | – | ✅ | – | **Reimplement** KikoFlu | Player control | 🔴 |
| Playback-session restore after restart | – | per-episode progress | ✅ session snapshot v1 | – | **Reimplement** KikoFlu snapshot | `app_settings['playback.session']` | 🔴 |
| Audio gain and normalisation | – | – | ✅ | – | **Reimplement** with Web Audio `GainNode` | Player setting | 🔴 |
| Windows media keys / SMTC | – | – | ✅ `smtc_windows` | – | **Reimplement** with `navigator.mediaSession` | All engines | 🟡 audio page (play/pause/prev/next + metadata); video: Phase 8 |
| Subtitles: VTT, SRT, ASS; delay | single URL | ✅ VTT, delay | ✅ 11 formats, editing, timing | – | **Reuse** Hibiki + **reimplement** KikoFlu parsers | `SubtitleService` (UI-independent) | 🟡 |
| Synced lyrics (LRC) + fullscreen lyrics | – | – | ✅ | – | **Reimplement** KikoFlu parser and display | Same `SubtitleService` timeline | 🔴 |
| Floating desktop lyrics (click-through) | – | – | ✅ | – | **Reimplement** as an always-on-top transparent window | Opt-in | 🔴 |
| Subtitle library + automatic matching to tracks | – | – | ✅ SQLite index + scoring | – | **Reimplement** KikoFlu `SubtitleMatcher` rules | `subtitle_library` table | 🔴 |
| Subtitle and lyric translation (Microsoft, Youdao, LLM) | – | – | ✅ | – | **Exclude** for now: sends content to third parties. Reconsider as an opt-in plugin | – | – |
| Manga reader: single/continuous, LTR/RTL, fit, zoom | ✅ settings model | – | – | (clients do) | **Port** RiuPlay `readerDefaults`, **reimplement** reader UI | `/read` route | 🟡 continuous + fit width/height + page tracking/resume + next chapter; single page, RTL, zoom: Phase 9 |
| Page prefetch and image cache | – | image proxy | ✅ cover prefetch | ✅ page cache | **Reimplement** | `core/cache` | 🔴 |
| Text, PDF and image files inside works | – | – | ✅ previews | – | **Reimplement** (PDF via Chromium viewer) | File viewer in work details | 🔴 |

## 5. Library, progress, updates, downloads

| Feature | Orig. RiuPlay | Hibiki | KikoFlu | Suwayomi | Decision | Unified as | Status |
|---|---|---|---|---|---|---|---|
| Library statuses + favourites | ✅ per type | ✅ | – | ✅ in library | **Port** RiuPlay statuses (active/planned/completed/on_hold/dropped + favourite) with per-type words; hibiki categories mapped onto them | One Library page for all types | ✅ (Phase 6; tests + e2e) |
| Categories with update include/exclude | – | fixed categories | – | ✅ | **Reimplement** Suwayomi | `collections` + `include_in_updates` | 🔴 |
| Custom collections | ✅ planned | – | ✅ playlists | categories | RiuPlay original | `collections` / `collection_items`; local and source titles together; button on local **and** source title pages | ✅ (Phase 6; tests + e2e) |
| Progress + Continue Watching/Reading/Listening | ✅ three rows | ✅ watching | ✅ history | ✅ last read | **Reuse** hibiki for source anime, **port** RiuPlay rows for local titles | Per-unit `local_progress` (ms / page); Home + sections | ✅ (Phase 6; tests + e2e). Unknown-length streams don't save progress (hibiki player reports only with a known duration) |
| History, clear with confirmation | ✅ | ✅ | ✅ | ✅ | **Reuse** hibiki | All types | 🟡 History page covers source anime only; local titles show progress on their pages |
| New-unit checks (episodes/chapters/tracks) | – | ✅ `newEpisodes` checker | – | ✅ scheduled updater, per-source queues, failure isolation | **Reuse** Hibiki checker + **reimplement** Suwayomi per-source channels and category filters | `core/updates` for every type | 🟡 (episodes) |
| "Updates" feed (recently released units) | – | notifications | – | ✅ | **Reimplement** Suwayomi | Home + Updates view | 🔴 |
| Downloads: queue, progress, cancel | ✅ basic | ✅ concurrent, HLS segments | ✅ selective, concurrent | ✅ chapters | **Reuse** Hibiki, **port** RiuPlay disk-space guard | One queue for episodes, chapters, tracks | 🟡 (episodes) |
| Pause / resume (HTTP Range) | – | – | partial | – | RiuPlay original (new) | Same queue | 🔴 |
| Selective download of a work's files | – | – | ✅ | – | **Reimplement** KikoFlu | Audio work file tree | 🔴 |
| Automatic download of new units | – | – | – | ✅ | **Reimplement** Suwayomi (opt-in) | `core/updates` → downloads | 🔴 |
| Offline library (downloaded only) | – | Downloads page only (no library filter) | ✅ offline search | ✅ | **Reuse** Hibiki Downloads page, **reimplement** KikoFlu offline search as a library filter | "Downloaded" filter in the library | 🟡 |

## 6. Personal data, backup, tracking, UI

| Feature | Orig. RiuPlay | Hibiki | KikoFlu | Suwayomi | Decision | Unified as | Status |
|---|---|---|---|---|---|---|---|
| Local profile, avatar | ✅ emoji avatar | ✅ profile page, stats | ✅ accounts | – | **Reuse** Hibiki, keep RiuPlay single local profile | Profile page | 🟡 |
| Backup / restore | ✅ versioned JSON | ✅ db + extensions | – | ✅ Mihon-compatible, scheduled | **Reuse** Hibiki, **reimplement** Suwayomi scheduled backups | Settings → Backup | 🟡 |
| Import Mihon/Tachiyomi backup (manga library) | – | – | – | ✅ protobuf | **Reimplement** read-only importer (later) | Backup → Import | 🔴 |
| Trackers (AniList, MAL, MangaUpdates) | – | ✅ AniList | – | ✅ several | **Reuse** Hibiki AniList (needs a RiuPlay client id). **Reimplement** others later | `core/tracking` for all types | 🟡 |
| Statistics, streaks, achievements | – | ✅ | – | – | **Reuse**, make optional | Profile | ✅ (source anime only) |
| First-run onboarding | – | ✅ (sources step) | ✅ | – | **Adapt** to RiuPlay (all types, no source required) | Onboarding | 🟡 still hibiki's sources-first wording |
| Privacy mode (blur covers) | – | – | ✅ | – | **Reimplement** | Appearance setting | 🔴 |
| Content rating filter / NSFW opt-in | nsfw flag | ✅ ignore NSFW | ✅ age rating | ✅ | **Unify** | One NSFW setting | 🟡 |
| Themes, accent colour, light/dark | ✅ | ✅ | ✅ M3 | – | **Reuse** Hibiki | RiuPlay design tokens | ✅ |
| Navigation covering all content types | ✅ Anime/Manga/Audio entries | anime only | audio only | – | RiuPlay original | Sidebar: Home, Discover, Catalog, Search, Video, Manga, Audio, Library, Collections, Downloads, Sources, Settings, Profile | ✅ (Phase 6) |
| Home mixing all types | ✅ continue watching/reading/listening | ✅ anime rows | ✅ | – | **Port** RiuPlay layout onto hibiki components; hibiki's source home becomes Discover | Home | ✅ (Phase 6; e2e) |
| Search across all providers and types | ✅ local search | ✅ per source + spotlight | ✅ advanced tags | ✅ global search | **Reuse** Hibiki spotlight, **reimplement** KikoFlu tag include/exclude | One search | 🟡 |
| OPDS feed / web UI / GraphQL server | – | – | – | ✅ | **Exclude**: RiuPlay is a desktop client and doesn't host a server (security surface) | – | – |
| Discord Rich Presence | – | ✅ | – | – | **Reuse**, opt-in. Needs RiuPlay's own Discord app id | – | 🟡 |
| Audio haptics, Liquid Glass, iOS PiP | – | – | ✅ | – | **Exclude**: mobile/Apple-only | – | – |

---

## Summary by reference

| Reference | Reused code | Reimplemented ideas | Service integration | Excluded |
|---|---|---|---|---|
| **Original RiuPlay** | Model (schema 0023). Next: queries, Suwayomi client, proxy, AddMedia, mini player, reader settings | – | – | Next.js/Postgres runtime (replaced) |
| **Hibiki** | Shell, DB, extension runtime, APK host, video player, downloads, library, sync, tracking, UI kit | – | – | Android build, automatic default repositories, `vm`-only sandbox (to be replaced) |
| **KikoFlu** | none (Dart) | Audio engine, queue, playlists, sleep timer, session restore, gain, LRC/subtitle parsers, subtitle library + matching, floating lyrics, privacy mode, selective downloads, file previews | Kikoeru server client | Translation services, haptics, Apple-only UI |
| **Suwayomi** | none (Kotlin, MPL) | Repository store, hasUpdate/obsolete, API window, deferred deletion, per-source update queues, category include/exclude, scheduled backups, auto-download, Mihon backup import | Suwayomi server client (manga APK sources) | OPDS, WebUI, GraphQL server, FlareSolverr |

## Origin and license ledger
Every file that enters the repository from outside, or that closely reimplements a reference, is listed here when it lands.

| RiuPlay path | Origin | Commit | License | Mode |
|---|---|---|---|---|
| `src/`, `apk-host/`, build config (see `THIRD_PARTY_NOTICES.md`) | hibiki | 132a71e | GPL-3.0-only | Reuse (modified) |
| `apk-host/` Aniyomi compat portions | Anikku / yuzono via hibiki | – | Apache-2.0 | Reuse |
| `src/core/db/schema.ts` (RiuPlay section), migration 0023 | original RiuPlay `legacy/next-app/src/db/schema.ts` | 35b853e | GPL-3.0 (owner) | Port |
| `src/core/db/schema.ts` (local_library, local_progress), migration 0024 | original RiuPlay `library_entries` + progress model | 35b853e | GPL-3.0 (owner) | Port |
| `src/core/media/*` (media, validation, collections, resolve) | original RiuPlay `src/server/queries.ts`, `providers.ts` (validation approach) | 35b853e | GPL-3.0 (owner) | Port |
| `src/main/mediaFiles.ts`, `src/main/mediaProtocol.ts` | original RiuPlay `src/server/storage.ts`, `src/app/api/files/[...path]` | 35b853e | GPL-3.0 (owner) | Port (adapted: reference in place, picker allowlist, DB-resolved URLs) |
| `src/renderer/src/components/media/AddMediaDialog.tsx`, pages `riuplayHome`, `mediaSection`, `collections`, `features/media/*` | original RiuPlay `AddMediaModal`, home page, `AudioPlayerContext`; hibiki UI components and `VideoPlayer` | 35b853e / 132a71e | GPL-3.0 | Port + Reuse |
| *(future)* `src/core/audio/*`, `src/core/subtitles/*` | KikoFlu `lib/src/services/*` | d8a8c61 | GPL-3.0 | Reimplement (credited per file) |
| *(future)* `src/core/extensions/lifecycle.ts`, `src/core/updates/*` | Suwayomi design only | 7b061be | MPL-2.0 (no files copied) | Reimplement |
