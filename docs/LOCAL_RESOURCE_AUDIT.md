# Local Resource Audit

Scope was limited to folders that clearly relate to RiuPlay. Personal files, browser profiles and credential stores were not accessed.

| Path | Related? | Notes |
|---|---|---|
| `E:\Projects\RiuPlay` | Yes | The project. See `EXISTING_PROJECT_AUDIT.md`. |
| `E:\Projects\Barsan` | No | Two `.txt` files (names only inspected). Not opened. |
| `E:\Projects\CD` | No | Empty directory. |

## Assets
- The project ships **no** icons, logos, fonts or images. The sidebar logo is a `lucide-react` `PlaySquare` icon on the accent colour. A RiuPlay logo and `.ico` must be created during the Windows integration phase.

## Machine toolchain (relevant to building)
| Tool | Status |
|---|---|
| Git | 2.55.0 (Windows) ✅ |
| Python | 3.14.4 ✅ (only needed by node-gyp fallback) |
| Node.js / npm | ❌ **Not installed**. This blocks every build and test step. Required: Node 22 LTS. |
| Java (JRE 17+) | Not checked/required yet. Only needed for the optional Aniyomi APK host (see INTEGRATION_PLAN). |
| Visual Studio Build Tools | Not checked. better-sqlite3 ships prebuilt binaries for Electron, so they are usually not needed. |

## Reference repositories (cloned read-only for audit)
Shallow clones live in the session scratchpad. None of their code has been executed, and none has been copied into RiuPlay yet.

| Repo | Commit | Date |
|---|---|---|
| akkirrai1337/hibiki-desktop | 5f7eb3b | 2026-10-09 |
| akkirrai1337/hibiki | 132a71e | 2026-10-23 |
| pa-jesusf/KikoFlu | d8a8c61 | 2026-09-19 |
| Suwayomi/Suwayomi-Server | 7b061be | 2026-11-01 |
