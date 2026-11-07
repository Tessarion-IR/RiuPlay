# Phase 7 Design: Sources, Extension Security, Networking, Suwayomi and Kikoeru

Status: **proposal, awaiting owner approval. No code has been changed for Phase 7.**
Basis: the code at commit `2e544bb`, plus the actual source of Suwayomi-Server @ `7b061be` and KikoFlu @ `d8a8c61`.

---

## 0. What exists today (findings from the code)

| Area | Current state | Problem |
|---|---|---|
| Extension execution | `src/main/extensions/execute.ts`: scripts run in `node:vm` contexts inside `worker_threads` in the **main Electron process tree**. Host globals (`globals.ts`): synchronous `fetch`/`fetchAll`, `Jsoup` (cheerio), `Gzip` (zlib), `Url`, `storage`, `challenge`, `browserFetch`, `console`. | `node:vm` is **not a security boundary**. One well-known escape (`this.constructor.constructor("return process")()`) gives a script the full Node API: files, processes, raw sockets. |
| Extension network | `core/extensions/netFetch.ts` fetches **any URL** a script asks for, with `redirect: "follow"`. | No host restriction, no private-network blocking, no redirect checks (SSRF). |
| APK sources | `apk-host/` runs Aniyomi APK code in a **JVM with the user's full rights**. Only enabled when Java 17+ is found. | Can't be sandboxed with the tools we have today. |
| Hidden browser windows | `browserFetchHost`, `browserResolveHost`, `challengeWindow`, `webLogin`: sandboxed Chromium windows that load third-party pages for scripts. | Sandboxed, but a script can point them at **any URL**, including LAN addresses. |
| Repositories | No preinstalled repository since Phase 5. Adding one shows a trust prompt. | The index has no integrity data. Installs and updates show no permissions (there are none). There is no compatibility window and no obsolete detection. |
| Proxy | One string in **renderer `localStorage`** (Settings → Network). It's applied to Chromium sessions, and to Node requests only when it is `http(s)://`. | Credentials in plaintext `localStorage`. **SOCKS5 isn't spoken by Node, so extension traffic silently bypasses a SOCKS proxy.** |
| Original RiuPlay Suwayomi client | `legacy/next-app/src/server/providers.ts` calls `/api/v1/settings/about`, `/api/v1/source/list`, `/api/v1/source/{id}/search`, `/api/v1/manga/{id}/chapters`. | **Those REST endpoints no longer exist** in current Suwayomi. Only images, page and chapter-download routes remain REST (`MangaAPI.kt`); everything else moved to GraphQL. The client must be rewritten, not ported. |
| Kikoeru | Not present. | — |

---

## 1. Milestones (in execution order)

The owner's M1–M5 are kept. They are **executed in dependency order**: the network foundation comes first, because the sandbox, the lifecycle and both server integrations make their requests through it.

| Order | Milestone | Delivers | Depends on |
|---|---|---|---|
| 1 | **M0 Research spikes** (time-boxed, nothing merged unless proven) | Answers to §6 R1–R3 before committing to an isolation design | — |
| 2 | **M3 Networking and proxy** | `guardedFetch`, SSRF protection, HTTP/HTTPS/SOCKS5 proxies with authentication, credentials in `safeStorage`, per-connection private-network allowance, network security tests | — |
| 3 | **M2 Extension security** | Out-of-process sandbox, enforced permissions, resource limits, malicious-extension tests | M3, M0 |
| 4 | **M1 Lifecycle and trust** | Repository records, manifest v1, integrity checks, consent and re-consent, compatibility window, update/obsolete detection, deferred deletion, attribution/licence display | M2 (permissions exist to consent to) |
| 5 | **M4 Suwayomi** (optional) | Connection setup, GraphQL client, browse/search/read in the **Manga** section, add to the unified library, authenticated page proxy, disconnection handling | M3 |
| 6 | **M5 Kikoeru** (optional) | Connection setup, browse/search in the **Audio** section, works → unified media, authenticated stream proxy, disconnection handling | M3 |
| 7 | **Wrap-up** | Matrix and docs, full suites 3×, end-to-end run in the real app, local commits | all |

