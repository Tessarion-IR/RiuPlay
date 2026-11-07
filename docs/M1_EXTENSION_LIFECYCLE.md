# M1: Extension lifecycle, repositories and trust

**Status:** implemented and tested (unit tests and real-SQLite tests). The Sources screen was not checked by hand in a running app; the automated Phase 6 end-to-end checks run at the end of the phase.

## What already existed, and was kept

hibiki's lifecycle was already in place:
- add, remove and refresh repositories, with duplicate-address detection (`repositoryKey`) and GitHub address resolution;
- install, update and uninstall;
- installed versions;
- host-API compatibility (`shared/hostApi.ts`);
- origin tracking: an id installed from one repository can't be overwritten from another.

RiuPlay also already shipped **no** preinstalled repository (Phase 4). None of this was rewritten.

## What M1 adds

| Area | Behaviour | Where |
|---|---|---|
| Repository trust | A repository starts **"Not reviewed – added by you"**. Adding it is discovery, not trust. **Trust…** is a separate, explicit choice. It changes only what the install dialog says, and it **never** gives an extension extra rights. | `repository_state.trust`, `RepositoryTrustBar` |
| Enable / disable a repository | A disabled repository is not fetched, and nothing installs from it (enforced in the main process). | `repositories.setEnabled`, `marketplace()`, `install()` |
| Last check | Each fetch records when it ran and its error, so a failing repository says why instead of silently showing nothing. | `repository_state.last_checked_at/last_error` |
| Compatibility | Decided from metadata alone, before anything is downloaded: extension type, id format, HTTPS manifest, host API, and APK without the Java helper. Incompatible entries carry a reason and cannot be installed. | `lifecycle.ts compatibilityOf` |
| Permissions | Computed from the manifest. Hibiki-format manifests declare nothing, so they get the **legacy grant**, and the dialog says exactly what that means: any *public* host (your computer, LAN and cloud metadata stay blocked), hidden browser pages, and their own storage. A manifest can narrow itself with `"permissions": { "hosts": [...], "browser": false }`. There is no permission for files, processes or private networks, so none can be granted. APK extensions are labelled as native code with full user rights, and NSFW is shown. | `lifecycle.ts describePermissions` |
| Consent | A new install, or an update asking for **different** permissions, needs consent listing exactly the permission ids that were shown. The main process refuses any other set. Updates with unchanged permissions need no new consent. | `consentCheck`, `PermissionConsentDialog`, `extension_state.granted_permissions` |
| Enforcement of declared permissions | `hosts`: the network broker refuses any other host for that extension, redirects included. `browser: false`: the bridge refuses `challenge()` / `browserFetch()`. | `policy.ts hostsFor`, `runtime.ts bridge` |
| Enable / disable an extension | A disabled extension stays installed (files, settings, origin) but is not listed and does not run; calls are refused before any code runs. | `extension_state.enabled`, `runtime.setDisabled` |
| Uninstall | Removes the extension's files, its own storage and its state row. Library, history, progress and media are untouched (tested). Removing a *repository* never uninstalls its extensions. | `extensions.ts`, `repositories.ts` |
| Discovery runs no code | Listing a repository fetches its index only, never an extension's `.js` (tested). | `marketplace()` |
| Identity | Every extension request reaches the broker as `extension:<id>`, set by the host. | M3 |

## Data changes

Migration **`0025_riuplay_extension_trust`** is additive: two new tables, `repository_state` and `extension_state`.
- Existing `source_repositories` rows are untouched. The migration test checks every pre-existing row is byte-identical.
- A repository without a state row reads as enabled and untrusted.
- As with every migration, the pre-migration snapshot (Phase 5) is taken first.

## Compatibility notes

- **Hibiki repositories and manifests keep working** under the legacy grant. Nothing about how their scripts run changed in M1 (the M2 hardening is separate).
- **The automatic carry-over install** (`installMissingSources`, used only by the Android legacy import) now fails the consent check and is logged. That is intended: there is no silent install any more. On desktop, the "missing sources" prompt lists each source's permissions and sends consent when the user presses Install.
