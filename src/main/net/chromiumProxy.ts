// RiuPlay M3: Chromium's half of proxy parity, independent of Electron so it can be tested.
//
// Every Chromium session (the main window: player streams, posters; the challenge, login and
// browser-resolver windows, each in its own partition) is given the SAME effective proxy as the
// controlled request path (main/net/state.ts chromiumNetworkPlan):
//   direct   -> { mode: "direct" }
//   proxy    -> { proxyRules: "<kind>://host:port" } - never credentials in the rule
//   blocked  -> a black-hole rule: Chromium requests fail instead of going direct
// Proxy authentication: Chromium asks the app ("login" event, authInfo.isProxy) for HTTP/HTTPS
// proxies only. The answer comes from memory, only for the configured proxy's exact host and port,
// at most MAX_ATTEMPTS times per minute (wrong credentials then fail instead of looping), and never
// for a server's own (non-proxy) authentication challenge. Chromium has no SOCKS5 username/password
// support at all; such a proxy is "blocked" for Chromium (see proxy.ts chromiumProxyPlan).
import type { ChromiumProxyPlan } from "./proxy";

export interface SessionLike {
  setProxy(config: { mode: "direct" } | { proxyRules: string }): Promise<void>;
  closeAllConnections?(): Promise<void>;
  /** Chromium caches proxy credentials per session; a changed proxy must not keep using old ones. */
  clearAuthCache?(): Promise<void>;
}

export interface ProxyAuthInfo {
  isProxy: boolean;
  scheme?: string;
  host: string;
  port: number;
}

const MAX_ATTEMPTS = 2;
const WINDOW_MS = 60_000;

export function chromiumProxyConfig(plan: ChromiumProxyPlan & { rules: string | null }): { mode: "direct" } | { proxyRules: string } {
  if (plan.mode === "direct" || !plan.rules) return { mode: "direct" };
  // Chromium's implicit loopback bypass stays: loopback traffic never leaves the machine, and media
  // the user added from localhost (Phase 6) must keep playing with a proxy configured.
  return { proxyRules: plan.rules };
}

export function createChromiumProxyController(options: { plan: () => ChromiumProxyPlan & { rules: string | null }; now?: () => number; onWarn?: (message: string) => void }) {
  const attempts = new Map<string, number[]>();
  const now = options.now ?? Date.now;

  async function apply(target: SessionLike): Promise<void> {
    try {
      await target.setProxy(chromiumProxyConfig(options.plan()));
      // Connections opened under the previous configuration must not keep carrying traffic, and
      // credentials Chromium cached for the previous proxy must not be reused (found by
      // research/m3/verify-chromium-proxy.mjs: a changed password kept working from the cache).
      await target.clearAuthCache?.();
      await target.closeAllConnections?.();
    } catch (error) {
      options.onWarn?.(`could not set the proxy on a session: ${error instanceof Error ? error.name : "error"}`);
    }
  }

  /** Credentials for a proxy challenge, or null (Chromium then cancels the request). */
  function answerLogin(info: ProxyAuthInfo): { username: string; password: string } | null {
    if (!info.isProxy) return null;
    const plan = options.plan();
    if (plan.mode !== "proxy" || !plan.auth) return null;
    const host = info.host.toLowerCase().replace(/^\[|\]$/g, "");
    if (host !== plan.auth.host.toLowerCase() || info.port !== plan.auth.port) return null;
    const key = `${host}:${info.port}`;
    const recent = (attempts.get(key) ?? []).filter((t) => now() - t < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      options.onWarn?.("proxy authentication failed repeatedly; check the proxy user name and password");
      attempts.set(key, recent);
      return null;
    }
    recent.push(now());
    attempts.set(key, recent);
    return { username: plan.auth.username, password: plan.auth.password };
  }

  function resetAttempts(): void {
    attempts.clear();
  }

  return { apply, answerLogin, resetAttempts };
}
