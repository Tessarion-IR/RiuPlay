// RiuPlay M1: what the user is told before installing an extension, and what the app enforces
// afterwards. Platform-independent: it reads only marketplace/manifest data (no extension code
// is ever executed to discover, preview or describe an extension).
//
// Permissions. Most existing (Hibiki-format) manifests declare nothing, so they get the legacy
// grant - any PUBLIC host (private, loopback, link-local and metadata addresses are always refused
// by the network broker) and the hidden browser pages - and the install dialog says exactly that.
// A manifest may narrow itself with
//   "permissions": { "hosts": ["example.com", "*.cdn.example.com"], "browser": false }
// which the broker then enforces for that extension (main/net policy) and the bridge enforces for
// browser pages. Nothing ever grants filesystem, process or private-network access: there is no
// such permission to ask for.
import { HOST_API, requiredHostApi } from "@shared/hostApi";
import type { ExtensionPermission, ExtensionPermissions, MarketplaceExtension } from "@shared/types";

const HOST_PATTERN = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** The manifest's own declaration, validated; anything malformed counts as "not declared". */
export function declaredPermissions(raw: unknown): ExtensionPermissions | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { hosts?: unknown; browser?: unknown };
  const hosts = Array.isArray(r.hosts) ? r.hosts.filter((h): h is string => typeof h === "string" && HOST_PATTERN.test(h)).map((h) => h.toLowerCase()) : null;
  if (Array.isArray(r.hosts) && hosts && hosts.length !== r.hosts.length) return null; // one bad entry: reject the declaration
  return { hosts: hosts && hosts.length > 0 ? [...new Set(hosts)].sort() : "any-public", browser: r.browser === false ? false : true };
}

/** The effective permissions of an extension: its declaration, or the legacy grant. */
export function effectivePermissions(extension: Pick<MarketplaceExtension, "permissions" | "apkPackage">): ExtensionPermissions {
  if (extension.apkPackage) return { hosts: "any-public", browser: false, native: true };
  return declaredPermissions(extension.permissions) ?? { hosts: "any-public", browser: true };
}

/** What the install dialog lists, one line each, in a stable order (consent is compared by id). */
export function describePermissions(extension: Pick<MarketplaceExtension, "permissions" | "apkPackage" | "isNsfw">): ExtensionPermission[] {
  const p = effectivePermissions(extension);
  const list: ExtensionPermission[] = [];
  if (p.native) {
    list.push({ id: "native-code", level: "danger", text: "Runs native Aniyomi (Android) code in a Java process with your full Windows user rights. RiuPlay cannot sandbox it." });
  }
  if (p.hosts === "any-public") {
    list.push({ id: "network:any-public", level: "warning", text: "Connects to any public website. Your computer, your local network and cloud-metadata addresses stay blocked." });
  } else {
    list.push({ id: `network:${p.hosts.join(",")}`, level: "info", text: `Connects only to: ${p.hosts.join(", ")}` });
  }
  if (p.browser) list.push({ id: "browser-pages", level: "info", text: "May open hidden browser pages (Cloudflare checks, sign-in) in its own separate session." });
  list.push({ id: "storage", level: "info", text: "Keeps its own settings and tokens, separate from other extensions." });
  if (extension.isNsfw) list.push({ id: "nsfw", level: "warning", text: "Marked as adult (NSFW) content." });
  return list;
}

export type Compatibility = { compatible: true } | { compatible: false; reason: string };

/** Whether this build can install it - checked from metadata alone, before anything is downloaded. */
export function compatibilityOf(extension: Pick<MarketplaceExtension, "type" | "hostApi" | "apkPackage" | "id" | "manifestUrl">, platform: { apkSources: boolean }): Compatibility {
  if (extension.type !== "source" && extension.type !== "player-resolver") return { compatible: false, reason: `unknown extension type "${String(extension.type)}"` };
  if (!/^[a-z0-9._:-]{1,120}$/i.test(extension.id ?? "")) return { compatible: false, reason: "invalid extension id" };
  if (extension.apkPackage && !platform.apkSources) return { compatible: false, reason: "APK (Aniyomi) extensions need the optional Java helper, which is not available or not enabled" };
  const required = requiredHostApi(extension);
  if (required !== null && required > HOST_API) return { compatible: false, reason: `needs a newer RiuPlay (extension API ${required}, this build has ${HOST_API})` };
  try {
    if (new URL(extension.manifestUrl).protocol !== "https:") return { compatible: false, reason: "its files are not served over HTTPS" };
  } catch {
    return { compatible: false, reason: "invalid manifest address" };
  }
  return { compatible: true };
}

/** The consent the renderer sends with an install: the permission ids it showed and the user accepted. */
export interface InstallConsent {
  acceptedPermissions: string[];
}

/**
 * Whether an install may go ahead. A new install, or an update whose permissions differ from what
 * was granted before, needs consent matching exactly what describePermissions() lists now.
 */
export function consentCheck(extension: MarketplaceExtension, granted: string[] | null, consent: InstallConsent | undefined): { ok: true; permissions: string[] } | { ok: false; reason: string; permissions: string[] } {
  const permissions = describePermissions(extension).map((p) => p.id);
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  if (granted && same(granted, permissions)) return { ok: true, permissions };
  if (consent && same(consent.acceptedPermissions, permissions)) return { ok: true, permissions };
  return { ok: false, reason: granted ? "this version asks for different permissions; review and accept them" : "installing needs your confirmation of its permissions", permissions };
}
