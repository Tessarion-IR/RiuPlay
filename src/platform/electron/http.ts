import type { HttpPort, HttpRequest, HttpResponse } from "../types";
import type { NetClient } from "../../main/net/client";
import { parseCaller, type Caller } from "../../main/net/policy";
import { netClient } from "../../main/net/state";

/**
 * RiuPlay M3: every platform.http request (extension fetch(), playlists, repository indexes,
 * updates, AniList, skip times) goes through the controlled request path (main/net/client.ts):
 * public addresses only, DNS pinned, every redirect re-validated, the configured proxy - HTTP,
 * HTTPS or SOCKS5 - applied or the request refused, bounded bodies and per-caller budgets.
 * Behaviour extensions rely on is kept: no CORS, no cookie jar, any header, decompressed bodies.
 */
export function createElectronHttp(client: NetClient, options: { caller?: (request: HttpRequest) => Caller } = {}): HttpPort {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      const response = await client.request({
        url: request.url,
        caller: options.caller?.(request) ?? parseCaller(request.caller),
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect ?? "follow",
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });
      return { status: response.status, url: response.url, headers: response.headers, body: response.body.toString("utf8") };
    },
  };
}

export const electronHttp: HttpPort = createElectronHttp(netClient);
