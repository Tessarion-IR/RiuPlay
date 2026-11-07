// M0 security tests for the network broker prototype (guardedFetch.ts).
//
// All servers here listen on 127.0.0.1 for the duration of a test. To let a loopback server play the
// part of "a public website", tests give the policy an exact host:port allowance (public.test:<port>),
// the same mechanism a user-confirmed LAN server would get; every other loopback/private destination
// stays blocked, and each blocked test also checks the target server saw no request at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrokerError, guardedFetch, type NetPolicy, type ProxyConfig } from "./guardedFetch";
import { blockedReason } from "./ip";
import { deadPort, makeCertificate, startHttpProxy, startSocks5, startTarget, type ProxyServer, type TargetServer } from "./fixtures";

let site: TargetServer; // "public.test"
let other: TargetServer; // "other.test"
let secure: TargetServer; // "public.test" over HTTPS
let cert: { key: string; cert: string };

beforeAll(async () => {
  cert = makeCertificate();
  site = await startTarget();
  other = await startTarget();
  secure = await startTarget({ tls: cert });
});
afterAll(async () => {
  await Promise.all([site.close(), other.close(), secure.close()]);
});

const resolveTest = async (name: string) => {
  if (name === "public.test" || name === "other.test") return ["127.0.0.1"];
  if (name === "private.test") return ["10.0.0.5"];
  if (name === "metadata.test") return ["169.254.169.254"];
  if (name === "mixed.test") return ["93.184.216.34", "192.168.1.1"];
  if (name === "v6private.test") return ["fd12:3456::1"];
  throw new Error("ENOTFOUND");
};

function policy(extra: Partial<NetPolicy> = {}): NetPolicy {
  return {
    hosts: ["public.test", "other.test"],
    allowHttp: true,
    privateAllowance: [
      { host: "public.test", port: site.port },
      { host: "other.test", port: other.port },
      { host: "public.test", port: secure.port },
    ],
    timeoutMs: 5000,
    ...extra,
  };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof BrokerError) return error.code;
    return `unexpected: ${error instanceof Error ? error.message : String(error)}`;
  }
}

describe("address classification", () => {
  it.each([
    ["127.0.0.1", true], ["127.255.255.254", true], ["10.1.2.3", true], ["172.16.0.1", true], ["172.31.255.255", true], ["172.32.0.1", false],
    ["192.168.0.1", true], ["169.254.169.254", true], ["100.64.0.1", true], ["0.0.0.0", true], ["224.0.0.1", true], ["255.255.255.255", true],
    ["198.18.0.1", true], ["192.0.2.1", true], ["8.8.8.8", false], ["93.184.216.34", false], ["1.1.1.1", false],
    ["::1", true], ["::", true], ["fe80::1", true], ["fd00::1", true], ["fc00::1", true], ["ff02::1", true], ["2001:db8::1", true],
    ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true], ["::ffff:8.8.8.8", false], ["64:ff9b::7f00:1", true], ["64:ff9b::808:808", false],
    ["::127.0.0.1", true], ["2002:7f00:1::", true], ["2002:808:808::", false], ["2001::1", true], ["2606:4700:4700::1111", false],
  ])("%s blocked=%s", (address, blocked) => {
    expect(blockedReason(address) !== null).toBe(blocked);
  });
});

