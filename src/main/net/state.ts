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
import { CHROMIUM_BLACKHOLE_RULES, chromiumProxyPlan, parseLegacyProxyString, type ChromiumProxyPlan, type ProxyConfig, type ProxyDnsMode } from "./proxy";
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

const listeners = new Set<() => void | Promise<void>>();

/** Called after every change of the effective proxy or DNS (main/network.ts re-applies Chromium's). */
export function onNetworkPathChange(listener: () => void | Promise<void>): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function changed(): Promise<void> {
  resolverCache = null;
  verification = null; // any earlier "both paths verified" no longer describes this configuration
  await Promise.all([netClient.resetConnections(), proxiedDnsClient.resetConnections(), directDnsClient.resetConnections()]);
  await Promise.all([...listeners].map(async (listener) => listener()));
}

/**
 * What Chromium's sessions must use. The SAME effective proxy as the controlled path: the encrypted
 * record when present, else the legacy string. A proxy that can't be used (invalid, unavailable,
 * or SOCKS5 with credentials, which Chromium can't speak) makes Chromium fail too - through a
 * black-hole rule - instead of going direct.
 */
export function chromiumNetworkPlan(): ChromiumProxyPlan & { rules: string | null } {
  const { state } = effectiveProxy();
  if (state.status === "none") return { mode: "direct", rules: null };
  if (state.status !== "ok") return { mode: "blocked", reason: state.reason, rules: CHROMIUM_BLACKHOLE_RULES };
  const plan = chromiumProxyPlan(state.config);
  return { ...plan, rules: plan.mode === "proxy" ? plan.proxyRules : plan.mode === "blocked" ? CHROMIUM_BLACKHOLE_RULES : null } as ChromiumProxyPlan & { rules: string | null };
}

/** The legacy string the renderer handed over at runtime - for the user-started migration only. */
export function legacyProxyString(): string {
  return legacyProxy;
}

// --- verification of the effective configuration on both paths ---------------------------------

export interface PathVerification {
  /** The configuration it was run against ("secure:<kind>://user@host:port" - never a password). */
  subject: string;
  main: { ok: boolean; code: string | null };
  chromium: { ok: boolean; code: string | null };
  at: number;
}

let verification: PathVerification | null = null;

export function verificationSubject(): string {
  const { state, source } = effectiveProxy();
  if (state.status !== "ok") return `${source}:${state.status}`;
  const c = state.config;
  return `${source}:${c.kind}://${c.username ? `${c.username}@` : ""}${c.host}:${c.port}`;
}

export function recordVerification(result: PathVerification): void {
  // Only kept if it still describes the current configuration.
  verification = result.subject === verificationSubject() ? result : null;
}

/** True only when the ENCRYPTED proxy is in force and passed on both the controlled path and Chromium. */
export function plaintextRemovalAllowed(): boolean {
  const { source, state } = effectiveProxy();
  return source === "secure" && state.status === "ok" && verification !== null && verification.subject === verificationSubject() && verification.main.ok && verification.chromium.ok;
}

export function lastVerification(): PathVerification | null {
  return verification;
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
