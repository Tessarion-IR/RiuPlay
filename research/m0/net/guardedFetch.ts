// M0 research prototype: the single controlled request path every extension (and server
// connection) request would take. Not wired into the app.
//
// Per hop: parse (WHATWG URL normalises decimal/octal/hex IPv4) -> scheme/credential checks ->
// host permission -> resolve ALL addresses once -> refuse if ANY is blocked (unless an exact
// host:port allowance exists) -> connect to the validated IP through one custom connector (direct,
// HTTP/HTTPS proxy via CONNECT, or SOCKS5), so DNS is never consulted again (no rebinding window)
// -> manual redirects, each re-validated -> bounded, manually decompressed body.
// A configured proxy is never bypassed: if it fails, the request fails.
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import zlib from "node:zlib";
import { Agent, request, type Dispatcher } from "undici";
import { SocksClient } from "socks";
import { blockedReason } from "./ip";

export type BrokerErrorCode =
  | "invalid-url"
  | "scheme-not-allowed"
  | "http-not-allowed"
  | "credentials-in-url"
  | "host-not-permitted"
  | "blocked-address"
  | "dns-failed"
  | "too-many-redirects"
  | "downgrade"
  | "body-too-large"
  | "decoded-too-large"
  | "timeout"
  | "proxy-failed"
  | "connect-failed";

export class BrokerError extends Error {
  constructor(
    readonly code: BrokerErrorCode,
    message: string,
  ) {
    super(`${message} (${code})`);
    this.name = "BrokerError";
  }
}

export interface ProxyConfig {
  kind: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** CA for an HTTPS proxy's own certificate (tests). */
  ca?: string | Buffer;
}

export interface NetPolicy {
  /** Hosts the caller may contact ("*.example.com" = subdomains), or any public host. */
  hosts: string[] | "any-public";
  allowHttp: boolean;
  /** Exact host:port pairs allowed to resolve to blocked ranges (a user-confirmed LAN server).
   * Extensions never get one. */
  privateAllowance?: Array<{ host: string; port: number }>;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxDecodedBytes?: number;
}

export interface BrokerDeps {
  resolve?: (hostname: string) => Promise<string[]>;
  proxy?: ProxyConfig | null;
  /** Extra trusted CA for TLS to targets (tests). */
  ca?: string | Buffer;
  /** Observes the address each connection is actually made to (tests). */
  onConnect?: (info: { host: string; address: string; port: number; via: "direct" | ProxyConfig["kind"] }) => void;
}

export interface BrokerRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface BrokerResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
  redirects: number;
}

const defaultResolve = async (hostname: string) => (await dns.lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

function hostMatches(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
    return host === p;
  });
}

const portOf = (url: URL) => Number(url.port || (url.protocol === "https:" ? 443 : 80));

