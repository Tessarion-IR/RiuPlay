# Audit: inherited default extension repositories

Date: 2026-11-07. Sources checked: the repository itself (cloned at its `main` HEAD, last 50 commits), the GitHub API, and the hibiki code that used it (`src/core/api/repositories.ts`, `src/core/marketplace.ts`).

## 1. `akkirrai1337/hibiki-sources` (hibiki's default scripted-source repository)

| Aspect | Finding |
|---|---|
| Ownership | Personal repository of GitHub user `akkirrai1337`, the hibiki author. Not an organisation, and not affiliated with RiuPlay. |
| License | **None.** The GitHub API reports `license: null`, and there is no LICENSE file. By default the scripts are "all rights reserved". RiuPlay may not copy or redistribute them. |
| Maintenance | Created 2026-08-03, last push 2026-10-21. 32 commits by the author and 18 by `github-actions[bot]`, which regenerates the index. 3 stars, 0 open issues, not archived. Active, but one person maintains it. |
| Contents | 15 source scripts plus reusable "extractor" resolvers. Languages: 6 `en`, 6 `ru`, 3 `uk`. They target third-party anime streaming websites, many of them unofficial. **1 source is marked NSFW.** |
| Format / compatibility | `repository/index.json` (schemaVersion 1) with `<id>.manifest.json` and `<id>.js` pairs. Fully compatible with RiuPlay's current runtime, because it is the same code hibiki uses. It is not a RiuPlay-specific or versioned API. |
| Integrity | The index carries **no hashes or signatures**. Scripts are fetched from `raw.githubusercontent.com/.../main/`, so whoever controls that account or branch decides what code users get on the next install or update. |
| Execution | Scripts run in `worker_threads` with `node:vm` contexts. **`node:vm` is not a security boundary**, so a malicious or compromised script can reach Node APIs, the file system and the network with the user's rights. |
| Install / update behaviour | Installing and updating are explicit user actions ("Install", "Update all"). Adding a repository by hand asks for trust confirmation. **But hibiki seeded this repository into every fresh install with no prompt.** |

### 2. `yuzono/anime-repo` (hibiki's default Aniyomi APK index)
Hibiki seeded it only where the Java APK host runs. It is also third-party (Apache-2.0 extension sources) and runs Dalvik code in a JVM child process with the user's rights. The same reasoning applies.

## Decision

**RiuPlay ships with no preinstalled extension repository** (`src/core/api/repositories.ts`):
- Fresh installs start with an empty repository list. The Sources page says that RiuPlay includes and endorses no repository, and points to "Add repository", which shows the existing trust warning.
- **Existing installs are not changed.** A repository hibiki had already added stays in the list until the user removes it, so no user data is deleted.
- Users can still add `hibiki-sources` or any other repository by URL. Nothing in RiuPlay presents it as an official RiuPlay repository.
- Tests: `src/core/api/repositories.test.ts` covers "preinstalled repositories".

Reasons: it has no license, it is not owned or reviewed by RiuPlay, its code is unsigned and runs without a real sandbox, it includes NSFW content, and it targets unofficial streaming sites, a legal risk for a public open-source project.

## What would make a default repository acceptable (Phase 7)
1. A RiuPlay-owned repository with a clear license for every extension.
2. Per-extension SHA-256 in the index, verified before install. Ideally signed indexes.
3. Extensions running in a restricted utility process with declared host permissions (see `ARCHITECTURE.md`).
4. A review policy and a NSFW opt-in.
