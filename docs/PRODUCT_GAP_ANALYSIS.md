# Product gap analysis and milestone plan (Phase 8)

Date: 2026-11-08. This measures RiuPlay 0.1.0-alpha.1 against the intended product: one-click source activation, then automatic content discovery, then native playback or reading. It covers all three media categories. Self-hosted servers are secondary.

## 1. Findings

### What really works today
| Piece | State |
|---|---|
| Sandboxed scripted-extension runtime (M2) and the network broker (M3) | **Works.** It is tested in real Electron (25/25 and 9/9). |
| Repository lifecycle: add, trust, install, update, disable, remove, permission dialog (M1) | **Works**, for scripted extensions whose repository URL the user types in. |
| Anime from scripted extensions: search, title page, episodes, link resolution, native video player, progress | **Works**. This is hibiki's pipeline, reached through the Discover and Search screens. |
| Local media and links: video, manga and audio, with the native player, reader and audio page; progress, library and collections | **Works** (Phase 6 end-to-end 25/25). |
| Suwayomi and Kikoeru server connections | **Implemented** and tested against fake servers only. They need a server the user runs, so they don't count toward the core experience. |

### Placeholders, or not part of the core experience
| Piece | Why it doesn't meet the requirement |
|---|---|
| The **Discover** catalog | It has 4 entries. Only one has an "Add repository" button: yuzono, an **APK** repository. The Java host isn't bundled, so **that button leads nowhere in the release build**. Keiyoushi is "copy the address into your Suwayomi server". Suwayomi and Kikoeru are "get the server" links. |
| The Manga and Audio sections | They show local titles and server titles only. **No extension can supply manga or audio**: the scripted API is anime-only (search, getById, getPlaybackGroups, getPlayerLinks, resolve), and the APK host loads only Aniyomi `AnimeSource`s. |
| The Video section | It shows local titles. Anime from extensions lives in hibiki's separate Discover/anime screens, and it isn't normalised into `MediaItem`/`MediaUnit`. |

### The questions answered
| Question | Video / anime | Manga | Audio / ASMR |
|---|---|---|---|
| Is a built-in repository visible? | No. None ships. | No | No |
| One-click install from the UI? | Only after typing a repository URL by hand | No (there is no runtime) | No (there is no runtime) |
| Does an installed source populate its section? | Partly: hibiki's own anime screens, not the Video section | No | No |
| Search and consume without another app or server? | Only with a hand-typed third-party repository | **No.** It needs a Suwayomi server | **No.** It needs a Kikoeru server |
| Is a real working provider integrated? | Hibiki scripted format: yes, but no repository is supplied | **None** | **None** |

### The upstream ecosystems
- **hibiki scripted sources** (`akkirrai1337/hibiki-sources`): the format is fully compatible and runs in the M2 sandbox. The repository has **no license**, targets unofficial streaming sites and includes NSFW content (`docs/EXTENSION_REPOSITORY_AUDIT.md`). RiuPlay can't redistribute it. Listing it in the built-in catalog is a decision for the owner (see §3).
- **Aniyomi APKs** (yuzono): they run in a JVM child process with the user's full rights, **outside the sandbox and the broker**. This can't be made one-click without confining the JVM first.
- **Tachiyomi/Keiyoushi manga APKs**: no loader exists. Suwayomi (MPL-2.0) shows how to load them on a JVM. Adding them has the same confinement problem as Aniyomi.
- **KikoFlu/Kikoeru**: KikoFlu is a *client* of Kikoeru-API servers. Public servers that speak this API (asmr.one and similar) mostly host commercial DLsite works without a license. **There is no legal audio or ASMR extension ecosystem.**
- **Legal, openly licensed providers checked on 2026-11-08** (all respond, with license metadata):
  - **Internet Archive:** public-domain and Creative Commons films and animation (1,313 titles in animation alone, filterable by `licenseurl`), CC audio, and 258 CC/PD ASMR recordings.
  - **LibriVox:** public-domain audiobooks, with a JSON API and MP3 files on archive.org.
  - **Pepper&Carrot:** a CC-BY 4.0 webcomic with a JSON episode list and page images.

## 2. Milestones

Each milestone ends in a test that runs on an isolated profile, either with local fixture servers or as an optional live run against the real public APIs.

| # | Milestone | Done when |
|---|---|---|
| **M6** | **Multi-media extension contract (host API 2).** Manifest `contentType: video, manga or audio` (default video, so every existing extension keeps working). Titles, groups and episodes are reused as titles, chapters and tracks. A new `getPages` method serves manga, and a `DIRECT_AUDIO` link type plus LRC/VTT lyrics serve audio. Everything runs in the existing M2 sandbox through the broker, with declared hosts enforced. | Sandbox contract tests for all three types; existing extensions are unchanged |
| **M7** | **The built-in RiuPlay repository.** A RiuPlay-owned, GPL-3.0 repository (`extensions/` in this repo) with SHA-256 for every file. It is bundled in the app, so it works with no URL and offline, and is visible as "RiuPlay (built-in)". Hashes are verified before install, and the app offers one-click Install, Enable/Disable, Update and Uninstall. | The index is visible and installs, with the hash checked |
| **M8** | **Provider adapter and unified catalog.** Each section (Video, Manga, Audio) gets a browse row per installed provider of that type. Unified search covers the providers of that type plus the library. The title page comes from the provider. Adding to the library or starting to play stores an `origin: "extension"` MediaItem automatically (`ext:<source>:<title>`), with no manual matching. Units are resolved lazily in the main process. | Results appear in the right section; search and title page work; progress, favourites and collections work |
| **M9** | **Video slice:** an Internet Archive extension for public-domain and CC films and animation, played in the native video player. | Acceptance test (§4) |
| **M10** | **Manga slice:** a Pepper&Carrot extension (CC-BY) plus Internet Archive public-domain comics, read in the native reader. | Acceptance test |
| **M11** | **Audio slice:** LibriVox and Internet Archive CC audio/ASMR extensions in the native audio player, with a queue, previous/next, resume, a sleep timer, and lyrics/subtitles where the provider has them. | Acceptance test |
| **M12** | **Anime pipeline into the unified model.** Hibiki-format anime sources show up in the Video section through the same adapter, keeping hibiki's resolvers. | An existing-format fixture source browses and plays from Video |
| **M13** | **Confined JVM host.** Run the APK host under a restricted token or AppContainer with a Job Object and the broker forced as its only egress, then add the Tachiyomi manga source API (following Suwayomi, MPL-2.0). Until this is done, APK sources stay opt-in. | Escape tests like M2's against the JVM host |

Order: M6, then M7, M8, M9, M10 and M11 (one vertical slice per category), then M12, then M13.

## 3. Decisions for the owner (not blocking M6 to M11)
1. **Third-party, unlicensed repositories in the built-in catalog** (hibiki-sources and similar). Should they be offered as one-click entries clearly marked "third-party, not reviewed", or left out?
2. **Public Kikoeru-API ASMR sites.** They are not offered, because they are copyright-infringing. Kikoeru stays available for the user's own server.

## 4. Acceptance test per category
These are automated over CDP against the real app on an isolated profile:
1. The built-in RiuPlay repository is visible under Sources.
2. The category's extension is installed or enabled from the UI.
3. Its content appears in the right section without further steps.
4. Search and the title page work.
5. One item plays or opens in the native player or reader (from a local fixture of the provider's API; there is also an optional live run).
6. Progress is saved and shows in Continue Watching, Reading or Listening.