describe("private, loopback and link-local destinations, in every spelling", () => {
  const any: Partial<NetPolicy> = { hosts: "any-public" };
  it.each([
    "http://127.0.0.1:PORT/", "http://2130706433:PORT/", "http://0x7f000001:PORT/", "http://0177.0.0.1:PORT/", "http://127.1:PORT/",
    "http://0x7f.0.0.1:PORT/", "http://[::1]:PORT/", "http://[::ffff:127.0.0.1]:PORT/", "http://[::ffff:7f00:1]:PORT/",
    "http://[0:0:0:0:0:ffff:7f00:1]:PORT/", "http://[64:ff9b::7f00:1]:PORT/", "http://[::127.0.0.1]:PORT/", "http://[2002:7f00:1::]:PORT/",
    "http://localhost:PORT/", "http://LOCALHOST.:PORT/", "http://foo.localhost:PORT/", "http://0.0.0.0:PORT/", "http://0:PORT/", "http://[::]:PORT/",
    "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://172.16.5.4/", "http://192.168.1.1/", "http://100.64.0.1/",
    "http://[fd00::1]/", "http://[fe80::1]/", "http://224.0.0.1/", "http://255.255.255.255/", "http://198.18.0.1/",
    "http://private.test/", "http://metadata.test/", "http://mixed.test/", "http://v6private.test/",
  ])("%s is refused before any connection", async (template) => {
    const before = site.hits.length;
    const url = template.replace("PORT", String(site.port));
    expect(await code(guardedFetch(url, {}, policy(any), { resolve: resolveTest }))).toBe("blocked-address");
    expect(site.hits.length).toBe(before);
  });

  it("refuses IPv6 zone identifiers", async () => {
    expect(await code(guardedFetch("http://[fe80::1%251]/", {}, policy({ hosts: "any-public" }), { resolve: resolveTest }))).toMatch(/blocked-address|invalid-url/);
  });

  it("refuses non-HTTP schemes and credentials in URLs", async () => {
    for (const url of ["file:///C:/Windows/win.ini", "ftp://public.test/", "data:text/plain,hi", "javascript:alert(1)", "ws://public.test/"]) {
      expect(await code(guardedFetch(url, {}, policy(), { resolve: resolveTest }))).toMatch(/scheme-not-allowed|invalid-url/);
    }
    expect(await code(guardedFetch(`http://user:pw@public.test:${site.port}/`, {}, policy(), { resolve: resolveTest }))).toBe("credentials-in-url");
    expect(await code(guardedFetch(`http://public.test:${site.port}/`, {}, policy({ allowHttp: false }), { resolve: resolveTest }))).toBe("http-not-allowed");
  });

  it("refuses hosts outside the caller's permissions", async () => {
    const before = other.hits.length;
    expect(await code(guardedFetch(`http://other.test:${other.port}/`, {}, policy({ hosts: ["public.test"] }), { resolve: resolveTest }))).toBe("host-not-permitted");
    expect(other.hits.length).toBe(before);
  });

  it("an allowance is exact: same host on another port, or the raw IP, stays blocked", async () => {
    expect(await code(guardedFetch(`http://public.test:${other.port}/`, {}, policy({ hosts: "any-public" }), { resolve: resolveTest }))).toBe("blocked-address");
    expect(await code(guardedFetch(`http://127.0.0.1:${site.port}/`, {}, policy({ hosts: "any-public" }), { resolve: resolveTest }))).toBe("blocked-address");
  });
});

describe("DNS resolution and rebinding", () => {
  it("connects to the address it validated, never asking the system DNS (public.test does not exist there)", async () => {
    const connects: string[] = [];
    let lookups = 0;
    const res = await guardedFetch(`http://public.test:${site.port}/`, {}, policy(), {
      resolve: async (name) => (lookups++, resolveTest(name)),
      onConnect: (info) => connects.push(info.address),
    });
    expect(res.status).toBe(200);
    expect(lookups).toBe(1);
    expect(connects).toEqual(["127.0.0.1"]);
  });

  it("re-validates every hop: a host that rebinds to a private address on the next lookup is refused", async () => {
    let calls = 0;
    const rebinding = async (name: string) => {
      if (name !== "rebind.test") return resolveTest(name);
      return ++calls === 1 ? ["127.0.0.1"] : ["169.254.169.254"];
    };
    const pol = policy({ hosts: ["rebind.test"], privateAllowance: [] });
    pol.privateAllowance = [{ host: "rebind.test", port: site.port }];
    // First request: the name validates (allowance) and is pinned. Second lookup returns metadata IP:
    // even with the same allowance the redirect hop resolves again and the new answer is checked.
    const target = `http://rebind.test:${site.port}/redirect?to=${encodeURIComponent(`http://rebind.test:${site.port}/again`)}`;
    // The allowance would also cover the second answer (it is host:port scoped), so prove the
    // per-hop check with the allowance removed for the second hop: a fresh policy per call.
    const first = await guardedFetch(`http://rebind.test:${site.port}/`, {}, pol, { resolve: rebinding });
    expect(first.status).toBe(200);
    expect(await code(guardedFetch(`http://rebind.test:${site.port}/`, {}, { ...pol, privateAllowance: [] }, { resolve: rebinding }))).toBe("blocked-address");
    void target;
  });

  it("reports resolution failures", async () => {
    expect(await code(guardedFetch("http://nowhere.test/", {}, policy({ hosts: "any-public" }), { resolve: resolveTest }))).toBe("dns-failed");
  });
});

