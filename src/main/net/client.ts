// RiuPlay M3: THE controlled request path for HTTP(S) that extensions, downloads and RiuPlay's own
// main-process code originate. Per hop:
//   parse (WHATWG URL normalises decimal/octal/hex IPv4) -> scheme / credential checks -> caller's
//   host permission -> resolve ALL addresses (system, DoH, or DoH through the proxy) -> refuse when
//   ANY of them is in a blocked range (unless this exact scheme/host/port carries a user-approved
//   local-server allowance for this connection caller) -> connect to the validated address via the
//   pinned connector (direct, HTTP/HTTPS proxy or SOCKS5) -> manual redirects, each validated anew,
//   HTTPS->HTTP refused, credentials stripped across origins -> bounded, manually decompressed body.
// Budgets (concurrency, queue, rate, bytes) are taken per caller before the first hop.
import { pipeline, Readable, Transform } from "node:stream";
import net from "node:net";
import zlib from "node:zlib";
import { Agent, request as undiciRequest, type Dispatcher } from "undici";
import { blockedReason } from "./addresses";
import { Budgets } from "./budget";
import { pinnedConnector, type PinnedTarget } from "./connector";
import { NetError } from "./errors";
import { allowanceFor, assertPermittedHost, policyFor, type Caller, type LocalServerAllowance, type NetPolicy } from "./policy";
import { describeProxy, type ProxyConfig } from "./proxy";
import { systemResolver, type Resolver } from "./resolve";

export type ProxyState =
  | { status: "none" }
  | { status: "ok"; config: ProxyConfig }
  /** A proxy is configured but can't be used (unparseable, or its stored password can't be
   * decrypted): every request fails, nothing goes direct. */
  | { status: "invalid" | "unavailable"; reason: string };

export interface ControlledRequest {
  url: string;
  caller: Caller;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** "follow" (default) walks redirects, validating each; "manual" answers with the 3xx itself. */
  redirect?: "follow" | "manual";
  /** Total time for a buffered request; time to response headers for a streamed one. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ResponseHead {
  status: number;
  /** The URL of the hop that answered. */
  url: string;
  headers: Record<string, string[]>;
  redirects: number;
}

export interface BufferedResponse extends ResponseHead {
  body: Buffer;
}

export interface StreamedResponse extends ResponseHead {
  /** Decoded body. Destroying it releases the connection and the caller's slot. */
  body: Readable;
}

export interface NetClientOptions {
  resolver?: () => Resolver;
  /** Resolver for names that carry a local-server allowance (the user's LAN server): system DNS. */
  localResolver?: Resolver;
  proxy?: () => ProxyState;
  /** Awaited before a request picks its proxy: lets the encrypted proxy finish loading at startup
   * so no early request goes out on the wrong path. */
  ready?: () => Promise<void>;
  budgets?: Budgets;
  allowances?: () => LocalServerAllowance[];
  /** RiuPlay M1: the hosts an extension caller declared (manifest permissions), or "any-public". */
  hostsFor?: (caller: Caller) => string[] | "any-public";
  defaultTimeoutMs?: number;
  connectTimeoutMs?: number;
  /** Idle timeout between body chunks of a streamed response. */
  streamIdleTimeoutMs?: number;
  /** Extra trusted CA for TLS to targets (tests only). */
  ca?: string | Buffer;
  /** Address classifier (default: addresses.ts blockedReason). Tests only - loopback test servers
   * stand in for public sites. The app never sets it, and nothing outside the main process can. */
  classify?: (address: string) => string | null;
  onConnect?: (info: { host: string; address: string; port: number; via: "direct" | ProxyConfig["kind"] }) => void;
}

const SENSITIVE_ON_CROSS_ORIGIN = new Set(["authorization", "cookie", "proxy-authorization"]);
/** Headers the caller does not get to set: the transport owns framing and the connection. */
const TRANSPORT_HEADERS = new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "proxy-authorization", "proxy-connection", "te", "trailer", "accept-encoding"]);
const MAX_POOLS = 64;

