// RiuPlay M3 test fixtures - copied from research/m0/net/fixtures.ts (which stays unchanged so the
// M0 results remain reproducible), plus a fake DNS-over-HTTPS server. Loopback only, test-lifetime only.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export interface Hit {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

export interface TargetServer {
  port: number;
  hits: Hit[];
  close(): Promise<void>;
}

const OPENSSL = ["C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "openssl"].find((p) => p === "openssl" || fs.existsSync(p))!;

/** A throwaway certificate valid for the test host names and 127.0.0.1. */
export function makeCertificate(): { key: string; cert: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-m3-cert-"));
  try {
    execFileSync(OPENSSL, [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"),
      "-subj", "/CN=public.test",
      "-addext", "subjectAltName=DNS:public.test,DNS:other.test,DNS:proxy.test,IP:127.0.0.1",
    ], { stdio: "ignore" });
    return { key: fs.readFileSync(path.join(dir, "key.pem"), "utf-8"), cert: fs.readFileSync(path.join(dir, "cert.pem"), "utf-8") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, ctx: { port: number }) => void;

const defaultRoutes: Handler = (req, res, ctx) => {
  const url = new URL(req.url ?? "/", "http://x");
  const to = url.searchParams.get("to");
  if (url.pathname === "/redirect" && to) {
    res.writeHead(Number(url.searchParams.get("code") ?? 302), { location: to }).end();
  } else if (url.pathname === "/loop") {
    res.writeHead(302, { location: `/loop?n=${Number(url.searchParams.get("n") ?? 0) + 1}` }).end();
  } else if (url.pathname === "/big") {
    res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.alloc(9 * 1024 * 1024, 1));
  } else if (url.pathname === "/bomb") {
    // ~100 MB of zeros compresses to ~100 KB.
    res.writeHead(200, { "content-encoding": "gzip" }).end(zlib.gzipSync(Buffer.alloc(100 * 1024 * 1024)));
  } else if (url.pathname === "/gzip") {
    res.writeHead(200, { "content-encoding": "gzip", "content-type": "application/json" }).end(zlib.gzipSync(JSON.stringify({ ok: true })));
  } else if (url.pathname === "/hang") {
    // never answers
  } else if (url.pathname === "/echo-headers") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(req.headers));
  } else {
    res.writeHead(200, { "content-type": "text/plain" }).end(`hello from ${ctx.port} ${req.method} ${url.pathname}`);
  }
};

