# Phase 7 status and continuation report

Last updated 2026-11-08. All commits are local; nothing was pushed or released.

## What is done

| Milestone | State | Details |
|---|---|---|
| M0 research | Done earlier | `docs/M0_RESULTS.md` |
| P0 Electron 45.2.3 | Done earlier | `docs/P0_ELECTRON_UPGRADE.md` |
| M3 networking and follow-up | **Implemented and tested** | `docs/M3_NETWORKING.md`; Chromium proxy check 9/9 in real Electron |
| M1 extension lifecycle and trust | **Implemented and tested** (Sources UI checked in screenshots only) | `docs/M1_EXTENSION_LIFECYCLE.md` |
| M2 sandbox and isolation | **Implemented and tested** | `docs/M2_SANDBOX.md`; 25/25 in real Electron |
| M4 Suwayomi | **Implemented and contract-tested** against fake servers; **not run against a live server** | `docs/M4_M5_SERVERS.md` |
| M5 Kikoeru | **Implemented and contract-tested** against fake servers; **not run against a live server** | same |
| Visible branding | Done | Profile, Discord, device names, backups and onboarding copy |
| Discovery catalog | Done | Facts checked on the project pages on 2026-11-08 |
| Onboarding, search, Profile and History | Done | |

## Verification (final run)

| Check | Result |
|---|---|
| Typecheck | Clean |
| Main and core tests | 780 passed, 6 skipped |
| Renderer tests | 322 passed |
| M0 network suite | 95 / 95 |
| M2 sandbox, real Electron | 25 / 25 |
| M3 Chromium proxy, real Electron | 9 / 9 |
| Phase 6 end-to-end (isolated profile) | 25 / 25 |
| Protocols and window (isolated profile) | 11 / 11 |
| Packaged-app smoke (isolated profile) | 10 / 10 |
| Production build and Windows unpacked package | OK |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Production dependency licenses | MIT, ISC, Apache-2.0, BSD-2/3, 0BSD, Unlicense, BlueOak-1.0.0: all GPL-3.0 compatible (local tally; the license-checker download was not allowed) |
| Real profile `%APPDATA%\RiuPlay` | Database unchanged (25 migrations, same schema and data) |
| Protected locations | `%APPDATA%\hibiki-desktop`, `%APPDATA%\Electron` and the backups were not written. The `riuplay://` key the packaged smoke registered was removed |

## Screens checked in screenshots

Captured from a dev build on an isolated profile:
- onboarding (new copy);
- Manga section with the empty "From your Suwayomi server" area;
- Settings > Network: encrypted proxy, APK sources, Media servers and its add form;
- Sources > Repositories with Discover;
- Profile with "Your media".

**Not tested by hand** (no click-through of real flows):
- adding a real server;
- installing a real extension through the consent dialog;
- the proxy migration with a real proxy;
- APK sources;
- playback from a Kikoeru server.

## Remaining work and known limits

1. **Chromium-loaded streams and pages** are checked once before loading, but segments, later redirects and DNS changes aren't pinned. Fixing this needs a desktop stream proxy through the controlled client. This is the main residual network risk.
2. **APK (Java) sources** are outside the broker and the sandbox. They stay off by default with an explicit opt-in (Phase 7 R4).
3. **Server titles** don't pick up new chapters or tracks (no refresh action). Kikoeru lyrics and subtitles are not imported (Phase 8).
4. **Translations.** The new UI strings are English only for servers, catalog and permission dialogs; Russian and Ukrainian fall back to English.
5. **Profile statistics** below "Your media" still count episodes watched through sources (labelled by context, not merged).
6. **Discord presence** needs a RiuPlay Discord application id at build time (`RIUPLAY_DISCORD_CLIENT_ID`).
7. **The automatic "carry-over" install** (Android legacy import) is now refused by the consent rule, by design.
8. **The Phase 6 end-to-end onboarding check** only verifies that the welcome step was left behind. Completion was confirmed separately in the screenshot run.
