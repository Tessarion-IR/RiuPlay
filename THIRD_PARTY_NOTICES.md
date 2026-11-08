# Third-Party Notices

RiuPlay is free software, licensed under the **GNU General Public License v3.0 only** (see [`LICENSE`](LICENSE)).

## Upstream work RiuPlay is derived from

### hibiki
- Source: https://github.com/akkirrai1337/hibiki
- Imported at commit `132a71e5b32713e2458b0ad99a4c150a0ec03f7b` (v3.3.0, 2026-10-23)
- Copyright © the hibiki authors (akkirrai1337 and contributors)
- License: **GPL-3.0-only**

The following parts of this repository were copied from hibiki at that commit and are distributed under its license: `src/`, `apk-host/`, `scripts/` (except `scripts/render-icons.cjs`), `electron-builder.yml`, `vite.config.ts`, `vite.android.config.ts`, `vitest.main.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`, `drizzle.config.ts`, `capacitor.config.json`, `package.json` and `package-lock.json`.

**Modification notice (GPL-3.0 §5a):** RiuPlay has modified these files. The first modification is rebranding (application name, identifiers, URL scheme, database and log file names, icons, user-visible strings). Every later change is recorded in the Git history of this repository and summarised in [`CHANGELOG.md`](CHANGELOG.md). The upstream changelog is kept in [`docs/UPSTREAM_HIBIKI_CHANGELOG.txt`](docs/UPSTREAM_HIBIKI_CHANGELOG.txt).

hibiki itself credits:
- **Anikku** (https://github.com/komikku-app/anikku) and **Yuzono anime-extensions** (https://github.com/yuzono/anime-extensions): the Aniyomi extension API and compatibility code used by `apk-host/`. License: **Apache-2.0**. Apache-2.0 code may be combined into a GPL-3.0 work, and its notices are preserved in the affected files.

### hibiki-desktop
- Source: https://github.com/akkirrai1337/hibiki-desktop (GPL-3.0-only)
- An older snapshot (v3.0.0) of the same codebase as hibiki. It was audited, and no code was taken from it separately.

## Projects used as design references (no code copied)

| Project | License | What RiuPlay takes |
|---|---|---|
| [KikoFlu](https://github.com/pa-jesusf/KikoFlu) | GPL-3.0 | Ideas for the audio queue, subtitle and lyric matching, playback-session restore and stream caching, re-implemented in TypeScript. Where an implementation follows KikoFlu closely, the file header credits it. |
| [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) | MPL-2.0 | Extension lifecycle design (API-version compatibility window, update and obsolete detection, deferred deletion). RiuPlay can also talk to a user-run Suwayomi server over its public HTTP API. |
| [kikoeru-express](https://github.com/kikoeru-project/kikoeru-express) | GPL-3.0 | No code. RiuPlay talks to a user-run Kikoeru server over its public HTTP API. |

## npm dependencies
The production dependencies are licensed under MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, BlueOak-1.0.0, or dual MIT/WTFPL and MIT/BSD/Apache. All of these are compatible with GPL-3.0. Generate the full list with:

```
npx license-checker-rseidelsohn --production --summary
```

## Electron and Chromium
Packaged builds include Electron, which bundles Chromium, Node.js and FFmpeg. Their license files ship inside the installed application (`LICENSE.electron.txt`, `LICENSES.chromium.html`).