Each milestone ends with: tests green, Phase 6 end-to-end checks still passing (no regression), and a local commit.

---

## 2. Extension security architecture (M2)

### 2.1 Goal
A malicious or compromised extension must not be able to:
- read or write user files;
- start processes;
- reach `localhost`, the LAN or cloud metadata;
- contact hosts it didn't declare;
- read other extensions' data, cookies or RiuPlay's credentials;
- freeze or exhaust the app.

### 2.2 Proposed design: Chromium-sandboxed extension host

```
Main process (privileged)
 ├─ ExtensionSupervisor   one host per extension (or small pool), spawn/kill, watchdog (time, memory)
 ├─ CapabilityBroker      every host call goes here: checks the extension's granted permissions,
 │                        then performs it (guardedFetch, storage, hidden-browser fetch)
 └─ protocol riuplay-ext-host://   the only door from the sandbox to the broker
        ▲  synchronous XHR from a Web Worker (scripts need synchronous fetch)
        │
Extension host  = hidden BrowserWindow, sandbox: true, contextIsolation, no Node, no preload API,
 (Chromium renderer        its own in-memory session partition (no shared cookies/storage),
  sandbox: restricted      webRequest: every request except riuplay-ext-host:// is cancelled,
  token / low integrity)   CSP: default-src 'none'; connect-src riuplay-ext-host:
   └─ Web Worker: host shim (fetch, Jsoup via bundled cheerio, Gzip via fflate, Url, storage)
                  + the extension script, evaluated in the worker
```

Why this design:
- The **Chromium renderer sandbox** is a real OS-level boundary on Windows (restricted token, low integrity, no file system, no process creation). `node:vm` isn't one.
- Scripts are written for **synchronous** `fetch()` (Rhino heritage). Synchronous XHR is allowed in Web Workers, and Electron serves custom-protocol XHR from an **async** main-process handler. So the main process stays non-blocking and the script still sees a synchronous call. *(This has to be proven in spike R1.)*
- All capability use goes through **one** broker, which makes permissions enforceable and testable in plain Node.

**Fallback if R1 fails:** Electron `utilityProcess` (a separate OS process, no shared memory with main) + `node:vm` + Node's permission model (`--experimental-permission`, with no `--allow-fs-*`, `--allow-child-process` or `--allow-worker`), with network only through the broker over IPC. This is weaker: Node 20's permission model doesn't restrict raw sockets, so a `vm` escape could still open connections. That residual risk would be documented.

### 2.3 Resource limits (enforced by the supervisor)

| Resource | Limit (defaults) |
|---|---|
| Wall time per call | 30 s (configurable 15–45 s, as today); the host is killed and restarted on overrun |
| CPU busy loop | Covered by the wall-time kill. The worker is terminated, not asked |
| Memory | Host process private memory checked every 2 s (`app.getAppMetrics`); kill above 512 MB |
| Requests | ≤ 8 in flight per extension; ≤ 120 per minute per extension |
| Response body | 8 MB per response (as the original RiuPlay); 32 MB cap on decompressed size (gzip bombs) |
| Script size | ≤ 2 MB per extension script; manifest ≤ 64 KB; repository index ≤ 12 MB (as the original RiuPlay) |
| Storage | ≤ 1 MB per extension key/value store |
| Hidden browser windows | ≤ 2 per extension at once, 45 s each |

### 2.4 What stays outside the sandbox (honest limits)
- **APK host (JVM).** It can't be put in a Chromium sandbox. Plan: **off by default** behind an explicit "run Aniyomi APK extensions with full user rights" opt-in with a clear warning. Real isolation (Windows AppContainer / restricted token + job object) is research item R4.
- **Hidden browser windows** for Cloudflare challenges, logins and browser-runtime resolvers stay Chromium-sandboxed. Their URLs must pass the extension's host permissions and the SSRF check, and each extension gets its own partition.

