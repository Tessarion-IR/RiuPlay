// RiuPlay M3: adversarial tests for the controlled request path (client.ts + connector.ts).
//
// All servers listen on 127.0.0.1 for the duration of a test. Most tests use a "lab" classifier in
// which 127.0.0.1 alone stands in for a public website (every other loopback/private/link-local
// address keeps its real classification); the address-spelling tests use the real classifier with
// no exceptions. Every refusal also checks the target server saw no request at all.
import dnsCallback from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { blockedReason } from "./addresses";
import { NetClient, type ControlledRequest, type ProxyState } from "./client";
import { NetError } from "./errors";
import { parseCaller, type Caller, type LocalServerAllowance } from "./policy";
import type { ProxyConfig } from "./proxy";
import { dohResolver, type Resolver } from "./resolve";
import { deadPort, makeCertificate, startDoh, startHttpProxy, startSocks5, startTarget, type ProxyServer, type TargetServer } from "./testing/fixtures";

let site: TargetServer; // "public.test"
let other: TargetServer; // "other.test"
let secure: TargetServer; // "public.test" over HTTPS
let cert: { key: string; cert: string };
const proxies: ProxyServer[] = [];
const keep = <T extends ProxyServer>(p: T) => (proxies.push(p), p);

beforeAll(async () => {
  cert = makeCertificate();
  site = await startTarget();
  other = await startTarget();
  secure = await startTarget({ tls: cert });
});
afterAll(async () => {
  await Promise.all([site.close(), other.close(), secure.close(), ...proxies.map((p) => p.close())]);
});
afterEach(() => vi.restoreAllMocks());

/** Lookups of anything but an IP literal - a name leaking to the system resolver. (Node may pass an
 * IP literal such as the proxy's own 127.0.0.1 through lookup; that reveals nothing.) */
const nameLookups = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0])).filter((h) => net.isIP(h) === 0);

const lab = (address: string) => (address === "127.0.0.1" ? null : blockedReason(address));

const table: Record<string, string[]> = {
  "public.test": ["127.0.0.1"],
  "other.test": ["127.0.0.1"],
  "private.test": ["10.0.0.5"],
  "metadata.test": ["169.254.169.254"],
  "mixed.test": ["93.184.216.34", "192.168.1.1"],
  "v6private.test": ["fd12:3456::1"],
  "mapped.test": ["::ffff:10.0.0.1"],
  "garbage.test": ["not-an-ip"],
};
function resolverFrom(map: Record<string, string[]> = table, counter?: { n: number }): Resolver {
  return {
    mode: "system",
    resolve: async (host) => {
      if (counter) counter.n++;
      const hit = map[host];
      if (!hit) throw new NetError("dns-failed", `could not resolve ${host}`);
      return hit;
    },
  };
}

