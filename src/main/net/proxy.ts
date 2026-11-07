// RiuPlay M3: proxy configuration as the controlled request path understands it.
//
// Two sources, in this order:
//  1. the encrypted secure-proxy store (secureProxyStore.ts) - new, set through IPC;
//  2. the legacy Settings > Network string the renderer already sends at runtime (unchanged
//     behaviour: it is used in memory only, never persisted or moved by this code).
// A configured proxy is never bypassed: an unparseable legacy string or an undecryptable stored
// password makes requests FAIL ("proxy-invalid" / "proxy-unavailable"), not go direct.
import net from "node:net";

export type ProxyKind = "http" | "https" | "socks5";

export interface ProxyConfig {
  kind: ProxyKind;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Trusted CA for an HTTPS proxy's own certificate (tests, corporate CAs). */
  ca?: string | Buffer;
}

/**
 * How destination names are resolved when a proxy is in use:
 *  - "doh-via-proxy" (default): DNS-over-HTTPS to an IP-literal resolver, sent THROUGH the proxy.
 *    No DNS query leaves outside the proxy, and every answer is still validated and pinned.
 *  - "local": the system resolver (or direct DoH). Explicit opt-in: DNS queries leave outside the
 *    proxy. Offered for proxies that block DoH; documented as a privacy trade-off.
 * Letting the proxy resolve names itself ("socks5h") is deliberately not offered: RiuPlay could not
 * see - and so could not refuse - the address the proxy connects to.
 */
export type ProxyDnsMode = "doh-via-proxy" | "local";

const DEFAULT_PORTS: Record<ProxyKind, number> = { http: 80, https: 443, socks5: 1080 };

export type ParsedProxy = { status: "none" } | { status: "ok"; config: ProxyConfig } | { status: "invalid"; reason: string };

/**
 * Reads the legacy Settings > Network proxy string ("http://host:port", "socks5://user:pass@host:1080",
 * "host:port" = http). Anything else (Chromium rule lists such as "http=a;https=b", PAC, unknown
 * schemes) is "invalid": the controlled path then refuses requests instead of silently going direct,
 * which is what Node did for anything but http(s):// before M3.
 */
export function parseLegacyProxyString(raw: string | null | undefined): ParsedProxy {
  const text = (raw ?? "").trim();
  if (!text || text.toLowerCase() === "direct://") return { status: "none" };
  if (/[;=\s]/.test(text)) return { status: "invalid", reason: "proxy rule lists are not supported for source traffic; use a single proxy URL" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { status: "invalid", reason: "not a valid proxy address" };
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  // "socks://" is ambiguous: Chromium reads it as SOCKS4, other tools as SOCKS5. It is never
  // guessed - the user picks socks5:// (SOCKS4 is not supported by the controlled path).
  if (scheme === "socks") return { status: "invalid", reason: "socks:// is ambiguous (SOCKS4 or SOCKS5?); write socks5:// - SOCKS4 is not supported" };
  if (scheme === "socks4" || scheme === "socks4a") return { status: "invalid", reason: "SOCKS4 is not supported; use socks5://, http:// or https://" };
  if (scheme === "socks5h") return { status: "invalid", reason: "socks5h:// (proxy-side DNS) is not supported: RiuPlay validates every address itself; use socks5://" };
  const kind: ProxyKind | null = scheme === "http" ? "http" : scheme === "https" ? "https" : scheme === "socks5" ? "socks5" : null;
  if (!kind) return { status: "invalid", reason: `unsupported proxy scheme ${scheme}` };
  if (url.pathname && url.pathname !== "/") return { status: "invalid", reason: "a proxy address has no path" };
  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return { status: "invalid", reason: "missing proxy host" };
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[kind];
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { status: "invalid", reason: "invalid proxy port" };
  const config: ProxyConfig = { kind, host, port };
  if (url.username) config.username = decodeURIComponent(url.username);
  if (url.password) config.password = decodeURIComponent(url.password);
  return { status: "ok", config };
}

/** A display form that never includes the password. */
export function describeProxy(config: ProxyConfig): string {
  const host = net.isIPv6(config.host) ? `[${config.host}]` : config.host;
  return `${config.kind}://${config.username ? `${config.username}@` : ""}${host}:${config.port}`;
}

/**
 * What Chromium's session.setProxy() gets for a proxy: the rule WITHOUT credentials (Chromium
 * never takes them from the rule; HTTP/HTTPS proxy credentials are answered from the app's
 * "login" handler instead, main/network.ts). Chromium cannot authenticate to a SOCKS5 proxy at all
 * (it implements no SOCKS username/password auth), so a SOCKS5 proxy with credentials has no
 * Chromium rule: Chromium traffic is then blocked rather than sent direct (see chromiumProxyPlan).
 */
export type ChromiumProxyPlan =
  | { mode: "direct" }
  | { mode: "proxy"; proxyRules: string; auth: { host: string; port: number; username: string; password: string } | null }
  | { mode: "blocked"; reason: string };

/** An address no proxy listens on: Chromium requests then fail instead of going direct. */
export const CHROMIUM_BLACKHOLE_RULES = "http://127.0.0.1:9";

export function chromiumProxyPlan(config: ProxyConfig | null): ChromiumProxyPlan {
  if (!config) return { mode: "direct" };
  const host = net.isIPv6(config.host) ? `[${config.host}]` : config.host;
  if (config.kind === "socks5" && (config.username || config.password)) {
    return { mode: "blocked", reason: "Chromium (player, pictures, sign-in windows) cannot authenticate to a SOCKS5 proxy; use a SOCKS5 proxy without a password, or an HTTP/HTTPS proxy" };
  }
  const auth = config.username ? { host: config.host, port: config.port, username: config.username, password: config.password ?? "" } : null;
  return { mode: "proxy", proxyRules: `${config.kind}://${host}:${config.port}`, auth };
}