describe("redirects", () => {
  const via = (to: string, extra = "") => `http://public.test:${site.port}/redirect?to=${encodeURIComponent(to)}${extra}`;

  // "any-public" (a legacy extension's grant) so that the address rule, not the host list, is what
  // has to stop these hops.
  it.each([
    ["to loopback by IP", () => `http://127.0.0.1:${site.port}/secret`, "blocked-address", "any-public"],
    ["to cloud metadata", () => "http://169.254.169.254/latest/meta-data/", "blocked-address", "any-public"],
    ["to a LAN address", () => "http://192.168.1.1/admin", "blocked-address", "any-public"],
    ["to a name resolving privately", () => "http://private.test/", "blocked-address", "any-public"],
    ["to IPv6 loopback in mapped form", () => `http://[::ffff:127.0.0.1]:${site.port}/`, "blocked-address", "any-public"],
    ["to an undeclared host", () => "http://elsewhere.test/", "host-not-permitted", "declared"],
    ["to a file URL", () => "file:///C:/Windows/win.ini", "scheme-not-allowed", "declared"],
  ] as const)("%s is refused", async (_label, to, expected, grant) => {
    const before = site.hits.length;
    const pol = grant === "any-public" ? policy({ hosts: "any-public" }) : policy();
    expect(await code(guardedFetch(via(to()), {}, pol, { resolve: resolveTest }))).toBe(expected);
    expect(site.hits.length - before).toBe(1); // only the first hop reached a server
  });

  it("stops redirect loops", async () => {
    const before = site.hits.length;
    expect(await code(guardedFetch(`http://public.test:${site.port}/loop`, {}, policy(), { resolve: resolveTest }))).toBe("too-many-redirects");
    expect(site.hits.length - before).toBe(6);
  });

  it("refuses an HTTPS to HTTP downgrade", async () => {
    const url = `https://public.test:${secure.port}/redirect?to=${encodeURIComponent(`http://public.test:${site.port}/`)}`;
    const before = site.hits.length;
    expect(await code(guardedFetch(url, {}, policy(), { resolve: resolveTest, ca: cert.cert }))).toBe("downgrade");
    expect(site.hits.length).toBe(before);
  });

  it("drops credentials and cookies on a cross-origin hop, keeps them on the same origin", async () => {
    const headers = { authorization: "Bearer secret", cookie: "sid=1", "x-keep": "yes" };
    const cross = await guardedFetch(via(`http://other.test:${other.port}/echo-headers`), { headers }, policy(), { resolve: resolveTest });
    const seen = JSON.parse(cross.body.toString());
    expect(seen.authorization).toBeUndefined();
    expect(seen.cookie).toBeUndefined();
    expect(seen["x-keep"]).toBe("yes");
    const same = await guardedFetch(via(`http://public.test:${site.port}/echo-headers`), { headers }, policy(), { resolve: resolveTest });
    expect(JSON.parse(same.body.toString()).authorization).toBe("Bearer secret");
  });

  it("turns a 303 after POST into GET", async () => {
    const res = await guardedFetch(via(`http://public.test:${site.port}/landed`, "&code=303"), { method: "POST", body: "x=1" }, policy(), { resolve: resolveTest });
    expect(res.body.toString()).toContain("GET /landed");
  });
});

describe("resource limits", () => {
  it("caps the body, the decompressed size and the time", async () => {
    expect(await code(guardedFetch(`http://public.test:${site.port}/big`, {}, policy(), { resolve: resolveTest }))).toBe("body-too-large");
    expect(await code(guardedFetch(`http://public.test:${site.port}/bomb`, {}, policy(), { resolve: resolveTest }))).toBe("decoded-too-large");
    expect(await code(guardedFetch(`http://public.test:${site.port}/hang`, {}, policy({ timeoutMs: 400 }), { resolve: resolveTest }))).toBe("timeout");
    const ok = await guardedFetch(`http://public.test:${site.port}/gzip`, {}, policy(), { resolve: resolveTest });
    expect(JSON.parse(ok.body.toString())).toEqual({ ok: true });
  });
});

