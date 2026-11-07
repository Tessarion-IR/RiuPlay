// RiuPlay M3: what a NEW backup leaves out. A backup carries the renderer's whole localStorage
// (zustand's persisted stores), and Settings > Network keeps the legacy proxy there as a plaintext
// string - possibly "scheme://user:password@host:port". New backups keep the proxy (scheme, user,
// host, port) but never its password; everything else in localStorage is kept as it is, so no
// unrelated setting is silently dropped. The backup lists what was redacted (key and field, never
// the value), and a restore reports it so the user can re-enter the password.
// Existing backup files are never modified: restoring an old backup restores what it contains.
// The encrypted proxy record (app_settings "network.proxy") stays in the copied database: it only
// decrypts for the same Windows user and RiuPlay profile; restored anywhere else it loads as
// "unavailable" and every proxied request fails closed until the user clears or re-enters it.
export const NETWORK_PREFS_KEY = "hibiki-network-prefs";

export interface Redaction {
  key: string;
  field: string;
  what: "proxy-password";
}

/** Drops the password from "scheme://user:password@host:port"; anything else is returned unchanged. */
export function stripProxyPassword(proxy: string): { value: string; redacted: boolean } {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]*)@(.*)$/i.exec(proxy.trim());
  if (!match) return { value: proxy, redacted: false };
  const [, scheme, userinfo, rest] = match;
  const colon = userinfo.indexOf(":");
  if (colon < 0) return { value: proxy, redacted: false };
  const user = userinfo.slice(0, colon);
  return { value: `${scheme}${user ? `${user}@` : ""}${rest}`, redacted: true };
}

export function redactLocalStorageForBackup(entries: Record<string, string>): { entries: Record<string, string>; redactions: Redaction[] } {
  const out: Record<string, string> = { ...entries };
  const redactions: Redaction[] = [];
  const raw = entries[NETWORK_PREFS_KEY];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { state?: { proxy?: unknown } };
      if (parsed && typeof parsed.state?.proxy === "string") {
        const { value, redacted } = stripProxyPassword(parsed.state.proxy);
        if (redacted) {
          out[NETWORK_PREFS_KEY] = JSON.stringify({ ...parsed, state: { ...parsed.state, proxy: value } });
          redactions.push({ key: NETWORK_PREFS_KEY, field: "state.proxy", what: "proxy-password" });
        }
      }
    } catch {
      // Not JSON (damaged): scrub any user:password@ authority rather than copying it as it is.
      const scrubbed = raw.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s:"]*):[^/@\s"]*@/gi, "$1$2@");
      if (scrubbed !== raw) {
        out[NETWORK_PREFS_KEY] = scrubbed;
        redactions.push({ key: NETWORK_PREFS_KEY, field: "(unparsed)", what: "proxy-password" });
      }
    }
  }
  return { entries: out, redactions };
}
