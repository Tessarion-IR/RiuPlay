# M0 Research Results: Extension Sandbox, Network Broker, Limits, Compatibility

Date: 2026-11-08. Machine: Windows 11 Pro (build 28000), Intel i5-12450H, 15.7 GB RAM.
Scope: **research spikes only.** No application code was changed (`src/`, `package.json` untouched; the app's type-check and 800 tests still pass). Everything lives in `research/m0/`, and raw results are in `research/m0/results/`.

> **Wording rule.** This report says a protection *held in the listed tests*. It does not call the sandbox "secure" in general. §5 lists what the tests do **not** cover.

---

## 1. Verdict

| Question (owner's acceptance criteria) | Answer | Evidence |
|---|---|---|
| Can a Chromium-sandboxed host stop an extension from reading local files, using Node/Electron APIs, launching programs, reaching arbitrary network destinations, or reaching another extension's data? | **Yes, for every attack in the suite**, on Electron 34.5.8 **and** 45.2.3 | `security`: **36/36** on both versions |
| Does the network broker block private, loopback and link-local addresses (IPv4 and IPv6), DNS rebinding, blocked redirects, encoded IPs, downgrades, proxy failures and bypasses? | **Yes, in all 95 tests** | `research/m0/net/broker.test.ts`: **95/95** |
| Do HTTP, HTTPS and SOCKS5 go through the same controlled path, and fail closed? | **Yes.** One connector for all three, connecting to the validated IP. Proxy down or wrong credentials → error, target hit 0 times | broker tests, "proxies" group |
| Can memory be limited? | **Only by the OS, through a Windows Job Object.** That is a **hard limit** and it held for both workloads. Electron has no API for it, so it needs native code. Monitoring alone is **not** a limit (overshoot to 2.3–2.5 GB). V8's heap flag is partial and app-wide | `memory-job` (hard), `memory-monitor`, `memory-natural`, `memory-jsflags` |
| Do existing hibiki-format extensions work without unrestricted privileges? | **Yes.** The fixture extension returns **byte-identical** results to hibiki's current `node:vm` path. **All 26 real hibiki-sources scripts load** in the sandbox with **no network granted** | `compat`: 8/8 on both versions; `real-scripts`: 26/26 |

**Recommendation: proceed with the Chromium-sandbox design.** It has three preconditions, given in §7: upgrade Electron, enforce the memory limit with a Job Object, and add the broker hardening listed in §5.

---

## 2. What was built (research only)

| Artifact | Purpose |
|---|---|
| `research/m0/net/ip.ts` | IPv4/IPv6 classification against blocked CIDR ranges, including addresses embedded in IPv6 (mapped, NAT64, compat, 6to4) |
| `research/m0/net/guardedFetch.ts` | The broker: validate → resolve once → refuse if any answer is blocked → **connect to the validated IP** through one custom connector (direct / HTTP CONNECT / HTTPS proxy / SOCKS5) → manual redirects, re-validated each hop → capped, manually decompressed body |
| `research/m0/net/fixtures.ts`, `broker.test.ts` | Loopback test servers (target, HTTPS with an openssl-generated certificate, counting HTTP CONNECT proxy, minimal counting SOCKS5 server) and 95 tests. They listen **only while a test runs** |
| `research/m0/sandbox/worker-src.ts` | Runs inside the sandbox: **hibiki's own** `buildExtensionGlobals` + `invokeProvider`, bundled for the browser (cheerio's browser build for Jsoup, fflate for Gzip, a Buffer polyfill), with fetch and storage bridged by **synchronous XHR** to the broker |
| `research/m0/sandbox/spike-main.cjs` | Electron main for the experiments: one hidden `sandbox: true` window per extension, a unique in-memory session per extension, `webRequest` cancelling everything except `riuplay-ext-host://`, CSP without `unsafe-eval`, permission requests denied, navigation and popups denied, and the broker served by a protocol handler **registered on that extension's session only** (identity comes from the session, never from the script) |
| `research/m0/sandbox/fixtures/*` | Hostile extensions (A attacks, B plants secrets), a hibiki-format compatibility extension, perf and resource-hog workloads |
| `research/m0/sandbox/job-limit.ps1` | Puts a renderer process into a Windows Job Object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` (Win32 through P/Invoke, no new dependency) |

Run them: `node research/m0/sandbox/build.mjs`, then `electron research/m0/sandbox/spike-main.cjs --mode=<security|compat|perf|cpu|memory-monitor|memory-natural|memory-jsflags|memory-job|safestorage|real-scripts>`; broker tests: `npx vitest run --config research/m0/vitest.config.ts`.

---

## 3. Experiment results

### 3.1 Sandbox isolation (`security`): 36/36 on Electron 34.5.8 and 45.2.3

| Attack (run as extension code in the worker) | Result |
|---|---|
| `require`, `process`, `module`, `global`, `__dirname`, `electron`, `ipcRenderer` | All `undefined` |
| `(function(){}).constructor("return process")` escape | Blocked: `EvalError` (CSP has no `unsafe-eval`). Even without CSP there is no `process` to reach (the host page has none either) |
| Read a secret temp file via sync XHR, `fetch`, `importScripts` | All refused (`NetworkError`/`TypeError`). The secret never appears in any result |
| Read `C:\Windows\win.ini` | Refused |
| Host protocol path traversal (`../`, `%2e%2e`), unknown broker routes | 404 |
| Ask the host for another extension's script | Only the caller's **own** script is served (query ignored); B's code is never returned |
| Native `fetch` / sync XHR / `no-cors` to loopback, `fetch` to the public internet, remote `importScripts`, nested `Worker` from another origin | All refused. **The loopback canary server received 0 requests and 0 WebSocket upgrades** |
| WebSocket to loopback | Error, no connection |
| Launch programs: `ms-calculator:` / `calculator://` / `ms-settings:` via fetch, XHR, Worker, `importScripts`; `window.open`/`location` from the host page | All refused or intercepted (denied). **No calculator process started** |
| Through the broker: loopback, cloud metadata, encoded loopback (`2130706433`), `file:` | Refused (`blocked-address`, `scheme-not-allowed`) |
| Broker storage of B, naming B explicitly | Returns A's own (empty) value; storage is keyed by session |
| B's IndexedDB and Cache Storage, from A | Invisible (`null`, `[]`) |
| A and B processes | **Separate OS processes**, both `sandboxed: true`, Windows integrity level **`untrusted`** (the lowest level) |
| Cross-origin isolation | Off: `crossOriginIsolated: false`, `SharedArrayBuffer` unavailable (limits high-resolution timer side channels) |

### 3.2 Network broker (`broker.test.ts`): 95/95

| Group | Covered |
|---|---|
| Classification (34) | RFC1918, loopback, link-local/metadata, CGNAT, multicast, reserved, benchmarking, documentation; IPv6 `::`, `::1`, ULA, link-local, multicast, documentation, Teredo; **embedded IPv4**: `::ffff:127.0.0.1`, `::ffff:7f00:1`, `64:ff9b::7f00:1`, `::127.0.0.1`, `2002:7f00:1::`. Public counter-examples stay allowed |
| Spellings (33 + 2) | `2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`, `0x7f.0.0.1`, `[::ffff:…]`, `[0:0:0:0:0:ffff:7f00:1]`, `localhost`, `LOCALHOST.`, `foo.localhost`, `0.0.0.0`, `0`, `[::]`, names resolving privately, **mixed public+private DNS answers**, IPv6 zone IDs. **Each one also asserts the target server got no request** |
| Schemes and credentials | `file:`, `ftp:`, `data:`, `javascript:`, `ws:` refused; `user:pass@` refused; HTTP refused unless granted |
| Permissions | Undeclared host refused; an allowance is exact (same host, other port → refused; raw IP → refused) |
| DNS / rebinding | **Resolved once, connected to that IP; system DNS never consulted** (the test name doesn't exist in system DNS, yet the request succeeds). A host that rebinds to `169.254.169.254` on the next lookup is refused |
| Redirects | To loopback, metadata, LAN, private names, mapped-IPv6 loopback, undeclared hosts and `file:` all refused, with only the first hop reaching a server. Loops stop at 6 hops. **HTTPS → HTTP downgrade refused.** `Authorization`/`Cookie` dropped cross-origin and kept same-origin. 303 POST → GET |
| Limits | 9 MB body refused (8 MB cap); **gzip bomb** (100 MB expanded) refused (32 MB cap); hanging server times out |
| Proxies | HTTP proxy receives **`127.0.0.1:port`, never the name**. HTTP proxy with Basic auth; **HTTPS through the proxy with the certificate checked against the real host name**; HTTPS proxy (TLS to the proxy); SOCKS5 with and without auth receives an **IPv4 address, never a domain**; **proxy unreachable (HTTP/HTTPS/SOCKS5) → `proxy-failed`, target hit 0 times**; wrong credentials → `proxy-failed`, target 0, **password not in the error**; `NO_PROXY=*` does not cause direct traffic; loopback destinations refused before the proxy is contacted |

### 3.3 Compatibility (`compat`, `real-scripts`)

| Check | Electron 34 | Electron 45 |
|---|---|---|
| Fixture extension (fetch, fetchAll, Jsoup, Base64, Gzip, Url, AnimeTitle, collectPaginated, storage): search / latest / getById / getPlaybackGroups / getPlayerLinks / getSettings **identical to hibiki's `node:vm` path** | 6/6 | 6/6 |
| Its network stays inside its declared host | ✅ | ✅ |
| 26 real hibiki-sources scripts (15 sources, 11 resolvers) load, with their full method lists, with **no network** | 26/26 | not re-run |

Static scan of the 26 real scripts: **no `eval`/`new Function`** (so the strict CSP doesn't break them), and no Java/Rhino or Node references. They use `Jsoup` (70×), `fetch` (57×), `AnimeTitle`, `storage`, **`challenge` (11×)**, `fetchAll`, `console`, `Url`, `collectPaginated`, `atob`, `Base64`, `setTimeout`, `preferredLanguage`, **`browserFetch` (1×)**. **5 resolvers need the `browserScript` runtime** (code executed inside a third-party page). `challenge`, `browserFetch` and `browserScript` were **not** prototyped in M0 (§5).

*The real scripts were only loaded, not run against their websites. M0 sent no traffic to third-party sites, and hibiki-sources code was not copied into this repository (it has no licence).*

### 3.4 Performance of the synchronous bridge (`perf`)

| Measure | Electron 34 | Electron 45 |
|---|---|---|
| Broker round trip (sync XHR → async protocol handler), mean / p95 | 1.2 / 2.4 ms | 1.0 / 1.6 ms |
| `fetch` through broker + guardedFetch (loopback), mean / p95 | 3.3 / 4.9 ms | 3.3 / 5.3 ms |
| `fetchAll` of 10 × 200 ms requests | 238 ms (concurrent) | 226 ms |

For comparison, hibiki's earlier `sync-fetch` path cost about 90 ms per request.

### 3.5 CPU (`cpu`): 4/4 on both

Infinite loop in an extension: main event-loop lag 8–10 ms; the host page stays responsive; `worker.terminate()` takes 1 ms; `forcefullyCrashRenderer()` takes 150–170 ms. App unaffected.

### 3.6 Memory: hard OS limit vs monitoring

| Experiment | Heap workload (JS objects) | ArrayBuffer workload (off-heap) | Conclusion |
|---|---|---|---|
| No limit, 2.5 GB safety cap (`memory-natural`) | 2.6 GB in 3.6 s, then safety kill | 3.0 GB in 0.7 s, then safety kill | **Nothing in Chromium/Windows limits a sandboxed renderer by default** |
| Watchdog at 512 MB, 250 ms sampling (`memory-monitor`) | Peak 630–703 MB | Peak **1.5–2.5 GB** | **Monitoring is not a limit.** At ~6 GB/s allocation it overshoots by gigabytes. Useful only as a backstop |
| `--js-flags=--max-old-space-size=256` (`memory-jsflags`) | V8 OOM at ~310 MB (hard) | **3.75 GB** (flag ignored) | **Partial and global**: off-heap memory isn't covered, and the flag applies to every renderer, including RiuPlay's own UI. Not recommended |
| **Windows Job Object, 512 MB per-process limit** (`memory-job`) | **512 MB peak**, process stopped by the OS (`oom`) | **480–481 MB peak**, allocations refused, process stays under the cap | **Hard limit, enforced by Windows**, on Electron 34 and 45. Needs native code (§7) |

### 3.7 Credential storage (`safestorage`): 5/5 on both
DPAPI is available on this account. Ciphertext (`v10…`) doesn't contain the plaintext, encryption is randomised, non-ASCII round-trips exactly, and **corrupted ciphertext throws**. A migration therefore needs a defined recovery path ("re-enter the password"). DPAPI binds ciphertext to this Windows user (and to the app's `Local State` key), so a backup restored on another PC or account **cannot** decrypt it. **No real setting was read, moved or deleted** in M0.

---

## 4. Failed experiments and corrections (full record)

| # | What happened | Cause | Resolution |
|---|---|---|---|
| F1 | First broker run: 4 redirect tests "failed" (`host-not-permitted` instead of `blocked-address`) | The targets weren't in the declared host list, so the permission check stopped them first: still refused, but the address rule wasn't what was tested | Those cases now use an "any public host" (legacy) grant, so the address rule must stop them. They pass |
| F2 | 17 unhandled `AbortError`s in the broker run | **Prototype bug**: destroying an undici response body without a listener | Redirect bodies are now dumped safely and the expected abort is swallowed. 0 unhandled errors |
| F3 | Security: B's Cache Storage secret couldn't be planted | Cache keys must be `http(s)`; the fixture used the custom scheme | Fixture fixed. The isolation check was valid either way (A saw `[]`) |
| F4 | Security: "other extension's script" reported as a leak | **Harness flaw**: the secret was substituted into A's own source, and the host correctly served A its own script | Secret no longer given to the attacker; markers built at run time. The check now requires "no foreign content". It passes |
| F5 | `memory-job` reported failure | My criterion required the process to *die*; with ArrayBuffers Windows refused the allocations and the process stayed under the cap | Criterion corrected to "peak never above the cap". Both workloads stay ≤ 512 MB |
| F6 | Electron 34 result files overwritten by the Electron 45 runs | My run loop | Electron 34 suites re-run; both versions are stored separately (`results/electron34`, `results/electron45`) |
| F7 | No built-in memory limit, monitoring overshoot, partial V8 flag | **Genuine limitations** (not harness issues) | Recorded in §3.6. The recommendation uses Job Objects |

---

## 5. Threat model: remaining risks and attack surfaces

**Assets:** local files; LAN and localhost services; cloud metadata; credentials (proxy, servers, source logins); other extensions' data; the user's privacy; app availability.
**Actors:** malicious or compromised extension or repository; malicious source site or user server response; network attacker; hostile page in a hidden browser window.

| Remaining risk | Severity | Status / mitigation |
|---|---|---|
| ~~**Electron 34.5.8 = Chromium 132 (June 2025), out of support.**~~ **Resolved in P0: upgraded to 45.2.3, see `P0_ELECTRON_UPGRADE.md`.** Electron supports only its latest three majors; current is 45.2.3 (Chromium 156). Known renderer vulnerabilities in Chromium 132 are exactly what an untrusted extension would use against the sandbox | **High** | **Upgrade to a supported Electron before shipping the sandbox.** All M0 suites pass unchanged on 45.2.3 |
| Renderer exploit **plus** sandbox escape (two bugs) | Medium | Inherent in any Chromium sandbox. Reduced by staying current; the `untrusted` integrity level limits the damage |
| Hidden browser windows (`challenge` ×11, `browserFetch` ×1, `browserScript` resolvers ×5) load **third-party pages** | Medium | **Not prototyped in M0.** Needs: per-extension partition, navigation restricted by host permission + SSRF rule through `webRequest`, no preload. Research item R8, carried into M2 |
| Media URLs returned by extensions are loaded by **Chromium in the UI renderer** (video/audio/img), outside the broker | Medium | Not covered by M0. Plan: validate extension-provided URLs and add a `webRequest` filter on the UI session that blocks private ranges for extension-originated media (user-entered URLs may be private) |
| Broker as attack surface: request-body size, JSON validation, request rate, storage quota | Medium | The spike has **no** body cap, quotas or rate limits. Required in M2 |
| Host page ↔ worker `postMessage` channel | Low | The host page holds no privileges. Keep it minimal; treat messages as data |
| Memory: hard limit needs native code (Job Object). Without it, only monitoring (gigabyte overshoot) | Medium | Use a Job Object through a small vetted native binding; keep monitoring as backstop |
| Proxy: HTTP CONNECT to port 80 is refused by some proxies (strict CONNECT-443 policies) | Low (availability) | Fails closed. Document; optional absolute-form for plain HTTP later |
| SOCKS5 with local resolution sends DNS queries outside the proxy | Low (privacy) | Deliberate trade-off for IP pinning. Offer "resolve through proxy" with a clear warning that pinning is lost |
| `safeStorage` (DPAPI) doesn't protect against malware running as the same Windows user, and doesn't travel between PCs | Low / by design | Document; backups exclude secrets; re-entry flow |
| APK host (JVM) runs with the user's full rights | High (if enabled) | **Off by default** behind an explicit opt-in; isolation research (R4) postponed |
| Electron fuses (e.g. `RunAsNode`): the packaged binary could be started as plain Node by another local program | Low/Medium | Flip fuses in the Windows build (Phase 14) |
| Side channels (Spectre-class) | Low | No cross-origin isolation, so no `SharedArrayBuffer`; separate processes per extension |
| Real Suwayomi and Kikoeru servers | n/a | Not part of M0; mock servers in M4/M5 |

**Not demonstrated by M0:**
- resistance to real browser exploits;
- the behaviour of hidden third-party browser windows;
- running real sources against their live websites;
- production quotas and rate limits;
- the encrypted credential migration itself (only DPAPI behaviour was tested).

---

## 6. Windows and Electron compatibility findings

| Topic | Finding |
|---|---|
| Electron versions tested | 34.5.8 (shipped today; Chromium 132, Node 20.19) and 45.2.3 (latest; Chromium 156, Node 24.22). **Every M0 suite passes on both** |
| Sandbox level | Extension hosts run `sandboxed: true` at integrity level **`untrusted`** on both |
| Sync XHR in workers | Works against an **async** custom-protocol handler on both. The main process stays responsive |
| Per-session protocol handlers | `session.protocol.handle` on an in-memory partition works, which gives a per-extension identity that can't be forged |
| Process isolation | Different partitions → different renderer processes (verified) |
| Job Objects | A Chromium-sandboxed renderer **can** be assigned to an additional job (nested jobs, Windows 8+) and the memory limit is enforced |
| CSP in custom-scheme workers | Enforced (`unsafe-eval` blocked) |
| Cache API | Only `http(s)` request keys |
| Electron 45 upgrade impact on the app (not done in M0) | Node 20 → 24 in main; better-sqlite3 must be rebuilt for the new ABI; drizzle, undici and vite should be fine; hibiki's Electron-specific code (protocols, sessions, `BrowserWindow` options) needs a full regression run. **Not yet attempted**: estimated in §8 |
| Side effect of the experiments | Running Electron scripts without an app name created `%APPDATA%\Electron` (about 7 MB, Electron's default profile for the spikes and helper scripts since 2026-11-07). It holds no RiuPlay or hibiki data and can be deleted. **Not deleted without your OK** |

---

## 7. Final recommended architecture

```
Main process (privileged)
 ├─ ExtensionSupervisor ── one sandboxed host per extension (separate OS process, own in-memory
 │                         session), restarts, per-call timeout, worker.terminate / crash on overrun
 ├─ MemoryGuard ─────────── Windows Job Object per host process: hard per-process memory cap
 │                         (native binding) + metrics watchdog as backstop
 ├─ CapabilityBroker ────── protocol handler registered on each host's session (identity = session):
 │     fetch / fetchAll  → permission check → guardedFetch (validated-IP connector, proxies, caps)
 │     storage           → per-extension store with quota
 │     challenge / browserFetch / browserScript → hidden windows in the extension's partition,
 │                         navigation limited to permitted hosts + SSRF rule (to build in M2)
 │     request-body caps, JSON validation, rate limits, logging with redaction
 └─ guardedFetch ────────── also used for Suwayomi/Kikoeru connections (with exact host:port
                            allowance for a user-confirmed LAN server) and app-wide proxy policy

Extension host = hidden BrowserWindow { sandbox, contextIsolation, no Node, no preload }
   CSP: default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self' (no eval)
   webRequest: cancel everything except riuplay-ext-host://; permissions denied; no navigation/popups
   └─ Web Worker: hibiki host API (unchanged behaviour) + the extension script via importScripts
```

**Preconditions before M2 ships to users:**
1. **Upgrade Electron to a supported release** (45.x today).
2. **Job Object memory limit** through a small native binding (or helper). Monitoring alone is not acceptable as "the limit".
3. **Broker hardening**: body caps, quotas, rate limits, schema validation.
4. **Hidden-window capabilities** built and tested under the same rules (R8).

The APK (JVM) host stays **off by default**.

---

## 8. Revised Phase 7 estimate

Units are **working sessions** like the ones used for Phases 5 and 6 (one session ≈ one milestone with tests and a commit).

| Step | Content | Estimate | Change vs design |
|---|---|---|---|
| **P0** Electron upgrade (new prerequisite) | 34 → 45.x; rebuild native modules; fix API changes; full regression (unit + Phase 6 end-to-end); verify packaging | 1–2 | **New** |
| **M3** Networking | Production `guardedFetch` (connection pooling per validated IP, keep-alive), proxy settings model (HTTP/HTTPS/SOCKS5 + auth), encrypted credential store **with migration and recovery tested before any plaintext is removed**, Chromium-session proxy parity, log redaction, tests | 2 | = |
| **M2** Extension security | Supervisor, per-session broker with caps/quotas/rate limits, Job Object binding + watchdog, hibiki runtime moved from `worker_threads`/`vm` to the sandbox host (keeping the `node:vm` path only as a disabled fallback), hidden-window capabilities (challenge / browserFetch / browserScript) under permissions, extension-originated media URL filter, malicious-extension suite in CI | 3–4 | +1 (hidden windows, Job Object) |
| **M1** Lifecycle and trust | Manifest v1, repository records, integrity, consent/re-consent UI, `riuplayApi` window, hasUpdate/obsolete, deferred deletion, attribution/licence | 2–3 | = |
| **M4** Suwayomi (optional) | GraphQL client, connections UI, Manga section integration, page proxy, disconnection handling, mock-server tests (real server needs yours) | 2 | = |
| **M5** Kikoeru (optional) | REST client, Audio section integration, stream proxy with Range, mock-server tests | 1.5–2 | = |
| Wrap-up | Matrix, docs, 3× suites, end-to-end run | 1 | = |
| **Total** | | **12.5–16 sessions** | |

**Still postponed (unchanged):** APK host isolation (R4), signed repositories (R7), progress write-back to servers, built-in asmr.one.