const ext: Caller = { kind: "extension", sourceId: "test-source" };
function labClient(extra: ConstructorParameters<typeof NetClient>[0] = {}) {
  return new NetClient({ resolver: () => resolverFrom(), classify: lab, ca: cert.cert, defaultTimeoutMs: 5_000, connectTimeoutMs: 2_000, ...extra });
}
function strictClient(extra: ConstructorParameters<typeof NetClient>[0] = {}) {
  return new NetClient({ resolver: () => resolverFrom(), defaultTimeoutMs: 5_000, connectTimeoutMs: 2_000, ...extra });
}
const get = (client: NetClient, url: string, more: Partial<ControlledRequest> = {}) => client.request({ url, caller: ext, ...more });

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (error instanceof NetError) return error.code;
    return `unexpected: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
  }
}

describe("private, loopback and link-local destinations, in every spelling (real classifier)", () => {
  it.each([
    "http://127.0.0.1:PORT/", "http://2130706433:PORT/", "http://0x7f000001:PORT/", "http://0177.0.0.1:PORT/", "http://127.1:PORT/",
    "http://0x7f.0.0.1:PORT/", "http://[::1]:PORT/", "http://[::ffff:127.0.0.1]:PORT/", "http://[::ffff:7f00:1]:PORT/",
    "http://[0:0:0:0:0:ffff:7f00:1]:PORT/", "http://[64:ff9b::7f00:1]:PORT/", "http://[64:ff9b:1::7f00:1]:PORT/", "http://[::127.0.0.1]:PORT/", "http://[2002:7f00:1::]:PORT/",
    "http://localhost:PORT/", "http://LOCALHOST.:PORT/", "http://foo.localhost:PORT/", "http://0.0.0.0:PORT/", "http://0:PORT/", "http://[::]:PORT/",
    "http://169.254.169.254/latest/meta-data/", "http://[fd00:ec2::254]/latest/meta-data/", "http://10.0.0.1/", "http://172.16.5.4/", "http://192.168.1.1/", "http://100.64.0.1/",
    "http://[fd00::1]/", "http://[fe80::1]/", "http://[fec0::1]/", "http://224.0.0.1/", "http://255.255.255.255/", "http://198.18.0.1/", "http://[2001::1]/", "http://[ff02::1]/",
    "http://private.test/", "http://metadata.test/", "http://mixed.test/", "http://v6private.test/", "http://mapped.test/",
  ])("%s is refused before any connection", async (template) => {
    const before = site.hits.length;
    const connects: string[] = [];
    const client = strictClient({ onConnect: (i) => connects.push(i.address) });
    expect(await code(get(client, template.replace("PORT", String(site.port))))).toBe("blocked-address");
    expect(site.hits.length).toBe(before);
    expect(connects).toEqual([]);
  });

  it("refuses IPv6 zone identifiers", async () => {
    expect(await code(get(strictClient(), "http://[fe80::1%251]/"))).toMatch(/blocked-address|invalid-url/);
  });

  it("refuses non-HTTP schemes, credentials in URLs and garbage", async () => {
    const client = labClient();
    for (const url of ["file:///C:/Windows/win.ini", "ftp://public.test/", "data:text/plain,hi", "javascript:alert(1)", "ws://public.test/", "chrome://settings", "riuplay-media://x"]) {
      expect(await code(get(client, url))).toMatch(/scheme-not-allowed|invalid-url/);
    }
    expect(await code(get(client, `http://user:pw@public.test:${site.port}/`))).toBe("credentials-in-url");
    expect(await code(get(client, "not a url"))).toBe("invalid-url");
    expect(await code(get(client, "http://"))).toBe("invalid-url");
  });

  it("refuses a resolver answer that is not an IP address", async () => {
    expect(await code(get(labClient(), "http://garbage.test/"))).toBe("dns-failed");
  });

  it("reports resolution failures", async () => {
    expect(await code(get(labClient(), "http://nowhere.test/"))).toBe("dns-failed");
  });
});

describe("DNS pinning and rebinding", () => {
  it("connects to the address it validated, asking the resolver exactly once and never the system DNS", async () => {
    const lookup = vi.spyOn(dnsPromises, "lookup");
    const lookupCb = vi.spyOn(dnsCallback, "lookup");
    const counter = { n: 0 };
    const connects: string[] = [];
    const client = labClient({ resolver: () => resolverFrom(table, counter), onConnect: (i) => connects.push(i.address) });
    const res = await get(client, `http://public.test:${site.port}/`);
    expect(res.status).toBe(200);
    expect(counter.n).toBe(1);
    expect(connects).toEqual(["127.0.0.1"]);
    expect(nameLookups(lookup)).toEqual([]);
    expect(nameLookups(lookupCb)).toEqual([]);
    await client.resetConnections();
  });

  it("re-validates every hop: a name that rebinds to cloud metadata on the redirect is refused", async () => {
    let calls = 0;
    const rebinding: Resolver = { mode: "system", resolve: async () => (++calls === 1 ? ["127.0.0.1"] : ["169.254.169.254"]) };
    const before = site.hits.length;
    const url = `http://rebind.test:${site.port}/redirect?to=${encodeURIComponent(`http://rebind.test:${site.port}/again`)}`;
    expect(await code(get(labClient({ resolver: () => rebinding }), url))).toBe("blocked-address");
    expect(site.hits.length - before).toBe(1);
    expect(calls).toBe(2);
  });

  it("re-validates on every request: a later answer pointing at a private address is refused", async () => {
    let calls = 0;
    const rebinding: Resolver = { mode: "system", resolve: async () => (++calls === 1 ? ["127.0.0.1"] : ["10.1.2.3"]) };
    const client = labClient({ resolver: () => rebinding });
    expect((await get(client, `http://rebind.test:${site.port}/`)).status).toBe(200);
    expect(await code(get(client, `http://rebind.test:${site.port}/`))).toBe("blocked-address");
    await client.resetConnections();
  });

  it("a mixed public/private answer is refused outright", async () => {
    expect(await code(get(labClient(), "http://mixed.test/"))).toBe("blocked-address");
  });
});

