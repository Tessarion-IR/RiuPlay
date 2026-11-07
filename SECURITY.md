# Security Policy

## Reporting a vulnerability
**Do not open a public issue for a security problem.** Report it privately through GitHub's **"Report a vulnerability"** button (Security → Advisories) on https://github.com/Tessarion-IR/RiuPlay.

Include the affected version, the steps to reproduce, and the impact. We aim to acknowledge reports within 7 days.

## Supported versions
RiuPlay is in alpha. Only the latest `main` branch receives fixes.

## Security model and known limitations
- **Renderer:** runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. The page can only reach the typed API exposed by the preload script.
- **Extensions are third-party code.** Today, scripted extensions run in Node `worker_threads` using `node:vm` contexts. **`node:vm` is not a security boundary**, so only install extensions from repositories you trust. Moving extensions to a restricted separate process, with declared permissions and integrity checks, is planned for Phase 7 (see `docs/ARCHITECTURE.md`).
- **No extension repository is preinstalled.** RiuPlay doesn't include or endorse any repository. See `docs/EXTENSION_REPOSITORY_AUDIT.md`.
- **APK extensions** run in a separate JVM process that talks to the app over loopback with a random token. They have the same rights as your user account.
- **Network:** protection against requests to private and loopback addresses (SSRF) is not complete yet. It is planned for Phase 6.
- **LAN device sync is off by default.** While it's off, RiuPlay opens no listening socket, answers no discovery probe and contacts no other device. Pairing, discovery and sync requests are refused in the main process, not just hidden in the UI. Tests in `src/main/lanSync.test.ts` and `src/main/ipc/sync.test.ts` check this with real sockets.
  - **When the user turns it on:** it listens on TCP 47652 and UDP 47653 on all interfaces, which the LAN needs. The first time, Windows Firewall asks whether to allow it. The installer adds no firewall rule. Turning it off closes both sockets and any live connection at once.
  - **Authentication:** pairing uses a 6-digit code shown on the other device. The code rotates every couple of minutes, and a window allows 5 attempts. The key exchange (ECDH) is bound to the code. Every later request must come from a paired device, and requests from unknown devices are rejected.
  - **Hardening:** at most 4 concurrent connections, because a request (up to 64 MB) is read before its sender is known, and a 60 s per-connection timeout.
  - **Not covered:** the LAN itself is trusted for availability, so someone on your network can still try to connect while sync is on. Use it only on networks you trust.
- **Profile folder:** the main process pins it to `%APPDATA%\RiuPlay` before any module loads (`src/main/appIdentity.ts`), so RiuPlay never opens another application's profile.
- **Data:** everything is stored unencrypted in `%APPDATA%\RiuPlay\`, protected by your Windows account permissions.