/** The host name as compared and resolved: lower-case, no trailing dot, IPv6 brackets removed. */
function normalisedHost(url: URL): string {
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

interface Validated {
  url: URL;
  host: string;
  port: number;
  address: string;
}

async function validate(raw: string, policy: NetPolicy, deps: BrokerDeps): Promise<Validated> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BrokerError("invalid-url", "Not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BrokerError("scheme-not-allowed", `Scheme ${url.protocol} is not allowed`);
  if (url.protocol === "http:" && !policy.allowHttp) throw new BrokerError("http-not-allowed", "Plain HTTP is not permitted for this caller");
  if (url.username || url.password) throw new BrokerError("credentials-in-url", "Credentials in URLs are not allowed");
  const host = normalisedHost(url);
  if (!host) throw new BrokerError("invalid-url", "Missing host");
  if (host.includes("%")) throw new BrokerError("blocked-address", "IPv6 zone identifiers are not allowed");
  const port = portOf(url);
  if (policy.hosts !== "any-public" && !hostMatches(host, policy.hosts)) throw new BrokerError("host-not-permitted", `Host ${host} is not in this caller's permissions`);

  const allowed = (policy.privateAllowance ?? []).some((a) => a.host.toLowerCase() === host && a.port === port);
  if (!allowed && (host === "localhost" || host.endsWith(".localhost"))) throw new BrokerError("blocked-address", `${host} is a loopback name`);

  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = await (deps.resolve ?? defaultResolve)(host);
    } catch (error) {
      throw new BrokerError("dns-failed", `Could not resolve ${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (addresses.length === 0) throw new BrokerError("dns-failed", `No addresses for ${host}`);
  }
  // Every answer must be acceptable: a mixed public/private answer is refused, so the OS can't
  // pick the private one.
  for (const address of addresses) {
    const why = blockedReason(address);
    if (why && !allowed) throw new BrokerError("blocked-address", `${host} resolves to a blocked address (${why})`);
  }
  return { url, host, port, address: addresses[0] };
}

// ---- One connector for every path: connect to the validated IP, never to the name. ----

function readConnectResponse(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.off("data", onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buffer)?.[1] ?? 0);
      if (status === 200) resolve();
      else reject(new BrokerError("proxy-failed", `Proxy refused the tunnel (HTTP ${status || "?"})`));
    };
    socket.on("data", onData);
    socket.once("error", (e) => reject(new BrokerError("proxy-failed", `Proxy connection failed: ${e.message}`)));
    socket.once("close", () => reject(new BrokerError("proxy-failed", "Proxy closed the connection")));
  });
}

function pinnedConnector(target: Validated, deps: BrokerDeps): Dispatcher.ConnectOptions["connect"] | any {
  const proxy = deps.proxy ?? null;
  const isHttps = target.url.protocol === "https:";
  const wrapTls = (socket: net.Socket | undefined, cb: (err: Error | null, s?: net.Socket) => void) => {
    if (!isHttps) return cb(null, socket);
    const secure = tls.connect({ socket, host: socket ? undefined : target.address, port: socket ? undefined : target.port, servername: net.isIP(target.host) ? undefined : target.host, ca: deps.ca, ALPNProtocols: ["http/1.1"] });
    secure.once("secureConnect", () => cb(null, secure));
    secure.once("error", (e) => cb(new BrokerError("connect-failed", `TLS failed: ${e.message}`)));
  };

  return (_opts: unknown, cb: (err: Error | null, socket?: net.Socket) => void) => {
    deps.onConnect?.({ host: target.host, address: target.address, port: target.port, via: proxy?.kind ?? "direct" });
    if (!proxy) {
      if (isHttps) return wrapTls(undefined, cb);
      const socket = net.connect({ host: target.address, port: target.port });
      socket.once("connect", () => cb(null, socket));
      socket.once("error", (e) => cb(new BrokerError("connect-failed", e.message)));
      return;
    }
    if (proxy.kind === "socks5") {
      SocksClient.createConnection({
        proxy: { host: proxy.host, port: proxy.port, type: 5, userId: proxy.username, password: proxy.password },
        command: "connect",
        destination: { host: target.address, port: target.port },
        timeout: 10_000,
      }).then(
        ({ socket }) => wrapTls(socket, cb),
        (e: Error) => cb(new BrokerError("proxy-failed", `SOCKS5 proxy failed: ${redact(e.message, proxy)}`)),
      );
      return;
    }
    // HTTP or HTTPS proxy: CONNECT to the validated IP, so the proxy never resolves the name.
    const toProxy: net.Socket =
      proxy.kind === "https" ? tls.connect({ host: proxy.host, port: proxy.port, ca: proxy.ca, servername: net.isIP(proxy.host) ? undefined : proxy.host }) : net.connect({ host: proxy.host, port: proxy.port });
    const ready = proxy.kind === "https" ? "secureConnect" : "connect";
    toProxy.once("error", (e) => cb(new BrokerError("proxy-failed", `Proxy unreachable: ${redact(e.message, proxy)}`)));
    toProxy.once(ready, () => {
      const authority = net.isIPv6(target.address) ? `[${target.address}]:${target.port}` : `${target.address}:${target.port}`;
      const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}\r\n` : "";
      toProxy.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
      readConnectResponse(toProxy).then(
        () => wrapTls(toProxy, cb),
        (e: Error) => {
          toProxy.destroy();
          cb(e);
        },
      );
    });
  };
}

/** Never let proxy credentials into an error message. */
function redact(text: string, proxy: ProxyConfig | null | undefined): string {
  let out = text;
  if (proxy?.password) out = out.split(proxy.password).join("***");
  return out;
}

