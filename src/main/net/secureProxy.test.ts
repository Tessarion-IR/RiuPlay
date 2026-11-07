// RiuPlay M3: the encrypted proxy store, the user-started legacy migration, the effective proxy
// precedence, Chromium parity and backup redaction - all with synthetic data only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { redactLocalStorageForBackup, stripProxyPassword } from "../backupRedaction";
import { on, openDevice } from "../../core/sync/syncDevices.testkit";
import { chromiumProxyConfig, createChromiumProxyController } from "./chromiumProxy";
import { applyLegacyProxyMigration, planLegacyProxyMigration } from "./legacyProxyMigration";
import { chromiumProxyPlan, parseLegacyProxyString } from "./proxy";
import { SECURE_PROXY_KEY, SecureProxyStore, type ProxyCipher, type SettingsStore } from "./secureProxyStore";
import { appSettingsStore } from "./settingsStore";
import {
  chromiumNetworkPlan,
  effectiveProxy,
  legacyProxyString,
  netClient,
  plaintextRemovalAllowed,
  recordVerification,
  setLegacyNetworkSettings,
  setSecureProxy,
  verificationSubject,
} from "./state";

function memorySettings(): SettingsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    insertIfAbsent: async (k, v) => (data.has(k) ? false : (data.set(k, v), true)),
    replaceIfEquals: async (k, expected, next) => {
      if (data.get(k) !== expected) return false;
      if (next === null) data.delete(k);
      else data.set(k, next);
      return true;
    },
  };
}

/** Reversible stand-in for safeStorage that never leaves the plaintext visible. "ENC1" = current key. */
function fakeCipher(options: { available?: boolean; corruptOnDecrypt?: boolean; failDecrypt?: boolean; staleKey?: boolean; failEncryptAfter?: number } = {}): ProxyCipher & { encrypted: number } {
  const c = {
    encrypted: 0,
    isAvailable: async () => options.available ?? true,
    encrypt: async (text: string) => {
      c.encrypted++;
      if (options.failEncryptAfter !== undefined && c.encrypted > options.failEncryptAfter) throw new Error("encrypt failed");
      return Buffer.concat([Buffer.from(options.staleKey ? "ENC0" : "ENC1"), Buffer.from(text, "utf8").map((b) => b ^ 0x5a)]);
    },
    decrypt: async (data: Buffer) => {
      if (options.failDecrypt) throw new Error("DPAPI: key not valid");
      const tag = data.subarray(0, 4).toString();
      if (tag !== "ENC1" && tag !== "ENC0") throw new Error("bad ciphertext");
      const text = Buffer.from(data.subarray(4).map((b) => b ^ 0x5a)).toString("utf8");
      return { text: options.corruptOnDecrypt ? `${text}x` : text, shouldReEncrypt: tag === "ENC0" };
    },
  };
  return c;
}

