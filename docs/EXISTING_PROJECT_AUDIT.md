# Existing Project Audit — RiuPlay (local workspace)

Audit date: 2026-11-07. Workspace: `E:\Projects\RiuPlay`.

## 1. Workspace and Git state

| Item | Finding |
|---|---|
| Git repository | **Was not a Git repository.** No `.git`, so there was no local history or branches to preserve. |
| GitHub origin | `https://github.com/Tessarion-IR/RiuPlay` exists, is public, and is **empty** (`git ls-remote` returns no refs). |
| Action taken | `git init -b main`, `origin` set to the URL above, `.gitignore` added. **Nothing committed or pushed.** |
| Uncommitted user changes | None could be lost: every file is untracked and untouched. |
| Secrets | No `.env` file. `drizzle.config.json` holds a default local DSN (`postgres:postgres@127.0.0.1`). It is a dev default, not a real secret. |
| Toolchain | **Node.js / npm are not installed** on this machine (not on PATH, not in `C:\Program Files\nodejs`). There is no `node_modules` and no lockfile. Nothing can be built, type-checked or tested until Node is installed. |

## 2. Technology in use

- Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4.
- **PostgreSQL** through `pg` + Drizzle ORM 0.45. There are no migrations folder (`drizzle-kit push` assumed).
- undici, socks, socks-proxy-agent, https-proxy-agent, zod 4, hls.js, lucide-react, nanoid, check-disk-space.
- `package.json` name is still `nextjs-postgresql-template`. The project was generated from a template.
- It runs as a **local web server**, not a desktop app. There is no Electron, Tauri or packaging.

Size: 59 files, about 4,770 lines of TS/TSX/CSS.

## 3. Feature inventory

### Fully implemented (in code; unverified because it cannot be run)
- **Unified data model** (`src/db/schema.ts`): profiles, settings, repositories, extensions, media_items (anime/manga/audio), episodes, chapters, tracks, library_entries, history_entries, downloads, search_history. A unique index on `(sourceType, sourceId, sourceItemId)` prevents duplicates.
- **Query layer** (`src/server/queries.ts`, 554 lines): CRUD for all of the above, continue-lists, library status counts.
- **Network helper** (`src/server/net.ts`): timeout, size cap, scheme check, HTTP/HTTPS proxy via undici `ProxyAgent`, SOCKS5 *handshake test* only, error classification.
- **Repository index parser** (`src/server/providers.ts`): validates Aniyomi/Tachiyomi `index.min.json` with zod. It honestly marks APK extensions as unsupported.
- **Suwayomi REST client**: test connection, list sources, search, manga, chapters, page URLs.
- **Download manager** (`src/server/downloadManager.ts`): real streaming download with progress, cancel, retry and a disk-space guard.
- **Local file server** (`src/app/api/files/[...path]`): Range requests and a path-traversal guard.
- **Backup / restore** API: JSON export, zod-validated, transactional restore.
- **Proxy password encryption at rest** (`src/lib/crypto.ts`): AES-256-GCM.
- **UI**: app shell, collapsible sidebar, theme/accent init script, Home, Discover, Anime list pages, MediaCard, AddMediaModal, VideoPlayer (HTML5 + hls.js), audio player context and mini-player bar, plus a toast/loading/empty/error kit.
- **API routes** (32): home, media, library, progress, history, downloads, extensions, repositories, search, search-history, settings, profile, proxy test, backup, upload, suwayomi.

### Partially implemented / broken
| Area | Problem |
|---|---|
| Navigation | The sidebar links to `/manga`, `/audio`, `/library`, `/history`, `/downloads`, `/extensions` and `/settings`, and cards link to `/{anime,manga,audio}/{id}`. **None of these pages exist**: only `/`, `/anime` and `/discover`. 7 of 10 nav entries are 404s, and there is no media details page, reader or settings UI. |
| Database | A Postgres server is required, which contradicts local-first and no-mandatory-backend. There are no migrations. |
| SSRF | `safeFetch` follows redirects with no revalidation and has **no private-IP, localhost, link-local or DNS-rebinding protection**. |
| Proxy | SOCKS5 is only handshake-tested. Real requests ignore SOCKS5 (`buildDispatcher` returns `undefined`). |
| Crypto | The key falls back to the hard-coded `"riuplay-local-dev-secret-change-me"`. That gives no real protection. On desktop it should use Electron `safeStorage` (DPAPI). |
| Downloads | The in-memory controller map is lost on restart, which leaves "downloading" rows stale. Downloads have no pause/resume (no Range-resume) and no SSRF check on `sourceUrl`. |
| Backup restore | It omits `extensions` and `downloads`, doesn't reset serial sequences after inserting explicit ids, and doesn't snapshot the existing data before the destructive replace. |
| Extensions | Metadata only. No extension can execute, by design. |
| Docs | `README.md` and `THIRD_PARTY_NOTICES.md` are referenced in comments but **missing**. There is no LICENSE. |
| Tests | **None.** |
| Build scripts | No Windows `.bat` scripts and no packaging. |

### Duplicate / abandoned
- No duplicates found. `readerDefaults` and `chapters` exist in the schema, but no reader UI was ever built.

## 4. Worth preserving
1. **Multi-content domain model** (anime + manga + audio, with episodes/chapters/tracks). This is broader than Hibiki's anime-only model and is RiuPlay's distinctive scope.
2. **Suwayomi REST client** and the **zod-validated Aniyomi index parser** (careful handling of untrusted remote data).
3. **Download manager** logic, the **Range file server** and the **path-traversal guard**.
4. **Honest-UX copy** (no fake content, explicit unsupported states).
5. **Backup format** concept (versioned, validated, transactional).
6. **Proxy settings model** (http/https/socks5 + encrypted password).
7. UI primitives (`ui.tsx`), the theme/accent mechanism and the audio mini-player.

## 5. Should be replaced or refactored
- PostgreSQL → **SQLite** (better-sqlite3), with real migrations.
- Next.js server → **Electron main process + typed IPC**. A Next server inside Electron doubles the runtime and exposes an HTTP port.
- `safeFetch` → SSRF-guarded fetch with per-hop redirect validation and DNS pinning.
- `crypto.ts` key source → Electron `safeStorage`.
- Missing pages → build them, or take them over from the chosen foundation (see `TECHNOLOGY_DECISION.md`).