interface Validated {
  url: URL;
  target: PinnedTarget;
  /** Whether a local-server allowance let a blocked address through (connects directly). */
  local: boolean;
}

const portOf = (url: URL) => Number(url.port || (url.protocol === "https:" ? 443 : 80));

/** Lower-case, no trailing dot, IPv6 brackets removed. */
function normalisedHost(url: URL): string {
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function flattenHeaders(raw: Dispatcher.ResponseData["headers"]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return out;
}

function decoderFor(encoding: string | undefined): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  const enc = (encoding ?? "").toLowerCase().trim();
  if (enc === "gzip" || enc === "x-gzip") return zlib.createGunzip();
  if (enc === "deflate") return zlib.createInflate();
  if (enc === "br") return zlib.createBrotliDecompress();
  return null;
}

export class NetClient {
  private readonly pools = new Map<string, Agent>();
  readonly budgets: Budgets;

  constructor(private readonly options: NetClientOptions = {}) {
    this.budgets = options.budgets ?? new Budgets();
  }

  private proxyState(): ProxyState {
    return this.options.proxy?.() ?? { status: "none" };
  }

  /** Closes every pooled connection - after a proxy or DNS change, so nothing keeps using the old path. */
  async resetConnections(): Promise<void> {
    const agents = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(agents.map((a) => a.close().catch(() => {})));
  }

  private async validate(raw: string, policy: NetPolicy, signal: AbortSignal): Promise<Validated> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new NetError("invalid-url", "not a valid URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new NetError("scheme-not-allowed", `scheme ${url.protocol} is not allowed`);
    if (url.protocol === "http:" && !policy.allowHttp) throw new NetError("http-not-allowed", "plain HTTP is not permitted for this caller");
    if (url.username || url.password) throw new NetError("credentials-in-url", "credentials in URLs are not allowed");
    const host = normalisedHost(url);
    if (!host) throw new NetError("invalid-url", "missing host");
    if (host.includes("%")) throw new NetError("blocked-address", "IPv6 zone identifiers are not allowed");
    const port = portOf(url);
    assertPermittedHost(policy, host);

    const allowance = allowanceFor(policy, url.protocol, host, port);
    if (!allowance && (host === "localhost" || host.endsWith(".localhost"))) throw new NetError("blocked-address", `${host} is a loopback name`);

    let addresses: string[];
    if (net.isIP(host)) addresses = [host];
    else {
      // The user's own LAN server is resolved by the system (DoH can't know it); everything else
      // by the active resolver - which, behind a proxy, asks DoH through that proxy.
      const resolver = allowance ? (this.options.localResolver ?? systemResolver()) : (this.options.resolver?.() ?? systemResolver());
      addresses = await resolver.resolve(host, signal);
      if (addresses.length === 0) throw new NetError("dns-failed", `no addresses for ${host}`);
    }
    let local = false;
    // Every answer must be acceptable: a mixed public/private answer is refused outright, so
    // neither the OS nor a racing connection attempt can end up on the private one.
    for (const address of addresses) {
      if (!net.isIP(address)) throw new NetError("dns-failed", `resolver returned a non-address for ${host}`);
      const why = (this.options.classify ?? blockedReason)(address);
      if (why) {
        if (!allowance) throw new NetError("blocked-address", `${host} resolves to a blocked address (${why})`);
        local = true;
      }
    }
    return { url, target: { protocol: url.protocol as PinnedTarget["protocol"], host, port, address: addresses[0] }, local };
  }