describe("secure proxy store", () => {
  it("stores the password only as ciphertext and gives the renderer a summary without it", async () => {
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher());
    const summary = await store.save({ kind: "socks5", host: "proxy.example", port: 1080, username: "bob", password: "hunter2-secret" });
    const raw = settings.data.get(SECURE_PROXY_KEY)!;
    expect(raw).not.toContain("hunter2-secret");
    expect(JSON.parse(raw)).toMatchObject({ version: 1, kind: "socks5", username: "bob", dnsMode: "doh-via-proxy", origin: "settings" });
    expect(JSON.stringify(summary)).not.toContain("hunter2");
    expect(summary).toMatchObject({ configured: true, hasPassword: true });
    expect(await store.load()).toEqual({ status: "ok", config: { kind: "socks5", host: "proxy.example", port: 1080, username: "bob", password: "hunter2-secret" }, dnsMode: "doh-via-proxy" });
  });

  it("refuses to store a password when OS encryption is unavailable - never plaintext", async () => {
    const settings = memorySettings();
    await expect(new SecureProxyStore(settings, fakeCipher({ available: false })).save({ kind: "http", host: "p.example", port: 3128, username: "u", password: "pw" })).rejects.toThrow(/unavailable/);
    expect(settings.data.size).toBe(0);
  });

  it("a failed encryption round-trip leaves the previous record in place", async () => {
    const settings = memorySettings();
    await new SecureProxyStore(settings, fakeCipher()).save({ kind: "http", host: "old.example", port: 1, username: "u", password: "old" });
    const before = settings.data.get(SECURE_PROXY_KEY);
    await expect(new SecureProxyStore(settings, fakeCipher({ corruptOnDecrypt: true })).save({ kind: "http", host: "new.example", port: 2, username: "u", password: "new" })).rejects.toThrow(/round-trip/);
    expect(settings.data.get(SECURE_PROXY_KEY)).toBe(before);
  });

  it.each([
    ["a damaged record", (s: Map<string, string>) => s.set(SECURE_PROXY_KEY, "{not json"), fakeCipher()],
    ["an unknown version", (s: Map<string, string>) => s.set(SECURE_PROXY_KEY, JSON.stringify({ version: 9 })), fakeCipher()],
    ["an undecryptable password (another Windows account or profile)", () => {}, fakeCipher({ failDecrypt: true })],
    ["encryption unavailable at load", () => {}, fakeCipher({ available: false })],
  ])("%s loads as unavailable (fail closed), never as no proxy", async (_label, damage, cipher) => {
    const settings = memorySettings();
    await new SecureProxyStore(settings, fakeCipher()).save({ kind: "http", host: "p.example", port: 3128, username: "u", password: "pw" });
    damage(settings.data);
    expect((await new SecureProxyStore(settings, cipher).load()).status).toBe("unavailable");
    expect((await new SecureProxyStore(settings, cipher).summary()).configured).toBe(true);
  });

  it("validates input", async () => {
    const store = new SecureProxyStore(memorySettings(), fakeCipher());
    for (const bad of [
      { kind: "socks4", host: "x", port: 1 },
      { kind: "http", host: "", port: 1 },
      { kind: "http", host: "a b", port: 1 },
      { kind: "http", host: "x", port: 0 },
      { kind: "http", host: "x", port: 1, username: "a\r\nb" },
      { kind: "http", host: "x", port: 1, username: "u", password: "a\nb" },
      { kind: "http", host: "x", port: 1, password: "no-user" },
    ]) {
      await expect(store.save(bad as never)).rejects.toThrow();
    }
  });

  it("disabled and cleared records are distinguishable from damaged ones", async () => {
    const store = new SecureProxyStore(memorySettings(), fakeCipher());
    await store.save({ kind: "http", host: "p.example", port: 1, enabled: false });
    expect((await store.load()).status).toBe("disabled");
    await store.clear();
    expect((await store.load()).status).toBe("none");
  });

  describe("re-encryption (decryptStringAsync shouldReEncrypt)", () => {
    it("re-encrypts with the current key, verifies, and swaps in the new ciphertext", async () => {
      const settings = memorySettings();
      await new SecureProxyStore(settings, fakeCipher({ staleKey: true })).save({ kind: "http", host: "p.example", port: 1, username: "u", password: "s3cret" });
      const stale = settings.data.get(SECURE_PROXY_KEY)!;
      const loaded = await new SecureProxyStore(settings, fakeCipher()).load();
      expect(loaded).toMatchObject({ status: "ok", config: { password: "s3cret" }, reEncrypted: true });
      const fresh = settings.data.get(SECURE_PROXY_KEY)!;
      expect(fresh).not.toBe(stale);
      expect(fresh).not.toContain("s3cret");
      expect(Buffer.from(JSON.parse(fresh).passwordCiphertext, "base64").subarray(0, 4).toString()).toBe("ENC1");
    });

    it("a failed re-encryption keeps the working record and still returns the proxy", async () => {
      const settings = memorySettings();
      await new SecureProxyStore(settings, fakeCipher({ staleKey: true })).save({ kind: "http", host: "p.example", port: 1, username: "u", password: "s3cret" });
      const stale = settings.data.get(SECURE_PROXY_KEY)!;
      const loaded = await new SecureProxyStore(settings, fakeCipher({ failEncryptAfter: 0 })).load();
      expect(loaded).toMatchObject({ status: "ok", config: { password: "s3cret" } });
      expect(settings.data.get(SECURE_PROXY_KEY)).toBe(stale);
    });

    it("never overwrites a record that changed while re-encrypting (compare-and-swap)", async () => {
      const settings = memorySettings();
      await new SecureProxyStore(settings, fakeCipher({ staleKey: true })).save({ kind: "http", host: "p.example", port: 1, username: "u", password: "s3cret" });
      const swap = settings.replaceIfEquals;
      settings.replaceIfEquals = async (k, expected, next) => {
        settings.data.set(k, "SAVED-BY-SETTINGS-MEANWHILE");
        return swap(k, expected, next);
      };
      await new SecureProxyStore(settings, fakeCipher()).load();
      expect(settings.data.get(SECURE_PROXY_KEY)).toBe("SAVED-BY-SETTINGS-MEANWHILE");
    });
  });
});

