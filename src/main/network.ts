// Settings > Network's desktop-only half: a proxy and DNS-over-HTTPS, for networks where a
// provider blocks the sites the sources live on. Both apply to the two ways this app goes online:
// Chromium (the player, posters, the hidden browser pages some sources need) - configured here -
// and the main process's controlled request path (main/net: every request an extension makes,
// downloads, RiuPlay's own requests), which is handed the same settings in memory.
// RiuPlay M3: the proxy string is still only consumed at runtime as before; it is not persisted,
// moved or deleted by the main process (see main/net/legacyProxyMigration.ts, not invoked).
import { app, session, type Session } from "electron";
import type { DohProvider, NetworkConfig } from "@shared/types";
import { logger } from "../core/logger";
import { describeNetworkPath, setLegacyNetworkSettings } from "./net/state";

const DOH_SERVERS: Record<Exclude<DohProvider, "off">, { template: string }> = {
  cloudflare: { template: "https://cloudflare-dns.com/dns-query" },
  google: { template: "https://dns.google/dns-query" },
  adguard: { template: "https://dns.adguard-dns.com/dns-query" },
};

let applied = { proxy: "", doh: "off" as DohProvider };

// Every session gets the proxy, including ones created after it was set (a source's login window,
// the hidden browser pages): each partition is a session of its own.
const sessions = new Set<Session>();
app.on("session-created", (created) => {
  sessions.add(created);
  void applyProxyTo(created);
});

async function applyProxyTo(target: Session): Promise<void> {
  try {
    await target.setProxy(applied.proxy ? { proxyRules: applied.proxy } : { mode: "direct" });
  } catch (error) {
    logger.warn("network", `could not set the proxy on a session: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Applies the proxy and DoH from Settings > Network; a no-op when neither changed. */
export async function applyNetworkConfig(config: NetworkConfig): Promise<void> {
  const proxy = config.proxy.trim();
  if (proxy === applied.proxy && config.doh === applied.doh) return;
  applied = { proxy, doh: config.doh };

  await Promise.all([session.defaultSession, ...sessions].map(applyProxyTo));
  try {
    app.configureHostResolver(
      config.doh === "off"
        ? { secureDnsMode: "off" }
        : { secureDnsMode: "secure", secureDnsServers: [DOH_SERVERS[config.doh].template] },
    );
  } catch (error) {
    logger.warn("network", `could not configure DNS-over-HTTPS: ${error instanceof Error ? error.message : String(error)}`);
  }
  await setLegacyNetworkSettings({ proxy, doh: config.doh });
  logger.info("network", `proxy ${proxy ? "on" : "off"}, DNS-over-HTTPS ${config.doh}; main-process requests: ${describeNetworkPath()}`);
}

/** Drops Cloudflare's cookies from every session, so the hidden browser pages pass the check anew. */
export async function clearCloudflareCookies(): Promise<void> {
  for (const target of [session.defaultSession, ...sessions]) {
    const cookies = await target.cookies.get({});
    await Promise.all(
      cookies
        .filter((cookie) => cookie.name === "cf_clearance" || cookie.name.startsWith("__cf"))
        .map((cookie) => {
          const host = (cookie.domain ?? "").replace(/^\./, "");
          return target.cookies.remove(`http${cookie.secure ? "s" : ""}://${host}${cookie.path ?? "/"}`, cookie.name).catch(() => undefined);
        }),
    );
  }
}