describe("redirects", () => {
  const via = (to: string, extra = "") => `http://public.test:${site.port}/redirect?to=${encodeURIComponent(to)}${extra}`;

  it.each([
    ["to another loopback address", (): string => `http://127.0.0.2:${site.port}/secret`],
    ["to cloud metadata", (): string => "http://169.254.169.254/latest/meta-data/"],
    ["to a LAN address", (): string => "http://192.168.1.1/admin"],
    ["to a name resolving privately", (): string => "http://private.test/"],
    ["to IPv6 loopback", (): string => `http://[::1]:${site.port}/`],
    ["to IPv4-mapped private", (): string => "http://[::ffff:10.0.0.1]/"],
    ["to localhost", (): string => `http://localhost:${site.port}/`],
  ] as const)("%s is refused", async (_label, to) => {
    const before = site.hits.length;
    expect(await code(get(labClient(), via(to())))).toBe("blocked-address");
    expect(site.hits.length - before).toBe(1); // only the first hop reached a server
  });

  it.each([["file:///C:/Windows/win.ini"], ["ftp://public.test/x"], ["data:text/html,hi"]])("a redirect to %s is refused", async (to) => {
    expect(await code(get(labClient(), via(to)))).toMatch(/scheme-not-allowed|invalid-url/);
  });

  it("stops redirect loops after five hops", async () => {
    const before = site.hits.length;
    expect(await code(get(labClient(), `http://public.test:${site.port}/loop`))).toBe("too-many-redirects");
    expect(site.hits.length - before).toBe(6);
  });

  it("refuses an HTTPS to HTTP downgrade before contacting the HTTP target", async () => {
    const url = `https://public.test:${secure.port}/redirect?to=${encodeURIComponent(`http://public.test:${site.port}/`)}`;
    const before = site.hits.length;
    expect(await code(get(labClient(), url))).toBe("downgrade");
    expect(site.hits.length).toBe(before);
  });

  it("drops credentials and cookies on a cross-origin hop (including port change), keeps them on the same origin", async () => {
    const headers = { Authorization: "Bearer secret", Cookie: "sid=1", "Proxy-Authorization": "Basic x", "x-keep": "yes" };
    const cross = await get(labClient(), via(`http://other.test:${other.port}/echo-headers`), { headers });
    const seen = JSON.parse(cross.body.toString());
    expect(seen.authorization).toBeUndefined();
    expect(seen.cookie).toBeUndefined();
    expect(seen["proxy-authorization"]).toBeUndefined();
    expect(seen["x-keep"]).toBe("yes");
    const same = await get(labClient(), via(`http://public.test:${site.port}/echo-headers`), { headers });
    const sameSeen = JSON.parse(same.body.toString());
    expect(sameSeen.authorization).toBe("Bearer secret");
    expect(sameSeen.cookie).toBe("sid=1");
    expect(sameSeen["proxy-authorization"]).toBeUndefined(); // never forwarded by the transport
  });

  it("turns a 303 after POST into GET, and a 302 after POST into GET without the body", async () => {
    const res = await get(labClient(), via(`http://public.test:${site.port}/landed`, "&code=303"), { method: "POST", body: "x=1", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(res.body.toString()).toContain("GET /landed");
    const res2 = await get(labClient(), via(`http://public.test:${site.port}/landed2`, "&code=302"), { method: "POST", body: "x=1" });
    expect(res2.body.toString()).toContain("GET /landed2");
  });

  it('redirect: "manual" answers with the 3xx itself and does not follow it', async () => {
    const before = other.hits.length;
    const res = await get(labClient(), via(`http://other.test:${other.port}/`), { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.location?.[0]).toBe(`http://other.test:${other.port}/`);
    expect(other.hits.length).toBe(before);
  });

  it("the deadline covers the whole redirect chain", async () => {
    expect(await code(get(labClient(), via(`http://public.test:${site.port}/hang`), { timeoutMs: 400 }))).toBe("timeout");
  });
});

describe("response limits and timeouts", () => {
  it("caps an extension's body (8 MB), decompressed size (32 MB) and time", async () => {
    const client = labClient();
    expect(await code(get(client, `http://public.test:${site.port}/big`))).toBe("body-too-large");
    expect(await code(get(client, `http://public.test:${site.port}/bomb`))).toBe("decoded-too-large");
    expect(await code(get(client, `http://public.test:${site.port}/hang`, { timeoutMs: 400 }))).toBe("timeout");
    const ok = await get(client, `http://public.test:${site.port}/gzip`);
    expect(JSON.parse(ok.body.toString())).toEqual({ ok: true });
    await client.resetConnections();
  }, 30_000);

  it("app requests get the larger 32 MB cap", async () => {
    const res = await labClient().request({ url: `http://public.test:${site.port}/big`, caller: { kind: "app", purpose: "test" } });
    expect(res.body.length).toBe(9 * 1024 * 1024);
  });

  it("a caller's abort signal is reported as aborted", async () => {
    const controller = new AbortController();
    const pending = get(labClient(), `http://public.test:${site.port}/hang`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expect(await code(pending)).toBe("aborted");
  });

  it("a connect that hangs times out (blackholed address via the lab)", async () => {
    // A listening socket that never accepts at TLS level: the TLS handshake stalls.
    const server = net.createServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await code(get(labClient({ connectTimeoutMs: 300 }), `https://public.test:${port}/`))).toBe("timeout");
    } finally {
      server.close();
    }
  });

  it("streams downloads without the body cap, decoding gzip, and releases the slot at the end", async () => {
    const client = labClient();
    const res = await client.stream({ url: `http://public.test:${site.port}/big`, caller: { kind: "download" } });
    let total = 0;
    for await (const chunk of res.body) total += (chunk as Buffer).length;
    expect(total).toBe(9 * 1024 * 1024);
    expect(client.budgets.snapshot({ kind: "download" }).inFlight).toBe(0);
    const gz = await client.stream({ url: `http://public.test:${site.port}/gzip`, caller: { kind: "download" } });
    const parts: Buffer[] = [];
    for await (const chunk of gz.body) parts.push(chunk as Buffer);
    expect(JSON.parse(Buffer.concat(parts).toString())).toEqual({ ok: true });
    await client.resetConnections();
  });

  it("an extension stream is still capped", async () => {
    const res = await labClient().stream({ url: `http://public.test:${site.port}/big`, caller: ext });
    let error: unknown;
    try {
      for await (const _ of res.body) void _;
    } catch (e) {
      error = e;
    }
    expect((error as NetError).code).toBe("body-too-large");
  });
});

describe("concurrency abuse and budgets", () => {
  let slow: TargetServer;
  let active = 0;
  let peak = 0;
  beforeAll(async () => {
    slow = await startTarget({
      handler: (_req, res) => {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active--;
          res.writeHead(200).end("ok");
        }, 60);
      },
    });
  });
  afterAll(() => slow.close());

  it("one extension: at most 8 in flight, 64 queued, the rest refused; another extension is unaffected", async () => {
    peak = 0;
    const client = labClient();
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => code(get(client, `http://public.test:${slow.port}/${i}`))));
    expect(peak).toBeLessThanOrEqual(8);
    expect(results.filter((r) => r === "ok").length).toBe(60); // 8 + 64 would be 72, but the rate burst is 60
    expect(results.filter((r) => r === "rate-limited" || r === "too-many-requests").length).toBe(40);
    // A different source still gets through at once.
    expect(await code(client.request({ url: `http://public.test:${slow.port}/x`, caller: { kind: "extension", sourceId: "other" } }))).toBe("ok");
    await client.resetConnections();
  });
});