---

## 3. Permissions model (manifest v1)

A RiuPlay extension manifest gains these fields:

```json
{
  "id": "example-source",
  "name": "Example",
  "version": "1.2.0",
  "riuplayApi": ">=1 <2",
  "author": "Jane Doe",
  "license": "MIT",
  "homepage": "https://github.com/jane/example-source",
  "contentTypes": ["video"],
  "nsfw": false,
  "permissions": {
    "network": { "hosts": ["example.com", "*.cdn.example.com"], "http": false },
    "browser": false,
    "login": false
  }
}
```

| Permission | Grants | Never grants |
|---|---|---|
| *(none, implicit)* | Running its own code, its own storage (1 MB), logging | — |
| `network.hosts` | HTTPS requests to the listed hosts (`*.` = subdomains), through `guardedFetch` | Private, loopback, link-local or metadata addresses, **whatever the host list says** |
| `network.http: true` | Plain HTTP to those hosts | — |
| `browser` | Cloudflare challenge / `browserFetch` windows, on listed hosts only | Navigation outside the listed hosts |
| `login` | Opening a login window for a listed host; cookies kept in the extension's own partition | Other extensions' cookies |
| *(no file-system permission exists)* | — | Any file access, ever |
| *(no process permission exists)* | — | Starting programs, ever |

**Legacy hibiki extensions** (no `permissions` field) have a declared `website` but contact many mirrors and CDNs. They're shown as **"Legacy extension: can contact any public website"**. They're installed only after that consent, still go through the sandbox and SSRF rules, and are never allowed private addresses.

**Consent rules:**
- Install shows the name, author, repository, licence ("No licence stated" when absent), integrity status, permissions and NSFW flag.
- An update that **adds** permissions or hosts asks for consent again; otherwise it's a one-click update.
- Nothing installs or updates on its own.
- Permissions can be revoked: the extension is then disabled until permissions are granted again.

---

## 4. Lifecycle and trust (M1)

| Function | Behaviour | Origin of the idea |
|---|---|---|
| Repository records | Name, URL, added date, last refresh, status, error, extension count; HTTPS only; never trusted by default; the trust prompt stays | Original RiuPlay `repositories` table + Suwayomi `ExtensionStoreTable` |
| Index formats | RiuPlay index v1 (adds `sha256`, `riuplayApi`, `license`, `permissions`), hibiki `repository/index.json` (legacy), Aniyomi `index.min.json` (metadata only unless the APK host is opted in) | RiuPlay zod validation (prototype) |
| Integrity | RiuPlay v1: script and manifest SHA-256 must match the index or the install is refused. Legacy indexes: installed as **"integrity unverified"**, shown in the UI | New |
| Compatibility | `riuplayApi` semver range checked before install and before every load; incompatible → blocked, with the reason shown. hibiki's host-API gate kept for legacy | Suwayomi `LIB_VERSION_MIN..MAX` |
| Updates | On refresh: `hasUpdate` (newer version), `obsolete` (gone from its repository), persisted in the DB, shown in Sources | Suwayomi `ExtensionsList` |
| Uninstall | Removes files and storage. If a host is running it, the files are deleted at next start (pending-delete list) | Suwayomi deferred deletion |
| Attribution | Every source shows author, licence, homepage, repository and version | New |

---

## 5. Networking threat model (M3)

