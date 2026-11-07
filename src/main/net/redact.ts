// RiuPlay M3: what may appear in logs about a request. URLs lose their credentials, query string
// and fragment (tokens live there) and long paths are shortened; sensitive headers are masked;
// free text has user:pass@ authorities and token=... parameters scrubbed.
const SENSITIVE_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"]);

/** "https://host:port/first/second/…" - never userinfo, query or fragment. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    const shown = segments.slice(0, 3).map((s) => (s.length > 32 ? `${s.slice(0, 12)}…` : s));
    const path = segments.length ? `/${shown.join("/")}${segments.length > 3 ? "/…" : ""}` : "/";
    return `${url.protocol}//${url.host}${path}${url.search ? "?…" : ""}`;
  } catch {
    return "<invalid-url>";
  }
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? "***" : value;
  return out;
}

/** Scrubs credentials from arbitrary text (error messages from libraries may echo them). */
export function redactText(text: string, secrets: Array<string | undefined | null> = []): string {
  let out = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1***@")
    .replace(/([?&](?:token|access_token|auth|key|sig|signature|password|pass|secret)=)[^&\s]+/gi, "$1***");
  for (const secret of secrets) if (secret && secret.length >= 3) out = out.split(secret).join("***");
  return out;
}
