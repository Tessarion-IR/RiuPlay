import { ProxyAgent, Dispatcher } from "undici";
import { SocksClient } from "socks";
import type { ProxySettings } from "@/lib/types";
import { decryptSecret } from "@/lib/crypto";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB cap on remote metadata/content responses
const DEFAULT_TIMEOUT_MS = 10_000;

export class NetError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Builds an undici dispatcher from stored proxy settings, if applicable (http/https only). */
export function buildDispatcher(
  proxy: ProxySettings | null | undefined,
  rawPassword?: string,
): Dispatcher | undefined {
  if (!proxy || proxy.mode === "none" || proxy.mode === "socks5") return undefined;
  if (!proxy.host || !proxy.port) return undefined;
  const scheme = proxy.mode === "https" ? "https" : "http";
  const password = rawPassword ?? (proxy.hasPassword && proxy.passwordEnc ? decryptSecret(proxy.passwordEnc) : "");
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}${password ? `:${encodeURIComponent(password)}` : ""}@`
    : "";
  const uri = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
  return new ProxyAgent({ uri });
}

interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
  proxy?: ProxySettings | null;
  proxyRawPassword?: string;
}

/** fetch() wrapper with timeout, response-size cap, and optional HTTP/HTTPS proxy dispatch. */
export async function safeFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NetError("invalid_url", "The provided URL is not valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NetError("invalid_protocol", "Only http:// and https:// URLs are supported.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const dispatcher = buildDispatcher(opts.proxy, opts.proxyRawPassword);

  try {
    const res = await fetch(parsed.toString(), {
      ...opts,
      signal: controller.signal,
      // @ts-expect-error -- undici-specific option accepted by Node's fetch implementation
      dispatcher,
      redirect: "follow",
    });

    const len = res.headers.get("content-length");
    const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
    if (len && Number(len) > maxBytes) {
      throw new NetError("response_too_large", "Remote response exceeded the allowed size limit.");
    }
    return res;
  } catch (err) {
    if (err instanceof NetError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new NetError("timeout", `Request to ${parsed.hostname} timed out.`);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
      throw new NetError("dns_error", `Could not resolve host ${parsed.hostname}.`);
    }
    if (/ECONNREFUSED/.test(message)) {
      throw new NetError("connection_refused", `Connection refused by ${parsed.hostname}.`);
    }
    if (/certificate|CERT_/i.test(message)) {
      throw new NetError("tls_error", `TLS certificate error contacting ${parsed.hostname}.`);
    }
    throw new NetError("network_error", message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function safeFetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await safeFetch(url, opts);
  if (!res.ok) {
    throw new NetError("http_error", `Request failed with status ${res.status}.`);
  }
  const text = await res.text();
  if (text.length > (opts.maxBytes ?? MAX_RESPONSE_BYTES)) {
    throw new NetError("response_too_large", "Remote response exceeded the allowed size limit.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NetError("invalid_json", "Remote server did not return valid JSON.");
  }
}

/** Tests connectivity for the socks5 proxy itself (handshake only; see README for scope notes). */
export async function testSocks5(host: string, port: number, username: string, password: string) {
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host,
        port,
        type: 5,
        userId: username || undefined,
        password: password || undefined,
      },
      command: "connect",
      destination: { host: "1.1.1.1", port: 443 },
      timeout: 8000,
    });
    socket.destroy();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Basic HTML/text sanitizer for untrusted remote metadata before rendering as plain text. */
export function sanitizeText(input: unknown, maxLen = 4000): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, maxLen)
    .trim();
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
