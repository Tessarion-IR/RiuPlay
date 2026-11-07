# License Compliance

| Component | License | Used how | Obligation |
|---|---|---|---|
| Hibiki / Hibiki Desktop | GPL-3.0-only | Proposed foundation (code copied and modified) | RiuPlay **as a whole must be distributed under GPL-3.0-only**: keep copyright/LICENSE notices, mark modified files, provide complete corresponding source with every binary release, and add no further restrictions. |
| Hibiki APK-compat code (from Anikku / yuzono) | Apache-2.0 | Comes with Hibiki if the APK host is kept | Keep NOTICE/attribution. Apache-2.0 → GPLv3 is compatible. |
| KikoFlu | GPL-3.0 | Algorithms re-implemented in TS (queue, subtitle matching, session restore) | A close translation is a derivative work → GPL-3.0 (consistent with the above). Credit in `THIRD_PARTY_NOTICES.md`. |
| Suwayomi-Server | MPL-2.0 | Design ideas + calling its REST API | No files copied → no obligations. If any file is ever copied, it stays MPL-2.0 with its header. |
| mpv (optional) | GPL-2.0+/LGPL-2.1+ | Separate executable | Ship its license and a source link. |
| Aniyomi/Mihon extensions | Various (mostly Apache-2.0) | Run by the user's choice, not distributed | None for RiuPlay. Users are responsible for the sources they add. |

## Decision required from the owner
Adopting Hibiki code **makes RiuPlay GPL-3.0-only, permanently and for all contributors**. RiuPlay currently has no license, so there is no conflict, but this choice belongs to the owner. **No Hibiki or KikoFlu code has been copied yet.**

If GPL is not acceptable, the fallback is option C (clean-room Electron app inspired by the references, any license). It would take several times the effort.

## Rules applied
- Upstream attribution and the GPL §5a modification notice for the whole imported hibiki tree are kept centrally in `THIRD_PARTY_NOTICES.md`, because hibiki's own files carry no per-file headers. Git history records each change. A file ported from *another* project (for example a KikoFlu algorithm) gets a header naming its source.
- `THIRD_PARTY_NOTICES.md` lists every upstream project, commit and license.
- npm dependencies are audited for license (`license-checker`) before each release.

---

## Resolution and checks (2026-11-07)

**Decision:** the owner approved **GPL-3.0-only** for RiuPlay and the use of hibiki as the foundation.

| Check | Result |
|---|---|
| Existing RiuPlay code (`legacy/next-app/`) | Written for this project and never published under any license, so the owner can license it as GPL-3.0. |
| Original template (`nextjs-postgresql-template`) | It contributed only trivial configuration boilerplate: `next.config.ts`, `postcss.config.mjs`, the ESLint flat config, the tsconfig and a `pg` pool singleton. No license header or LICENSE file came with it, and nothing it contains is copyrightable expression worth worrying about. **Assumption:** the owner obtained it from a generator with no restrictive terms. It is kept only under `legacy/` and will not ship in the app. |
| hibiki @132a71e | GPL-3.0-only, with the full, unmodified GPLv3 text in `LICENSE`. Attribution and a §5a modification notice are in `THIRD_PARTY_NOTICES.md`. |
| Apache-2.0 parts in hibiki (`apk-host/`, Anikku/yuzono) | Compatible with GPLv3. Credited. |
| npm production dependencies | MIT 145, Apache-2.0 19, BSD-2 11, ISC 10, BSD-3 3, 0BSD 1, Unlicense 1, MIT/WTFPL 1, BSD-2/MIT/Apache 1. **All are GPLv3-compatible.** (The one "UNLICENSED" entry is RiuPlay itself, reported that way because `private: true`.) |
| Branding | Hibiki's logos were removed. RiuPlay has its own logo (`electron-builder-resources/riuplay.svg`). |
| Distribution duty | Every binary release must link to the exact source commit. Releases come from this public repository. |
