# Changelog

All notable changes to RiuPlay are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and RiuPlay uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Extension-powered catalogue: a built-in RiuPlay repository (open films, Pepper&Carrot, LibriVox, open audio) and installed extensions as sources of the Video, Manga and Audio sections, with search, title pages, the native player and reader, and progress.
- KikoFlu's audio source (asmr.one) as a built-in extension; adult works hidden unless turned on for that source.
- Hibiki's anime sources as a one-click, clearly third-party repository.
- **Keiyoushi manga extensions inside RiuPlay**, with no Suwayomi server and no Java to install: one-click repository (Keiyoushi's protobuf index), install of each extension's signed jar only when signed by the key the repository publishes, and its titles, chapters and pages in the Manga section and the native reader.

### Security
- APK extensions (Keiyoushi manga, Aniyomi anime) now run **confined**: RiuPlay's bundled Java runtime starts inside a Windows AppContainer with no capabilities and a Job Object, so it cannot reach the person's files, start programs or open network connections. Its connections go through RiuPlay's network rules (public websites on ports 80/443, the configured proxy, never private addresses). The "full user rights" opt-in is gone; the runtime can still be switched off in Settings.

## [0.1.0-alpha.1] - 2026-11-08

First public pre-release. **Alpha: not stable or production-ready.** Windows x64 only; the builds are not code-signed. Known limitations are listed in the README and in `docs/releases/v0.1.0-alpha.1.md`.

### Release preparation
- Packaged builds now contain only the runtime bundles (`dist/`, `dist-electron/main`, `dist-electron/preload`). Compiled tests and build configs are no longer shipped. `LICENSE.txt` and `THIRD_PARTY_NOTICES.md` are placed next to `RiuPlay.exe`.
- A portable build (`RiuPlay-v<version>-portable.exe`) alongside the installer.
- Removed a leftover browser-preview stub (`preview-mock.js`) from the renderer.
- Exported logs are named `riuplay-log-*.log` and say "RiuPlay".
- README, SECURITY and third-party notices updated for the public alpha.

### Phase 7 completion: M1, M2, M4, M5, product identity

#### Added
- **M1, extension lifecycle and trust.** Repositories start "not reviewed"; trusting and enabling them are separate choices. Compatibility is checked before download. An install dialog lists permissions, and the main process enforces the consent. Extensions can be disabled. Migration 0025 is additive. See `docs/M1_EXTENSION_LIFECYCLE.md`.
- **M2, sandboxed extensions.** Each extension runs in its own Chromium-sandboxed window with no Node or Electron access, with all its traffic through the network broker and a Windows Job Object memory cap. Challenge and browser windows get a per-source partition and a check of every URL. APK (Java) sources are off by default. See `docs/M2_SANDBOX.md`.
- **M4 and M5, Suwayomi and Kikoeru servers.** Settings > Media servers, browsing in the Manga and Audio sections, and server titles in the unified library. Credentials stay in the main process. Migration 0026 is additive. See `docs/M4_M5_SERVERS.md`.
- **M3 follow-up.** A user-started encrypted proxy migration, Chromium proxy parity with proxy authentication, new backups without the proxy password, a check of stream URLs before playback, and a per-source request cache.
- **Discover catalog** of known repositories and servers (anime, manga, audio), with verified facts and no automatic trust.
- **Unified search and activity.** Search includes your own library; Profile and History show video, manga and audio activity.

#### Changed
- **Branding.** No visible hibiki branding remains: the Profile default name, Discord texts and device names now say RiuPlay. Discord presence needs RiuPlay's own Discord application id (build secret `RIUPLAY_DISCORD_CLIENT_ID`) and is otherwise unavailable.
- **Onboarding** explains video, manga and audio; online sources are optional.
- **New backups** are `.riuplaybackup`; `.hibikibackup` files still restore.
- **`RIUPLAY_USER_DATA_DIR`** runs the app on a separate profile (tests).

### M3: Networking

#### Added
- **One controlled request path** for main-process HTTP(S) (`src/main/net/`, see `docs/M3_NETWORKING.md`). It covers extension `fetch()`, downloads, HLS playlists, updates, repositories, AniList, skip times and the player's redirect probe:
  - private, loopback, link-local and metadata addresses are refused, in every IPv4 and IPv6 spelling;
  - every resolved address is validated and pinned, and every redirect is re-validated;
  - HTTPS → HTTP downgrades are refused, and credentials are stripped across origins;
  - bodies, decompressed bodies and time are capped; every caller has in-flight, queue, rate and hourly-byte budgets.
- **HTTP, HTTPS and SOCKS5 proxies (with authentication)** for main-process requests, through one connector that hands the proxy an IP literal. Behind a proxy, names are resolved by DNS-over-HTTPS *through* the proxy to IP-literal resolvers, so no DNS query leaves outside it.
- **Encrypted proxy store** (`app_settings` `network.proxy`), using Electron 45's asynchronous `safeStorage`, with IPC to get, set, clear and test it. No Settings screen uses it yet.
- Design for a user-approved local-server exception (one connection, one exact scheme, host and port; never for extensions), with tests.
- 200 new network tests. The M0 suite still passes unchanged.

#### Changed
- **A configured proxy is never bypassed.** Before, a SOCKS proxy or a proxy rule list made Node go direct, and downloads and the player probe always went direct. Now requests fail (`proxy-failed`, `proxy-invalid`, `proxy-unavailable`) instead.
- Network log lines no longer contain query strings, credentials or full paths.
- `socks` 2.8.9 (MIT, already in the lockfile) is now a direct dependency.

#### Not changed (awaiting approval)
- The existing plaintext Settings > Network proxy is still used at runtime exactly as before. It has not been read, migrated or deleted. The migration is designed and tested but not invoked (`docs/M3_NETWORKING.md` §6).

### P0: Electron upgrade

#### Changed
- **Electron 34.5.8 → 45.2.3** (Chromium 132 → 156, Node 20 → 24). Electron 34 was out of security support. See `docs/P0_ELECTRON_UPGRADE.md`.
- **better-sqlite3 11.10.0 → 13.0.3**: N-API prebuilt binary, so no per-Electron rebuild and no C++ toolchain needed. SQLite 3.53.4. The existing database is verified unchanged: no migration re-run.
- Install flow: the `postinstall`/`rebuild:electron` native rebuild is removed. Electron downloads its own binary on first use (`npm run electron:install` to prefetch). The new `.npmrc` sets `ignore-scripts=true` (npm otherwise tries to compile better-sqlite3), and `electron-builder.yml` sets `npmRebuild: false`.

#### Verified
- Type-check clean; 481 + 319 tests (3 runs); production build; 25/25 end-to-end checks and 11/11 protocol and window checks on Electron 45; Windows NSIS + portable packaging; packaged-app smoke test 10/10.

#### Known
- File dialogs now open in Downloads (Electron 43 behaviour).
- The synchronous `safeStorage` API is deprecated (to migrate before Electron 46).
- `console-message` positional arguments are deprecated.

### Product direction
- Documented the integration vision: RiuPlay combines the original RiuPlay, hibiki, KikoFlu and Suwayomi into one product, and is not a hibiki rebrand. Added `docs/FEATURE_INTEGRATION_MATRIX.md` (every feature, its origin, reuse mode, unified design and status, plus the origin and license ledger). `docs/INTEGRATION_PLAN.md` is reordered so the integration phases (unified media core, source lifecycle and servers, audio experience, manga reader, unified library and updates) come before polish and release.

### Phase 6: unified media core

#### Added
- **One media model for video, manga and audio** (`src/shared/media.ts`, `src/core/media/`). A title is made of units (episodes, chapters or tracks), with a personal library, per-unit progress, Continue lists and collections. This ports the original RiuPlay prototype onto the SQLite foundation. Migration `0024_riuplay_local_library` is additive.
- **Video, Manga and Audio sections**, and an **Add Media** dialog: by URL, from local files (native picker; files referenced in place, never copied), or by hand. The same URL is never added twice.
- **Title pages** for every type: status (Watching/Reading/Listening…), favourite, collections, editing, removal, and units with progress. Units can be marked finished.
- **Playing, listening, reading**:
  - Video plays in hibiki's own player, with resume.
  - An audio page with automatic next track, keyboard control and Windows media keys.
  - A continuous manga reader that resumes at the saved page.
- **Unified Library**: titles from sources and your own titles, filtered by type and status.
- **Collections**: local and source titles together. "Add to collection" is also on source anime pages.
- **New Home**: Continue Watching (local episodes and source anime together), Continue Reading, Continue Listening, favourites, recently added and collections. Hibiki's source home is now **Discover**.
- `riuplay-media://` protocol: serves only files recorded for imported titles, with byte ranges. Only paths the native picker returned this session can be imported.
- Tests: 21 core media tests, 9 file/protocol tests, 7 renderer helper tests, and a migration test for 0024.

#### Fixed
- Persisted pages (Home, sections, Library, Collections) now refresh when shown again, and media queries are always fresh. Before, a screen could show another screen's outdated copy for up to a minute.

#### Known limitations
- Streams with no known length (live streams, some WebM files) don't save video progress, because hibiki's player reports progress only when the duration is known.
- The History page and statistics cover source anime only.
- First-run onboarding still uses hibiki's sources-first wording.
- The reader has no single-page mode, RTL or zoom yet (Phase 9). The audio player has no persistent mini player, queue or lyrics yet (Phase 8).

### Phase 5: database, security, test reliability

#### Added
- **Merged schema** (migration `0023_riuplay_merged_schema`, additive only): `app_settings`, `local_media`, `local_media_units`, `collections` and `collection_items`. They carry the original RiuPlay prototype's model (settings, direct/manual/local video, manga and audio with episodes, chapters and tracks, and custom collections).
- **Automatic pre-migration snapshot** of an existing database, written before any pending migration runs, in `%APPDATA%\RiuPlay\backups\pre-migration\` (5 kept). If the snapshot fails, nothing is migrated.
- `scripts/verify-db-upgrade.ts`: checks a real database's upgrade on a copy. See `docs/DATABASE_MIGRATIONS.md` for the rollback and recovery guide.
- **Opt-in LAN sync**, with a switch in Settings → Sync. Off by default: no sockets are opened, and pairing, discovery and sync are refused until it is turned on. Turning it off closes the ports and live connections. The sync server is limited to 4 concurrent connections.
- Tests: migration upgrade and data preservation, pre-migration backup, app settings, LAN sync with real sockets (no ports while off, ports closed after turning off), and the sync IPC guards and app identity.
- `docs/EXTENSION_REPOSITORY_AUDIT.md` and `docs/DATABASE_MIGRATIONS.md`.

#### Changed
- **drizzle-orm 0.39.3 → 0.45.4** (fixes GHSA-gpj5-g38j-94v9, SQL injection via improperly escaped identifiers, which affects < 0.45.2), and drizzle-kit 0.30.6 → 0.31.11. `npm audit --omit=dev` now reports 0 vulnerabilities.
- **No extension repository is preinstalled any more.** hibiki seeded `akkirrai1337/hibiki-sources` (and the yuzono APK index) into fresh installs. Existing lists are kept.
- The profile folder is pinned to `%APPDATA%\RiuPlay` by `src/main/appIdentity.ts`, the first import of the main process.
- English is the default and fallback interface language (hibiki used Russian).

#### Fixed
- `sync.tcp.test.ts` failures under full-suite load. **Root cause:** one test made 780 sequential inserts before a ~3 MB sync and exceeded Vitest's 5 s timeout under parallel load. The timed-out test kept running and swapped the global platform under the next test (`no-transport`). Inserts are now batched (2.1 s → 0.7 s) and the timeout is sized to the workload.

### Phase 4: foundation

#### Added
- Project audit, reference audit, architecture, technology decision and license documents (`docs/`).
- New foundation: imported the **hibiki** v3.3.0 desktop codebase (commit `132a71e`, GPL-3.0-only), including the Electron shell, SQLite and migrations, extension marketplace and worker host, APK host, video player, library, downloads and tests.
- RiuPlay logo and icons (`electron-builder-resources/riuplay.*`, generated by `scripts/render-icons.cjs`).
- `postinstall` / `rebuild:electron` scripts, which build better-sqlite3 for Electron's ABI. `build:win` script.
- Open-source files: GPL-3.0 `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, issue and PR templates.

#### Changed
- Rebranded hibiki → RiuPlay: app name, AppUserModelID `io.github.tessarion.riuplay`, URL scheme `riuplay://`, `riuplay.db`, `riuplay.log`, window title, installer name and user-visible strings.
- The URL scheme is now registered only by packaged builds, so development runs no longer write to the Windows registry.
- `npm audit fix`: updated `undici` (GHSA-55wc-3pg8-jfw6).
- The in-app update checker now reads `Tessarion-IR/RiuPlay` releases instead of hibiki's.
- Discord Rich Presence is off by default.

#### Moved
- The original RiuPlay Next.js + PostgreSQL prototype now lives in `legacy/next-app/`.

### Known issues
- The Discord Rich Presence integration still uses hibiki's Discord application id. It is off by default and will be replaced.
- The LAN sync discovery protocol still identifies the app as `"hibiki"`, which keeps compatibility with hibiki devices. Whether RiuPlay should keep that is an open decision.
- The new LAN sync switch has been verified by automated tests and with the switch off in the running app. Turning it on in the window has not been clicked through by hand yet.
- Dev-only tooling still has npm audit advisories (electron-builder, drizzle-kit and Vite chains). They will be reviewed before the first release.
