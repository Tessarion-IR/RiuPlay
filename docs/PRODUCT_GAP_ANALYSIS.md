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
| **Keiyoushi** (Apache-2.0) | Tachiyomi/Mihon extensions built against Keiyoushi's own **extensions-lib 1.6** (a redesigned, suspend-based API: `getMangaUpdate`, `memo`). The index is **protobuf** (`repo.json` -> `index.pb`, gzip'd; `index.min.json` serves only an "Outdated App" placeholder). Every extension is published twice: an APK and a **signed JVM jar** (`Resources.jarUrl`, field 501), both signed with the key `repo.json` publishes. | **Done (K1-K5, 2026-11-08).** See below. |

### How Keiyoushi runs inside RiuPlay (no Suwayomi, no Java to install)
1. **Repository (K3).** Discover > "Keiyoushi manga extensions" > Add repository (one click). The main process reads `repo.json` and the v2 index through NetClient (`src/main/extensions/keiyoushiIndex.ts`, a small protobuf reader) and refuses an index whose signing key differs from `repo.json`'s. All 1,556 extensions are listed under Sources > Extensions; NSFW and "mixed" ones are marked 18+.
2. **Install (K3).** The jar URL and the key are read again from the repository in the main process (never taken from the page). The signed jar is downloaded through NetClient, its signer is checked in a separate confined JVM that loads no extension (`--verify`: `java.util.jar` verification, every entry signed, exactly one signer), and checked again by the host before it is stored. A jar signed by anyone else is refused. Using the jar means no dex conversion: dex2jar mistranslates R8-optimised constructors (MangaDex, Webtoons) and would need the verifier off.
3. **Runtime (K1, K2).** `apk-host` builds again (hibiki's shared sources are vendored in `apk-host/shared/`, JDK 21 toolchain, Kotlin 2.4.10, OkHttp 5.4.0 to match what the extensions are built with). The extensions-lib 1.6 API is re-implemented in `apk-host/src/main/kotlin/eu/kanade/tachiyomi/source/` (`HttpSource` keeps a `headers$delegate` field, which Keiyoushi's `KeiSource` replaces by reflection; the manga client omits the Aniyomi compression interceptors that `KeiSource` refuses). `MangaSourceAdapter` answers search, latest, details, chapters (one `getMangaUpdate` per title, serialised: sources refuse concurrent updates), pages (opaque tokens) and page pictures (the source's own `imageRequest` and client). Android stand-ins were added for what the tested extensions touch (`LocaleList`, `Paint`/`Canvas`/`StaticLayout` as non-drawing types, `WebChromeClient`, `ConsoleMessage`, a `Dispatchers.Main`).
4. **Confinement (K4).** The JVM runs through `riuplay-sandbox.exe` (`apk-host/sandbox/RiuPlaySandbox.cs`): an **AppContainer with no capabilities** (no network at all, not even loopback; only its runtime and lib folders readable and its data folder writable), a **Job Object** (one process: it cannot start programs; 1.5 GB; no clipboard or desktop; killed with the launcher), image-load and extension-point mitigations, three inherited handles and a minimal environment. Its only channel is stdin/stdout in frames (`apkBroker.ts` / `Broker.kt`): RiuPlay sends requests, and the host asks RiuPlay for every outbound connection, which `NetClient.openTunnel` decides with the same rules as every request (host policy, DoH or proxy resolver, every resolved address public, socket pinned to the validated address, proxy never bypassed) on ports 80/443 only. TLS stays end to end inside the host. zstd's DLL ships read-only (`native/`), because the sandbox will not load code from a folder the host can write.
5. **Catalogue (K5).** APK manga sources are providers of the Manga section (M8 adapter): titles, search, the RiuPlay title page, chapters as units, pages served by the host at `riuplay-media://ext/<unit>/page/<n>` in the native reader, progress and Continue Reading. Aniyomi APK sources appear in Video and keep the anime pipeline.

### Tests (2026-11-08)
- **In the real app** (isolated profile, `research/m8/verify-extension-slices.mjs`, `SLICES=keiyoushi`): **11/11**. One-click repository; 1,556 extensions read from the v2 index with signer `9add655a…`; Arknights Comics listed; install with the permission dialog (which states the sandbox); installed and enabled; 17 titles in Manga; search "Prelude" (3 results); title page with 3 chapters; a chapter read in the native reader (pages decoded, 44 pages); progress saved and shown in Continue Reading.
- **Escape tests** (`apkSandbox.e2e.test.ts`): from inside the sandbox, reading and listing the person's files, writing outside its folder, listing the profile, connecting to the internet and to a loopback listener, resolving DNS and starting `cmd.exe` all fail; writing its own folder and reading its runtime work.
- **Broker rules:** private, loopback, link-local/metadata addresses (also by name and in mixed answers), non-web ports and an unusable proxy are refused.
- **Live, confined:** Arknights Comics and Gunnerkrigg Court - signer check, install, popular, search, details, chapters, pages and a page picture through the broker. At JVM level also: MangaDex and Webtoons.com load (62 and 7 sources).
- `apk-host` unit tests 81/81; RiuPlay main and renderer suites and the typecheck (see the commit).

### Remaining limitations
- **Sites blocked on the test network.** MangaDex, Webtoons.com and many others resolve to a DNS sinkhole (`10.10.34.35`) here, so they were not exercised end to end; RiuPlay refuses private addresses, as it should. With a proxy configured in RiuPlay they go through it.
- **Network scope.** APK extensions declare no hosts, so their connections are limited to public websites on ports 80/443 rather than to a per-extension list.
- **WebView-based sources** (Manga UP! uses one for a token) get their pages from RiuPlay's hidden windows (the existing RemotePages path); this was not exercised end to end for a manga source.
- **Drawing.** `Canvas`/`StaticLayout` do not draw: pages a source renders itself (Webtoons' author notes) fail; picture pages are unaffected. QuickJS-based sources (a few) are not supported.
- **Settings** of manga sources (`ConfigurableSource`) are not shown yet; **icons** come from the repository only on the card, not for installed sources.
- **Windows only.** Without `riuplay-sandbox.exe` (other platforms) APK sources are off; they never run unconfined.
- **Aniyomi APKs** (Hibiki's second repository) now run in the same sandbox but were not re-tested end to end.

### Packaging
`gradlew bundle -PbundleName=<arch>` in `apk-host/` (JDK 21; set `JDK21_HOME` if Gradle does not find it) writes `build/bundle-<arch>/`: `lib/` (15 MB of jars), `runtime/` (37 MB, Temurin 21 jlink'd, with its `legal/`), `native/zstd-kmp.dll` and `riuplay-sandbox.exe` (built with the in-box .NET Framework `csc.exe`). `electron-builder.yml` copies it to `resources/apk-host`. About 52 MB per architecture; users install nothing.