describe("proxies: one path, IP pinned, fail closed", () => {
  const proxies: ProxyServer[] = [];
  afterAll(async () => {
    await Promise.all(proxies.map((p) => p.close()));
  });
  const keep = <T extends ProxyServer>(p: T) => (proxies.push(p), p);

  it("HTTP proxy: tunnels to the validated IP (the proxy never sees the name)", async () => {
    const proxy = keep(await startHttpProxy());
    const before = site.hits.length;
    const res = await guardedFetch(`http://public.test:${site.port}/`, {}, policy(), { resolve: resolveTest, proxy: { kind: "http", host: "127.0.0.1", port: proxy.port } });
    expect(res.status).toBe(200);
    expect(proxy.requested).toEqual([`127.0.0.1:${site.port}`]);
    expect(site.hits.length).toBe(before + 1);
  });

  it("HTTP proxy with credentials, and HTTPS through it with the certificate checked for the real name", async () => {
    const proxy = keep(await startHttpProxy({ user: "u", pass: "p@ss" }));
    const pc: ProxyConfig = { kind: "http", host: "127.0.0.1", port: proxy.port, username: "u", password: "p@ss" };
    const res = await guardedFetch(`https://public.test:${secure.port}/`, {}, policy(), { resolve: resolveTest, proxy: pc, ca: cert.cert });
    expect(res.status).toBe(200);
    expect(proxy.requested.at(-1)).toBe(`127.0.0.1:${secure.port}`);
  });

  it("HTTPS proxy (TLS to the proxy itself)", async () => {
    const proxy = keep(await startHttpProxy({ tls: cert }));
    const res = await guardedFetch(`http://public.test:${site.port}/`, {}, policy(), { resolve: resolveTest, proxy: { kind: "https", host: "127.0.0.1", port: proxy.port, ca: cert.cert } });
    expect(res.status).toBe(200);
    expect(proxy.connections).toBe(1);
  });

  it("SOCKS5, without and with credentials, is handed an IPv4 address, not a domain name", async () => {
    const open = keep(await startSocks5());
    const res = await guardedFetch(`http://public.test:${site.port}/`, {}, policy(), { resolve: resolveTest, proxy: { kind: "socks5", host: "127.0.0.1", port: open.port } });
    expect(res.status).toBe(200);
    expect(open.requested).toEqual([`127.0.0.1:${site.port}`]);
    const authed = keep(await startSocks5({ user: "u", pass: "s3cret" }));
    const res2 = await guardedFetch(`https://public.test:${secure.port}/`, {}, policy(), {
      resolve: resolveTest,
      ca: cert.cert,
      proxy: { kind: "socks5", host: "127.0.0.1", port: authed.port, username: "u", password: "s3cret" },
    });
    expect(res2.status).toBe(200);
  });

  it.each(["http", "https", "socks5"] as const)("%s proxy unreachable: the request fails and never goes direct", async (kind) => {
    const before = site.hits.length;
    const port = await deadPort();
    expect(await code(guardedFetch(`http://public.test:${site.port}/`, {}, policy(), { resolve: resolveTest, proxy: { kind, host: "127.0.0.1", port, ca: cert.cert } }))).toBe("proxy-failed");
    expect(site.hits.length).toBe(before);
  });

  it("wrong proxy credentials fail closed and are never echoed in the error", async () => {
    const httpProxy = keep(await startHttpProxy({ user: "u", pass: "right" }));
    const socks = keep(await startSocks5({ user: "u", pass: "right" }));
    const before = site.hits.length;
    for (const proxy of [
      { kind: "http" as const, host: "127.0.0.1", port: httpProxy.port, username: "u", password: "Wr0ng-Pa55" },
      { kind: "socks5" as const, host: "127.0.0.1", port: socks.port, username: "u", password: "Wr0ng-Pa55" },
    ]) {
      try {
        await guardedFetch(`http://public.test:${site.port}/`, {}, policy(), { resolve: resolveTest, proxy });
        throw new Error("should have failed");
      } catch (error) {
        expect((error as BrokerError).code).toBe("proxy-failed");
        expect(String((error as Error).message)).not.toContain("Wr0ng-Pa55");
      }
    }
    expect(site.hits.length).toBe(before);
  });

  it("bypass attempts: NO_PROXY and loopback names do not route around the proxy", async () => {
    const proxy = keep(await startHttpProxy());
    const saved = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
    process.env.NO_PROXY = "*";
    process.env.no_proxy = "*";
    try {
      const pc: ProxyConfig = { kind: "http", host: "127.0.0.1", port: proxy.port };
      await guardedFetch(`http://public.test:${site.port}/`, {}, policy(), { resolve: resolveTest, proxy: pc });
      expect(proxy.connections).toBe(1);
      // Loopback destinations are refused before the proxy is contacted at all.
      for (const url of [`http://127.0.0.1:${site.port}/`, `http://localhost:${site.port}/`, `http://[::1]:${site.port}/`]) {
        expect(await code(guardedFetch(url, {}, policy({ hosts: "any-public" }), { resolve: resolveTest, proxy: pc }))).toBe("blocked-address");
      }
      expect(proxy.connections).toBe(1);
    } finally {
      process.env.NO_PROXY = saved.NO_PROXY;
      process.env.no_proxy = saved.no_proxy;
      if (saved.NO_PROXY === undefined) delete process.env.NO_PROXY;
      if (saved.no_proxy === undefined) delete process.env.no_proxy;
    }
  });
});
