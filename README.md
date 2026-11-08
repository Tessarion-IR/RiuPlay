<div align="center">

<img src="electron-builder-resources/riuplay.svg" alt="RiuPlay logo" width="112" height="112"/>

# RiuPlay

**A local-first, open-source media application for Windows: video, manga and audio from sources you choose.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange)

</div>

> **Status: early alpha.** RiuPlay brings four projects together in one application:
> - **the original RiuPlay**: one media model for anime, video, manga and audio, and its own features;
> - **[hibiki](https://github.com/akkirrai1337/hibiki)**: desktop infrastructure, video playback and the extension runtime;
> - **[KikoFlu](https://github.com/pa-jesusf/KikoFlu)**: the audio experience (queue, synced lyrics, session restore);
> - **[Suwayomi](https://github.com/Suwayomi/Suwayomi-Server)**: source lifecycle and update management.
>
> Today the running app is mostly the hibiki foundation. The integration work is planned phase by phase in the [roadmap](docs/INTEGRATION_PLAN.md) and tracked feature by feature in the [integration matrix](docs/FEATURE_INTEGRATION_MATRIX.md). This README separates what works today from what is planned.

## What RiuPlay is

- **Local-first.** There's no account and no cloud backend. Your library, history and settings live in a SQLite database on your PC.
- **Bring your own sources.** RiuPlay doesn't host or distribute content. You add extension repositories, and installed extensions find and play media from the sites they target.
- **Built for Windows.** It's a native installer and a native window, with Windows media controls.

## Features

### RiuPlay's own media (Phase 6, verified on Windows 11)
- **Video, Manga and Audio** sections, one model for all three.
- **Add media** by URL, from files on your PC (never copied), or by hand.
- Title pages with library status, favourites, collections, and episodes, chapters or tracks.
- Video plays in the built-in player. Audio has its own player page with auto-next and media keys. Manga has a continuous reader. All of them remember where you stopped.
- **Home** with Continue Watching / Reading / Listening, a **Library** for every type, and **Collections** that mix your own titles with titles from sources.

### Sources, servers and security (Phase 7)
- **Your own servers:** connect a Suwayomi (manga) or Kikoeru (audio) server under Settings > Media servers, browse it from the Manga and Audio sections, and add titles to the same library. Passwords are encrypted on your PC and never shown again.
- **Discover:** the Sources screen lists known places to start from, with license and maintenance facts and what was checked. Nothing is added, trusted or installed until you choose.
- **Extensions:** each runs in its own Chromium-sandboxed window, with no access to your files, other programs or your local network, and a Windows-enforced memory limit. Before installing, you see what an extension may do. Repositories start "not reviewed", and APK (Java) sources are off unless you turn them on.
- **Networking:** every request from extensions, downloads and the app goes through one path. Your computer and local network are blocked, every address is checked, and a configured HTTP, HTTPS or SOCKS5 proxy is never bypassed (DNS goes through it too). The proxy password can be stored encrypted.

### Inherited from the hibiki foundation
These features come with the imported codebase. On Windows 11 so far, startup, database creation and the full automated test suite have been verified. Each feature will be checked by hand in the next phases.
- Install, update and remove scripted source extensions from HTTPS repositories.
- Run Aniyomi APK extensions through an optional Java host.
- Search with filters, browse catalogs, open title details, related titles and episodes.
- Built-in video player with HLS, DASH and MP4, quality and speed controls, subtitle delay, opening and ending skip, and resume.
- Library (watching, planned, completed, dropped, on hold, favourites), Continue Watching, history and statistics.
- Episode downloads for offline viewing.
- Light and dark themes, an accent colour, and English, Russian and Ukrainian interface languages.
- Backup and restore of the local database.

### Planned (see [INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md))
- Manga reader modes (single page, right-to-left, zoom) and the KikoFlu audio experience (queue, synced lyrics, session restore, mini player).
- Integrity hashes and signed repositories for extensions; per-source proxies.
- Generic providers: RSS/Atom, JSON-LD/OpenGraph.
- Subtitle library and matching, an audio queue with session restore, and an optional mpv playback engine.

## Install (users)

There are no published releases yet. To try RiuPlay now, build it from source (below).

## Build from source (Windows)

Requirements: **Windows 10/11 x64**, **Node.js 22 LTS** and **Git**. No C++ toolchain is needed: the only native module (better-sqlite3) ships a prebuilt N-API binary, and Electron (45) downloads its own binary on first use (`npm run electron:install` fetches it up front).

```bat
git clone https://github.com/Tessarion-IR/RiuPlay.git
cd RiuPlay
npm ci          :: no install scripts run (see .npmrc); nothing needs compiling
npm run dev     :: starts the app with hot reload (Electron downloads itself on first use)
```

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development mode |
| `npm test` | Renderer unit tests (Vitest) |
| `npm run test:main` | Core and main-process tests (Vitest, Node 22) |
| `npm run typecheck` | TypeScript project check |
| `npm run electron:install` | Download the Electron binary now (otherwise it happens on first use) |
| `npm run build:win` | Build the NSIS installer and portable `.exe` into `release/` (see `docs/P0_ELECTRON_UPGRADE.md` for a Windows packaging note) |

Your data lives in `%APPDATA%\RiuPlay\` (database `riuplay.db`, `logs\`, `extensions\`).

## Architecture

```
src/
  main/       Electron main process: window, IPC, database, extension host, downloads
  preload/    The minimal, typed API exposed to the page (contextIsolation + sandbox)
  core/       Platform-independent domain: db schema and migrations, library, extensions, sync
  platform/   Adapters (electron/, android/) behind the contracts in platform/types.ts
  renderer/   React 19 UI: TanStack Router and Query, Zustand, Tailwind
  shared/     Types and the IPC contract shared by every layer
apk-host/     Optional JVM process that runs Aniyomi APK extensions
legacy/       The original RiuPlay prototype (Next.js), kept while its features are ported
docs/         Audits, architecture, decisions and plans
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/TECHNOLOGY_DECISION.md](docs/TECHNOLOGY_DECISION.md) for the design.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License and credits

RiuPlay is licensed under the **GNU GPL v3.0 only**. It is derived from **[hibiki](https://github.com/akkirrai1337/hibiki)** by akkirrai1337 and contributors (GPL-3.0-only). Thanks to them for the foundation. Design ideas come from [KikoFlu](https://github.com/pa-jesusf/KikoFlu) and [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

RiuPlay does not host, store or distribute any media. It works like a specialised browser for sources the user adds. The developers have no affiliation with any content provider. Respect copyright law in your country, and only use sources you have the right to access.
