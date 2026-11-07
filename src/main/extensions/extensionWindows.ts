// RiuPlay M2: the Chromium windows an extension makes the app open on its behalf - hidden challenge
// and browser-fetch pages, and BROWSER-runtime resolvers - are held to the same rules as the
// extension's own requests:
//   - each source gets its OWN persistent partition ("persist:riuplay-src-<id>"): cookies,
//     storage and cache never cross between sources or with the app's own session;
//   - every URL such a window is told to load or fetch is preflighted by the network broker first
//     (scheme, DNS through the active resolver, private/loopback/link-local/metadata refusal,
//     declared hosts), attributed to the source;
//   - the session refuses non-web schemes (file:, chrome:, devtools: ...) and any request to a
//     private / loopback / link-local IP literal or a localhost name, denies every permission and
//     every download;
//   - windows never open popups, and never navigate or redirect to a blocked target.
// Residual (documented): a page's subresources on a NAME that resolves privately are not
// re-resolved here (Chromium resolves them itself) - the preflight covers the URLs the extension
// supplies, not every URL the third-party page then loads.
import net from "node:net";
import { session, type BrowserWindow, type Session } from "electron";
import { blockedReason } from "../net/addresses";
import { netClient } from "../net/state";
import { parseCaller } from "../net/policy";
import { logger } from "../../core/logger";

const hardened = new WeakSet<Session>();

/** Whether a URL may be requested by an extension's window (no DNS: literal checks only). */
export function windowRequestAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "data:" || url.protocol === "blob:" || raw === "about:blank") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") return false;
  if (url.username || url.password) return false;
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (net.isIP(host) && blockedReason(host) !== null) return false;
  return true;
}

export function partitionForSource(sourceId: string | undefined): string {
  return sourceId ? `persist:riuplay-src-${sourceId.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80)}` : "persist:riuplay-src-unattributed";
}

/** The source's own hardened session. */
export function sessionForSource(sourceId: string | undefined): Session {
  const target = session.fromPartition(partitionForSource(sourceId));
  if (!hardened.has(target)) {
    hardened.add(target);
    target.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    target.setPermissionCheckHandler(() => false);
    target.on("will-download", (event) => event.preventDefault());
    target.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      const ok = windowRequestAllowed(details.url);
      if (!ok) logger.warn("ext-window", `${sourceId ?? "?"}: refused a page request (${details.resourceType}) to a blocked destination`);
      callback({ cancel: !ok });
    });
  }
  return target;
}

/** Popups denied; navigation and redirects only to allowed targets. */
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guard = (event: Electron.Event, url: string) => {
    if (!windowRequestAllowed(url)) event.preventDefault();
  };
  win.webContents.on("will-navigate", guard);
  win.webContents.on("will-redirect", guard);
}

/** Throws unless the broker would let this source request `url` (DNS, addresses, declared hosts). */
export async function assertBrowsable(url: string, sourceId: string | undefined): Promise<void> {
  const verdict = await netClient.preflight(url, parseCaller(sourceId ? `extension:${sourceId}` : undefined));
  if (!verdict.ok) throw new Error(`${sourceId ?? "extension"}: refused to open ${new URL(url).host} in a browser page (${verdict.code})`);
}
