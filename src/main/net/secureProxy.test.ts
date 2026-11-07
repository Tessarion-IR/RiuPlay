// RiuPlay M3: the encrypted proxy store, the (not invoked) legacy migration, and the effective
// proxy precedence - including every way it must fail closed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyLegacyProxyMigration, planLegacyProxyMigration } from "./legacyProxyMigration";
import { SECURE_PROXY_KEY, SecureProxyStore, type ProxyCipher, type SettingsStore } from "./secureProxyStore";
import { effectiveProxy, netClient, setLegacyNetworkSettings, setSecureProxy } from "./state";

function memorySettings(): SettingsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

/** Reversible stand-in for DPAPI that never leaves the plaintext visible. */
function fakeCipher(options: { available?: boolean; corruptOnDecrypt?: boolean; failDecrypt?: boolean } = {}): ProxyCipher & { encrypted: number } {
  const c = {
    encrypted: 0,
    isAvailable: async () => options.available ?? true,
    encrypt: async (text: string) => {
      c.encrypted++;
      return Buffer.concat([Buffer.from("ENC1"), Buffer.from(text, "utf8").map((b) => b ^ 0x5a)]);
    },
    decrypt: async (data: Buffer) => {
      if (options.failDecrypt) throw new Error("DPAPI: key not valid");
      if (data.subarray(0, 4).toString() !== "ENC1") throw new Error("bad ciphertext");
      const text = Buffer.from(data.subarray(4).map((b) => b ^ 0x5a)).toString("utf8");
      return options.corruptOnDecrypt ? `${text}x` : text;
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
    expect(JSON.parse(raw)).toMatchObject({ version: 1, kind: "socks5", username: "bob", dnsMode: "doh-via-proxy" });
    expect(JSON.stringify(summary)).not.toContain("hunter2");
    expect(summary).toMatchObject({ configured: true, hasPassword: true });
    expect(await store.load()).toEqual({ status: "ok", config: { kind: "socks5", host: "proxy.example", port: 1080, username: "bob", password: "hunter2-secret" }, dnsMode: "doh-via-proxy" });
  });

  it("refuses to store a password when OS encryption is unavailable - never plaintext", async () => {
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher({ available: false }));
    await expect(store.save({ kind: "http", host: "p.example", port: 3128, password: "pw" })).rejects.toThrow(/unavailable/);
    expect(settings.data.size).toBe(0);
  });

  it("a failed encryption round-trip leaves the previous record in place", async () => {
    const settings = memorySettings();
    await new SecureProxyStore(settings, fakeCipher()).save({ kind: "http", host: "old.example", port: 1, password: "old" });
    const before = settings.data.get(SECURE_PROXY_KEY);
    await expect(new SecureProxyStore(settings, fakeCipher({ corruptOnDecrypt: true })).save({ kind: "http", host: "new.example", port: 2, password: "new" })).rejects.toThrow(/round-trip/);
    expect(settings.data.get(SECURE_PROXY_KEY)).toBe(before);
  });

  it.each([
    ["a damaged record", (s: Map<string, string>) => s.set(SECURE_PROXY_KEY, "{not json"), fakeCipher()],
    ["an unknown version", (s: Map<string, string>) => s.set(SECURE_PROXY_KEY, JSON.stringify({ version: 9 })), fakeCipher()],
    ["an undecryptable password (profile moved to another account)", () => {}, fakeCipher({ failDecrypt: true })],
    ["encryption unavailable at load", () => {}, fakeCipher({ available: false })],
  ])("%s loads as unavailable (fail closed), never as no proxy", async (_label, damage, cipher) => {
    const settings = memorySettings();
    await new SecureProxyStore(settings, fakeCipher()).save({ kind: "http", host: "p.example", port: 3128, username: "u", password: "pw" });
    damage(settings.data);
    expect((await new SecureProxyStore(settings, cipher).load()).status).toBe("unavailable");
  });

  it("validates input", async () => {
    const store = new SecureProxyStore(memorySettings(), fakeCipher());
    for (const bad of [
      { kind: "socks4", host: "x", port: 1 },
      { kind: "http", host: "", port: 1 },
      { kind: "http", host: "a b", port: 1 },
      { kind: "http", host: "x", port: 0 },
      { kind: "http", host: "x", port: 1, username: "a\r\nb" },
      { kind: "http", host: "x", port: 1, password: "a\nb" },
    ]) {
      await expect(store.save(bad as never)).rejects.toThrow();
    }
  });

  it("disabled and cleared records are distinguishable from damaged ones", async () => {
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher());
    await store.save({ kind: "http", host: "p.example", port: 1, enabled: false });
    expect((await store.load()).status).toBe("disabled");
    await store.clear();
    expect((await store.load()).status).toBe("none");
  });
});

describe("legacy proxy migration (designed and tested; not invoked by the app)", () => {
  it("plans without revealing the password", () => {
    expect(planLegacyProxyMigration("")).toMatchObject({ action: "nothing" });
    expect(planLegacyProxyMigration("http=a;https=b")).toMatchObject({ action: "refuse" });
    const plan = planLegacyProxyMigration("http://alice:s3cr3t@proxy.example:3128");
    expect(plan).toMatchObject({ action: "migrate", target: { kind: "http", host: "proxy.example", port: 3128, username: "alice", hasPassword: true } });
    expect(JSON.stringify(plan)).not.toContain("s3cr3t");
  });

  it("migrates, verifies by decrypting, and leaves the legacy value alone", async () => {
    const legacy = "socks5://alice:s3cr3t@proxy.example:1080";
    const settings = memorySettings();
    const store = new SecureProxyStore(settings, fakeCipher());
    const result = await applyLegacyProxyMigration(legacy, store);
    expect(result).toMatchObject({ outcome: "migrated", legacyStillPresent: true });
    expect(settings.data.get(SECURE_PROXY_KEY)).not.toContain("s3cr3t");
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

  it("a migration that can't encrypt or verify stores nothing and keeps the legacy setting in force", async () => {
    for (const cipher of [fakeCipher({ available: false }), fakeCipher({ corruptOnDecrypt: true })]) {
      const settings = memorySettings();
      const result = await applyLegacyProxyMigration("http://u:pw@p.example:1", new SecureProxyStore(settings, cipher));
      expect(result).toMatchObject({ outcome: "failed", legacyStillPresent: true });
      expect(settings.data.size).toBe(0);
    }
  });

  it("is not imported by any production code", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !full.endsWith("legacyProxyMigration.ts")) {
          if (/(?:from\s*|import\(\s*)["'][^"']*legacyProxyMigration["']/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("effective proxy precedence and fail-closed behaviour", () => {
  afterEach(async () => {
    await setSecureProxy({ status: "none" });
    await setLegacyNetworkSettings({ proxy: "", doh: "off" });
  });

  it("secure store first, then the legacy runtime string, then direct", async () => {
    expect(effectiveProxy().state.status).toBe("none");
    await setLegacyNetworkSettings({ proxy: "socks5://127.0.0.1:1080", doh: "off" });
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
  });

  it("an unparseable legacy string refuses requests instead of going direct (Node used to ignore it)", async () => {
    await setLegacyNetworkSettings({ proxy: "http=a:1;https=b:2", doh: "off" });
    await expect(netClient.request({ url: "https://example.com/", caller: { kind: "extension", sourceId: "x" } })).rejects.toMatchObject({ code: "proxy-invalid" });
    await expect(netClient.stream({ url: "https://example.com/", caller: { kind: "download" } })).rejects.toMatchObject({ code: "proxy-invalid" });
  });
});