describe("app_settings conditional writes (real SQLite through drizzle)", () => {
  beforeEach(async () => {
    on(await openDevice());
  });

  it("insertIfAbsent inserts once; replaceIfEquals only acts on the expected value", async () => {
    expect(await appSettingsStore.insertIfAbsent("network.proxy", "A")).toBe(true);
    expect(await appSettingsStore.insertIfAbsent("network.proxy", "B")).toBe(false);
    expect(await appSettingsStore.get("network.proxy")).toBe("A");
    expect(await appSettingsStore.replaceIfEquals("network.proxy", "B", "C")).toBe(false);
    expect(await appSettingsStore.replaceIfEquals("network.proxy", "A", "C")).toBe(true);
    expect(await appSettingsStore.get("network.proxy")).toBe("C");
    expect(await appSettingsStore.replaceIfEquals("network.proxy", "A", null)).toBe(false);
    expect(await appSettingsStore.replaceIfEquals("network.proxy", "C", null)).toBe(true);
    expect(await appSettingsStore.get("network.proxy")).toBeNull();
  });

  it("the store on real SQLite: migration then a Settings save, never mixed up", async () => {
    const store = new SecureProxyStore(appSettingsStore, fakeCipher());
    expect((await applyLegacyProxyMigration("http://u:pw@legacy.example:3128", store)).outcome).toBe("migrated");
    await store.save({ kind: "socks5", host: "typed.example", port: 1080 });
    expect((await applyLegacyProxyMigration("http://u:pw@legacy.example:3128", store)).outcome).toBe("already-migrated");
    expect(await store.load()).toMatchObject({ status: "ok", config: { host: "typed.example" } });
  });
});

