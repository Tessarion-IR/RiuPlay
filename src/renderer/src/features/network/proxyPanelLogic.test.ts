import { describe, expect, it } from "vitest";
import type { SecureProxyStatus } from "@shared/types";
import { proxyPanelActions } from "./proxyPanelLogic";

const base: SecureProxyStatus = {
  stored: { configured: false, enabled: false, kind: null, host: null, port: null, username: null, hasPassword: false, dnsMode: "doh-via-proxy" },
  effectiveSource: "legacy",
  effectiveState: "ok",
  effectiveReason: null,
  path: "proxy http (legacy)",
  chromium: { mode: "proxy", reason: null },
  legacy: { action: "migrate", display: "http://u@p.example:3128", hasPassword: true, reason: null },
  verification: null,
  plaintextRemovalAllowed: false,
};

describe("encrypted proxy panel decisions", () => {
  it("offers migration of a plain proxy only while nothing is stored", () => {
    expect(proxyPanelActions(base, "http://u:pw@p.example:3128").offerMigration).toBe(true);
    expect(proxyPanelActions({ ...base, stored: { ...base.stored, configured: true } }, "http://u:pw@p.example:3128").offerMigration).toBe(false);
    expect(proxyPanelActions({ ...base, legacy: { action: "refuse", display: null, hasPassword: false, reason: "socks:// is ambiguous" } }, "socks://x:1").offerMigration).toBe(false);
  });

  it("never offers plaintext removal before the encrypted proxy passed on both paths", () => {
    expect(proxyPanelActions(base, "http://u:pw@p.example:3128").offerPlaintextRemoval).toBe(false);
    // The main process says allowed, but the legacy proxy is what is in force: still no.
    expect(proxyPanelActions({ ...base, plaintextRemovalAllowed: true }, "http://u:pw@p.example:3128").offerPlaintextRemoval).toBe(false);
    const secure = { ...base, effectiveSource: "secure" as const, stored: { ...base.stored, configured: true } };
    expect(proxyPanelActions(secure, "http://u:pw@p.example:3128").offerPlaintextRemoval).toBe(false);
    expect(proxyPanelActions({ ...secure, plaintextRemovalAllowed: true }, "http://u:pw@p.example:3128").offerPlaintextRemoval).toBe(true);
    expect(proxyPanelActions({ ...secure, plaintextRemovalAllowed: true }, "").offerPlaintextRemoval).toBe(false); // nothing left to remove
  });

  it("reports fail-closed states and offers no verification of an unusable proxy", () => {
    const broken = { ...base, effectiveState: "unavailable" as const, effectiveReason: "could not decrypt" };
    expect(proxyPanelActions(broken, "").failingClosed).toBe(true);
    expect(proxyPanelActions(broken, "").offerVerify).toBe(false);
  });
});
