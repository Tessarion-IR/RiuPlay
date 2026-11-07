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
- Every copied file keeps upstream attribution in a header comment, plus a `Modified by RiuPlay` note.
- `THIRD_PARTY_NOTICES.md` lists every upstream project, commit and license.
- npm dependencies are audited for license (`license-checker`) before each release.