  private agentFor(validated: Validated, proxy: ProxyConfig | null): Agent {
    // A local-server allowance means the user's own machine/LAN: reached directly, never handed to
    // an outside proxy (which couldn't reach it, and shouldn't learn about it).
    const via = validated.local ? null : proxy;
    const t = validated.target;
    const key = `${via ? describeProxy(via) : "direct"}|${t.protocol}//${t.host}:${t.port}@${t.address}`;
    let agent = this.pools.get(key);
    if (agent) {
      this.pools.delete(key); // re-insert as most recently used
      this.pools.set(key, agent);
      return agent;
    }
    agent = new Agent({
      connect: pinnedConnector(t, { proxy: via, connectTimeoutMs: this.options.connectTimeoutMs ?? 15_000, ca: this.options.ca, onConnect: this.options.onConnect }) as never,
      keepAliveTimeout: 4_000,
      pipelining: 1,
      connections: 8,
    });
    this.pools.set(key, agent);
    while (this.pools.size > MAX_POOLS) {
      const [oldestKey, oldest] = this.pools.entries().next().value as [string, Agent];
      this.pools.delete(oldestKey);
      void oldest.close().catch(() => {});
    }
    return agent;
  }

  /**
   * RiuPlay K4: a raw TCP connection for the confined APK host (platform/electron/apkBroker.ts), whose own
   * TLS runs inside it end to end. The same checks as every request here: the caller's host policy, the
   * active resolver (DoH, through the proxy when one is set), every resolved address must be public, the
   * socket goes to the validated address, and a configured proxy is never bypassed. Web ports only.
   */
  async openTunnel(caller: Caller, host: string, port: number, signal: AbortSignal): Promise<net.Socket> {
    if (port !== 443 && port !== 80) throw new NetError("blocked-address", `port ${port} is not a web port`);
    if (this.options.ready) await this.options.ready();
    const state = this.proxyState();
    if (state.status === "invalid") throw new NetError("proxy-invalid", `the configured proxy can't be used: ${state.reason}`);
    if (state.status === "unavailable") throw new NetError("proxy-unavailable", `the configured proxy is unavailable: ${state.reason}`);
    const proxy = state.status === "ok" ? state.config : null;
    const policy = policyFor(caller, { timeoutMs: this.options.defaultTimeoutMs ?? 25_000, hostsFor: this.options.hostsFor });
    const literal = net.isIPv6(host) ? `[${host}]` : host;
    const validated = await this.validate(`${port === 443 ? "https" : "http"}://${literal}:${port}/`, { ...policy, allowances: [] }, signal);
    // "http:": the connector hands back the plain socket (or proxy tunnel) without TLS of its own.
    const connect = pinnedConnector({ ...validated.target, protocol: "http:" }, { proxy, connectTimeoutMs: this.options.connectTimeoutMs ?? 15_000, onConnect: this.options.onConnect });
    return new Promise((resolve, reject) => connect({}, (error, socket) => (error || !socket ? reject(error ?? new NetError("connect-failed", "no socket")) : resolve(socket))));
  }

