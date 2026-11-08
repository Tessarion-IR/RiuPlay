# Security Policy

## Reporting a vulnerability
**Do not open a public issue for a security problem.** Report it privately through GitHub's **"Report a vulnerability"** button (Security → Advisories) on https://github.com/Tessarion-IR/RiuPlay.

Include the affected version, the steps to reproduce, and the impact. We aim to acknowledge reports within 7 days.

## Supported versions
RiuPlay is in **alpha**. Only the latest pre-release and the `main` branch receive fixes. Alpha builds are not code-signed.

## Security model
These protections are implemented and covered by automated tests. **They have not been independently audited.**

- **Renderer:** runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. The page can only reach the typed API exposed by the preload script.
- **Profile folder:** the main process pins it to `%APPDATA%\RiuPlay` before any module loads (`src/main/appIdentity.ts`), so RiuPlay never opens another application's profile.
- **Scripted extensions are third-party code.** Each one runs in its own Chromium-sandboxed hidden window with an in-memory session (`docs/M2_SANDBOX.md`):
  - it has no Node or Electron APIs and no file access;
  - its network requests go through the main-process network client;
  - a Windows Job Object limits its memory.

  Repositories start "not reviewed". The permissions an extension declares, including the hosts it may contact, are shown before install and enforced by the main process (`docs/M1_EXTENSION_LIFECYCLE.md`). The sandbox reduces the risk of installing extensions; it doesn't remove it.
- **No extension repository is preinstalled.** RiuPlay doesn't include or endorse any repository. The Discover catalog only lists starting points, and adds nothing by itself.
- **Network** (`docs/M3_NETWORKING.md`): requests from extensions, downloads, server connections and the app's own features go through one controlled client.
  - Loopback, private, link-local and other special addresses are blocked, unless the user approved that exact media server.
  - Every resolved address is checked and the connection is pinned to it, and every redirect is re-checked.
  - A configured HTTP, HTTPS or SOCKS5 proxy is never bypassed, and DNS goes through it too.
- **Credentials:** proxy and media-server passwords are encrypted with Windows DPAPI (Electron `safeStorage`) and stay in the main process. Server credentials are sent only to their own server's origin, and new backups leave out the proxy password.
- **LAN device sync is off by default.** While it's off, RiuPlay opens no listening socket, answers no discovery probe and contacts no other device. The main process refuses pairing, discovery and sync requests; they aren't just hidden in the UI.
  - **When the user turns it on:** it listens on TCP 47652 and UDP 47653 on all interfaces. The first time, Windows Firewall asks whether to allow it. The installer adds no firewall rule.
  - **Authentication:** pairing uses a rotating 6-digit code shown on the other device, with 5 attempts per window and an ECDH key exchange bound to the code. Requests from unknown devices are rejected.
  - **Hardening:** at most 4 concurrent connections, each with a 60 s timeout.
  - **Not covered:** someone on your network can still try to connect while sync is on, so use it only on networks you trust.
- **Data at rest:** apart from the encrypted passwords above, the database and files in `%APPDATA%\RiuPlay\` are not encrypted. Your Windows account permissions protect them.

## Known limitations (alpha)
- **Streams in the player:** a stream URL is checked before playback starts. Later HLS/DASH segments, redirects during playback and DNS changes are not yet continuously re-checked. A desktop stream proxy that closes this gap is deferred.
- **APK (Java) extensions** run in a separate JVM process with the same rights as your user account, outside the sandbox and the controlled network path. They are off by default and need an explicit opt-in. Alpha release builds don't include the Java host.
- **Suwayomi and Kikoeru connections** are tested against fake servers only, not yet against real servers.
