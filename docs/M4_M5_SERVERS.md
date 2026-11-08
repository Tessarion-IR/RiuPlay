# M4 / M5: Suwayomi (manga) and Kikoeru (audio) servers

**Status: implemented, and tested against disposable fake servers** (`src/main/connections/connections.test.ts`, 15 contract tests).
- **Not run against a live Suwayomi or Kikoeru server.** The request formats come from the servers' source code, as recorded in `docs/PHASE7_DESIGN.md` §7–8.
- **Not checked by hand in the running app:** the Settings → Media servers panel and the browse screens.

Both integrations are **optional**. RiuPlay installs nothing on a server, and local manga and audio keep working without one.

## How it fits together

```
Settings > Media servers ── IPC (validated, main) ── ConnectionsService ── ConnectionStore (server_connections, migration 0026)
Manga / Audio sections: "From your Suwayomi/Kikoeru server" (FromServers.tsx)
        browse / search ──► SuwayomiClient (POST /api/graphql) | KikoeruClient (REST)
                              └─► M3 controlled path, caller connection:<id>
        "Add" ──► insertMedia(): an ordinary MediaItem, origin "server"
                    library status, progress, Continue Reading/Listening, favourites, collections, search
Reader / player ── riuplay-media://remote/<unit>[/page/<i>], remote-cover/<media>, remote-thumb/<conn>/<ref>
                    └─► main process: looks up the STORED reference, adds the credentials, streams (Range for audio)
```

## Security properties (each one tested)

- **Passwords and tokens stay in the main process.**
  - The password is encrypted with async safeStorage, and stored and listed only as `hasSecret`.
  - The Kikoeru token and the Suwayomi bearer token live in memory only.
  - Stored units hold server paths, never a token.
- **Credentials only ever go to the server's own origin.** A page, cover or stream URL that points at another host is refused **before it is stored**.
- **Local servers need your confirmation.** A server on this computer or the local network only works after you confirm it. That creates the M3 exact-address exception (scheme, host and port) for that one connection. Removing the connection removes the exception.
  - Whether an address is local is decided by the broker's own resolver, through the proxy when one is set. Only names public DNS cannot know (such as `nas`) are asked of the system resolver.
- **Public servers** get every M3 rule: address validation, the proxy, budgets and timeouts.
- **No SSRF route through the media protocol.** `riuplay-media://remote...` serves only references stored in the database (unit, media, connection ids). Anything else is answered with 404; a server error or an unreachable server with 502, never a crash.
- **IPC is validated in the main process.** Each operation has its own narrow handler with checked arguments: ids, numeric refs, page bounds, text lengths, no line breaks in credentials.

## Authentication

| Server | Supported | Not supported |
|---|---|---|
| Suwayomi | none; HTTP Basic; UI login (`login` mutation → Bearer; signs in again once on a 401) | `SIMPLE_LOGIN` (a cookie session for the web UI) |
| Kikoeru | none; account (`POST /api/auth/me` → token, sent as `Authorization: Bearer`) | |

## Data

- **Migration 0026** is additive: one new table, `server_connections`.
- **Server titles** use the existing tables:
  - `local_media`: `origin = "server"`, `origin_ref = "<kind>:<connection>:<id>"`, cover `remote:cover`;
  - units: `remote:suwayomi-chapter:<id>` or `remote:kikoeru-track:<server path>`;
  - chapter pages are filled in the first time a chapter is opened.
- **Removing a connection** leaves its titles in the library. They can't be opened until the server is added again; nothing is deleted.

## Known limitations

- **Pages and tracks don't refresh.** New chapters on the server aren't picked up by a title that was already added (no refresh action yet). Kikoeru `.lrc`/`.vtt` files are not imported yet (Phase 8 lyrics).
- **Translations.** The UI strings are English only so far; Russian and Ukrainian fall back to English.
