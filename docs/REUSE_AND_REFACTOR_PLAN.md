# Reuse and Refactor Plan

## Preservation
The current Next.js tree is moved, not deleted, to `legacy/next-app/` in the first commit. Its logic is then ported module by module. It is removed only once every listed item is ported, and only with owner approval.

## Port map: existing RiuPlay → new structure

| Existing file | Destination | Change |
|---|---|---|
| `src/db/schema.ts` (pg) | `src/core/db/schema.ts` (sqlite) | Merge with Hibiki tables. `jsonb` → `text` JSON, `serial` → integer PK. Add `media_source_links`, `collections`, `categories`, `watch_progress` per unit. |
| `src/server/queries.ts` | `src/core/api/{media,library,history}.ts` | Synchronous better-sqlite3 calls, generalised content type. |
| `src/server/providers.ts` (index parser, Suwayomi) | `src/core/providers/{aniyomiIndex,suwayomi}.ts` | Keep the zod schemas. Route through guardedFetch. |
| `src/server/net.ts` | `src/core/net/guardedFetch.ts` | Add the SSRF guard, redirect revalidation and real SOCKS5 (socks-proxy-agent). |
| `src/server/downloadManager.ts` | merge into Hibiki `core/api/downloads.ts` | Add Range resume, pause and persistent queue. |
| `src/server/storage.ts` | `src/core/storage.ts` | Rooted in `app.getPath('userData')`. |
| `src/lib/crypto.ts` | `src/platform/electron/secrets.ts` | Electron `safeStorage` (DPAPI). |
| `src/app/api/backup/*` | `src/core/backup/` | Snapshot before restore, cover all tables, schema version. |
| `src/app/api/files/[...path]` | custom `riuplay-file://` protocol handler | Same Range + traversal logic. |
| `src/components/AudioPlayerContext.tsx`, `MiniPlayerBar.tsx` | `renderer/features/audio/` | Upgraded with the KikoFlu queue/session-restore ideas. |
| `src/components/ui.tsx`, `AddMediaModal.tsx` | `renderer/components/` | Restyled to the RiuPlay design tokens. |
| Next API routes (32) | typed IPC handlers | 1:1 behaviour. |

## From Hibiki (taken as base, then modified)
`src/main`, `src/preload`, `src/platform/electron`, `src/core/{db,extensions,api,logger,platform}`, `src/renderer` shell, pages, player, `electron-builder.yml`, `vite*.config.ts`, tests.
**Dropped or optional:** Android/Capacitor tree, AniList tracker (needs a secret), Discord RPC (opt-in), achievements/XP (opt-in), LAN sync (later).

## Refactors required on Hibiki code
1. Extension execution moves from `worker_threads` + `node:vm` to an Electron **utilityProcess** with no Node built-ins exposed, with all network brokered through guardedFetch + manifest host allow-list. `vm` is not a sandbox.
2. Marketplace adds a **SHA-256 integrity** field in the index, an explicit **consent dialog** on install/update showing permissions, and a **RiuPlay API version range** (the Suwayomi lib-version idea).
3. Domain generalisation: `AnimeTitle` → `MediaItem`, `PlaybackGroup` → `Unit` list.
4. Branding: product name, appId `com.riuplay.desktop`, protocol `riuplay://`, icons.
