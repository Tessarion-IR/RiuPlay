<div align="center">

<img src="electron-builder-resources/riuplay.svg" alt="RiuPlay logo" width="112" height="112"/>

# RiuPlay

**A local-first, open-source media application for Windows: video, anime, manga, audio and ASMR, from your own files, your own servers and sources you choose.**

[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPL--3.0--only-blue.svg)](LICENSE)
![Platform: Windows 10/11 x64](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D6)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange)

</div>

> [!WARNING]
> **RiuPlay is alpha software.** This is an early public pre-release for testing and feedback. It is not stable or production-ready. Expect bugs, rough edges and changes that may need a fresh profile. The builds are **not code-signed**. Read [Known alpha limitations](#known-alpha-limitations) before you install, and keep a backup of anything you care about.

## What RiuPlay is

RiuPlay is one desktop app for the media you watch, read and listen to.

- **Local-first.** No account and no cloud backend. Your library, progress, history and settings stay in a SQLite database on your PC.
- **Bring your own media.** RiuPlay doesn't host or distribute content. It plays your local files and links, connects to servers you run yourself, and runs source extensions: its own built-in ones and those from repositories you add.
- **Sources fill the sections.** Install a source with one click and its titles appear in the Video, Manga or Audio section, with search, title pages, the native player or reader, and progress.
- **One library for everything.** Video, manga and audio share one model: the same library statuses, favourites, collections, progress and search.
- **Made for Windows.** It has a native installer, a portable build, Windows media keys and a `riuplay://` link handler.

RiuPlay is derived from [hibiki](https://github.com/akkirrai1337/hibiki) (GPL-3.0-only). It also borrows ideas from [KikoFlu](https://github.com/pa-jesusf/KikoFlu) and [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server). See [License and credits](#license-and-credits).

## Features

### Video and anime
- Built-in player for HLS, DASH and MP4 streams and local video files. It has quality and speed controls, subtitles with delay adjustment, opening and ending skip, and resume.
- **Hibiki's anime sources** (Hibiki's own scripted source repository) are one click away in Discover. Their titles appear in the Video section and open on the anime title page, with episodes, Hibiki's player and resolvers, and resume.
- Open films and animation from the Internet Archive (built in).
- Continue Watching, watch history and episode downloads for offline viewing.

### Manga
- **Keiyoushi's manga extensions run inside RiuPlay.** No Suwayomi server and no Java to install: RiuPlay ships its own Java runtime and runs the extensions in a Windows sandbox (see [Security and privacy](#security-and-privacy)). Their titles, chapters and pages appear in the Manga section and the native reader.
- Pepper&Carrot (CC BY 4.0, built in), local folders of images, page URLs and chapters from your own Suwayomi server.
- Continue Reading with remembered page position.

### Audio and ASMR
- **KikoFlu's content source, asmr.one**, as a built-in extension: search, works with their tracks, the native audio player. **Adult (R18) works are hidden** unless you turn on "Show adult (R18) works" in that source's settings.
- LibriVox audiobooks and open audio from the Internet Archive (built in).
- An audio player page with auto-next and Windows media keys; local files and folders, track URLs, and works from your own Kikoeru server.
- Continue Listening with remembered position.

### Unified library
- **Add media** by URL, from files on your PC (they are never copied), or by hand.
- Library statuses (watching or reading, planned, completed, on hold, dropped), favourites and **collections** that mix your own titles with titles from sources.
- **Search** covers both your sources and your own library, with each result labelled by where it comes from.
- Profile and History show your video, manga and audio activity.
- Backup and restore of the local database, plus English, Russian and Ukrainian interface languages (some newer screens are English only).

### Extensions and sources
- A **built-in RiuPlay repository** ships inside the app (open films, Pepper&Carrot, LibriVox, open audio, asmr.one). Its files are checked against SHA-256 hashes before install.
- Install, update, disable and remove scripted source extensions from HTTPS repositories, and Keiyoushi's manga extensions (signed Java jars).
- A **Discover** catalog on the Sources screen lists known repositories and servers. For each one it shows the license, maintenance status and the date its facts were checked. Nothing in it is added, trusted or installed until you choose.
- Repositories start as **not reviewed**. Trusting a repository and installing from it are separate choices.
- Before you install an extension, RiuPlay shows the permissions it asks for, such as the hosts it may contact.

### Your own servers: Suwayomi and Kikoeru
- Connect a [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) (manga) or a [Kikoeru](https://github.com/kikoeru-project/kikoeru-express) server (audio and ASMR) under **Settings → Network → Media servers**.
- Browse the server from the Manga and Audio sections and add titles to your library. They then behave like any other title.
- Passwords are encrypted with Windows DPAPI and never shown again. They are sent only to the server they belong to.
- A server on your own PC or local network only works after you confirm it in the connection form.

## Installation (Windows)

Requirements: **Windows 10 or 11, x64.**

1. Open the [Releases page](https://github.com/Tessarion-IR/RiuPlay/releases) and pick the latest **pre-release**.
2. Download one of these files:
   - `RiuPlay-v<version>-setup.exe`: an installer for your user account. It needs no administrator rights and adds Start-menu and desktop shortcuts.
   - `RiuPlay-v<version>-portable.exe`: a single file that runs without installing.
3. Optionally, check the download against `SHA256SUMS.txt` from the same release:
   ```powershell
   Get-FileHash .\RiuPlay-v<version>-setup.exe -Algorithm SHA256
   ```
4. Run it. The builds are **not code-signed**, so Windows SmartScreen may say "Windows protected your PC". Choose **More info → Run anyway** only if the checksum matches.

Both builds keep your data in `%APPDATA%\RiuPlay\`. That folder holds the database `riuplay.db`, plus `logs\`, `extensions\` and `backups\`. Uninstalling doesn't delete it.

The in-app updater only offers **stable** releases, so it won't offer alpha pre-releases. Update an alpha by installing the next one from the Releases page.

## First-run setup

1. **Onboarding** explains the Video, Manga and Audio sections. Online sources are optional, and you can skip every step.
2. **Add your own media:** in any section, choose **Add media** to add a link, a local file or a folder.
3. **Connect a server (optional):** open **Settings → Network → Media servers**, choose Suwayomi or Kikoeru, enter the address and sign-in, and choose **Test**.
4. **Set a proxy (optional):** set it under **Settings → Network**. HTTP, HTTPS and SOCKS5 proxies are supported, and the proxy password can be stored encrypted.

## Discovering and adding repositories

RiuPlay ships with its own **built-in repository** and endorses no third-party one.

1. Open **Sources → Extensions**. The built-in sources are listed there; **Install** shows what the source may do (for example "Connects only to: archive.org") and installs it. Its titles then appear in its section.
2. **Sources → Repositories → Discover** lists known third-party starting points. Each entry links to its project page and states its license, cautions and the date it was checked. Use these buttons:
   - **Add repository** adds it. Its extensions are then listed under **Extensions** and install with one click. This is how you get **Hibiki's anime sources** and **Keiyoushi's manga extensions**.
   - **Get the server** opens the project page of a server you can run yourself.
3. You can also paste the HTTPS address of any repository you know.
4. A third-party repository is **not reviewed**. Check the permissions of the extension you want before installing. You can disable or remove it at any time.

**About the third-party ecosystems.** Hibiki's anime sources and most of Keiyoushi's extensions read unofficial websites, and asmr.one serves commercial works it does not hold a license for. RiuPlay is only a client; whether using them is lawful where you live is your responsibility. Hibiki's source repository states no license.

## Security and privacy

What RiuPlay does today (details in [SECURITY.md](SECURITY.md) and [docs/](docs)):

- **No telemetry and no account.** RiuPlay contacts:
  - the sources, servers and proxy you set up;
  - GitHub, to check for stable updates;
  - AniList (anonymously) and AniSkip, to look up opening and ending times when you play anime from a source;
  - a DNS-over-HTTPS provider, only if you turn that on.
- **Isolated renderer.** The UI runs with `contextIsolation`, `sandbox` and no Node integration. It can only reach a small typed API.
- **Sandboxed extensions.** Each scripted extension runs in its own Chromium-sandboxed hidden window with an in-memory session. It has no Node or Electron access and no file access. It runs under a Windows Job Object memory limit.
- **Confined Java host for APK extensions** (Keiyoushi manga, Aniyomi anime). RiuPlay's bundled Java runtime starts inside a **Windows AppContainer with no capabilities** and a **Job Object**:
  - it can read only its own runtime and write only its own data folder; your files, profile and other programs are out of reach;
  - it cannot start other programs;
  - it has **no network of its own**: it asks RiuPlay for each connection, and RiuPlay opens it only to public websites on ports 80 and 443, through your proxy if you set one.
  - Keiyoushi extensions install only if signed with the key the repository publishes. You can switch the Java host off under **Settings**.
- **One controlled network path.** All requests from extensions, downloads and the app's own features go through one checked client:
  - requests to your computer and local network are blocked unless you approved that exact server;
  - every resolved address is checked;
  - redirects are re-checked;
  - a configured proxy is never bypassed, and DNS goes through it too.
- **Credentials stay in the main process.** Server and proxy passwords are encrypted with Windows DPAPI and never reach the UI. New backups don't include the proxy password.
- **LAN device sync is off by default.** While it's off, RiuPlay opens no listening socket.

These are design goals backed by automated tests. **They have not been independently audited.** Extensions are third-party code, so only install them from repositories you are willing to trust.

## Known alpha limitations

These are known and not yet solved. They are not finished features.

1. **Stream security.** Stream URLs are checked when playback starts. Later HLS/DASH segments, redirects during playback and DNS changes are **not yet continuously re-checked**. Full stream-proxy hardening on desktop is deferred to a later release.
2. **Suwayomi and Kikoeru.** Both integrations have automated tests against disposable fake servers. They have **not yet been verified against real Suwayomi or Kikoeru servers**. Server titles don't pick up new chapters or tracks after you add them, and Kikoeru lyrics and subtitles are not imported.
3. **UI verification.** The new Media servers screens, the Discover catalog and the extension permission dialog have **not yet had a full manual interactive test**. They were checked in automated tests and screenshots only.
4. **APK (Java) sources** run confined (see above), but:
   - **Windows only**, and only with the bundled sandbox launcher; elsewhere they are off;
   - APK extensions declare no hosts, so they may contact **any public website** (never your computer or local network);
   - extensions that draw their own text pages (Webtoons' author notes) or use a JavaScript engine (QuickJS) don't work; WebView-based ones (Manga UP!) were not tested end to end;
   - manga sources' own settings screens and installed-source icons are not shown yet;
   - the Java host adds about 52 MB to the download.
5. **Discord Rich Presence** needs a RiuPlay Discord application id at build time (`RIUPLAY_DISCORD_CLIENT_ID`). The release builds have none, so **Discord presence stays off**.
6. **AniList sign-in** needs an AniList client id at build time (`ANILIST_CLIENT_ID`). The release builds have none, so AniList tracking isn't available.
7. **Translations.** The newest screens (servers, Discover, permission dialogs) are English only. Russian and Ukrainian fall back to English there.
8. **Unsigned builds.** The installer and the portable build are not code-signed.
9. **Windows only.** macOS, Linux and Android builds exist in the code but are not part of this release and are untested.
10. **Hibiki's sources were not played.** RiuPlay's anime pipeline was tested end to end (playback, controls, saved progress, resume) with a Hibiki-format source serving Creative Commons films. Hibiki's own sources were tested up to their episode lists; their streams come from unofficial sites and were not played in testing. Sites change often, so any of them may stop working.
11. **Network-dependent sources.** Some sites are blocked on some networks. RiuPlay refuses sites that resolve to private addresses (a common sign of a DNS block) instead of connecting.
12. **asmr.one lyrics** are matched to tracks but not yet shown in the audio player.

The full list of remaining work is in [docs/PHASE7_STATUS.md](docs/PHASE7_STATUS.md).

## Reporting bugs

- **Bugs and ideas:** open an issue with the [issue templates](https://github.com/Tessarion-IR/RiuPlay/issues/new/choose). Include:
  - the RiuPlay version (Settings → About);
  - your Windows version;
  - steps to reproduce;
  - relevant lines from `%APPDATA%\RiuPlay\logs\riuplay.log`.

  **Remove personal data, server addresses and anything that looks like a password or token** before you post log lines.
- **Security problems:** don't open a public issue. Report them privately through [GitHub security advisories](https://github.com/Tessarion-IR/RiuPlay/security/advisories/new), as described in [SECURITY.md](SECURITY.md).

## Building from source

Requirements: Windows 10/11 x64, **Node.js 22 LTS or newer** and **Git**. No C++ toolchain is needed.

```bat
git clone https://github.com/Tessarion-IR/RiuPlay.git
cd RiuPlay
npm ci
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development mode |
| `npm test` | Renderer unit tests (Vitest) |
| `npm run test:main` | Core and main-process tests (Vitest) |
| `npm run typecheck` | TypeScript project check |
| `npm run build:win` | Build the NSIS installer and the portable `.exe` into `release/` |

**The Java host for APK extensions** (optional for development, included in release builds) needs **JDK 21**. In `apk-host/`, run `gradlew bundle -PbundleName=x64` (set `JDK21_HOME` if Gradle does not find your JDK 21). This writes `apk-host/build/bundle-x64/`: the host's jars, a trimmed Java 21 runtime (jlink), `native/zstd-kmp.dll` and `riuplay-sandbox.exe` (built with the C# compiler that ships with Windows). `npm run build:win` packages it into `resources/apk-host`. For development, `gradlew bundle` writes `build/bundle-dev/`, which `npm run dev` uses.

Set the environment variable `RIUPLAY_USER_DATA_DIR` to an absolute path to run the app on a separate, disposable profile. This is useful for testing.

### Architecture

```
src/
  main/       Electron main process: window, IPC, database, network client, extension hosts, servers
  preload/    The minimal typed API exposed to the page
  core/       Platform-independent domain: database schema and migrations, library, extensions, sync
  platform/   Adapters (electron/, android/) behind the contracts in platform/types.ts
  renderer/   React 19 UI: TanStack Router and Query, Zustand, Tailwind
  shared/     Types and the IPC contract shared by every layer
apk-host/     The confined JVM host for Keiyoushi (manga) and Aniyomi (anime) APK extensions, and its sandbox launcher
extensions/   The built-in RiuPlay repository
legacy/       The original RiuPlay prototype (Next.js), kept for reference
docs/         Architecture, security, decisions and status reports
```

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/M2_SANDBOX.md](docs/M2_SANDBOX.md), [docs/M3_NETWORKING.md](docs/M3_NETWORKING.md) and [docs/M4_M5_SERVERS.md](docs/M4_M5_SERVERS.md).

## Creator and maintainer

RiuPlay is created and maintained by **[Tessarion-IR](https://github.com/Tessarion-IR)**.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. By contributing, you agree that your work is licensed under GPL-3.0-only.

## License and credits

RiuPlay is free software, licensed under the **GNU General Public License v3.0 only** ([LICENSE](LICENSE)).

- RiuPlay is derived from **[hibiki](https://github.com/akkirrai1337/hibiki)** v3.3.0 by akkirrai1337 and contributors (GPL-3.0-only). RiuPlay has modified it, and the changes are recorded in the Git history and in [CHANGELOG.md](CHANGELOG.md). Thanks to them for the foundation.
- The APK extension compatibility code comes, through hibiki, from **Anikku** and **Yuzono anime-extensions** (Apache-2.0).
- RiuPlay takes design ideas, but no copied code, from **[KikoFlu](https://github.com/pa-jesusf/KikoFlu)** (GPL-3.0) and **[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server)** (MPL-2.0). It talks to Suwayomi and Kikoeru servers only over their public HTTP APIs.
- The manga host implements **Keiyoushi**'s extensions-lib 1.6 API (Apache-2.0) and reads Keiyoushi's repository index format (Apache-2.0). Keiyoushi's extensions are downloaded by the user from Keiyoushi; they are not part of RiuPlay.
- Packaged builds include Electron, Chromium, Node.js and FFmpeg under their own licenses (`LICENSE.electron.txt`, `LICENSES.chromium.html`), and Eclipse Temurin 21 (OpenJDK, GPL-2.0 with the Classpath Exception; its license files are in `resources/apk-host/runtime/legal/`).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full notices.

RiuPlay is an independent project. It is not affiliated with or endorsed by hibiki, KikoFlu, asmr.one, Keiyoushi, Suwayomi, Kikoeru, AniList or Discord.

## Disclaimer

RiuPlay does not host, store or distribute any media. It works like a specialised browser and player for files, servers and sources that you add yourself. The developers have no affiliation with any content provider. Respect the copyright law of your country, and only use sources you have the right to access.