describe("legacy proxy migration", () => {
  it("plans without revealing the password, and names ambiguous or unsupported values", () => {
    expect(planLegacyProxyMigration("")).toMatchObject({ action: "nothing" });
    expect(planLegacyProxyMigration("http=a;https=b")).toMatchObject({ action: "refuse" });
    expect(planLegacyProxyMigration("socks://p.example:1080")).toMatchObject({ action: "refuse", reason: expect.stringMatching(/ambiguous/) });
    expect(planLegacyProxyMigration("socks4://p.example:1080")).toMatchObject({ action: "refuse" });
    const plan = planLegacyProxyMigration("http://alice:s3cr3t@proxy.example:3128");
    expect(plan).toMatchObject({ action: "migrate", target: { kind: "http", host: "proxy.example", port: 3128, username: "alice", hasPassword: true } });
    expect(JSON.stringify(plan)).not.toContain("s3cr3t");
  });

  it("migrates, verifies by decrypting, and leaves the legacy value alone", async () => {
    const legacy = "socks5://alice:s3cr3t@proxy.example:1080";
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher());
    expect(await applyLegacyProxyMigration(legacy, store)).toMatchObject({ outcome: "migrated", legacyStillPresent: true });
    expect(settings.data.get(SECURE_PROXY_KEY)).not.toContain("s3cr3t");
    expect(JSON.parse(settings.data.get(SECURE_PROXY_KEY)!).origin).toBe("legacy-migration");
    expect(await store.load()).toMatchObject({ status: "ok", config: { password: "s3cr3t", username: "alice" } });
    expect(legacy).toBe("socks5://alice:s3cr3t@proxy.example:1080");
  });

  it("never overwrites an existing encrypted record", async () => {
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher());
    await store.save({ kind: "http", host: "newer.example", port: 1 });
    const before = settings.data.get(SECURE_PROXY_KEY);
    expect((await applyLegacyProxyMigration("http://old.example:2", store)).outcome).toBe("already-migrated");
    expect(settings.data.get(SECURE_PROXY_KEY)).toBe(before);
  });

  it("is atomic: a Settings save that lands between check and write is never overwritten", async () => {
    const settings = memorySettings();
    const insert = settings.insertIfAbsent;
    // The user saves through Settings at the exact moment the migration writes.
    settings.insertIfAbsent = async (k, v) => {
      settings.data.set(k, "SAVED-BY-SETTINGS");
      return insert(k, v);
    };
    const result = await applyLegacyProxyMigration("http://u:pw@legacy.example:1", new SecureProxyStore(settings, fakeCipher()));
    expect(result.outcome).toBe("already-migrated");
    expect(settings.data.get(SECURE_PROXY_KEY)).toBe("SAVED-BY-SETTINGS");
  });

  it("runs one migration at a time", async () => {
    const store = new SecureProxyStore(memorySettings(), fakeCipher());
    const [a, b] = await Promise.all([applyLegacyProxyMigration("http://u:pw@p.example:1", store), applyLegacyProxyMigration("http://u:pw@p.example:1", store)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["busy", "migrated"]);
  });

  it("a failed verify removes only its own record, never one saved meanwhile", async () => {
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher({ corruptOnDecrypt: true }));
    // encode()'s own round-trip catches this cipher, so nothing is written at all:
    expect((await applyLegacyProxyMigration("http://u:pw@p.example:1", store)).outcome).toBe("failed");
    expect(settings.data.size).toBe(0);
    // A record that changes before the undo is left alone.
    const json = '{"x":1}';
    settings.data.set(SECURE_PROXY_KEY, "OTHER");
    expect(await store.removeIfUnchanged(json)).toBe(false);
    expect(settings.data.get(SECURE_PROXY_KEY)).toBe("OTHER");
  });

  it("a migration that can't encrypt stores nothing and keeps the legacy setting in force", async () => {
    const settings = memorySettings();
    const result = await applyLegacyProxyMigration("http://u:pw@p.example:1", new SecureProxyStore(settings, fakeCipher({ available: false })));
    expect(result).toMatchObject({ outcome: "failed", legacyStillPresent: true });
    expect(settings.data.size).toBe(0);
  });

  it("is only reachable from the user-started IPC handler", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !full.endsWith("legacyProxyMigration.ts")) {
          if (/(?:from\s*|import\(\s*)["'][^"']*legacyProxyMigration["']/.test(fs.readFileSync(full, "utf8"))) importers.push(path.relative(root, full).split(path.sep).join("/"));
        }
      }
    };
    walk(root);
    expect(importers).toEqual(["main/ipc/network.ts"]);
  });
});