describe("local-server allowance (designed for M4/M5 connections; never for extensions)", () => {
  const allowance = (): LocalServerAllowance => ({ connectionId: "suwayomi-1", scheme: "http", host: "127.0.0.1", port: site.port, approvedAt: 1 });

  it("lets exactly the approved connection reach exactly that scheme, host and port", async () => {
    const client = strictClient({ allowances: () => [allowance()] });
    const res = await client.request({ url: `http://127.0.0.1:${site.port}/`, caller: { kind: "connection", connectionId: "suwayomi-1" } });
    expect(res.status).toBe(200);
    await client.resetConnections();
  });

  it.each([
    ["an extension", { kind: "extension", sourceId: "suwayomi-1" } as Caller, () => `http://127.0.0.1:${site.port}/`],
    ["a download", { kind: "download" } as Caller, () => `http://127.0.0.1:${site.port}/`],
    ["an app request", { kind: "app", purpose: "x" } as Caller, () => `http://127.0.0.1:${site.port}/`],
    ["another connection", { kind: "connection", connectionId: "other" } as Caller, () => `http://127.0.0.1:${site.port}/`],
    ["the same connection on another port", { kind: "connection", connectionId: "suwayomi-1" } as Caller, () => `http://127.0.0.1:${other.port}/`],
    ["the same connection over https", { kind: "connection", connectionId: "suwayomi-1" } as Caller, () => `https://127.0.0.1:${site.port}/`],
    ["the same connection, other loopback spelling", { kind: "connection", connectionId: "suwayomi-1" } as Caller, () => `http://localhost:${site.port}/`],
    ["the same connection, other private host", { kind: "connection", connectionId: "suwayomi-1" } as Caller, () => "http://169.254.169.254/"],
  ])("refuses %s", async (_label, caller, url) => {
    const before = site.hits.length + other.hits.length;
    const client = strictClient({ allowances: () => [allowance()] });
    expect(await code(client.request({ url: url(), caller }))).toBe("blocked-address");
    expect(site.hits.length + other.hits.length).toBe(before);
  });

  it("a redirect from the allowed server to another private address is refused", async () => {
    const client = strictClient({ allowances: () => [allowance()] });
    const url = `http://127.0.0.1:${site.port}/redirect?to=${encodeURIComponent("http://169.254.169.254/")}`;
    expect(await code(client.request({ url, caller: { kind: "connection", connectionId: "suwayomi-1" } }))).toBe("blocked-address");
  });

  it("a caller tag from shared code can never claim to be a connection", () => {
    expect(parseCaller("connection:suwayomi-1").kind).toBe("app");
    expect(parseCaller("extension:abc")).toEqual({ kind: "extension", sourceId: "abc" });
    expect(parseCaller(undefined).kind).toBe("app");
    expect(parseCaller("download").kind).toBe("download");
  });
});

