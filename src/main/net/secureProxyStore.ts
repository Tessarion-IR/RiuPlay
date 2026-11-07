// RiuPlay M3: proxy settings stored with the password encrypted at rest.
//
// The record lives in app_settings under "network.proxy" as JSON. The password is never stored in
// plaintext: it is encrypted with Electron 45's asynchronous safeStorage API (DPAPI-protected key on
// Windows) via the injectable ProxyCipher, so tests run without Electron and no new synchronous
// safeStorage call exists. Reading never throws on damage: a record that can't be parsed, or a
// password that can't be decrypted (profile copied to another Windows account, DPAPI key lost),
// yields "unavailable" - and the controlled path then FAILS requests instead of going direct.
//
// Concurrency: every write goes through one in-process queue (this class is a singleton in the
// app), and the two writes that must not race use conditional SQL: insert-if-absent for the
// legacy migration, compare-and-swap for re-encryption and for undoing a failed migration. A
// Settings save that lands between them is therefore never silently overwritten or deleted.
import type { ProxyConfig, ProxyDnsMode, ProxyKind } from "./proxy";

export const SECURE_PROXY_KEY = "network.proxy";
const VERSION = 1;

export interface ProxyCipher {
  isAvailable(): Promise<boolean>;
  encrypt(plaintext: string): Promise<Buffer>;
  /** `shouldReEncrypt`: Electron's decryptStringAsync says the data used an outdated key or scheme. */
  decrypt(ciphertext: Buffer): Promise<{ text: string; shouldReEncrypt: boolean }>;
}

/** Key/value persistence (app_settings in the app, a Map in tests). The conditional writes must be
 * atomic in the backing store (one SQL statement each). */
export interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Inserts only when no row exists; true when it inserted. */
  insertIfAbsent(key: string, value: string): Promise<boolean>;
  /** Replaces (or, with next = null, deletes) only when the row still holds `expected`; true when it did. */
  replaceIfEquals(key: string, expected: string, next: string | null): Promise<boolean>;
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
  /** "settings" (typed in) or "legacy-migration" (moved from the plaintext setting). */
  origin?: "settings" | "legacy-migration";
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
  /** True when a record exists but can't be used (damaged / undecryptable). */
  damaged?: boolean;
  enabled: boolean;
  kind: ProxyKind | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hasPassword: boolean;
  dnsMode: ProxyDnsMode;
  origin?: "settings" | "legacy-migration";
}

