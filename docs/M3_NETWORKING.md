# M3 Networking: the controlled request path

Status: **implemented and tested.** The follow-up (Chromium parity, a user-started migration, backup redaction, stream checks, Discord, a partitioned cache) is described in §6 and §9.
Scope: M3 only. There is no extension sandbox, no hidden extension windows, no Suwayomi/Kikoeru and no Settings UI change.

## 1. What changed, in one paragraph

Before M3, main-process HTTP went out in three different ways:
- `platform.http` used undici with an optional `ProxyAgent`. That covered only `http(s)://` proxies: a **SOCKS proxy was silently ignored** and the requests went **direct**.
- Downloads used Node's global `fetch`. This **always bypassed the proxy**.
- The player's redirect pre-resolver used the global `fetch` too. It **bypassed the proxy** and **logged full stream URLs**.

None of them checked where a request went: an extension could reach `127.0.0.1`, the LAN or `169.254.169.254`.

Now all three use one client, `src/main/net/client.ts`. It:
- refuses private and local destinations in every spelling;
- pins the address it validated;
- re-validates every redirect;
- applies the configured HTTP, HTTPS or SOCKS5 proxy, or refuses the request, and never goes direct instead;
- resolves names behind a proxy *through* the proxy;
- caps bodies and time, and budgets every caller.

## 2. Architecture

```
extension fetch() ──► runtime.ts bridge (caller = extension:<sourceId>, set by the host)
                         └─► core/extensions/netFetch.ts ─► platform.http.request({caller})
core: marketplace, updates, AniList, skip times, HLS playlists ─► platform.http.request({caller})
core/api/downloads.ts (files, segments) ─► platform.downloads.fetchToFile  (caller = download)
main/playerStream.ts (redirect pre-resolve) ─► netClient.stream (caller = app:player)
                                                  │
platform/electron/http.ts, downloadTransfer.ts ───┤
                                                  ▼
                       main/net/client.ts  NetClient   (one instance: main/net/state.ts)
   budgets.ts ── per-caller in-flight / queue / token-bucket rate / hourly bytes; global cap
   policy.ts  ── caller → limits, local-server allowance (connection callers only)
   resolve.ts ── system | DoH direct (fallback: system) | DoH THROUGH the proxy (no fallback)
   addresses.ts ─ blocked ranges (IPv4, IPv6, embedded IPv4)
   connector.ts ─ connects to the validated IP: direct | HTTP CONNECT | HTTPS proxy | SOCKS5
   proxy.ts / secureProxyStore.ts / state.ts ── effective proxy (fail closed)
   redact.ts / errors.ts ── what may be logged; NetError codes
```

There is no listening socket, external broker, background service or telemetry. All of it runs in the main process. The packaged-app smoke test checks for listening sockets: the only one is the test's own DevTools port.

### 2.1 One request, hop by hop