describe("effective proxy precedence, fail closed, and plaintext-removal gate", () => {
  afterEach(async () => {
    await setSecureProxy({ status: "none" });
    await setLegacyNetworkSettings({ proxy: "", doh: "off" });
  });

  it("secure store first, then the legacy runtime string, then direct", async () => {
    expect(effectiveProxy().state.status).toBe("none");
    await setLegacyNetworkSettings({ proxy: "socks5://127.0.0.1:1080", doh: "off" });
    expect(legacyProxyString()).toBe("socks5://127.0.0.1:1080");
    expect(effectiveProxy()).toMatchObject({ source: "legacy", state: { status: "ok", config: { kind: "socks5" } }, dnsMode: "doh-via-proxy" });
    await setSecureProxy({ status: "ok", config: { kind: "http", host: "secure.example", port: 3128 }, dnsMode: "local" });
    expect(effectiveProxy()).toMatchObject({ source: "secure", state: { status: "ok", config: { host: "secure.example" } }, dnsMode: "local" });
    await setSecureProxy({ status: "disabled" });
    expect(effectiveProxy().source).toBe("legacy");
  });

  it("an undecryptable stored proxy wins over the legacy string and refuses requests", async () => {
    await setLegacyNetworkSettings({ proxy: "http://legacy.example:3128", doh: "off" });
    await setSecureProxy({ status: "unavailable", reason: "could not decrypt" });
    expect(effectiveProxy().state.status).toBe("unavailable");
    await expect(netClient.request({ url: "https://example.com/", caller: { kind: "extension", sourceId: "x" } })).rejects.toMatchObject({ code: "proxy-unavailable" });
    expect(chromiumNetworkPlan()).toMatchObject({ mode: "blocked", rules: "http://127.0.0.1:9" });
  });

  it("an unparseable or ambiguous legacy string refuses requests on both paths", async () => {
    for (const proxy of ["http=a:1;https=b:2", "socks://p.example:1080"]) {
      await setLegacyNetworkSettings({ proxy, doh: "off" });
      await expect(netClient.request({ url: "https://example.com/", caller: { kind: "extension", sourceId: "x" } })).rejects.toMatchObject({ code: "proxy-invalid" });
      await expect(netClient.stream({ url: "https://example.com/", caller: { kind: "download" } })).rejects.toMatchObject({ code: "proxy-invalid" });
      expect(chromiumNetworkPlan().mode).toBe("blocked");
    }
  });

  it("Chromium follows the encrypted record, not the legacy string", async () => {
    await setLegacyNetworkSettings({ proxy: "http://legacy.example:3128", doh: "off" });
    expect(chromiumNetworkPlan()).toMatchObject({ mode: "proxy", rules: "http://legacy.example:3128" });
    await setSecureProxy({ status: "ok", config: { kind: "https", host: "secure.example", port: 8443, username: "u", password: "pw" }, dnsMode: "doh-via-proxy" });
    const plan = chromiumNetworkPlan();
    expect(plan).toMatchObject({ mode: "proxy", rules: "https://secure.example:8443", auth: { host: "secure.example", port: 8443, username: "u" } });
    expect(plan.rules).not.toContain("pw");
  });

  it("offers plaintext removal only after the ENCRYPTED proxy passed on both paths, for the current configuration", async () => {
    await setLegacyNetworkSettings({ proxy: "http://u:pw@legacy.example:3128", doh: "off" });
    const ok = { ok: true, code: null };
    recordVerification({ subject: verificationSubject(), main: ok, chromium: ok, at: 1 });
    expect(plaintextRemovalAllowed()).toBe(false); // legacy is what passed, not the encrypted record
    await setSecureProxy({ status: "ok", config: { kind: "http", host: "legacy.example", port: 3128, username: "u", password: "pw" }, dnsMode: "doh-via-proxy" });
    expect(plaintextRemovalAllowed()).toBe(false); // not verified yet
    recordVerification({ subject: verificationSubject(), main: ok, chromium: { ok: false, code: "TypeError" }, at: 2 });
    expect(plaintextRemovalAllowed()).toBe(false); // Chromium failed
    recordVerification({ subject: verificationSubject(), main: ok, chromium: ok, at: 3 });
    expect(plaintextRemovalAllowed()).toBe(true);
    await setSecureProxy({ status: "ok", config: { kind: "http", host: "other.example", port: 3128 }, dnsMode: "doh-via-proxy" });
    expect(plaintextRemovalAllowed()).toBe(false); // configuration changed: verify again
  });
});

