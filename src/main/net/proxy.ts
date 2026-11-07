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
  const kind: ProxyKind | null = scheme === "http" ? "http" : scheme === "https" ? "https" : scheme === "socks5" || scheme === "socks" ? "socks5" : null;
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
