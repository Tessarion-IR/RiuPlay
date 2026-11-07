# RiuPlay Architecture (target)

```
┌──────────────────────── Electron main process (privileged) ────────────────────────┐
│ app lifecycle · tray · protocol/file associations · safeStorage · auto-update      │
│ IPC router (typed, zod-validated)                                                   │
│  ├─ core/  (platform-independent domain, from Hibiki core/ + RiuPlay server/)       │
│  │   db/ (better-sqlite3 + Drizzle, migrations, backup)                             │
│  │   media/ (MediaItem, MediaAsset, Unit = episode|chapter|track)                   │
│  │   library/ history/ progress/ collections/ categories/                           │
│  │   net/  guardedFetch (SSRF: scheme, DNS-resolve, private-IP block, per-hop       │
│  │         redirect check, IP pinning) · proxy (http/https/socks5) · cache          │
│  │   extensions/ marketplace · manifest validation · permissions · updates          │
│  │   downloads/ queue · Range resume · HLS segments                                 │
│  │   providers/ direct-url · local-files · rss/atom/json-ld/opengraph · suwayomi    │
│  └─ platform/electron/ adapters                                                     │
├──────────── Extension host (separate utilityProcess per pool, no Node APIs) ────────┤
│ scripted sources run in a restricted context; all I/O is brokered by main via       │
│ guardedFetch and filtered by the extension's declared host permissions              │
├──────────── Optional: apk-host (JVM child process, loopback + token) ───────────────┤
├──────────── Optional: mpv.exe (JSON IPC named pipe) ───────────────────────────────┤
└─────────────────────────────────────────────────────────────────────────────────────┘
        ▲ contextBridge (preload, minimal API)    
┌───────┴───────────── Renderer (sandboxed, contextIsolation, no Node) ───────────────┐
│ React 19 · TanStack Router/Query · Zustand · Tailwind                               │
│ Home · Discover · Categories · Details · Library · Continue · History · Sources ·   │
│ Extensions · Downloads · Profile · Settings · Player (video) · Reader · AudioBar    │
│ PlaybackEngine: HtmlMediaEngine | MpvEngine     SubtitleService (UI-independent)    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Universal models
`MediaItem` (contentType: video | manga | audio; universal metadata + `providerMeta` JSON) ← 1..n `MediaSourceLink` (the same title from several providers; used for duplicate detection by normalised title + year + external ids) → `Unit` (episode/chapter/track) → `PlaybackOption` / `MediaAsset` / `Subtitle`.
`LibraryEntry`, `WatchProgress` (per unit, upserted), `WatchHistory` (append-only), `Category`, `Collection`, `LocalProfile`, `ApplicationSettings`, `SourceRepository`, `SourceInstance`, `Extension`, `ExtensionVersion`, `BackupMetadata`.

## Data location
`%APPDATA%\RiuPlay\` → `riuplay.db` (WAL), `extensions\`, `downloads\` (configurable), `cache\`, `backups\`, `logs\`.
