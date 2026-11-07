# Dependency Audit

No `node_modules` and no lockfile exist locally (Node is not installed), so versions are as declared. `npm audit` and license checks run in phase 4.

## Current RiuPlay (`package.json`)
| Dependency | Keep? | Note |
|---|---|---|
| next 16.2.6 | ❌ | Replaced by Vite + Electron |
| pg, @types/pg, drizzle pg dialect | ❌ | Replaced by better-sqlite3 |
| drizzle-orm 0.45 / drizzle-kit | ✅ | Hibiki pins 0.39. Unify on the newer version after the tests pass |
| react / react-dom 19 | ✅ | Same as Hibiki |
| hls.js | ✅ | Hibiki also uses it |
| zod 4 | ✅ | For IPC + manifest validation. Hibiki lacks it |
| undici, socks, socks-proxy-agent, https-proxy-agent | ✅ | Real proxy support in the main process |
| lucide-react | ✅ | Hibiki also uses it |
| tailwindcss 4 | ⚠️ | Hibiki uses v3. Stay on v3 at import, migrate to v4 in phase 12 |
| nanoid, dotenv, check-disk-space | ✅ / ❌ / ✅ | dotenv is not needed in a desktop app |

## Inherited from Hibiki (declared)
electron ^34, electron-builder ^25, better-sqlite3 ^11 (native, rebuilt by @electron/rebuild), vite ^6, vitest ^3, @playwright/test, TanStack router/query/virtual, zustand, radix-ui, motion, i18next, cheerio, dashjs, sync-fetch.
- `@xhayper/discord-rpc`: optional, may be dropped.
- `@capacitor/*`: **remove** (Android not in scope).
- `sync-fetch`: review. It spawns a child process per call. Superseded by the brokered host bridge.

## To add
`socks-proxy-agent` (SOCKS5 fetch), `ipaddr.js` (CIDR checks for the SSRF guard), `license-checker` (dev).

---

## Post-import status (2026-11-07)
- `npm ci` installed 839 packages on Node 22.23.4, and better-sqlite3 was rebuilt for Electron 34 (`postinstall`).
- `npm audit fix` (semver-safe) cleared the undici DoS advisory.
- **Remaining production advisory:** `drizzle-orm` < 0.45.2 (high). Fixing it means upgrading 0.39 → 0.45.2, which can break the schema and migrations, so it is scheduled for Phase 5 with the migration tests.
- The remaining advisories are in dev-only tooling (electron-builder, drizzle-kit, vite chain). They will be reviewed before the first release.
- Test setup: the app uses better-sqlite3 (Electron ABI), and the core tests use Node's built-in `node:sqlite`. That is why system Node must be ≥ 22.5.
