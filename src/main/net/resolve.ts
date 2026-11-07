// RiuPlay M3: turning a host name into the addresses the controlled path may connect to.
//
//  system          the OS resolver (dns.lookup) - direct connections with DoH off.
//  doh-direct      Settings > Network's DNS-over-HTTPS provider, asked directly; when it can't be
//                  reached the system resolver answers instead (the behaviour the setting always
//                  had - a broken resolver must not take every source down).
//  doh-via-proxy   any configured proxy: DNS-over-HTTPS to an IP-literal resolver, sent THROUGH the
//                  proxy, so no DNS query leaves outside it. No fallback: if every endpoint fails,
//                  the request fails ("dns-failed"). Local DNS behind a proxy only by explicit opt-in.
//
// Whatever the source, the answers are only candidates: guardedRequest validates every one of them
// and connects to the address it validated, never to the name again.
import dns from "node:dns/promises";
import net from "node:net";
import { NetError } from "./errors";

export interface Resolver {
  readonly mode: "system" | "doh-direct" | "doh-via-proxy";
  resolve(host: string, signal?: AbortSignal): Promise<string[]>;
}

/** An HTTPS GET used to ask a DoH endpoint; provided by the transport so a proxied query takes the
 * same pinned, proxied connection every other request does. */
export type DohQuery = (url: string, signal?: AbortSignal) => Promise<{ status: number; body: Buffer }>;

/** DoH JSON endpoints by IP literal (TLS certificates verified to cover the IP: Cloudflare 1.1.1.1,
 * Google 8.8.8.8, AdGuard 94.140.14.14). Asking an IP needs no DNS lookup of the resolver itself. */
export const PROXY_DOH_ENDPOINTS = ["https://1.1.1.1/dns-query", "https://8.8.8.8/resolve", "https://94.140.14.14/resolve"] as const;

/** The name-based endpoints Settings > Network has always used for direct DoH. */
export const DIRECT_DOH_ENDPOINTS = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
  adguard: "https://dns.adguard-dns.com/resolve",
} as const;

const DOH_TIMEOUT_MS = 5_000;
const MIN_TTL_S = 30;
const MAX_TTL_S = 300;
const CACHE_MAX = 512;

interface DohJson {
  Status?: number;
  Answer?: Array<{ type: number; data: string; TTL: number }>;
}

export const systemLookup = async (host: string): Promise<string[]> => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export function systemResolver(lookup: (host: string) => Promise<string[]> = systemLookup): Resolver {
  return {
    mode: "system",
    async resolve(host) {
      try {
        return await lookup(host);
      } catch (error) {
        throw new NetError("dns-failed", `could not resolve ${host}: ${(error as NodeJS.ErrnoException).code ?? "lookup failed"}`);
      }
    },
  };
}

/** Parses one DoH JSON answer into IP addresses of the asked type. CNAME chains are followed by
 * the resolver itself; only A (1) / AAAA (28) records whose data really is an IP are taken. */
export function parseDohAnswer(body: Buffer, type: 1 | 28): { addresses: string[]; ttl: number } {
  let json: DohJson;
  try {
    json = JSON.parse(body.toString("utf8")) as DohJson;
  } catch {
    throw new Error("unreadable DoH answer");
  }
  if (json.Status !== undefined && json.Status !== 0 && json.Status !== 3) throw new Error(`DoH status ${json.Status}`);
  const records = (json.Answer ?? []).filter((a) => a.type === type && typeof a.data === "string" && net.isIP(a.data) === (type === 1 ? 4 : 6));
  const ttl = records.length ? Math.min(...records.map((r) => (Number.isFinite(r.TTL) ? r.TTL : MIN_TTL_S))) : MIN_TTL_S;
  return { addresses: records.map((r) => r.data), ttl: Math.max(MIN_TTL_S, Math.min(MAX_TTL_S, ttl)) };
}

/** Asks DoH endpoints in order (A and AAAA together) until one answers. Throws when none does. */
export function dohResolver(options: { mode: "doh-direct" | "doh-via-proxy"; endpoints: readonly string[]; query: DohQuery; fallback?: Resolver; now?: () => number }): Resolver {
  const cache = new Map<string, { addresses: string[]; expiresAt: number }>();
  const now = options.now ?? Date.now;

  async function ask(endpoint: string, host: string, signal?: AbortSignal): Promise<{ addresses: string[]; ttl: number }> {
    const one = async (type: 1 | 28) => {
      const url = `${endpoint}?name=${encodeURIComponent(host)}&type=${type === 1 ? "A" : "AAAA"}`;
      const timeout = AbortSignal.timeout(DOH_TIMEOUT_MS);
      const response = await options.query(url, signal ? AbortSignal.any([signal, timeout]) : timeout);
      if (response.status !== 200) throw new Error(`DoH HTTP ${response.status}`);
      return parseDohAnswer(response.body, type);
    };
    const [a, aaaa] = await Promise.allSettled([one(1), one(28)]);
    if (a.status === "rejected" && aaaa.status === "rejected") throw a.reason;
    const parts = [a, aaaa].flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    return { addresses: parts.flatMap((p) => p.addresses), ttl: Math.min(...parts.map((p) => p.ttl)) };
  }

  return {
    mode: options.mode,
    async resolve(host, signal) {
      const key = host.toLowerCase();
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) return cached.addresses;
      let lastError = "no endpoint";
      for (const endpoint of options.endpoints) {
        if (signal?.aborted) throw new NetError("aborted", "request aborted");
        try {
          const { addresses, ttl } = await ask(endpoint, host, signal);
          if (addresses.length === 0) throw new NetError("dns-failed", `no addresses for ${host}`);
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
          cache.set(key, { addresses, expiresAt: now() + ttl * 1000 });
          return addresses;
        } catch (error) {
          if (error instanceof NetError && error.code === "dns-failed") throw error; // a real NXDOMAIN-like answer
          lastError = error instanceof NetError ? error.code : "endpoint unreachable";
        }
      }
      if (options.fallback) return options.fallback.resolve(host, signal);
      throw new NetError("dns-failed", `could not resolve ${host} through DNS-over-HTTPS (${lastError})`);
    },
  };
}