### 5.1 Assets
- Files on the PC.
- Services on `localhost` and the LAN (router admin, NAS, dev servers, the user's own Suwayomi and Kikoeru).
- Cloud metadata endpoints.
- Credentials: proxy password, server passwords and tokens, source login cookies.
- The user's privacy (IP address, which titles they watch).

### 5.2 Threat actors
1. A malicious or compromised extension (or repository).
2. A malicious response from a source site or a user's server.
3. A network attacker (MITM on HTTP, rogue DNS).
4. A malicious page inside a hidden browser window.

### 5.3 Threats and controls

| Threat | Control |
|---|---|
| SSRF to private networks | `guardedFetch` resolves **all** addresses of the host and refuses if **any** is in a blocked range (list below). The connection is made to the **validated IP** (undici `connect.lookup`), so there is no second DNS lookup and no **DNS rebinding** window |
| Tricky address forms | The WHATWG URL parser normalises decimal, octal and hex IPv4. Explicit handling covers IPv4-mapped and NAT64 IPv6 (the embedded IPv4 is checked), `localhost`, `*.localhost`, trailing dots, and IPv6 zone IDs (refused) |
| Redirect to a private address or a downgrade | Redirects are followed **manually**, max 5, each hop re-validated (scheme, host permission, IP ranges). `https → http` is refused for extensions. `Authorization`/`Cookie` headers are stripped on cross-origin hops |
| Blocked ranges | IPv4: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4. IPv6: ::/128, ::1, ::ffff:0:0/96 (→ IPv4 check), 64:ff9b::/96 (→ IPv4 check), 100::/64, 2001:db8::/32, fc00::/7, fe80::/10, ff00::/8 |
| The user's own LAN servers | A Suwayomi or Kikoeru **connection** may be on the LAN or localhost only when the user confirms it ("This server is on your local network"). The allowance is **scoped to that connection's exact host and port**, and extensions never get it |
| Resource exhaustion | Timeouts, body caps, decompressed-size cap, concurrency and rate limits (§2.3) |
| Proxy leaks | One network policy for Chromium sessions **and** Node. SOCKS5 spoken by Node too (`socks-proxy-agent`). If a configured proxy can't be used, requests **fail** rather than silently going direct |
| Proxy and SSRF | HTTP CONNECT proxies receive a host name and resolve it themselves. RiuPlay validates locally first, but the proxy's own resolution can differ: a **documented residual risk**. SOCKS5 defaults to local resolution + validated IP; a "resolve through proxy" privacy option would lose IP pinning and say so |
| Credential exposure | Proxy and server secrets are encrypted with Electron `safeStorage` (Windows DPAPI, per user) and stored in the DB as ciphertext. They never go to `localStorage` and never back to the renderer (it only sees `hasPassword`). The logger redacts `Authorization`, `Proxy-Authorization`, `Cookie`, `token=` and `user:pass@`. The existing plaintext proxy string is **migrated** into the new store and removed from `localStorage` (the only data change, announced in the changelog) |
| Server tokens in URLs | Kikoeru stream URLs carry `?token=`. RiuPlay never stores those URLs: the renderer gets `riuplay-media://remote/<unitId>`, and main adds the credentials when it proxies the request |
| Extension-provided media URLs | Stream URLs returned by extensions are checked against the same private-range rule before reaching the player (user-entered URLs may be private, since the user chose them) |
| New listening services | **None.** Everything is outbound, or a custom protocol inside the app |

---

## 6. Research needed first (time-boxed in M0 or postponed)

| # | Question | Why it matters | Plan |
|---|---|---|---|
| R1 | Can a Web Worker in a sandboxed hidden window make **synchronous XHR** to an Electron custom protocol whose handler is async, reliably and fast enough? | It decides the sandbox design (§2.2) | Spike in M0. If not, use the utilityProcess fallback and document the residual risk |
| R2 | Do hibiki's host shims (`Jsoup` on cheerio, `Gzip` on zlib) run in a browser worker? | Compatibility with existing scripts | Bundle cheerio for the browser, use fflate (already a dependency). Test against our own fixture extensions, plus (locally, not committed) a few real hibiki-sources scripts, since that repository has no licence |
| R3 | Can memory be capped per sandbox process, or only watched? | Resource limits | Measure with `app.getAppMetrics`. Fall back to watchdog kill |
| R4 | Can the JVM APK host be confined on Windows (AppContainer, restricted token, job object)? | APK sources run with full rights | **Postponed.** Off by default with an explicit opt-in until solved |
| R5 | Suwayomi `SIMPLE_LOGIN` and `UI_LOGIN` (JWT `login`/`refreshToken`) and the CSRF handling in `BASIC_AUTH` | Auth against real servers | Implement `NONE` + `BASIC_AUTH` + `UI_LOGIN` against a mock. **Real-server verification needs a running Suwayomi (Java 21; this PC has Java 8)**, so it is postponed until the owner can run one |
| R6 | Kikoeru server variants (kikoeru-express versions, auth on/off) | Compatibility | Implement the self-hosted API as KikoFlu uses it. Real-server verification needs the owner's server |
| R7 | Signed repository indexes (Ed25519/minisign) | Integrity beyond "matches the index" | **Postponed**: needs a key-distribution design. Phase 7 delivers SHA-256 integrity + re-consent |
| R8 | Content filtering of hidden-browser navigation by host permission | `browser` permission | Implement with `webRequest` on the extension's partition. Verify behaviour across redirects in M2 |

### Postponed outright (not in Phase 7)
- Running Tachiyomi/Mihon **manga** APKs natively: only through the user's Suwayomi server.
- The official asmr.one service: **not preconfigured** (third-party, legally sensitive content). Kikoeru support targets **self-hosted** servers the user runs. A user may still enter any URL.
- Syncing progress back to Suwayomi or Kikoeru (`updateChapter` read state, Kikoeru `/api/progress`): read-only integration first. Write-back is an opt-in follow-up.
- Signed repositories (R7) and APK host isolation (R4).

---

## 7. Suwayomi integration (M4)

**Endpoints** (from Suwayomi-Server source, `JavalinSetup.kt`, `GraphQL.kt`, `MangaAPI.kt`):

| Purpose | Call |
|---|---|
| Health / version | `POST {base}/api/graphql` → `query { aboutServer { name version buildType } }` |
| Installed sources | `query { sources { nodes { id name lang displayName isNsfw iconUrl } } }` |
| Browse / search | `mutation fetchSourceManga(input: { source, type: SEARCH \| POPULAR \| LATEST, page, query }) { mangas { id title thumbnailUrl } hasNextPage }` |
| Title details | `mutation fetchManga(input: { id }) { manga { id title description genre author status thumbnailUrl } }` |
| Chapters | `mutation fetchChapters(input: { mangaId }) { chapters { id name chapterNumber sourceOrder pageCount } }` |
| Pages | `mutation fetchChapterPages(input: { chapterId }) { pages }` (page URLs), images via REST `GET {base}/api/v1/manga/{mangaId}/chapter/{chapterIndex}/page/{index}` |
| Cover | `GET {base}/api/v1/manga/{mangaId}/thumbnail` |
| Auth | `NONE`; `BASIC_AUTH` (HTTP Basic); `UI_LOGIN` (`mutation login(input:{username,password}) { accessToken refreshToken }`, then `Authorization: Bearer`, renewed with `refreshToken`). `SIMPLE_LOGIN` is cookie-based for the web UI, so RiuPlay asks for one of the others (R5) |

**In RiuPlay:**
- Settings → **Connections** → Add Suwayomi server: URL, auth, test connection (shows version), and an explicit "local network" confirmation when the server is private.
- The **Manga** section gets a "From your Suwayomi server" area: pick a source, search or browse, open a title.
- "Add to library" creates a unified `MediaItem` (`origin: "server"`, reference `suwayomi:<connection>:<mangaId>`). Its chapters become units, and pages are resolved through `riuplay-media://remote/...`, so they go through main with credentials.
- Native manga (files, URLs) never depends on Suwayomi. If the server is offline, its titles stay in the library with a "server unreachable" state and a retry. Nothing is deleted.

---

## 8. Kikoeru integration (M5)

**Endpoints** (from KikoFlu `kikoeru_api_service.dart`, self-hosted variant):

| Purpose | Call |
|---|---|
| Health | `GET {base}/api/health` |
| Login (when enabled) | `POST {base}/api/auth/me` `{ name, password }` → `{ token }`, then `Authorization: Bearer <token>` |
| Works list | `GET {base}/api/works?page&pageSize&order&sort&seed` |
| Search | `GET {base}/api/search/{keyword}?page&pageSize` |
| Work details | `GET {base}/api/work/{id}` |
| Track tree | `GET {base}/api/tracks/{id}` → folders and files (`type`, `title`, `hash`, `duration`, `mediaStreamUrl`) |
| Stream | `GET {base}/api/media/stream/{hash}` (auth by header or `?token=`), with HTTP Range |
| Cover | `GET {base}/api/cover/{id}?type=main` |

**In RiuPlay:**
- Settings → Connections → Add Kikoeru server (same flow as Suwayomi).
- The **Audio** section gets a "From your Kikoeru server" area: browse and search works.
- "Add to library" creates a unified `MediaItem` (`origin: "server"`, `kikoeru:<connection>:<workId>`). Audio files in the track tree become track units in folder order. `.lrc`/`.vtt` files beside tracks are kept for Phase 8 lyrics.
- Streams go through `riuplay-media://remote/<unitId>`: main adds the token and passes Range through, so the token never reaches the renderer or the DB.
- Local audio is unaffected. An unreachable server shows a clear state; nothing is deleted.

---

## 9. Data changes (all additive)

Migration `0025`:
- `server_connections` (id, kind, name, base URL, auth mode, username, `secret_enc` (safeStorage ciphertext), `allow_private_network`, status, last check)
- `extension_records` (source id, repository, version, sha256, integrity status, `riuplay_api`, granted permissions JSON, licence, author, homepage, `has_update`, `obsolete`, `pending_delete`, installed at)
- `source_repositories` gains nullable metadata columns: name, status, error, last refreshed, extension count. Additive `ALTER TABLE ADD COLUMN`, with defaults

`MEDIA_ORIGINS` gains `"server"`. Existing rows are untouched. The pre-migration snapshot (Phase 5) protects the upgrade.

---

## 10. Tests to be added

| Area | Tests |
|---|---|
| Network | Every blocked range (v4/v6, mapped, NAT64); decimal/octal/hex hosts; `localhost` variants; DNS answers mixing public and private; rebinding (second lookup different), proved impossible by pinning; redirect to private, redirect loop, >5 hops, https→http; header stripping; body and decompression caps; timeouts; proxy HTTP/HTTPS/SOCKS5 with and without auth against local test proxies; "proxy down → request fails, never goes direct"; credentials never in logs |
| Sandbox | Fixture extensions that try `require`, `process`, `vm` escape, `fs`, `child_process`, `XMLHttpRequest`/`fetch` to arbitrary origins, an undeclared host, `127.0.0.1`, `169.254.169.254`, an infinite loop, a memory bomb, a huge response, oversized storage. All must be refused or killed, and the app stays responsive |
| Lifecycle | Index parsing (three formats); sha256 mismatch refused; incompatible `riuplayApi` blocked; update with new permissions requires re-consent; `hasUpdate`/`obsolete`; deferred deletion across restart; no repository auto-trusted |
| Suwayomi / Kikoeru | Mock servers: connection test, each auth mode, browse, search, details, chapters/tracks, page/stream proxy with Range, **server down mid-request**, 401 and token refresh, malformed responses, private-network allowance required and scoped |
| Regression | Phase 6 unit tests + the 25-check end-to-end run, unchanged |