describe("proxies: one path, IP pinned, fail closed", () => {
  const withProxy = (config: ProxyConfig | ProxyState, extra: ConstructorParameters<typeof NetClient>[0] = {}) =>
    labClient({ proxy: () => ("status" in config ? config : { status: "ok", config }), ...extra });

  it("HTTP proxy: tunnels to the validated IP (the proxy never sees the name)", async () => {
    const proxy = keep(await startHttpProxy());
    const before = site.hits.length;
    const res = await get(withProxy({ kind: "http", host: "127.0.0.1", port: proxy.port }), `http://public.test:${site.port}/`);
    expect(res.status).toBe(200);
    expect(proxy.requested).toEqual([`127.0.0.1:${site.port}`]);
    expect(site.hits.length).toBe(before + 1);
  });

  it("HTTP proxy with credentials, and HTTPS through it with the certificate checked for the real name", async () => {
    const proxy = keep(await startHttpProxy({ user: "u", pass: "p@ss" }));
    const res = await get(withProxy({ kind: "http", host: "127.0.0.1", port: proxy.port, username: "u", password: "p@ss" }), `https://public.test:${secure.port}/`);
    expect(res.status).toBe(200);
    expect(proxy.requested.at(-1)).toBe(`127.0.0.1:${secure.port}`);
  });

  it("HTTPS through a proxy still verifies the target certificate (wrong name refused)", async () => {
    const proxy = keep(await startHttpProxy());
    const client = withProxy({ kind: "http", host: "127.0.0.1", port: proxy.port }, { resolver: () => resolverFrom({ "wrong.example": ["127.0.0.1"] }) });
    expect(await code(get(client, `https://wrong.example:${secure.port}/`))).toBe("connect-failed");
  });

  it("HTTPS proxy (TLS to the proxy itself)", async () => {
    const proxy = keep(await startHttpProxy({ tls: cert }));
    const res = await get(withProxy({ kind: "https", host: "127.0.0.1", port: proxy.port, ca: cert.cert }), `http://public.test:${site.port}/`);
    expect(res.status).toBe(200);
    expect(proxy.connections).toBe(1);
  });

  it("SOCKS5, without and with credentials, is handed an IP address, never a domain name", async () => {
    const open = keep(await startSocks5());
    const res = await get(withProxy({ kind: "socks5", host: "127.0.0.1", port: open.port }), `http://public.test:${site.port}/`);
    expect(res.status).toBe(200);
    expect(open.requested).toEqual([`127.0.0.1:${site.port}`]);
    const authed = keep(await startSocks5({ user: "u", pass: "s3cret" }));
    const res2 = await get(withProxy({ kind: "socks5", host: "127.0.0.1", port: authed.port, username: "u", password: "s3cret" }), `https://public.test:${secure.port}/`);
    expect(res2.status).toBe(200);
    expect(authed.requested.every((r) => !r.startsWith("domain:"))).toBe(true);
  });

  it.each(["http", "https", "socks5"] as const)("%s proxy unreachable: the request fails and never goes direct", async (kind) => {
    const before = site.hits.length;
    const connects: string[] = [];
    const port = await deadPort();
    const client = withProxy({ kind, host: "127.0.0.1", port, ca: cert.cert }, { onConnect: (i) => connects.push(i.via) });
    expect(await code(get(client, `http://public.test:${site.port}/`))).toBe("proxy-failed");
    expect(site.hits.length).toBe(before);
    expect(connects.every((v) => v === kind)).toBe(true);
  });

  it("a proxy that accepts but never answers CONNECT times out as proxy-failed, not direct", async () => {
    const silent = net.createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    const before = site.hits.length;
    try {
      const client = withProxy({ kind: "http", host: "127.0.0.1", port: (silent.address() as net.AddressInfo).port }, { connectTimeoutMs: 300 });
      expect(await code(get(client, `http://public.test:${site.port}/`))).toBe("proxy-failed");
      expect(site.hits.length).toBe(before);
    } finally {
      silent.close();
    }
  });

  it("a proxy that drops the tunnel mid-request fails; it is not retried direct", async () => {
    const dropping = http.createServer();
    dropping.on("connect", (_req, socket: net.Socket) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      setTimeout(() => socket.destroy(), 20);
    });
    await new Promise<void>((r) => dropping.listen(0, "127.0.0.1", r));
    const before = site.hits.length;
    try {
      const client = withProxy({ kind: "http", host: "127.0.0.1", port: (dropping.address() as net.AddressInfo).port });
      expect(await code(get(client, `http://public.test:${site.port}/`))).toMatch(/proxy-failed|connect-failed/);
      expect(site.hits.length).toBe(before);
    } finally {
      dropping.close();
    }
  });

  it("wrong proxy credentials (HTTP 407, SOCKS auth failure) fail closed and are never echoed", async () => {
    const httpProxy = keep(await startHttpProxy({ user: "u", pass: "right" }));
    const socks = keep(await startSocks5({ user: "u", pass: "right" }));
    const before = site.hits.length;
    for (const proxy of [
      { kind: "http" as const, host: "127.0.0.1", port: httpProxy.port, username: "u", password: "Wr0ng-Pa55" },
      { kind: "socks5" as const, host: "127.0.0.1", port: socks.port, username: "u", password: "Wr0ng-Pa55" },
    ]) {
      const error = await get(withProxy(proxy), `http://public.test:${site.port}/`).catch((e: unknown) => e);
      expect((error as NetError).code).toBe("proxy-failed");
      expect(String((error as Error).message)).not.toContain("Wr0ng-Pa55");
      expect(String((error as Error).message)).not.toContain(Buffer.from("u:Wr0ng-Pa55").toString("base64"));
    }
    expect(site.hits.length).toBe(before);
  });

  it.each([
    [{ status: "invalid", reason: "rule list" } as ProxyState, "proxy-invalid"],
    [{ status: "unavailable", reason: "password could not be decrypted" } as ProxyState, "proxy-unavailable"],
  ])("a configured but unusable proxy (%o) refuses every request without any connection", async (state, expected) => {
    const before = site.hits.length;
    const counter = { n: 0 };
    const connects: string[] = [];
    const client = withProxy(state, { resolver: () => resolverFrom(table, counter), onConnect: (i) => connects.push(i.address) });
    expect(await code(get(client, `http://public.test:${site.port}/`))).toBe(expected);
    expect(await code(client.stream({ url: `http://public.test:${site.port}/`, caller: { kind: "download" } }))).toBe(expected);
    expect(site.hits.length).toBe(before);
    expect(counter.n).toBe(0); // not even a DNS query
    expect(connects).toEqual([]);
  });

  it("NO_PROXY / HTTP(S)_PROXY environment variables do not route around (or change) the proxy", async () => {
    const proxy = keep(await startHttpProxy());
    const saved = { ...process.env };
    process.env.NO_PROXY = "*";
    process.env.no_proxy = "*";
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    try {
      const client = withProxy({ kind: "http", host: "127.0.0.1", port: proxy.port });
      await get(client, `http://public.test:${site.port}/`);
      expect(proxy.connections).toBe(1);
      for (const url of [`http://127.0.0.2:${site.port}/`, `http://localhost:${site.port}/`, `http://[::1]:${site.port}/`]) {
        expect(await code(get(client, url))).toBe("blocked-address");
      }
      expect(proxy.connections).toBe(1);
    } finally {
      for (const key of ["NO_PROXY", "no_proxy", "HTTP_PROXY"]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  it("an approved local server is reached directly, never through the outside proxy", async () => {
    const proxy = keep(await startHttpProxy());
    const client = new NetClient({
      resolver: () => resolverFrom(),
      proxy: () => ({ status: "ok", config: { kind: "http", host: "127.0.0.1", port: proxy.port } }),
      allowances: () => [{ connectionId: "c", scheme: "http", host: "127.0.0.1", port: site.port, approvedAt: 1 }],
    });
    const res = await client.request({ url: `http://127.0.0.1:${site.port}/`, caller: { kind: "connection", connectionId: "c" } });
    expect(res.status).toBe(200);
    expect(proxy.connections).toBe(0);
    await client.resetConnections();
  });
});

describe("DNS behind a proxy: DoH through the proxy, no leak, no fallback", () => {
  const neverResolve: Resolver = { mode: "system", resolve: async () => Promise.reject(new NetError("dns-failed", "IP literals only")) };

  async function proxiedSetup(kind: "http" | "socks5", dohPort: number) {
    const proxy = keep(kind === "http" ? await startHttpProxy() : await startSocks5());
    const config: ProxyConfig = { kind, host: "127.0.0.1", port: proxy.port };
    const dnsClient = labClient({ resolver: () => neverResolve, proxy: () => ({ status: "ok", config }) });
    const resolver = dohResolver({
      mode: "doh-via-proxy",
      endpoints: [`https://127.0.0.1:${dohPort}/dns-query`],
      query: (url, signal) => dnsClient.request({ url, caller: { kind: "app", purpose: "dns" }, headers: { Accept: "application/dns-json" }, signal }),
    });
    const client = labClient({ resolver: () => resolver, proxy: () => ({ status: "ok", config }) });
    return { proxy, client };
  }

  it.each(["http", "socks5"] as const)("%s proxy: the DNS query and the request both go through the proxy; the system resolver is never asked", async (kind) => {
    const doh = await startDoh(cert, { "public.test": { A: ["127.0.0.1"] } });
    const lookup = vi.spyOn(dnsPromises, "lookup");
    const lookupCb = vi.spyOn(dnsCallback, "lookup");
    try {
      const { proxy, client } = await proxiedSetup(kind, doh.port);
      const res = await get(client, `http://public.test:${site.port}/`);
      expect(res.status).toBe(200);
      expect(doh.queries).toContain("public.test/A");
      expect(proxy.requested).toContain(`127.0.0.1:${doh.port}`);
      expect(proxy.requested).toContain(`127.0.0.1:${site.port}`);
      expect(proxy.requested.some((r) => r.includes("public.test"))).toBe(false);
      expect(nameLookups(lookup)).toEqual([]);
      expect(nameLookups(lookupCb)).toEqual([]);
    } finally {
      await doh.close();
    }
  });

  it("DoH unreachable: the request fails with dns-failed - no fallback to the system resolver, no direct connection", async () => {
    const lookup = vi.spyOn(dnsPromises, "lookup");
    const before = site.hits.length;
    const { client } = await proxiedSetup("http", await deadPort());
    expect(await code(get(client, `http://public.test:${site.port}/`))).toBe("dns-failed");
    expect(nameLookups(lookup)).toEqual([]);
    expect(site.hits.length).toBe(before);
  });

  it("DoH answering with an error status fails closed", async () => {
    const doh = await startDoh(cert, {}, { status: 500 });
    try {
      const { client } = await proxiedSetup("http", doh.port);
      expect(await code(get(client, `http://public.test:${site.port}/`))).toBe("dns-failed");
    } finally {
      await doh.close();
    }
  });

  it("a DoH answer pointing at a private or metadata address is refused like any other", async () => {
    const doh = await startDoh(cert, { "evil.test": { A: ["169.254.169.254"] }, "evil6.test": { AAAA: ["fe80::1"] }, "cname.test": { A: ["10.0.0.1", "127.0.0.1"] } });
    try {
      const { client } = await proxiedSetup("http", doh.port);
      expect(await code(get(client, "http://evil.test/"))).toBe("blocked-address");
      expect(await code(get(client, "http://evil6.test/"))).toBe("blocked-address");
      expect(await code(get(client, `http://cname.test:${site.port}/`))).toBe("blocked-address");
    } finally {
      await doh.close();
    }
  });

  it("an NXDOMAIN answer is dns-failed", async () => {
    const doh = await startDoh(cert, {});
    try {
      const { client } = await proxiedSetup("http", doh.port);
      expect(await code(get(client, "http://nowhere.test/"))).toBe("dns-failed");
    } finally {
      await doh.close();
    }
  });
});

describe("errors never carry secrets or full URLs", () => {
  it("connect failures name a code, not the URL's query or path", async () => {
    const port = await deadPort();
    const error = await get(labClient(), `http://public.test:${port}/private/path?token=SECRET123`).catch((e: unknown) => e);
    expect((error as NetError).code).toBe("connect-failed");
    expect(String((error as Error).message)).not.toContain("SECRET123");
    expect(String((error as Error).message)).not.toContain("/private/path");
  });
});

describe("preflight: destination check without a request (stream URLs before Chromium loads them)", () => {
  it("applies the same address, scheme and DNS rules, and never connects", async () => {
    const connects: string[] = [];
    const before = site.hits.length;
    const client = labClient({ onConnect: (i) => connects.push(i.address) });
    expect(await client.preflight(`http://public.test:${site.port}/a.m3u8`, ext)).toEqual({ ok: true });
    for (const url of ["http://169.254.169.254/", "http://private.test/x", "http://mixed.test/", "http://localhost/x", "file:///C:/x", `http://u:p@public.test:${site.port}/`]) {
      expect((await client.preflight(url, ext)).ok).toBe(false);
    }
    expect(await client.preflight("http://metadata.test/", ext)).toEqual({ ok: false, code: "blocked-address" });
    expect(connects).toEqual([]);
    expect(site.hits.length).toBe(before);
  });

  it("refuses when the configured proxy is unusable", async () => {
    const client = labClient({ proxy: () => ({ status: "invalid", reason: "x" }) });
    expect(await client.preflight(`http://public.test:${site.port}/`, ext)).toEqual({ ok: false, code: "proxy-invalid" });
  });
});
