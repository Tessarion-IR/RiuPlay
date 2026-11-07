# Integration Plan & Roadmap

**Product vision (owner, 2026-11-07):** RiuPlay is one integrated media application for anime, video, manga and audio. It combines Hibiki's desktop infrastructure, KikoFlu's audio experience and Suwayomi's source lifecycle, and it keeps the original RiuPlay's model and features. **It must not end up as a rebranded Hibiki fork.** This vision takes priority over finishing the Hibiki migration quickly.

[`FEATURE_INTEGRATION_MATRIX.md`](FEATURE_INTEGRATION_MATRIX.md) is the source of truth for what comes from where (reuse, port, reimplement, service or exclude) and for each feature's status. Every phase below closes rows in that matrix.

## Honest current state (after Phase 5)
- The **running app is still essentially Hibiki**: anime-only types, routes and navigation, plus RiuPlay's safety work (branding, data-folder pin, opt-in LAN sync, no preinstalled repositories, merged schema, pre-migration backups, drizzle security upgrade).
- The original RiuPlay features (manga, audio, direct and local media, Suwayomi client, SOCKS5 proxy, collections, three "continue" rows) exist in `legacy/next-app/` and in schema 0023, **but not yet in the UI**.
- KikoFlu and Suwayomi contribute **nothing yet** beyond the design study recorded in the matrix.

Phases 6–10 are therefore integration work, scheduled **before** polish and release.

## Completed

| # | Phase | Result |
|---|---|---|
| 1–3 | Audit, reference audit, architecture decision | `docs/` audits |
| 4 | Foundation import | Hibiki v3.3.0 imported under GPL-3.0, rebranded, legacy preserved |
| 5 | Database and security | drizzle 0.45.4, schema 0023 + pre-migration backups, opt-in LAN sync, sync test root cause fixed, repository audit |
| 6 | Unified media core | One model for video/manga/audio (migration 0024), Add Media by URL/files/manual, Video/Manga/Audio sections, title pages, play (hibiki player)/listen/read with progress + resume, unified Library, Collections across local and source titles, unified Home, Discover. Verified by unit tests and a 25-check end-to-end run in the real app |

## Integration phases (next)

Each phase ends with tests green 3× in a row, a local commit, matrix rows updated, and a report.

### Phase 6: Unified media core *(original RiuPlay + Hibiki)* - ✅ done (see the matrix for what is partial)
The domain stops being anime-only.
- Introduce `MediaItem` / `Unit` (episode, chapter, track) / `MediaSourceLink` in `src/shared`. Adapt Hibiki's `AnimeTitle`/`PlaybackGroup` into them, with compatibility shims so the extension runtime and existing data keep working.
- Port the original RiuPlay query layer (`legacy/next-app/src/server/queries.ts`) onto SQLite: `local_media`, `local_media_units`, collections, duplicate detection.
- Make "Add media" (direct URL, local file, manual) work for all three types. This ports `AddMediaModal` and the upload and Range file server as a custom protocol.
- Navigation and Home become type-aware: Video, Manga and Audio sections, and Continue Watching/Reading/Listening rows.
- **Done when:** a direct-URL video, a manual manga and a local audio file can each be added, opened, tracked in the library and resumed. The existing Hibiki library still works.

### Phase 7: Source lifecycle, server connections, network *(Suwayomi + original RiuPlay + Hibiki)*
- Repository store with metadata, status and errors. Persisted `hasUpdate`/`obsolete` flags on refresh. A `riuplayApi` compatibility window. Deferred deletion at startup. Per-file `sha256` checked before install. A per-install consent dialog with permissions.
- Extension execution moves to an Electron `utilityProcess` with network brokered by the main process.
- `core/net/guardedFetch` with SSRF protection. Proxy HTTP/HTTPS/SOCKS5 with authentication, global and per-source (ports the original RiuPlay settings model).
- Server connections as providers: **Suwayomi** (port the RiuPlay client; manga APK sources through the user's server) and **Kikoeru** (reimplement the KikoFlu client, self-hosted first). Both share a "Connections" settings page with latency test.
- Publish `docs/EXTENSION_DEVELOPMENT.md` (RiuPlay extension spec v1).

### Phase 8: Audio experience *(KikoFlu + original RiuPlay)*
- An `AudioEngine` behind the shared `PlaybackEngine` interface, and a persistent mini player (ports RiuPlay's `MiniPlayerBar`).
- `PlayQueue` shared by audio and video: loop one/all, shuffle, playlists (stored as `collections`), sleep timer, gain.
- Playback-session restore after restart (KikoFlu snapshot design). Windows media keys through `mediaSession`.
- `SubtitleService`: parsers for LRC, VTT, SRT and ASS, synced lyrics and fullscreen lyrics, delay. The subtitle library plus automatic matching follows KikoFlu's rules (credited per file). Optional floating desktop lyrics.

### Phase 9: Manga reader *(original RiuPlay + Suwayomi)*
- Reader for `Unit{kind:'chapter'}`: single page or continuous, LTR/RTL, fit and zoom (RiuPlay `readerDefaults`), keyboard navigation, page prefetch and cache, per-chapter progress.
- Chapter downloads in the shared queue. Mihon/Tachiyomi backup import (read-only) is evaluated here.

### Phase 10: Unified library, updates and downloads *(Hibiki + Suwayomi + KikoFlu)*
- One library for all types, with per-type statuses (watching, reading, listening).
- Categories with an update include/exclude setting.
- `core/updates`: Hibiki's new-episode checker generalised to chapters and tracks, with per-source update queues and failure isolation (Suwayomi), an "Updates" feed, and opt-in auto-download.
- Downloads: pause and resume through HTTP Range, the disk-space guard (RiuPlay), and selective download of a work's files (KikoFlu).

## Product and release phases (after integration)

| # | Phase | Content |
|---|---|---|
| 11 | Personalisation | Profile, privacy mode (KikoFlu), one NSFW setting, history management, scheduled backups (Suwayomi) |
| 12 | UI polish and identity | RiuPlay design language across all sections, keyboard navigation, empty and error states, high-DPI, accessibility pass |
| 13 | Testing and hardening | Full Vitest, Playwright-Electron smoke tests per content type, security review of the extension sandbox and network layer |
| 14 | Windows release | `install.bat`/`run.bat`/`test.bat`/`build.bat`, NSIS + portable, `BUILD_WINDOWS.md`, installer launched and checked on this machine. **Publishing only with owner approval** |

## Architecture completeness gate
The architecture counts as complete only when:
1. every row of `FEATURE_INTEGRATION_MATRIX.md` is ✅ or **Exclude** (with a reason);
2. no user-facing screen is anime-only by construction;
3. the origin and license ledger lists every reused or reimplemented file.
