// RiuPlay M3: the one NetClient the main process uses, and which proxy / resolver it applies.
//
// Effective proxy, in order:
//   1. the encrypted store (secureProxyStore.ts): ok -> used; damaged/undecryptable -> "unavailable"
//      (requests fail - a proxy the user configured is never silently dropped);
//      disabled or absent -> next;
//   2. the legacy Settings > Network string the renderer hands over at runtime (main/network.ts),
//      used in memory only, as before - unparseable -> "invalid" (requests fail);
//   3. none: direct.
// Resolver: behind a proxy, DoH through that proxy to IP-literal resolvers (no fallback) unless the
// stored record explicitly opted into local DNS; direct, the DoH provider from Settings > Network
// with its system-DNS fallback, or the system resolver.
import type { DohProvider } from "@shared/types";
import { NetClient, type ProxyState } from "./client";
import { NetError } from "./errors";
import { parseLegacyProxyString, type ProxyConfig, type ProxyDnsMode } from "./proxy";
import { DIRECT_DOH_ENDPOINTS, dohResolver, PROXY_DOH_ENDPOINTS, systemResolver, type Resolver } from "./resolve";
import type { LoadedProxy } from "./secureProxyStore";
import type { LocalServerAllowance } from "./policy";

let legacyProxy = "";
let doh: DohProvider = "off";
let secure: LoadedProxy = { status: "none" };
let allowances: LocalServerAllowance[] = [];
let resolverCache: { key: string; resolver: Resolver } | null = null;

export function effectiveProxy(): { state: ProxyState; dnsMode: ProxyDnsMode; source: "secure" | "legacy" | "none" } {
  if (secure.status === "ok") return { state: { status: "ok", config: secure.config }, dnsMode: secure.dnsMode, source: "secure" };
  if (secure.status === "unavailable") return { state: { status: "unavailable", reason: secure.reason }, dnsMode: "doh-via-proxy", source: "secure" };
  const parsed = parseLegacyProxyString(legacyProxy);
  if (parsed.status === "ok") return { state: { status: "ok", config: parsed.config }, dnsMode: "doh-via-proxy", source: "legacy" };
  if (parsed.status === "invalid") return { state: { status: "invalid", reason: parsed.reason }, dnsMode: "doh-via-proxy", source: "legacy" };
  return { state: { status: "none" }, dnsMode: "doh-via-proxy", source: "none" };
}

// DNS queries themselves go through dedicated clients that never consult a resolver of their own:
// the proxied one only ever asks IP-literal endpoints; the direct one resolves the provider's name
// with the system resolver, as Settings > Network's DoH always did.
const neverResolve: Resolver = {
  mode: "system",
  resolve: async () => {
    throw new NetError("dns-failed", "DNS endpoints are IP literals");
  },
};
let proxiedDnsProxy: ProxyConfig | null = null;
const proxiedDnsClient = new NetClient({ resolver: () => neverResolve, proxy: () => (proxiedDnsProxy ? { status: "ok", config: proxiedDnsProxy } : { status: "invalid", reason: "no proxy for DNS" }), defaultTimeoutMs: 5_000 });
const directDnsClient = new NetClient({ resolver: () => systemResolver(), defaultTimeoutMs: 5_000 });

function currentResolver(): Resolver {
  const { state, dnsMode } = effectiveProxy();
  const proxied = state.status === "ok" && dnsMode === "doh-via-proxy";
  const key = proxied ? `proxy:${JSON.stringify(state.config)}` : `direct:${doh}`;
  if (resolverCache?.key === key) return resolverCache.resolver;
  let resolver: Resolver;
  if (proxied) {
    proxiedDnsProxy = state.config;
    resolver = dohResolver({
      mode: "doh-via-proxy",
      endpoints: PROXY_DOH_ENDPOINTS,
      query: (url, signal) => proxiedDnsClient.request({ url, caller: { kind: "app", purpose: "dns" }, headers: { Accept: "application/dns-json" }, signal }),
    });
  } else if (doh !== "off") {
    resolver = dohResolver({
      mode: "doh-direct",
      endpoints: [DIRECT_DOH_ENDPOINTS[doh]],
      query: (url, signal) => directDnsClient.request({ url, caller: { kind: "app", purpose: "dns" }, headers: { Accept: "application/dns-json" }, signal }),
      fallback: systemResolver(),
    });
  } else resolver = systemResolver();
  resolverCache = { key, resolver };
  return resolver;
}

let ready: Promise<void> = Promise.resolve();

export const netClient = new NetClient({
  ready: () => ready,
  resolver: currentResolver,
  proxy: () => effectiveProxy().state,
  allowances: () => allowances,
});

async function changed(): Promise<void> {
  resolverCache = null;
  await Promise.all([netClient.resetConnections(), proxiedDnsClient.resetConnections(), directDnsClient.resetConnections()]);
}

/** From Settings > Network (renderer, at start and on every change). In memory only. */
export async function setLegacyNetworkSettings(next: { proxy: string; doh: DohProvider }): Promise<void> {
  if (next.proxy === legacyProxy && next.doh === doh) return;
  legacyProxy = next.proxy;
  doh = next.doh;
  await changed();
}

export async function setSecureProxy(next: LoadedProxy): Promise<void> {
  secure = next;
  await changed();
}

const LOAD_TIMEOUT_MS = 10_000;

/** Loads the encrypted proxy at startup. Requests wait for it; a load that fails or hangs makes
 * the proxy "unavailable" when a record exists (requests refused), never "none". */
export function beginSecureProxyLoad(load: () => Promise<LoadedProxy>): Promise<void> {
  ready = (async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const loaded = await Promise.race([
        load(),
        new Promise<LoadedProxy>((resolve) => {
          timer = setTimeout(() => resolve({ status: "unavailable", reason: "loading the stored proxy timed out" }), LOAD_TIMEOUT_MS);
        }),
      ]);
      await setSecureProxy(loaded);
    } catch {
      await setSecureProxy({ status: "unavailable", reason: "the stored proxy could not be loaded" });
    } finally {
      clearTimeout(timer);
    }
  })();
  return ready;
}

/** Connections (M4/M5) register their approved local-server allowances here. Unused in M3. */
export function setLocalServerAllowances(next: LocalServerAllowance[]): void {
  allowances = next.slice();
}

/** For logs/diagnostics - never the password. */
export function describeNetworkPath(): string {
  const { state, dnsMode, source } = effectiveProxy();
  if (state.status === "ok") return `proxy ${state.config.kind} (${source}), DNS ${dnsMode === "doh-via-proxy" ? "DoH through proxy" : "local"}`;
  if (state.status === "none") return `direct, DNS ${doh === "off" ? "system" : `DoH ${doh}`}`;
  return `proxy ${state.status} (${source}) - requests refused`;
}
