# M2: Extension sandbox and isolation

**Status:**
- **Implemented and tested.** The sandboxed host is now the runtime for JS extensions (sources and resolvers). Verified in a real Electron 45.2.3 by `research/m2/verify-sandbox.mjs`: **25/25** (19 isolation checks, 6 identical-result compatibility checks).
- **Not verified by hand:** real third-party sources against their live sites (no third-party traffic is sent by the tests).

## Architecture

The design is the one M0 measured (`docs/M0_RESULTS.md` §7), now in production code under `src/main/extensions/sandbox/`.

```
ExtensionRuntime (main) ── run(call, bridge) ──► SandboxedExtensionHost
                                                  per extension (and per resolver), up to 2 hosts:
                                                  hidden BrowserWindow { sandbox, contextIsolation,
                                                    no nodeIntegration (also workers/subframes),
                                                    no preload, no webview }
                                                  own in-memory session (unique partition per host)
                                                    webRequest: cancel everything except riuplay-ext-host://host/
                                                    permissions: all denied; downloads: prevented
                                                    navigation / redirects / popups: denied
                                                  CSP  default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'
                                                  └─ Web Worker: hibiki host API (hostWorker.ts) + the script
                                                       fetch / fetchAll / challenge / browserFetch
                                                       └─ sync XHR → /broker/bridge → the call's BridgeHandler
                                                          → netFetch → M3 controlled path (caller extension:<id>)
JobGuard (one PowerShell helper) ── assigns each host renderer to a Windows Job Object
                                     (JOB_OBJECT_LIMIT_PROCESS_MEMORY, 512 MB) BEFORE the script loads
```

- **Identity.** The broker knows which extension is asking from the **session** the request arrived on. A script can't claim to be another extension.
- **What each host is served.** Only its own script, at `/ext.js`.
- **Storage.** Per call, exactly as in the `node:vm` path: the call carries the source's snapshot in and returns the keys it wrote. Storage stays separate per extension.
- **Compatibility.** hibiki's `globals.ts` is bundled for the browser, with `zlib` → `fflate` and `createRequire` → a static `cheerio/slim`. No other module can be required. `preferredLanguage` matches the old path. On the M0 compatibility source, results are **byte-identical** to the `node:vm` path for search, latest, getById, getPlaybackGroups, getPlayerLinks and getSettings.
- **Old runtime.** The in-process `node:vm` worker is **not** a sandbox. It remains only as a developer fallback, behind `RIUPLAY_LEGACY_EXTENSION_RUNTIME=1`, and is never selected otherwise.

## Verified behaviour

Each line is a check in `verify-sandbox.mjs`.

| Attack or property | Result |
|---|---|
| `require`, `process`, `module`, `electron`, `ipcRenderer` | all `undefined` |
| `Function`-constructor escape, `eval` | refused by the CSP (`EvalError`) |
| `file://` read of a secret, `C:\Windows\win.ini` | refused, nothing leaked |
| Direct XHR to loopback or the public internet | refused |
| Native `fetch`, `WebSocket`, nested `Worker`, `EventSource` (fire-and-forget) | **0 hits** on the loopback canary |
| `importScripts` from the network or a file | refused |
| Host path traversal, unknown broker routes, another extension's script | nothing served |
| `fetch()` | reaches only the broker bridge **of the calling extension**; a broker refusal reaches the script as an error |
| Storage | per extension and per call |
| Memory | host put in a Job Object; an allocating extension stopped at the OS limit; other extensions keep working |
| CPU | an infinite loop times out, and its host (renderer process) is destroyed |

## Extension-driven Chromium windows

These are the hidden challenge and `browserFetch` pages, and BROWSER-runtime resolvers (`extensionWindows.ts`).
- **Partitions.** Each source has its **own persistent partition** (`persist:riuplay-src-<id>`). Before M2 they shared the app's default session with the player.
- **Preflight.** Every URL an extension asks such a window to load **or fetch in-page** is preflighted by the network broker: scheme, DNS, private/loopback/metadata refusal and declared hosts, attributed to the source. Before M2, `browserFetch()` could make a page-context request to any address.
- **The session itself:**
  - refuses non-web schemes and private, loopback or link-local IP literals and `localhost` names;
  - denies permissions and downloads.
- **Windows** can't open pop-ups or navigate or redirect to blocked targets.
- **User-earned clearance.** A Cloudflare clearance the **user** earned in the visible check window is copied into the source's partition for that site only, so "pass the check once" keeps working.
- **Sign-in windows** already had a per-source persistent partition (unchanged).
- **Residual:** subresources a third-party page loads by *name* are resolved by Chromium itself and are not re-checked.

## Stream URLs

Before a source's links reach the player, every stream, audio and subtitle URL is preflighted. Refused links are dropped (`runtime.ts` `withoutBlockedDestinations`). The redirect pre-resolver uses the controlled path.
- **Residual:** Chromium loads the stream itself, so later segment hosts and DNS changes after the preflight are not pinned. The fix is a desktop stream proxy through the controlled client (as on Android); deferred.

## Network isolation summary

The sandbox has no network of its own: the session cancels everything except the broker. All extension traffic therefore takes the M3 path:
- public destinations only, with DNS pinning;
- redirects re-checked, downgrades refused;
- per-extension budgets, concurrency, size limits and timeouts;
- declared hosts (M1);
- no DNS fallback behind a proxy.

The GET cache is partitioned per caller (M3 follow-up).

## Memory limit: what is and isn't claimed

- **Enforced:** a per-renderer **512 MB** Windows Job Object limit, *when the assignment succeeds*. Each host records `memoryLimited` (logged; `describe()` for diagnostics).
- **Not claimed elsewhere:** where the helper can't start (PowerShell blocked by policy, not Windows), hosts run **without** a hard memory cap, and the log says "memory limit NOT enforced". The call timeout and the host kill still apply.
- **How it's applied:** the helper is the app's own code (embedded P/Invoke). It never sees extension code or data.

## APK (Java) sources

- **Off by default.** The Java helper starts only after the user opts in (Settings, with a "full user rights, not sandboxed" warning; effective after a restart; `platform/electron/apkOptIn.ts`). Before M2 it started whenever Java and the jars were present.
- **Not sandboxed.** Their traffic does not go through the broker, and RiuPlay makes no sandbox claim for them (Phase 7 R4). The install dialog labels them "native code with your full Windows user rights".

## Known limitations

- **Live-site behaviour not exercised.** Real hibiki-sources scripts were loaded and run only against the fixture. Behaviour against live sites needs a manual check by someone who has the sources installed.
- **Startup cost.** The first call to an extension starts its host, about 0.3 s plus about 1–2 s once per app start for the memory helper (measured roughly in the verification run). Up to 2 hosts per extension, closed after 3 minutes idle.
- **Chromium-loaded streams and pages** are not address-pinned after the preflight (above).