const SENSITIVE_ON_CROSS_ORIGIN = ["authorization", "cookie", "proxy-authorization"];

async function readBody(body: Dispatcher.ResponseData["body"], encoding: string | undefined, policy: NetPolicy): Promise<Buffer> {
  const maxBody = policy.maxBodyBytes ?? 8 * 1024 * 1024;
  const maxDecoded = policy.maxDecodedBytes ?? 32 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += (chunk as Buffer).length;
    if (size > maxBody) {
      body.on("error", () => {}); // the abort below is expected
      body.destroy();
      throw new BrokerError("body-too-large", `Response exceeded ${maxBody} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  const enc = (encoding ?? "").toLowerCase().trim();
  const decoder =
    enc === "gzip" || enc === "x-gzip"
      ? zlib.createGunzip()
      : enc === "deflate"
        ? zlib.createInflate()
        : enc === "br"
          ? zlib.createBrotliDecompress()
          : null;
  if (!decoder) return raw;
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    let decoded = 0;
    decoder.on("data", (chunk: Buffer) => {
      decoded += chunk.length;
      if (decoded > maxDecoded) {
        decoder.destroy();
        reject(new BrokerError("decoded-too-large", `Decompressed response exceeded ${maxDecoded} bytes`));
        return;
      }
      out.push(chunk);
    });
    decoder.on("end", () => resolve(Buffer.concat(out)));
    decoder.on("error", (e) => reject(new BrokerError("connect-failed", `Bad compressed body: ${e.message}`)));
    decoder.end(raw);
  });
}

export async function guardedFetch(rawUrl: string, init: BrokerRequest, policy: NetPolicy, deps: BrokerDeps = {}): Promise<BrokerResponse> {
  const maxRedirects = policy.maxRedirects ?? 5;
  const deadline = AbortSignal.timeout(policy.timeoutMs ?? 25_000);
  let current = rawUrl;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers: Record<string, string> = { ...(init.headers ?? {}) };
  let previous: URL | null = null;

  for (let hop = 0; ; hop++) {
    const target = await validate(current, policy, deps);
    if (previous && previous.protocol === "https:" && target.url.protocol === "http:") throw new BrokerError("downgrade", "Redirect from HTTPS to HTTP refused");
    if (previous && previous.origin !== target.url.origin) {
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SENSITIVE_ON_CROSS_ORIGIN.includes(k.toLowerCase())));
    }
    const agent = new Agent({ connect: pinnedConnector(target, deps), pipelining: 0 });
    let response: Dispatcher.ResponseData;
    try {
      response = await request(target.url, {
        method: method as Dispatcher.HttpMethod,
        headers: { ...headers, host: target.url.host, "accept-encoding": "gzip, deflate, br" },
        body,
        dispatcher: agent,
        signal: deadline,
        maxRedirections: 0,
      } as never);
    } catch (error) {
      await agent.close().catch(() => {});
      if (deadline.aborted) throw new BrokerError("timeout", "Request timed out");
      if (error instanceof BrokerError) throw error;
      const cause = (error as { cause?: unknown }).cause;
      if (cause instanceof BrokerError) throw cause;
      throw new BrokerError(deps.proxy ? "proxy-failed" : "connect-failed", redact(error instanceof Error ? error.message : String(error), deps.proxy));
    }
    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      await response.body.dump({ limit: 64 * 1024 }).catch(() => {}); // discard the redirect body safely
      await agent.close().catch(() => {});
      if (hop >= maxRedirects) throw new BrokerError("too-many-redirects", `More than ${maxRedirects} redirects`);
      previous = target.url;
      current = new URL(String(location), target.url).toString();
      if (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    try {
      const data = await readBody(response.body, response.headers["content-encoding"] as string | undefined, policy);
      const flat = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]));
      return { status: response.statusCode, headers: flat, body: data, url: target.url.toString(), redirects: hop };
    } catch (error) {
      if (deadline.aborted) throw new BrokerError("timeout", "Request timed out");
      throw error;
    } finally {
      await agent.close().catch(() => {});
    }
  }
}
