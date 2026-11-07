# Technology Decision

Status: **Proposed — awaiting owner approval** (it implies a GPL-3.0 license; see `LICENSE_COMPLIANCE.md`).

## Options compared

| Criterion | A. Keep Next.js + Postgres, wrap in Electron | B. **Adopt Hibiki (v3.3.0) as foundation, port RiuPlay's unique parts** | C. Fresh Electron app, cherry-pick |
|---|---|---|---|
| Code reuse | ~4.8k lines kept, ~everything else built new | ~35k lines of working, tested Electron code + RiuPlay's ~1.5k lines of unique logic | Moderate. Re-integration cost is high |
| Windows compatibility | Needs a bundled Postgres server ❌ | NSIS build already configured ✅ | Must be built |
| Performance | Two servers (Next + PG) inside Electron | Single process tree, SQLite in-process, worker pool | Good, eventually |
| UI quality | 3 of 10 pages exist | Full set of polished pages | Must be built |
| Playback | Basic HTML5 + hls | HTML5 + hls.js + dash.js, skip, subtitle delay, recovery | Must be built |
| Extension architecture | Metadata only | JS scripted sources + Aniyomi APK host (JVM) | Must be built |
| Dev experience | Next dev server | Vite + HMR for main and renderer, Vitest (82 test files) | Same as B, eventually |
| Long-term maintenance | Template heritage, no tests | Clear core/platform/renderer layering, active upstream | Own burden |
| Packaging | Hard (Postgres) | Done (electron-builder) | Must be done |
| License impact | None | **RiuPlay must be GPL-3.0-only** | Same as B if any Hibiki code is used |

## Decision (proposed): **B**

**Stack:** Electron 34+ · Vite 6 · React 19 · TypeScript 5 · TanStack Router/Query · Zustand · Tailwind · **SQLite (better-sqlite3) + Drizzle migrations** · worker/utility-process extension host · electron-builder (NSIS + portable).

Why: Hibiki is the only reference that is already the target architecture (Electron + React + TS + SQLite) and already ships a Windows installer. Its `core/` ↔ `platform/` split lets RiuPlay generalise the domain from anime-only to anime + manga + audio without touching the platform adapters. The existing RiuPlay code is valuable mainly as **domain scope and careful remote-data handling**. Those parts are small and port cleanly. Its runtime choices (Next.js server, Postgres) are the parts that conflict with the product vision.

## Playback engine

`PlaybackEngine` interface with two implementations:
1. **HtmlMediaEngine** (default): Chromium `<video>/<audio>` + hls.js + dash.js, taken from Hibiki's player. It covers MP4/WebM/HLS/DASH, VTT, and AAC/MP3/Opus/FLAC.
2. **MpvEngine** (optional, phase 9): spawns `mpv.exe` with `--input-ipc-server` (JSON IPC over a named pipe) for MKV/HEVC/AC3/ASS where Chromium falls short. Embedding libmpv into an Electron window has no maintained binding, so an external-window mpv is the honest, maintainable option. mpv is GPL/LGPL, distributed as a separate executable.

Only formats verified by tests will be advertised.

## Rejected
- **Tauri/Rust**: would discard both codebases.
- **Flutter (KikoFlu stack)**: would discard both TS codebases. KikoFlu's ideas are ported instead.
- **Postgres**: violates "no mandatory backend".
