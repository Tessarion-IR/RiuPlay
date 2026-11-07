import { describe, expect, it } from "vitest";
import { blockedReason } from "./addresses";
import { NetError } from "./errors";
import { allowanceFor, hostMatches, policyFor } from "./policy";
import { describeProxy, parseLegacyProxyString } from "./proxy";
import { redactHeaders, redactText, redactUrl } from "./redact";
import { dohResolver, parseDohAnswer, PROXY_DOH_ENDPOINTS, systemResolver } from "./resolve";

describe("address classification", () => {
  it.each([
    ["127.0.0.1", true], ["127.255.255.254", true], ["10.1.2.3", true], ["172.16.0.1", true], ["172.31.255.255", true], ["172.32.0.1", false],
    ["192.168.0.1", true], ["169.254.169.254", true], ["100.64.0.1", true], ["100.128.0.1", false], ["0.0.0.0", true], ["224.0.0.1", true], ["255.255.255.255", true],
    ["198.18.0.1", true], ["198.20.0.1", false], ["192.0.2.1", true], ["192.0.0.8", true], ["192.88.99.1", true], ["8.8.8.8", false], ["93.184.216.34", false], ["1.1.1.1", false],
    ["::1", true], ["::", true], ["fe80::1", true], ["febf::1", true], ["fec0::1", true], ["fd00::1", true], ["fc00::1", true], ["ff02::1", true], ["2001:db8::1", true], ["100::1", true],
    ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true], ["::ffff:8.8.8.8", false], ["::ffff:169.254.169.254", true], ["64:ff9b::7f00:1", true], ["64:ff9b::808:808", false],
    ["64:ff9b:1::a00:1", true], ["::127.0.0.1", true], ["2002:7f00:1::", true], ["2002:a00:1::", true], ["2002:808:808::", false], ["2001::1", true],
    ["2606:4700:4700::1111", false], ["2a00:1450:4001::200e", false], ["fd00:ec2::254", true],
  ])("%s blocked=%s", (address, blocked) => {
    expect(blockedReason(address) !== null).toBe(blocked);
  });

  it("refuses zone ids and throws for a non-address", () => {
    expect(blockedReason("fe80::1%eth0")).not.toBeNull();
    expect(() => blockedReason("example.com")).toThrow();
  });
});

describe("policy", () => {
  it("matches hosts exactly or by subdomain wildcard, never by suffix trickery", () => {
    expect(hostMatches("a.example.com", ["*.example.com"])).toBe(true);
    expect(hostMatches("example.com", ["*.example.com"])).toBe(false);
    expect(hostMatches("evilexample.com", ["*.example.com"])).toBe(false);
    expect(hostMatches("example.com.evil.net", ["example.com"])).toBe(false);
  });

  it("only connection callers carry allowances, and only their own", () => {
    const allowances = [
      { connectionId: "a", scheme: "http" as const, host: "nas.local", port: 4567, approvedAt: 1 },
      { connectionId: "b", scheme: "http" as const, host: "other.local", port: 80, approvedAt: 1 },
    ];
    expect(policyFor({ kind: "extension", sourceId: "a" }, { timeoutMs: 1, allowances }).allowances).toEqual([]);
    expect(policyFor({ kind: "download" }, { timeoutMs: 1, allowances }).allowances).toEqual([]);
    const own = policyFor({ kind: "connection", connectionId: "a" }, { timeoutMs: 1, allowances });
    expect(own.allowances.map((a) => a.host)).toEqual(["nas.local"]);
    expect(allowanceFor(own, "http:", "nas.local", 4567)).not.toBeNull();
    expect(allowanceFor(own, "https:", "nas.local", 4567)).toBeNull();
    expect(allowanceFor(own, "http:", "nas.local", 4568)).toBeNull();
    expect(allowanceFor(own, "http:", "other.local", 80)).toBeNull();
  });
});

describe("legacy proxy string (in memory only)", () => {
  it.each([
    ["", "none"], ["  ", "none"], ["direct://", "none"],
    ["http://proxy.example:3128", "ok"], ["proxy.example:3128", "ok"], ["https://proxy.example", "ok"], ["socks5://127.0.0.1:1080", "ok"], ["socks://127.0.0.1", "invalid"], ["socks4a://x:1", "invalid"], ["socks5h://x:1", "invalid"],
    ["socks5://user:p%40ss@[::1]:1080", "ok"],
    ["http=a:1;https=b:2", "invalid"], ["socks4://x:1", "invalid"], ["pac+https://x/proxy.pac", "invalid"], ["http://x:99999", "invalid"], ["http://x:8080/path", "invalid"], ["http:// space:1", "invalid"],
  ])("%j -> %s", (raw, status) => {
    expect(parseLegacyProxyString(raw).status).toBe(status);
  });

  it("decodes credentials, defaults ports, and never shows the password", () => {
    const parsed = parseLegacyProxyString("socks5://user:p%40ss@[::1]");
    expect(parsed).toEqual({ status: "ok", config: { kind: "socks5", host: "::1", port: 1080, username: "user", password: "p@ss" } });
    if (parsed.status === "ok") expect(describeProxy(parsed.config)).toBe("socks5://user@[::1]:1080");
    expect(parseLegacyProxyString("proxy:8080")).toMatchObject({ config: { kind: "http", port: 8080 } });
  });
});