  /** Walks the request to its final response (headers only); the body is still unread. */
  private async open(req: ControlledRequest, mode: "buffer" | "stream", deadline: AbortSignal, signal: AbortSignal): Promise<{ head: ResponseHead; data: Dispatcher.ResponseData }> {
    if (this.options.ready) await this.options.ready();
    const state = this.proxyState();
    if (state.status === "invalid") throw new NetError("proxy-invalid", `the configured proxy can't be used: ${state.reason}`);
    if (state.status === "unavailable") throw new NetError("proxy-unavailable", `the configured proxy is unavailable: ${state.reason}`);
    const proxy = state.status === "ok" ? state.config : null;
    const policy = policyFor(req.caller, { timeoutMs: req.timeoutMs ?? this.options.defaultTimeoutMs ?? 25_000, allowances: this.options.allowances?.(), hostsFor: this.options.hostsFor });

    let current = req.url;
    let method = (req.method ?? "GET").toUpperCase();
    let body = req.body;
    let headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers ?? {})) {
      if (!TRANSPORT_HEADERS.has(name.toLowerCase()) && typeof value === "string") headers[name] = value;
    }
    let previous: URL | null = null;

    for (let hop = 0; ; hop++) {
      const validated = await this.validate(current, policy, signal);
      const url = validated.url;
      if (previous && previous.protocol === "https:" && url.protocol === "http:") throw new NetError("downgrade", "redirect from HTTPS to HTTP refused");
      if (previous && previous.origin !== url.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SENSITIVE_ON_CROSS_ORIGIN.has(k.toLowerCase())));
      }
      let data: Dispatcher.ResponseData;
      try {
        data = await undiciRequest(url, {
          method: method as Dispatcher.HttpMethod,
          headers: { ...headers, "accept-encoding": "gzip, deflate, br" },
          body: body as string | Buffer | undefined,
          dispatcher: this.agentFor(validated, proxy),
          signal: mode === "buffer" ? deadline : signal,
          headersTimeout: policy.timeoutMs,
          bodyTimeout: mode === "stream" ? (this.options.streamIdleTimeoutMs ?? 60_000) : 0,
          maxRedirections: 0,
        } as never);
      } catch (error) {
        throw this.translate(error, deadline, signal, proxy);
      }
      const status = data.statusCode;
      const location = data.headers.location;
      const isRedirect = status >= 300 && status < 400 && status !== 304 && location !== undefined;
      if (isRedirect && (req.redirect ?? "follow") === "follow") {
        await data.body.dump({ limit: 64 * 1024 }).catch(() => {});
        if (hop >= policy.maxRedirects) throw new NetError("too-many-redirects", `more than ${policy.maxRedirects} redirects`);
        previous = url;
        try {
          current = new URL(String(Array.isArray(location) ? location[0] : location), url).toString();
        } catch {
          throw new NetError("invalid-url", "redirect to an invalid URL");
        }
        if (status === 303 ? method !== "HEAD" : (status === 301 || status === 302) && method === "POST") {
          method = "GET";
          body = undefined;
          headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-/i.test(k)));
        }
        continue;
      }
      return { head: { status, url: url.toString(), headers: flattenHeaders(data.headers), redirects: hop }, data };
    }
  }

  private translate(error: unknown, deadline: AbortSignal, signal: AbortSignal, proxy: ProxyConfig | null): NetError {
    if (error instanceof NetError) return error;
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof NetError) return cause;
    if (signal.aborted) return new NetError("aborted", "request aborted");
    if (deadline.aborted || (error as { code?: string }).code === "UND_ERR_HEADERS_TIMEOUT") return new NetError("timeout", "request timed out");
    if ((error as { code?: string }).code === "UND_ERR_BODY_TIMEOUT") return new NetError("timeout", "response stalled");
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.name : "error");
    // Never the library's message verbatim: it can echo URLs. A code is enough to act on.
    return new NetError(proxy ? "proxy-failed" : "connect-failed", `request failed (${code})`);
  }

  private signals(req: ControlledRequest): { signal: AbortSignal; deadline: AbortSignal } {
    const timeout = AbortSignal.timeout(req.timeoutMs ?? this.options.defaultTimeoutMs ?? 25_000);
    const signal = req.signal ?? new AbortController().signal;
    return { signal, deadline: AbortSignal.any([signal, timeout]) };
  }

  /**
   * Validates a destination without requesting it - the same parse, scheme, host, DNS (through the
   * active resolver, so behind a proxy through the proxy) and address rules as a real request. For
   * URLs Chromium will load itself (extension stream URLs before they reach the player). A
   * configured but unusable proxy refuses too.
   */
  async preflight(url: string, caller: Caller, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; code: string }> {
    try {
      if (this.options.ready) await this.options.ready();
      const state = this.proxyState();
      if (state.status === "invalid") return { ok: false, code: "proxy-invalid" };
      if (state.status === "unavailable") return { ok: false, code: "proxy-unavailable" };
      const policy = policyFor(caller, { timeoutMs: this.options.defaultTimeoutMs ?? 25_000, allowances: this.options.allowances?.(), hostsFor: this.options.hostsFor });
      await this.validate(url, policy, signal ?? AbortSignal.timeout(policy.timeoutMs));
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error instanceof NetError ? error.code : "error" };
    }
  }

  /** A request whose whole (decoded) body is read into memory, within the caller's caps. */
  async request(req: ControlledRequest): Promise<BufferedResponse> {
    const { signal, deadline } = this.signals(req);
    const release = await this.budgets.acquire(req.caller, deadline);
    try {
      const { head, data } = await this.open(req, "buffer", deadline, signal);
      const policy = policyFor(req.caller, { timeoutMs: 0 });
      const raw = await this.readRaw(data.body, req.caller, policy.maxBodyBytes, deadline, signal);
      const decoder = decoderFor(head.headers["content-encoding"]?.[0]);
      const body = decoder ? await this.decodeAll(raw, decoder, policy.maxDecodedBytes) : raw;
      return { ...head, body };
    } finally {
      release();
    }
  }

  private async readRaw(body: Dispatcher.ResponseData["body"], caller: Caller, maxBytes: number | null, deadline: AbortSignal, signal: AbortSignal): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (maxBytes !== null && size > maxBytes) throw new NetError("body-too-large", `response exceeded ${maxBytes} bytes`);
        this.budgets.charge(caller, buffer.length);
        chunks.push(buffer);
      }
    } catch (error) {
      body.on("error", () => {}); // the destroy below is expected
      body.destroy();
      if (error instanceof NetError) throw error;
      throw this.translate(error, deadline, signal, null);
    }
    return Buffer.concat(chunks);
  }

  private decodeAll(raw: Buffer, decoder: NonNullable<ReturnType<typeof decoderFor>>, maxDecoded: number | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const out: Buffer[] = [];
      let decoded = 0;
      decoder.on("data", (chunk: Buffer) => {
        decoded += chunk.length;
        if (maxDecoded !== null && decoded > maxDecoded) {
          decoder.destroy();
          reject(new NetError("decoded-too-large", `decompressed response exceeded ${maxDecoded} bytes`));
          return;
        }
        out.push(chunk);
      });
      decoder.on("end", () => resolve(Buffer.concat(out)));
      decoder.on("error", () => reject(new NetError("connect-failed", "the response's compressed body is corrupt")));
      decoder.end(raw);
    });
  }

  /**
   * A request whose body is handed over as a stream (downloads, player URL probes): the timeout
   * covers reaching the response headers, then an idle timeout guards the body. The caller's slot
   * is held until the stream ends or is destroyed.
   */
  async stream(req: ControlledRequest): Promise<StreamedResponse> {
    const { signal, deadline } = this.signals(req);
    const release = await this.budgets.acquire(req.caller, deadline);
    let head: ResponseHead;
    let data: Dispatcher.ResponseData;
    try {
      ({ head, data } = await this.open(req, "stream", deadline, signal));
    } catch (error) {
      release();
      throw error;
    }
    const caller = req.caller;
    const policy = policyFor(caller, { timeoutMs: 0 });
    const budgets = this.budgets;
    let raw = 0;
    const source = data.body;
    const counted = new Readable({
      read() {
        source.resume();
      },
      destroy(error, callback) {
        source.on("error", () => {});
        source.destroy();
        release();
        callback(error);
      },
    });
    source.on("data", (chunk: Buffer) => {
      raw += chunk.length;
      try {
        if (policy.maxBodyBytes !== null && raw > policy.maxBodyBytes) throw new NetError("body-too-large", `response exceeded ${policy.maxBodyBytes} bytes`);
        budgets.charge(caller, chunk.length);
      } catch (error) {
        counted.destroy(error as Error);
        return;
      }
      if (!counted.push(chunk)) source.pause();
    });
    source.on("end", () => {
      counted.push(null);
      release();
    });
    source.on("error", (error) => counted.destroy(this.translate(error, deadline, signal, null)));

    const decoder = decoderFor(head.headers["content-encoding"]?.[0]);
    if (!decoder) return { ...head, body: counted };
    let decoded = 0;
    const maxDecoded = policy.maxDecodedBytes;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        decoded += chunk.length;
        if (maxDecoded !== null && decoded > maxDecoded) callback(new NetError("decoded-too-large", "decompressed response too large"));
        else callback(null, chunk);
      },
    });
    // pipeline() destroys every stage when any one fails or the consumer destroys the last.
    pipeline(counted, decoder, limiter, () => {});
    return { ...head, body: limiter };
  }
}

