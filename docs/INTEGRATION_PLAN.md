# Integration Plan & Roadmap

Each phase ends with: tests green, a local commit, and a report. Nothing is pushed without approval.

| # | Phase | Concrete output | Verification |
|---|---|---|---|
| 0 | **Prerequisites** | Node 22 LTS installed. License decision. First commit of the current state. | `node -v`. `git log` shows the baseline. |
| 1–3 | Audit & decision | This `docs/` set ✅ | Owner review |
| 4 | Stabilise / import | Move the Next app to `legacy/`. Import Hibiki v3.3.0 @132a71e with attribution. Rebrand. Drop Android. `npm ci`, typecheck, run its tests unchanged. | Upstream test suite passes on Windows. `npm run dev` window opens. |
| 5 | Core foundation | Merged SQLite schema + migration. Generalised MediaItem/Unit. Logger to file. Settings store. safeStorage secrets. | Migration tests (fresh + upgrade), model tests |
| 6 | Media sources | guardedFetch (SSRF), proxy (http/https/socks5 real), providers: direct URL, local files, RSS/Atom, JSON-LD/OpenGraph, Suwayomi (ported) | Unit tests with a mocked HTTP server, SSRF test matrix (127/8, 10/8, 169.254, ::1, fc00::/7, DNS rebinding, redirect to private) |
| 7 | Extension system | `riuplay-extension` spec v1 (manifest, API range, permissions, sha256). utilityProcess host. Consent UI. Install/update/uninstall/enable. Logs. `docs/EXTENSION_DEVELOPMENT.md` + a sample extension. | Install/update/compat/permission-denial tests |
| 8 | Catalog | Details page for all content types, categories, collections, library, favourites, duplicate detection | Library/collection tests |
| 9 | Playback | PlaybackEngine interface, HtmlMediaEngine (from Hibiki), queue, audio-track/subtitle selection, SubtitleService (VTT/SRT/ASS→VTT, delay, styling), resume, mediaSession (SMTC). Manga reader. Optional MpvEngine. | Playback state tests + manual format matrix recorded in `docs/TESTING.md` |
| 10 | Personalisation | Profile/avatar, theme light/dark/accent, Continue Watching, history clear with confirm | Tests |
| 11 | Advanced | Downloads pause/resume (Range), backup/restore with pre-restore snapshot, cache limits | Backup round-trip tests |
| 12 | UI polish | RiuPlay identity (logo, tokens), keyboard nav, empty/error states, high-DPI | Manual checklist + screenshots |
| 13 | Testing | Full Vitest + Playwright-Electron smoke | CI-style `test.bat` |
| 14 | Windows release | `install.bat`/`run.bat`/`test.bat`/`build.bat`, NSIS + portable, `BUILD_WINDOWS.md` | Installer built **and launched on this Windows machine** |