describe("redaction", () => {
  it("URLs keep scheme, host and the start of the path only", () => {
    expect(redactUrl("https://user:pw@cdn.example.com:8443/a/b/c/d/e?token=SECRET#frag")).toBe("https://cdn.example.com:8443/a/b/c/…?…");
    expect(redactUrl("https://x.test/" + "z".repeat(80))).toBe(`https://x.test/${"z".repeat(12)}…`);
    expect(redactUrl("not a url")).toBe("<invalid-url>");
  });

  it("sensitive headers are masked and credentials scrubbed from text", () => {
    expect(redactHeaders({ Authorization: "Bearer x", Cookie: "a=b", "Proxy-Authorization": "Basic y", Accept: "*/*" })).toEqual({ Authorization: "***", Cookie: "***", "Proxy-Authorization": "***", Accept: "*/*" });
    expect(redactText("connect socks5://bob:hunter2@10.0.0.1 failed ?token=abc&x=1", ["hunter2"])).toBe("connect socks5://***@10.0.0.1 failed ?token=***&x=1");
  });
});

describe("DoH resolution", () => {
  const answer = (records: object) => Buffer.from(JSON.stringify(records));

  it("takes only A/AAAA records whose data is really an IP, clamping TTLs", () => {
    const body = answer({ Status: 0, Answer: [{ type: 5, data: "cname.example.", TTL: 5 }, { type: 1, data: "93.184.216.34", TTL: 5 }, { type: 1, data: "not-an-ip", TTL: 5 }, { type: 28, data: "::1", TTL: 5 }] });
    expect(parseDohAnswer(body, 1)).toEqual({ addresses: ["93.184.216.34"], ttl: 30 });
    expect(parseDohAnswer(body, 28).addresses).toEqual(["::1"]);
    expect(() => parseDohAnswer(Buffer.from("<html>"), 1)).toThrow();
    expect(() => parseDohAnswer(answer({ Status: 2 }), 1)).toThrow();
  });

  it("proxy endpoints are IP literals, so asking them needs no DNS lookup", () => {
    for (const endpoint of PROXY_DOH_ENDPOINTS) expect(/^https:\/\/\d+\.\d+\.\d+\.\d+\//.test(endpoint)).toBe(true);
  });

  it("tries endpoints in order, caches by TTL, and fails closed without a fallback", async () => {
    const asked: string[] = [];
    let now = 0;
    const resolver = dohResolver({
      mode: "doh-via-proxy",
      endpoints: ["https://1.1.1.1/dns-query", "https://8.8.8.8/resolve"],
      now: () => now,
      query: async (url) => {
        asked.push(url);
        if (url.startsWith("https://1.1.1.1")) throw new NetError("proxy-failed", "down");
        return { status: 200, body: answer({ Status: 0, Answer: url.includes("type=A&") || url.endsWith("type=A") ? [{ type: 1, data: "93.184.216.34", TTL: 120 }] : [] }) };
      },
    });
    expect(await resolver.resolve("example.com")).toEqual(["93.184.216.34"]);
    const count = asked.length;
    expect(await resolver.resolve("EXAMPLE.com")).toEqual(["93.184.216.34"]);
    expect(asked.length).toBe(count); // cached
    now += 121_000;
    await resolver.resolve("example.com");
    expect(asked.length).toBeGreaterThan(count);

    const dead = dohResolver({ mode: "doh-via-proxy", endpoints: PROXY_DOH_ENDPOINTS, query: async () => Promise.reject(new Error("down")) });
    await expect(dead.resolve("example.com")).rejects.toMatchObject({ code: "dns-failed" });
  });

  it("direct DoH keeps its documented fallback to the system resolver", async () => {
    const resolver = dohResolver({
      mode: "doh-direct",
      endpoints: ["https://dns.google/resolve"],
      query: async () => Promise.reject(new Error("blocked")),
      fallback: systemResolver(async () => ["93.184.216.34"]),
    });
    expect(await resolver.resolve("example.com")).toEqual(["93.184.216.34"]);
  });
});