1. **Parse** with the WHATWG URL parser, which normalises decimal, octal and hex IPv4 (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`).
2. **Basic refusals.** Only `http:` and `https:` are allowed; userinfo in the URL is refused (`credentials-in-url`); IPv6 zone IDs are refused; host names are lower-cased with trailing dots removed.
3. **Name refusals.** `localhost` and `*.localhost` are refused unless a local-server allowance covers this exact scheme, host and port.
4. **Resolve all addresses** with the active resolver (§4). The resolver must return only IP addresses; anything else is `dns-failed`.
5. **Refuse if *any* address is blocked.** A mixed public/private answer is refused outright. The blocked ranges are listed in `addresses.ts`, and IPv6 forms that embed an IPv4 address (mapped, NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, compatible, 6to4) are judged by that IPv4 address.
6. **Connect to the validated address** through `connector.ts`, never to the name. The connector is pooled per validated address and proxy, so keep-alive still works. TLS uses SNI and certificate checks against the real name. A proxy gets the **IP literal** (`CONNECT 93.184.216.34:443`, SOCKS5 ATYP 1/4), never the name. So, unlike the Phase 7 draft feared, a proxy cannot resolve the name differently.
7. **Redirects** are followed manually, at most 5. Each hop goes through steps 1–6 again. HTTPS → HTTP is refused (`downgrade`). On a cross-origin hop (scheme, host or port changes), `Authorization`, `Cookie` and `Proxy-Authorization` are dropped. 301/302 after POST and 303 become GET without the body. `redirect: "manual"` returns the 3xx itself, unfollowed.
8. **Body.** Gzip, deflate and br are decompressed manually, under a raw-size cap *and* a decoded-size cap (zip-bomb protection). Bytes count against the caller's hourly quota as they arrive. Transport headers (`Host`, `Connection`, `Transfer-Encoding`, `Content-Length`, `Proxy-*`, `Accept-Encoding`, …) belong to the transport, and anything the caller sets for them is dropped.

### 2.2 Callers, limits and budgets

| Caller | Who | Body / decoded cap | In flight / queue | Rate | Bytes per hour |
|---|---|---|---|---|---|
| `extension:<id>` | a source's `fetch()`, per source | 8 MB / 32 MB | 8 / 64 | burst 60, then 2 per second | 256 MB |
| `download` | episode files, HLS segments and playlists | streamed, no cap | 16 / 1024 (outside the global cap) | – | – |
| `app:<purpose>` | updates, repositories, AniList, skip times, player probe, DNS | 32 MB / 64 MB | 16 / 256 | – | – |
| `connection:<id>` | M4/M5 servers (not used yet) | 64 MB / 128 MB | 8 / 128 | burst 120, then 10 per second | – |
| global | everything except downloads | | 32 | | |

Timeouts:
- A buffered request has one deadline for the whole chain: Settings > Network's request timeout (15–45 s) for extensions, or the caller's own.
- A streamed request has a deadline for the headers, then a 60 s idle timeout between body chunks.
- Connect and proxy handshakes have 15 s each.

Refusals are explicit NetError codes: `too-many-requests`, `rate-limited`, `quota-exceeded`, `body-too-large`, `decoded-too-large`, `timeout`.

`netFetch.ts` retries only transport failures (`timeout`, `connect-failed`, `dns-failed`), and never a refusal by policy or a proxy failure.

The caller tag in `HttpRequest.caller` comes from main-process code only. The extension bridge sets `extension:<sourceId>` from the call it is serving, so a script can't choose it. A tag that claims `connection:` is downgraded to an app request (`parseCaller`), so shared code can never claim a local-server exception.

## 3. Proxies

### 3.1 Kinds and fail-closed behaviour

All three proxy kinds use the same pinned connector:
- **HTTP**: CONNECT, with Basic `Proxy-Authorization`.
- **HTTPS**: TLS to the proxy itself, with its certificate verified, then CONNECT.
- **SOCKS5**: RFC 1928/1929, with optional user name and password (`socks` 2.8.9, MIT; it was already in the lockfile and is now a direct dependency).

Plain-HTTP targets are tunnelled too, so a proxy never gets an absolute-URI request with a name in it.

A configured proxy is never bypassed:

| Situation | Result |
|---|---|
| proxy unreachable, refuses the tunnel, sends 407, rejects the SOCKS authentication, accepts but never answers, or drops the tunnel | `proxy-failed`; the target sees nothing; no direct retry |
| legacy proxy string unparseable (Chromium rule lists such as `http=a;https=b`, PAC, `socks4://`, a path, a bad port) | `proxy-invalid` for **every** request: no DNS query, no connection |
| stored record damaged, password undecryptable (profile moved to another account, DPAPI key lost), OS encryption unavailable, or loading timed out | `proxy-unavailable` for every request |
| `NO_PROXY`, `HTTP_PROXY` environment variables | ignored |

Before M3, Node went **direct** for SOCKS proxies and rule lists. That is a behaviour change, and a deliberate one.

### 3.2 Which proxy applies

The effective proxy is chosen in `state.ts`, in this order:
1. **The encrypted store** (`app_settings` key `network.proxy`, see §5):
   - ok → it is used;
   - damaged → `proxy-unavailable` (fail closed);
   - disabled or absent → go to step 2.
2. **The legacy Settings > Network string.** The renderer hands it over at runtime, exactly as before. It is parsed **in memory only**: never persisted, moved or deleted by the main process.
3. **No proxy**: requests go direct.

Chromium sessions (player, posters, the challenge windows) keep getting the legacy proxy through `session.setProxy`, unchanged.

At startup, requests wait (at most 10 s) for the encrypted record to load, so no early request goes out on the wrong path.

## 4. DNS, and the SOCKS5 DNS question from M0

**What M0 found.** With SOCKS5 there are two choices:
- resolve locally, then connect by IP (`socks5`), which leaks the DNS query outside the proxy;
- let the proxy resolve (`socks5h`), which makes IP validation and pinning impossible: RiuPlay could not see, and so could not refuse, the address the proxy connects to.

**What M3 does.** Behind any proxy (HTTP, HTTPS or SOCKS5), names are resolved by **DNS-over-HTTPS sent through that same proxy** to **IP-literal** resolvers:
- `https://1.1.1.1/dns-query`
- `https://8.8.8.8/resolve`
- `https://94.140.14.14/resolve`

Their TLS certificates are verified to cover the IP. Because they are IP literals, asking them needs no DNS lookup of its own. The answers are then validated and pinned like any others.

- **No DNS query leaves outside the proxy.** The test spies on `dns.lookup` (callback and promise forms) and asserts that no name was ever looked up. The only lookup seen is Node passing the proxy's own IP literal through `lookup`, which reveals nothing.
- **No fallback.** If all three endpoints fail, the request fails with `dns-failed`. It never falls back to the system resolver.
- `socks5h` (remote resolution) is **not offered**, because it defeats address validation.
- **Opt-in local DNS.** A proxy that blocks DoH can be stored with `dnsMode: "local"`. This is an explicit choice, documented as a privacy trade-off: DNS queries then leave outside the proxy. The legacy string always uses DoH through the proxy.

**Without a proxy**, behaviour is unchanged:
- with DoH set in Settings > Network, the provider is asked directly, and its system-DNS fallback is kept;
- otherwise the system resolver answers.

Chromium's own resolver is configured as before (`app.configureHostResolver`).

**Name-to-address answers are not shared across modes.** Every proxy or DoH change resets the resolver cache and closes every pooled connection.

## 5. Encrypted proxy store

`secureProxyStore.ts` stores the proxy as a versioned JSON record in `app_settings` under `network.proxy`. The record holds:
- `kind`, `host`, `port`, `username`, `dnsMode`, `enabled`;
- `passwordCiphertext`.

How the password is protected:
- **Encrypted asynchronously only.** The password is encrypted with Electron 45's asynchronous API through `main/net/electron.ts`: `safeStorage.isAsyncEncryptionAvailable()`, `encryptStringAsync()` and `decryptStringAsync()`. No new synchronous `safeStorage` call exists. The existing source-token store is unchanged and still uses the synchronous API; that deprecation is tracked in P0.
- **Never stored in plaintext.** When OS encryption is unavailable, saving a password **fails**.
- **Verified before it is written.** Every save decrypts the ciphertext again and compares it with the input before writing, so a record that can't be read back never replaces a working one.
- **Never sent to the renderer.** The renderer only sees a summary with `hasPassword`. Errors and logs are redacted: the password and its Basic-auth base64 are scrubbed, as are `user:pass@` and `token=` query parameters.

IPC: `network:secureProxy:status`, `:set`, `:clear` and `:verify`, plus `network:legacyProxy:migrate`. The renderer reaches them through `window.hibiki.network.secureProxy`, and the Settings > Network "Encrypted proxy" panel uses them.
- **`verify`** checks both paths against `https://1.1.1.1/cdn-cgi/trace`, an IP literal:
  - one request on the controlled path;
  - one page load in a hidden, sandboxed window of the default session (Chromium).

  It runs only when the user presses Verify.
- **Writes are serialized.** All writes go through one in-process queue (the store is a singleton). The writes that must not race are single conditional SQL statements (`settingsStore.ts`: insert-if-absent and compare-and-swap, each reporting success through `RETURNING`).

## 6. Legacy proxy migration: implemented, user-started only

**Status:** implemented and tested with synthetic data in temporary stores. It **never runs by itself**, and it has not been run against any real profile. The only entry point is Settings > Network > Encrypted proxy > "Move it to encrypted storage…", followed by a confirmation. A test enforces that `legacyProxyMigration.ts` is imported only by that IPC handler.

### 6.1 Where the legacy proxy lives (from the code, no profile read)

- **Renderer store:** zustand `useNetworkPrefsStore`, persisted under the localStorage key `hibiki-network-prefs` as `{"state":{…,"proxy":"<string>","doh":…},"version":0}`. That is plaintext, in Chromium's Local Storage inside the RiuPlay profile.
  - The key keeps its Hibiki-era name so existing data still loads.
- **Accepted format:** the Settings field accepts `http(s)://[user[:password]@]host:port` and `socks5://…`.
  - `socks://` is now refused as ambiguous (6.5).
  - Rule lists can't be typed in, but may still arrive from an old backup.
- **Main process:** the string is held in memory only. The renderer hands it over through `network:configure`, and it ends up in `main/net/state.ts` (`legacyProxyString()`). It is never written to the database.
- **Backups:** every `.hibikibackup` / `.riuplaybackup` file contains the whole localStorage, so **existing backups contain the plaintext proxy, password included** (6.4). LAN sync does not carry either the setting or `app_settings`.

### 6.2 The sequence

1. **Preview.** `network:secureProxy:status` returns `legacy: { action, display, hasPassword, reason }`, computed from the string the main process already holds. It never contains the password.
   - **Refused:** rule lists, PAC, `socks://` (ambiguous), `socks4://` and `socks5h://`, each with the reason shown.
2. **Explicit confirmation.** The dialog shows `kind://user@host:port` and whether a password is present. The renderer sends back the exact preview it showed (`migrateLegacy(display)`), and the main process refuses if the legacy string has changed since.
3. **Encrypt and insert atomically.** One migration runs at a time (module lock). The record is encrypted, round-trip checked, and then written with **`INSERT … ON CONFLICT DO NOTHING RETURNING`**, one statement. A record saved through Settings in the meantime is never overwritten, and the result is then "already-migrated".
4. **Verify.** The record is decrypted again and every field is compared (kind, host, port, user name, password).
   - On a mismatch it is removed with a **compare-and-swap delete**, which only deletes the row if it is still exactly what this migration wrote.
   - The plaintext stays in force.
5. **Effective only after verification.** The record is loaded into `state.ts` only after step 4 succeeds. From then on it is the effective proxy for **both** the controlled path and Chromium (6.3).
6. **Test both paths.** "Verify" makes:
   - one request through the controlled path;
   - one page load in a hidden, sandboxed window of the default session, which is Chromium's real network stack, so proxy authentication is exercised.
7. **Remove the plaintext: separate and explicit.** It is offered only when **all** of these hold, checked in the main process (`plaintextRemovalAllowed`) and again in the renderer:
   - the encrypted record is the one in force;
   - its last verification passed on **both** paths;
   - that verification was for the current configuration (any change resets it).

   Removal clears `state.proxy` in `hibiki-network-prefs`. Nothing else is touched.

### 6.3 Chromium proxy parity

- **One configuration.** Every Chromium session (the default session: player streams, posters; each challenge, login and browser-resolver partition) gets the same effective proxy (`chromiumNetworkPlan`). Sessions are re-applied on every change, and old connections are closed.
- **No credentials in rules.** A Chromium proxy rule never contains credentials.
- **HTTP/HTTPS proxy authentication** is answered from memory through `app.on("login")`, and only when:
  - the challenge is a proxy challenge (`isProxy`);
  - the host and port are exactly those of the configured proxy;
  - it hasn't already been answered twice within a minute, so wrong credentials fail instead of looping.

  A website's own login challenge is never answered.
- **Auth cache.** Chromium's proxy auth cache is cleared whenever the configuration changes. The isolated test found that, without this, a changed password kept working from Chromium's cache.
- **SOCKS5 with credentials.** Chromium has no SOCKS5 username/password support, so such a proxy is **blocked** for Chromium rather than sent direct, and the Settings screen says so. SOCKS5 without credentials works.
- **Unusable proxy.** A proxy that is invalid or undecryptable gives Chromium a black-hole rule (`http://127.0.0.1:9`), so Chromium requests fail instead of going direct.
- **Loopback.** Chromium's implicit loopback bypass is kept. Loopback traffic never leaves the machine, and media the user added from localhost must keep playing.
- **DNS.** With a proxy, Chromium lets the proxy resolve names (CONNECT host / SOCKS5 remote). There is no local DNS leak, but Chromium cannot pin addresses the way the controlled path does. Source stream URLs are therefore checked before they reach the player (§9).
- **Verified in a real Electron 45.2.3** by `research/m3/verify-chromium-proxy.mjs`, with a throwaway profile, loopback fixture proxies and synthetic credentials. Result: **9/9**.

### 6.4 Backups

- **Existing backups are never modified.** Restoring an old backup restores what it contains, including the plaintext proxy.
- **New backups (`.riuplaybackup`)** keep all of localStorage except the proxy **password**: the proxy keeps its scheme, user name, host and port, and only the password is dropped (`main/backupRedaction.ts`). A value that can't be parsed has `user:password@` scrubbed rather than being copied as is. The backup lists what was left out (`redactions`: key and field, never a value), and restore reports it.
- **The database inside a backup** still holds the encrypted record. It decrypts only for the same Windows user and RiuPlay profile; restored on another account or computer it loads as **unavailable**:
  - every proxied request fails closed (`proxy-unavailable`), and Chromium is blocked;
  - Settings shows that the stored proxy can't be read, and offers "Clear stored proxy" and re-entering it.
- **Restore still accepts `.hibikibackup` files.**

### 6.5 SOCKS scheme

| Scheme | Result |
|---|---|
| `socks5://` | Supported |
| `socks://` | Refused as ambiguous (Chromium reads it as SOCKS4, other tools as SOCKS5); never reinterpreted |
| `socks4://`, `socks4a://` | Refused (not supported) |
| `socks5h://` | Refused (proxy-side DNS defeats address validation) |

The Settings field and the parser agree on this. The proxy hint (en, ru, uk) now describes the real behaviour: one proxy for everything, and fail-closed.

### 6.6 Re-encryption

- **When it happens.** `decryptStringAsync` reports `shouldReEncrypt` when the key or scheme is outdated. The store then encrypts again, round-trips the result, and replaces the row with a **compare-and-swap** (only if it still holds the ciphertext that was read).
- **On failure.** The old, still-decryptable record is kept and the proxy keeps working. No credential is logged.

### 6.7 Recovery

| Situation | What happens | Recovery |
|---|---|---|
| Encryption unavailable when saving or migrating | Nothing is stored; no plaintext fallback | The plain setting stays in force |
| Record damaged | `unavailable` → fail closed (both paths) | Clear stored proxy, then re-enter |
| Another Windows account or profile, lost DPAPI key or `Local State` | Decrypt fails → `unavailable` | Clear, then re-enter (the plain copy, if not removed, takes over again after Clear) |
| Chromium proxy authentication fails | Bounded retries, then the request fails; Verify shows "player and pictures: failed" | Fix the credentials; plaintext removal stays disabled |
| SOCKS5 with credentials | Chromium blocked, with the reason shown | Use an HTTP/HTTPS proxy, or SOCKS5 without a password |
| Interrupted migration | The single-row insert is atomic: either nothing was stored, or a complete, pre-verified record | Next attempt says "already-migrated"; Verify or Clear it; the plain copy is untouched |
| Rollback | "Clear stored proxy" deletes `network.proxy` | Behaviour returns to the plain setting |

### 6.8 Exact data changes

| Action | Change |
|---|---|
| Migrate or save | One row in `app_settings`, key `network.proxy`. No schema change: the table exists since migration 0023 |
| Clear | That row is deleted |
| Remove plaintext | `state.proxy` in localStorage `hibiki-network-prefs` becomes `""` |
| New backup | No proxy password in localStorage |

Nothing else changes.

## 7. Local-server exception (designed; used by M4/M5)

A `LocalServerAllowance` covers exactly one `connectionId`, one scheme, one host and one port, and records `approvedAt`, the time of your consent.

- **Who can use it.** It applies only to `connection:<id>` callers, and only to the one it belongs to. Extensions, downloads and app requests never carry one (`policyFor`), and a `connection:` tag from shared code is downgraded (`parseCaller`).
- **What it allows.** It lets that exact origin resolve to a blocked range. The same host on another port, over the other scheme, under another loopback spelling (`localhost` versus `127.0.0.1`), or any other private host stays blocked. A redirect from the allowed server to another private address is refused.
- **How it connects.** Your own LAN or loopback server is reached **directly**, never through the outside proxy. That proxy couldn't reach it and shouldn't learn about it. Its name is resolved by the system resolver, since DoH can't know LAN names.
- **What exists in M3.** M3 provides the policy, the mechanism and the tests (`setLocalServerAllowances` in `state.ts`). No UI or connection uses it yet.

## 8. Threat model update (corrections to `PHASE7_DESIGN.md` §5.3)

| Item | Phase 7 draft | M3 reality |
|---|---|---|
| Proxy and SSRF | "HTTP CONNECT proxies receive a host name… documented residual risk" | **Removed.** Every proxy receives the validated IP literal; the target certificate is still checked against the name |
| SOCKS5 DNS | "local resolution + validated IP; a 'resolve through proxy' option would lose pinning" | DoH **through the proxy** to IP-literal resolvers by default, so there is no leak and no pinning loss. Local DNS only by explicit opt-in. `socks5h` is not offered |
| SOCKS library | `socks-proxy-agent` | `socks` (lower level) inside the one pinned connector |
| Plaintext proxy migration | "migrated… and removed from localStorage" | Designed and tested, **not run**: waits for approval (§6). Never auto-deletes |
| Proxy leaks | "one policy for Chromium sessions and Node" | Node: one controlled path, fail closed. Chromium: the session proxy as before (not in M3's scope; see §9) |
| Extension-provided media URLs | "checked against the private-range rule before reaching the player" | The player's pre-resolver now goes through the controlled path, so a private-range hop is refused there. The player (Chromium) still loads the URL itself; that falls under M2 |

New threats considered in M3:
- **DNS rebinding across hops and requests:** re-resolved and re-validated every time.
- **Mixed DNS answers:** refused.
- **A resolver returning non-IP data:** refused.
- **A malicious DoH answer:** validated like any other.
- **Zip bombs:** decoded-size cap.
- **Connection-flood abuse by one source:** per-source caps, isolated from other sources.
- **Env-var proxy bypass:** ignored.
- **Credential echo in errors:** scrubbed.

## 9. Network-path tracking (updated after the M3 follow-up)

| Path | Status | Where |
|---|---|---|
| Extension `fetch()`, downloads, HLS playlists, app requests (updates, repositories, AniList, skip times) | **Controlled path** | `main/net/client.ts` |
| Player redirect probe | **Controlled path** (`app:player`) | `main/playerStream.ts` |
| Discord poster reachability check | **Controlled path** (`app:discord`) | `main/discordRpc.ts`. Discord RPC itself is a local named pipe, not network |
| Source stream URLs (stream, separate audio, subtitles) before Chromium plays them | **Preflight-checked**: scheme, DNS (through the proxy when one is set), address rules, attributed to the source; refused links are dropped and logged | `core/extensions/runtime.ts` `withoutBlockedDestinations`, `NetClient.preflight` |
| Chromium traffic (player, posters, challenge, login and resolver windows) | **Same effective proxy**, fail-closed, proxy authentication from memory, auth cache cleared on change | §6.3 |
| Chromium address pinning (segments, later redirects, a DNS answer changing after the preflight) | **Not covered.** Chromium resolves and connects itself; only the preflight runs. Fixing this needs a desktop stream proxy (a custom protocol that pipes through the controlled client, like Android's) | Deferred: a residual risk |
| Shared GET cache (`netFetch`) | **Partitioned by caller**: no answer, in-flight request or disk entry is shared between sources | `core/extensions/netFetch.ts` |
| APK sources (JVM `apk-host/`) | **Outside the controlled path.** Off by default; runs only after the user installs an APK source with Java present | Phase 7 R4; see `docs/M2_SANDBOX.md` |
| Proxy host names | Resolved by the system resolver (the proxy you chose) | Use an IP literal to avoid even that lookup |
| No per-extension host lists yet | Every extension gets "any public host" | Manifest permissions (M1/M2) |

## 10. Tests and results

| Suite | Result |
|---|---|
| `src/main/net/client.test.ts`: address spellings, DNS pinning and rebinding, redirects, limits and timeouts, concurrency abuse, local-server allowance, all proxy kinds and failures, DNS leakage, DoH failures, error redaction | 103 / 103 |
| `budget.test.ts`, `config.test.ts` (address classes, policy, legacy proxy parsing, redaction, DoH parsing, cache and fallback), `secureProxy.test.ts` (store, migration, precedence, fail closed) | 95 / 95 |
| M0 network research suite, re-run unchanged (`research/m0`) | 95 / 95 |
| Main and core suite (Node 22), including the Electron transport contracts through the controlled path | 694 passed, 6 skipped (700) |
| Renderer suite | 319 / 319 |
| Type-check (`tsc -b`) | clean |
| Production build and Windows unpacked package (Electron 45.2.3) | OK |
| Phase 6 end to end: playback, reading, progress, library, collections, Discover | 25 / 25 |
| Protocols and window (`research/p0/verify-protocols-and-window.mjs`) | 11 / 11 |
| Packaged-app smoke, including "no listening sockets" | 10 / 10 |
| Database snapshot before and after all runs | migrations 25 = 25, schema identical, no table data changed, `integrity_check` ok |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `legacy/next-app` against `35b853e` | 61 / 61 files byte-identical |

## 11. Changed files

New (`src/main/net/`):
- **Core:** `addresses.ts`, `errors.ts`, `redact.ts`, `policy.ts`, `proxy.ts`, `resolve.ts`, `connector.ts`, `budget.ts`, `client.ts`, `state.ts`
- **Proxy store and migration:** `secureProxyStore.ts`, `electron.ts`, `legacyProxyMigration.ts`
- **Tests:** `client.test.ts`, `budget.test.ts`, `config.test.ts`, `secureProxy.test.ts`, `testing/fixtures.ts`
- **IPC:** `src/main/ipc/network.ts`

Changed:
- **Transports moved onto the controlled path:** `src/platform/electron/http.ts`, `src/platform/electron/downloadTransfer.ts`, `src/main/playerStream.ts`
- **Network settings:** `src/main/network.ts` (the undici dispatcher is gone; the settings are handed to `net/state`)
- **Caller threading:** `src/core/extensions/runtime.ts`, `src/core/extensions/netFetch.ts` (also redacted logs and NetError-aware retry), `src/core/api/downloads.ts`, `src/platform/types.ts` (`HttpRequest.caller`)
- **Secure-proxy IPC surface:** `src/main/index.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/shared/hibikiApi.ts`, `src/preload/index.ts`
- **Tests:** `src/platform/electron/transports.test.ts`, `src/platform/electron/updates.integration.test.ts`, `src/core/extensions/netFetch.test.ts`
- **Dependencies:** `package.json`, `package-lock.json` (`socks` becomes a direct dependency)
- **Docs:** `CHANGELOG.md`, `docs/FEATURE_INTEGRATION_MATRIX.md`, `docs/PHASE7_DESIGN.md`, `docs/M3_NETWORKING.md`

Unchanged: `research/m0/**`, `research/p0/**`, `legacy/next-app/**`, the unified media model and Phase 6 code.