describe("Chromium proxy rules and authentication", () => {
  it("never puts credentials into a Chromium rule; SOCKS5 with credentials is blocked, not sent direct", () => {
    const parsed = parseLegacyProxyString("http://u:pw@p.example:3128");
    expect(parsed.status === "ok" && chromiumProxyPlan(parsed.config)).toMatchObject({ mode: "proxy", proxyRules: "http://p.example:3128" });
    expect(chromiumProxyPlan({ kind: "socks5", host: "s.example", port: 1080 })).toMatchObject({ mode: "proxy", proxyRules: "socks5://s.example:1080", auth: null });
    expect(chromiumProxyPlan({ kind: "socks5", host: "s.example", port: 1080, username: "u", password: "pw" }).mode).toBe("blocked");
    expect(chromiumProxyPlan({ kind: "http", host: "::1", port: 8080 })).toMatchObject({ proxyRules: "http://[::1]:8080" });
    expect(chromiumProxyConfig({ mode: "blocked", reason: "x", rules: "http://127.0.0.1:9" })).toEqual({ proxyRules: "http://127.0.0.1:9" });
    expect(chromiumProxyConfig({ mode: "direct", rules: null })).toEqual({ mode: "direct" });
  });

  it("applies the plan to every session and closes old connections", async () => {
    const calls: unknown[] = [];
    let closed = 0;
    let authCleared = 0;
    const controller = createChromiumProxyController({ plan: () => ({ mode: "proxy", proxyRules: "http://p.example:3128", auth: null, rules: "http://p.example:3128" }) });
    await controller.apply({ setProxy: async (c) => void calls.push(c), closeAllConnections: async () => void closed++, clearAuthCache: async () => void authCleared++ });
    expect(calls).toEqual([{ proxyRules: "http://p.example:3128" }]);
    expect(closed).toBe(1);
    expect(authCleared).toBe(1);
  });

  it("answers only proxy challenges for the configured proxy, a bounded number of times", () => {
    let now = 0;
    const plan = { mode: "proxy" as const, proxyRules: "http://p.example:3128", rules: "http://p.example:3128", auth: { host: "p.example", port: 3128, username: "u", password: "pw" } };
    const controller = createChromiumProxyController({ plan: () => plan, now: () => now });
    expect(controller.answerLogin({ isProxy: false, host: "p.example", port: 3128 })).toBeNull(); // a website's own login
    expect(controller.answerLogin({ isProxy: true, host: "evil.example", port: 3128 })).toBeNull();
    expect(controller.answerLogin({ isProxy: true, host: "p.example", port: 8080 })).toBeNull();
    expect(controller.answerLogin({ isProxy: true, host: "P.EXAMPLE", port: 3128 })).toEqual({ username: "u", password: "pw" });
    expect(controller.answerLogin({ isProxy: true, host: "p.example", port: 3128 })).not.toBeNull();
    expect(controller.answerLogin({ isProxy: true, host: "p.example", port: 3128 })).toBeNull(); // wrong password: no loop
    now += 61_000;
    expect(controller.answerLogin({ isProxy: true, host: "p.example", port: 3128 })).not.toBeNull();
    expect(createChromiumProxyController({ plan: () => ({ mode: "direct", rules: null }) }).answerLogin({ isProxy: true, host: "p.example", port: 3128 })).toBeNull();
  });
});

describe("backup redaction (new backups never carry the proxy password)", () => {
  const prefs = (proxy: unknown) => JSON.stringify({ state: { proxy, doh: "off", maxDownloads: 2 }, version: 0 });

  it("drops the password, keeps scheme, user, host and port, and every other entry", () => {
    const entries = { "hibiki-network-prefs": prefs("socks5://alice:S3cr3t!@proxy.example:1080"), "hibiki-ui": '{"state":{"x":1}}', other: "kept" };
    const { entries: out, redactions } = redactLocalStorageForBackup(entries);
    expect(out["hibiki-network-prefs"]).not.toContain("S3cr3t");
    expect(JSON.parse(out["hibiki-network-prefs"]).state).toEqual({ proxy: "socks5://alice@proxy.example:1080", doh: "off", maxDownloads: 2 });
    expect(out["hibiki-ui"]).toBe(entries["hibiki-ui"]);
    expect(out.other).toBe("kept");
    expect(redactions).toEqual([{ key: "hibiki-network-prefs", field: "state.proxy", what: "proxy-password" }]);
    expect(JSON.stringify(redactions)).not.toContain("S3cr3t");
    expect(entries["hibiki-network-prefs"]).toContain("S3cr3t"); // the input (live store) is not modified
  });

  it("leaves proxies without a password, empty values and other stores untouched", () => {
    for (const proxy of ["", "http://p.example:3128", "http://user@p.example:3128"]) {
      const { entries, redactions } = redactLocalStorageForBackup({ "hibiki-network-prefs": prefs(proxy) });
      expect(redactions).toEqual([]);
      expect(entries["hibiki-network-prefs"]).toBe(prefs(proxy));
    }
    expect(redactLocalStorageForBackup({}).redactions).toEqual([]);
  });

  it("scrubs a damaged (non-JSON) value instead of copying the secret", () => {
    const { entries, redactions } = redactLocalStorageForBackup({ "hibiki-network-prefs": '{"state":{"proxy":"http://u:pw@p.example:1"' });
    expect(entries["hibiki-network-prefs"]).not.toContain(":pw@");
    expect(redactions).toHaveLength(1);
  });

  it("stripProxyPassword handles odd user infos", () => {
    expect(stripProxyPassword("http://:pw@h:1")).toEqual({ value: "http://h:1", redacted: true });
    expect(stripProxyPassword("http://u:p%40ss@h:1")).toEqual({ value: "http://u@h:1", redacted: true });
    expect(stripProxyPassword("h:1")).toEqual({ value: "h:1", redacted: false });
  });
});
