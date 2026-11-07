# Changelog

All notable changes to RiuPlay are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and RiuPlay uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