export async function startTarget(options: { tls?: { key: string; cert: string }; handler?: Handler } = {}): Promise<TargetServer> {
  const hits: Hit[] = [];
  let port = 0;
  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    hits.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    (options.handler ?? defaultRoutes)(req, res, { port });
  };
  const server = options.tls ? https.createServer(options.tls, onRequest) : http.createServer(onRequest);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as net.AddressInfo).port;
  return {
    port,
    hits,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

export interface ProxyServer {
  port: number;
  /** Every tunnel/connection target the proxy was asked for, as given by the client. */
  requested: string[];
  connections: number;
  close(): Promise<void>;
}

/** HTTP proxy that only tunnels (CONNECT), optionally requiring Basic credentials. */
export async function startHttpProxy(options: { user?: string; pass?: string; tls?: { key: string; cert: string } } = {}): Promise<ProxyServer> {
  const state = { requested: [] as string[], connections: 0 };
  const sockets = new Set<net.Socket>();
  const handler = (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    state.connections++;
    state.requested.push(req.url ?? "");
    if (options.user) {
      const expected = `Basic ${Buffer.from(`${options.user}:${options.pass ?? ""}`).toString("base64")}`;
      if (req.headers["proxy-authorization"] !== expected) {
        client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
        return;
      }
    }
    const [host, portText] = (req.url ?? "").startsWith("[") ? [(req.url ?? "").slice(1, (req.url ?? "").indexOf("]")), (req.url ?? "").split("]:")[1]] : (req.url ?? "").split(":");
    const upstream = net.connect({ host, port: Number(portText) }, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    sockets.add(client);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  };
  const server = options.tls ? https.createServer(options.tls) : http.createServer();
  server.on("connect", handler);
  server.on("request", (_req, res) => res.writeHead(405).end());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    get requested() { return state.requested; },
    get connections() { return state.connections; },
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

/** Minimal SOCKS5 server (RFC 1928/1929), CONNECT only, recording the address type it was given. */
export async function startSocks5(options: { user?: string; pass?: string } = {}): Promise<ProxyServer> {
  const state = { requested: [] as string[], connections: 0 };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    state.connections++;
    sockets.add(client);
    client.on("error", () => {});
    let stage: "greeting" | "auth" | "request" | "piped" = "greeting";
    let buf = Buffer.alloc(0);
    client.on("data", (chunk: Buffer) => {
      if (stage === "piped") return;
      buf = Buffer.concat([buf, chunk]);
      if (stage === "greeting" && buf.length >= 2 && buf.length >= 2 + buf[1]) {
        const methods = [...buf.subarray(2, 2 + buf[1])];
        buf = buf.subarray(2 + buf[1]);
        if (options.user) {
          if (!methods.includes(2)) return client.end(Buffer.from([5, 0xff]));
          client.write(Buffer.from([5, 2]));
          stage = "auth";
        } else {
          client.write(Buffer.from([5, 0]));
          stage = "request";
        }
      }
      if (stage === "auth" && buf.length >= 2) {
        const ulen = buf[1];
        if (buf.length < 3 + ulen) return;
        const plen = buf[2 + ulen];
        if (buf.length < 3 + ulen + plen) return;
        const user = buf.subarray(2, 2 + ulen).toString();
        const pass = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
        buf = buf.subarray(3 + ulen + plen);
        if (user !== options.user || pass !== (options.pass ?? "")) return client.end(Buffer.from([1, 1]));
        client.write(Buffer.from([1, 0]));
        stage = "request";
      }
      if (stage === "request" && buf.length >= 5) {
        const atyp = buf[3];
        let host: string;
        let offset: number;
        if (atyp === 1) {
          if (buf.length < 10) return;
          host = [...buf.subarray(4, 8)].join(".");
          offset = 8;
        } else if (atyp === 4) {
          if (buf.length < 22) return;
          host = buf.subarray(4, 20).toString("hex").match(/.{4}/g)!.join(":");
          offset = 20;
        } else {
          const len = buf[4];
          if (buf.length < 5 + len + 2) return;
          host = `domain:${buf.subarray(5, 5 + len).toString()}`;
          offset = 5 + len;
        }
        const port = buf.readUInt16BE(offset);
        state.requested.push(`${host}:${port}`);
        stage = "piped";
        const rest = buf.subarray(offset + 2);
        const realHost = host.startsWith("domain:") ? host.slice(7) : host;
        const upstream = net.connect({ host: realHost, port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (rest.length) upstream.write(rest);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        sockets.add(upstream);
        upstream.on("error", () => client.destroy());
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    get requested() { return state.requested; },
    get connections() { return state.connections; },
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

/** A port nothing listens on. */
export async function deadPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export interface DohServer {
  port: number;
  /** Every name asked, "<name>/<type>". */
  queries: string[];
  close(): Promise<void>;
}

/** A DoH JSON endpoint over HTTPS (certificate for 127.0.0.1) answering from a fixed table. */
export async function startDoh(tls: { key: string; cert: string }, records: Record<string, { A?: string[]; AAAA?: string[] }>, options: { status?: number } = {}): Promise<DohServer> {
  const queries: string[] = [];
  const server = https.createServer(tls, (req, res) => {
    const url = new URL(req.url ?? "/", "https://x");
    const name = (url.searchParams.get("name") ?? "").toLowerCase();
    const type = (url.searchParams.get("type") ?? "A").toUpperCase() as "A" | "AAAA";
    queries.push(`${name}/${type}`);
    if (options.status && options.status !== 200) return void res.writeHead(options.status).end();
    const answers = (records[name]?.[type] ?? []).map((data) => ({ name, type: type === "A" ? 1 : 28, TTL: 60, data }));
    res.writeHead(200, { "content-type": "application/dns-json" }).end(JSON.stringify({ Status: records[name] ? 0 : 3, Answer: answers }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    queries,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