export type LoadedProxy =
  | { status: "none" }
  | { status: "disabled" }
  | { status: "ok"; config: ProxyConfig; dnsMode: ProxyDnsMode; reEncrypted?: boolean }
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
  if (input.password && !input.username) return "a proxy password needs a user name";
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
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: SettingsStore,
    private readonly cipher: ProxyCipher,
    private readonly now: () => number = Date.now,
  ) {}

  /** Runs write operations one after another (and reads that may re-encrypt). */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Builds (and round-trip verifies) the JSON to store. Never falls back to plaintext. */
  private async encode(input: ProxyInput, origin: StoredProxyRecord["origin"]): Promise<string> {
    const problem = validateProxyInput(input);
    if (problem) throw new Error(problem);
    let passwordCiphertext: string | null = null;
    if (input.password) {
      if (!(await this.cipher.isAvailable())) throw new Error("OS encryption is unavailable; the proxy password was not stored");
      passwordCiphertext = (await this.cipher.encrypt(input.password)).toString("base64");
      // Round-trip before anything is written: a password that can't be read back must not replace
      // a working record.
      if ((await this.cipher.decrypt(Buffer.from(passwordCiphertext, "base64"))).text !== input.password) throw new Error("encryption round-trip failed; nothing was stored");
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
      origin,
      updatedAt: this.now(),
    };
    return JSON.stringify(record);
  }

  /** Encrypts and stores (replacing any record): the Settings "save" action. */
  save(input: ProxyInput): Promise<ProxySummary> {
    return this.serial(async () => {
      const json = await this.encode(input, "settings");
      await this.settings.set(SECURE_PROXY_KEY, json);
      return this.summarise(parseRecord(json)!);
    });
  }

  /**
   * Stores only if no record exists - atomically (one INSERT ... ON CONFLICT DO NOTHING), so a
   * record saved by another path in the meantime is never overwritten. Returns the stored JSON,
   * or null when a record already existed.
   */
  saveIfAbsent(input: ProxyInput, origin: StoredProxyRecord["origin"] = "legacy-migration"): Promise<string | null> {
    return this.serial(async () => {
      const json = await this.encode(input, origin);
      return (await this.settings.insertIfAbsent(SECURE_PROXY_KEY, json)) ? json : null;
    });
  }

  /** Removes the record only if it is still exactly `json` (undoing our own write, never someone else's). */
  removeIfUnchanged(json: string): Promise<boolean> {
    return this.serial(() => this.settings.replaceIfEquals(SECURE_PROXY_KEY, json, null));
  }

  clear(): Promise<void> {
    return this.serial(() => this.settings.delete(SECURE_PROXY_KEY));
  }

  async raw(): Promise<StoredProxyRecord | null | "corrupt"> {
    const raw = await this.settings.get(SECURE_PROXY_KEY);
    if (raw === null) return null;
    return parseRecord(raw) ?? "corrupt";
  }

  async summary(): Promise<ProxySummary> {
    const record = await this.raw();
    const empty: ProxySummary = { configured: false, enabled: false, kind: null, host: null, port: null, username: null, hasPassword: false, dnsMode: "doh-via-proxy" };
    if (record === null) return empty;
    if (record === "corrupt") return { ...empty, configured: true, damaged: true, enabled: true };
    return this.summarise(record);
  }

  private summarise(r: StoredProxyRecord): ProxySummary {
    return { configured: true, enabled: r.enabled, kind: r.kind, host: r.host, port: r.port, username: r.username, hasPassword: r.passwordCiphertext !== null, dnsMode: r.dnsMode, origin: r.origin };
  }

  /**
   * The usable proxy, decrypted in memory only. When Electron says the ciphertext should be
   * re-encrypted, a fresh ciphertext is made, verified, and swapped in only if the record is still
   * the one that was read (compare-and-swap). A failed re-encryption keeps the old, working record.
   */
  load(): Promise<LoadedProxy> {
    return this.serial(async () => {
      const raw = await this.settings.get(SECURE_PROXY_KEY);
      if (raw === null) return { status: "none" };
      const record = parseRecord(raw);
      if (!record) return { status: "unavailable", reason: "the stored proxy settings are damaged" };
      if (!record.enabled) return { status: "disabled" };
      const config: ProxyConfig = { kind: record.kind, host: record.host, port: record.port };
      if (record.username) config.username = record.username;
      let reEncrypted = false;
      if (record.passwordCiphertext) {
        let decrypted: { text: string; shouldReEncrypt: boolean };
        try {
          if (!(await this.cipher.isAvailable())) return { status: "unavailable", reason: "OS encryption is unavailable" };
          decrypted = await this.cipher.decrypt(Buffer.from(record.passwordCiphertext, "base64"));
        } catch {
          return { status: "unavailable", reason: "the stored proxy password could not be decrypted (another Windows account or profile?)" };
        }
        config.password = decrypted.text;
        if (decrypted.shouldReEncrypt) reEncrypted = await this.reEncrypt(raw, record, decrypted.text);
      }
      return { status: "ok", config, dnsMode: record.dnsMode, ...(reEncrypted ? { reEncrypted } : {}) };
    });
  }

  private async reEncrypt(raw: string, record: StoredProxyRecord, password: string): Promise<boolean> {
    try {
      const fresh = (await this.cipher.encrypt(password)).toString("base64");
      if ((await this.cipher.decrypt(Buffer.from(fresh, "base64"))).text !== password) return false;
      const next = JSON.stringify({ ...record, passwordCiphertext: fresh, updatedAt: this.now() });
      return await this.settings.replaceIfEquals(SECURE_PROXY_KEY, raw, next);
    } catch {
      return false; // the old ciphertext still decrypts: keep it
    }
  }
}
