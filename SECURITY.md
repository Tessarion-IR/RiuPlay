# Security Policy

## Reporting a vulnerability
**Do not open a public issue for a security problem.** Report it privately through GitHub's **"Report a vulnerability"** button (Security → Advisories) on https://github.com/Tessarion-IR/RiuPlay.

Include the affected version, the steps to reproduce, and the impact. We aim to acknowledge reports within 7 days.

## Supported versions
RiuPlay is in alpha. Only the latest `main` branch receives fixes.

## Security model and known limitations
- **Renderer:** runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. The page can only reach the typed API exposed by the preload script.
- **Extensions are third-party code.** Today, scripted extensions run in Node `worker_threads` using `node:vm` contexts. **`node:vm` is not a security boundary**, so only install extensions from repositories you trust. Moving extensions to a restricted separate process, with declared permissions and integrity checks, is planned for Phase 7 (see `docs/ARCHITECTURE.md`).
- **APK extensions** run in a separate JVM process that talks to the app over loopback with a random token. They have the same rights as your user account.
- **Network:** protection against requests to private and loopback addresses (SSRF) is not complete yet. It is planned for Phase 6.
- **LAN device sync:** the app currently listens on TCP 47652 and UDP 47653 on all interfaces at startup, so Windows Firewall will ask about it. It answers discovery probes only during an explicit pairing window, and syncing requires pairing. Making it opt-in is planned for Phase 5.
- **Data:** everything is stored unencrypted in `%APPDATA%\RiuPlay\`, protected by your Windows account permissions.
