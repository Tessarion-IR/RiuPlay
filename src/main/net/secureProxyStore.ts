// RiuPlay M3: proxy settings stored with the password encrypted at rest.
//
// The record lives in app_settings under "network.proxy" as JSON. The password is never stored in
// plaintext: it is encrypted with Electron 45's asynchronous safeStorage API (DPAPI on Windows) via
// the injectable ProxyCipher, so tests run without Electron and no new synchronous safeStorage call
// exists. Reading never throws on damage: a record that can't be parsed, or a password that can't be
// decrypted (profile copied to another Windows account, DPAPI key lost), yields "unavailable" -
// and the controlled path then FAILS requests instead of going direct.
import type { ProxyConfig, ProxyDnsMode, ProxyKind } from "./proxy";

export const SECURE_PROXY_KEY = "network.proxy";
const VERSION = 1;

export interface ProxyCipher {
  isAvailable(): Promise<boolean>;
  encrypt(plaintext: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<string>;
}

/** Key/value persistence (app_settings in the app, a Map in tests). */
export interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** What is persisted. No plaintext secret appears in it. */
export interface StoredProxyRecord {
  version: 1;
  enabled: boolean;
  kind: ProxyKind;
  host: string;
  port: number;
  username: string | null;
  /** base64 safeStorage ciphertext, or null when the proxy has no password. */
  passwordCiphertext: string | null;
  dnsMode: ProxyDnsMode;
  updatedAt: number;
}

export interface ProxyInput {
  kind: ProxyKind;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  dnsMode?: ProxyDnsMode;
  enabled?: boolean;
}

/** Safe to hand to the renderer: never the password, only whether one is stored. */
export interface ProxySummary {
  configured: boolean;
  enabled: boolean;
  kind: ProxyKind | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hasPassword: boolean;
  dnsMode: ProxyDnsMode;
}

export type LoadedProxy =
  | { status: "none" }
  | { status: "disabled" }
  | { status: "ok"; config: ProxyConfig; dnsMode: ProxyDnsMode }
  | { status: "unavailable"; reason: string };

const KINDS: ReadonlySet<string> = new Set(["http", "https", "socks5"]);
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$|^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-f:]+$/i;

export function validateProxyInput(input: ProxyInput): string | null {
  if (!KINDS.has(input.kind)) return "unsupported proxy type";
  const host = String(input.host ?? "").trim();
  if (!host || host.length > 253 || !HOST_RE.test(host)) return "invalid proxy host";
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) return "invalid proxy port";
  if (input.username != null && (typeof input.username !== "string" || input.username.length > 255 || /[\r\n]/.test(input.username))) return "invalid proxy user name";
  if (input.password != null && (typeof input.password !== "string" || input.password.length > 1024 || /[\r\n]/.test(input.password))) return "invalid proxy password";
  if (input.dnsMode != null && input.dnsMode !== "doh-via-proxy" && input.dnsMode !== "local") return "invalid DNS mode";
  return null;
}

function parseRecord(raw: string): StoredProxyRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<StoredProxyRecord>;
    if (r.version !== VERSION || typeof r.enabled !== "boolean" || !KINDS.has(String(r.kind)) || typeof r.host !== "string" || typeof r.port !== "number") return null;
    if (r.passwordCiphertext !== null && typeof r.passwordCiphertext !== "string") return null;
    if (r.username !== null && typeof r.username !== "string") return null;
    return { ...r, dnsMode: r.dnsMode === "local" ? "local" : "doh-via-proxy" } as StoredProxyRecord;
  } catch {
    return null;
  }
}

export class SecureProxyStore {
  constructor(
    private readonly settings: SettingsStore,
    private readonly cipher: ProxyCipher,
    private readonly now: () => number = Date.now,
  ) {}

  /** Encrypts and stores. Refuses (throws) when OS encryption is unavailable - it never falls back
   * to storing the password in plaintext. */
  async save(input: ProxyInput): Promise<ProxySummary> {
    const problem = validateProxyInput(input);
    if (problem) throw new Error(problem);
    let passwordCiphertext: string | null = null;
    if (input.password) {
      if (!(await this.cipher.isAvailable())) throw new Error("OS encryption is unavailable; the proxy password was not stored");
      passwordCiphertext = (await this.cipher.encrypt(input.password)).toString("base64");
      // Round-trip before anything is written: a password that can't be read back must not replace
      // a working record.
      if ((await this.cipher.decrypt(Buffer.from(passwordCiphertext, "base64"))) !== input.password) throw new Error("encryption round-trip failed; nothing was stored");
    }
    const record: StoredProxyRecord = {
      version: VERSION,
      enabled: input.enabled ?? true,
      kind: input.kind,
      host: input.host.trim(),
      port: input.port,
      username: input.username ? input.username : null,
      passwordCiphertext,
      dnsMode: input.dnsMode ?? "doh-via-proxy",
      updatedAt: this.now(),
    };
    await this.settings.set(SECURE_PROXY_KEY, JSON.stringify(record));
    return this.summarise(record);
  }

  async clear(): Promise<void> {
    await this.settings.delete(SECURE_PROXY_KEY);
  }

  async raw(): Promise<StoredProxyRecord | null | "corrupt"> {
    const raw = await this.settings.get(SECURE_PROXY_KEY);
    if (raw === null) return null;
    return parseRecord(raw) ?? "corrupt";
  }

  async summary(): Promise<ProxySummary> {
    const record = await this.raw();
    if (record === null || record === "corrupt") return { configured: record === "corrupt", enabled: record === "corrupt", kind: null, host: null, port: null, username: null, hasPassword: false, dnsMode: "doh-via-proxy" };
    return this.summarise(record);
  }

  private summarise(r: StoredProxyRecord): ProxySummary {
    return { configured: true, enabled: r.enabled, kind: r.kind, host: r.host, port: r.port, username: r.username, hasPassword: r.passwordCiphertext !== null, dnsMode: r.dnsMode };
  }

  /** The usable proxy, decrypted in memory only. */
  async load(): Promise<LoadedProxy> {
    const record = await this.raw();
    if (record === null) return { status: "none" };
    if (record === "corrupt") return { status: "unavailable", reason: "the stored proxy settings are damaged" };
    if (!record.enabled) return { status: "disabled" };
    const config: ProxyConfig = { kind: record.kind, host: record.host, port: record.port };
    if (record.username) config.username = record.username;
    if (record.passwordCiphertext) {
      try {
        if (!(await this.cipher.isAvailable())) return { status: "unavailable", reason: "OS encryption is unavailable" };
        config.password = await this.cipher.decrypt(Buffer.from(record.passwordCiphertext, "base64"));
      } catch {
        return { status: "unavailable", reason: "the stored proxy password could not be decrypted" };
      }
    }
    return { status: "ok", config, dnsMode: record.dnsMode };
  }
}
