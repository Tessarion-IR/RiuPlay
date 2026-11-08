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

## 5. Mandatory ecosystems (owner decision, 2026-11-08): what the upstream code actually does

The owner fixed the three ecosystems: **KikoFlu** for audio/ASMR, **Hibiki** for anime and **Keiyoushi** for manga. These findings come from the upstream source code, cloned read-only on 2026-11-08: KikoFlu `d8a8c61`, hibiki `132a71e`, keiyoushi/extensions-source `2c02d07b`.

| Ecosystem | How it really gets content | Integration in RiuPlay |
|---|---|---|
| **KikoFlu** (GPL-3.0) | `KikoeruApiService` talks to **asmr.one's public Kikoeru-compatible API**: `ServerUtils.defaultRemoteHost` is `api.asmr-200.com`, with mirrors `api.asmr-100.com` and `api.asmr-300.com`. It uses `/api/works`, `/api/search/<kw>`, `/api/work/<id>` and `/api/tracks/<id>` (a folder tree whose `mediaStreamUrl` points at `*.kiko-play-niptan.one`). It works anonymously. Most of the catalogue is R18 commercial (DLsite) works. | **Done:** `riuplay.asmr-one`, a built-in host-API-2 audio extension speaking the same endpoints, with mirror fallback. It runs in the M2 sandbox, its hosts are limited to those four, and the format is chosen per recording. **R18 is off by default**: every query carries the API's own `$-age:adult$` filter, and each work's `nsfw` flag is checked again; a per-source setting turns R18 on. The extension is marked 18+ in Sources. Lyric/subtitle files (`.vtt`/`.lrc`) are matched to tracks; showing them in the audio player is still to do. |
| **Hibiki** (GPL-3.0) | Two default repositories (`src/core/marketplace.ts`): **hibiki-sources**, a scripted JS index with 15 sources and 10 resolvers and no license, and **yuzono/anime-repo**, Aniyomi APKs that need the JVM host. | **Scripted sources: done.** They are a one-click, third-party Discover entry, never preinstalled or trusted, with their audit facts shown. Once added, their sources are listed under Extensions and install with one click (behind the permission dialog). They run in the M2 sandbox through the broker, appear in the Video section, and open in the native anime pipeline (title page, episodes, resolvers, HLS player, history). **Aniyomi APKs:** see K-milestones. |
| **Keiyoushi** (Apache-2.0) | Tachiyomi/Mihon **APK** extensions (Kotlin compiled to dex). The repository index has moved to **protobuf** (`repo.json` points to `index.pb`; `index.min.json` now serves only an "Outdated App" placeholder), APKs are listed in `release-assets.json`, and `repo.json` publishes a signing-key fingerprint. | **Not yet possible in-app; needs the JVM host.** RiuPlay's APK host (inherited from Hibiki) loads Aniyomi `AnimeSource`s only. It has no Tachiyomi manga API, compiles against `android/` sources that were not imported into this repository, and needs JDK 21, which this machine doesn't have (JDK 8 only). |

### Why Keiyoushi (and Hibiki's APK repository) can't be embedded directly
1. **Format.** These are Android dex bytecode, not scripts. They only run on a JVM, through dex-to-jar translation plus an implementation of the Tachiyomi source API (`HttpSource`, `ParsedHttpSource`, `SManga`/`SChapter`/`Page`, `NetworkHelper`). That is the same approach Suwayomi (MPL-2.0) and Mihon (Apache-2.0) use.
2. **Security.** A JVM process can't run inside the Chromium sandbox, and it has the user's full rights. Making it one-click without weakening M2/M3 needs a **confined JVM host**:
   - a restricted token or AppContainer;
   - a Job Object;
   - network traffic forced through a broker proxy that applies each extension's hosts.
3. **Build.** JDK 21 and Gradle dependencies have to be downloaded, plus a trimmed Java runtime (jlink) bundled per release.

### K-milestones (Keiyoushi and Aniyomi APKs)
| # | Milestone | Done when |
|---|---|---|
| K1 | Restore Hibiki's shared `android/…/eu/kanade/tachiyomi` sources (GPL-3.0) so `apk-host` builds; JDK 21 toolchain | `gradlew test` passes in `apk-host` |
| K2 | Port the Tachiyomi **source API** from Mihon (Apache-2.0, notices kept) into `apk-host`, and add a manga loader beside the anime one | A Keiyoushi APK loads; popular, search, details, chapters and pages answer |
| K3 | Keiyoushi index v2 (`index.pb`) and `release-assets.json` client; **APK signature checked against the published fingerprint** before install | Install, update and uninstall from Sources |
| K4 | **Confined JVM:** AppContainer or restricted token plus a Job Object; egress only through a local broker proxy that applies per-extension hosts; escape tests like M2's | The escape tests pass. APK sources then lose the "full user rights" opt-in gate |
| K5 | APK manga sources as host-API-2 manga providers (the M8 adapter), and Aniyomi APKs in the anime pipeline | Keiyoushi acceptance §4 passes in the real app |
