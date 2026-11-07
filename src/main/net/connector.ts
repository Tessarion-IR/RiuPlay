// RiuPlay M3: the one connector every controlled request uses. It is bound to an address that
// guardedRequest already validated and connects to THAT address - directly, through an HTTP or
// HTTPS proxy (CONNECT to the IP literal) or through SOCKS5 (CONNECT to the IP literal) - so DNS is
// never consulted again between validation and connection (no rebinding window), and the proxy is
// never asked to resolve a name. A configured proxy is never bypassed: when it fails, the
// connection fails with "proxy-failed"; nothing here ever falls back to a direct socket.
import net from "node:net";
import tls from "node:tls";
import { SocksClient } from "socks";
import { NetError } from "./errors";
import type { ProxyConfig } from "./proxy";
import { redactText } from "./redact";

export interface PinnedTarget {
  protocol: "http:" | "https:";
  /** The validated name (TLS SNI and certificate check use it). */
  host: string;
  port: number;
  /** The validated address the socket goes to. */
  address: string;
}

export interface ConnectorOptions {
  proxy: ProxyConfig | null;
  connectTimeoutMs: number;
  /** Extra trusted CA for TLS to targets (tests only). */
  ca?: string | Buffer;
  onConnect?: (info: { host: string; address: string; port: number; via: "direct" | ProxyConfig["kind"] }) => void;
}

type Callback = (error: Error | null, socket?: net.Socket) => void;

const authority = (address: string, port: number) => (net.isIPv6(address) ? `[${address}]:${port}` : `${address}:${port}`);

function proxyError(message: string, proxy: ProxyConfig): NetError {
  return new NetError("proxy-failed", redactText(message, [proxy.password, proxy.username && proxy.password ? Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64") : null]));
}

/** Reads the proxy's answer to CONNECT. Anything but 200 refuses the tunnel - 407 included. */
function readConnectResponse(socket: net.Socket, proxy: ProxyConfig): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 16 * 1024) {
        cleanup();
        reject(proxyError("proxy sent an oversized CONNECT answer", proxy));
        return;
      }
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      cleanup();
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buffer.subarray(0, end).toString("latin1"))?.[1] ?? 0);
      if (status === 200) resolve(buffer.subarray(end + 4));
      else reject(proxyError(status === 407 ? "proxy authentication failed (HTTP 407)" : `proxy refused the tunnel (HTTP ${status || "?"})`, proxy));
    };
    const onError = (e: Error) => {
      cleanup();
      reject(proxyError(`proxy connection failed: ${e.message}`, proxy));
    };
    const onClose = () => {
      cleanup();
      reject(proxyError("proxy closed the connection", proxy));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

/** An undici `connect` function bound to one validated target. */
export function pinnedConnector(target: PinnedTarget, options: ConnectorOptions) {
  const proxy = options.proxy;
  const isHttps = target.protocol === "https:";
  const servername = net.isIP(target.host) ? undefined : target.host;

  const withTimeout = (socket: net.Socket, cb: Callback, code: "connect-failed" | "proxy-failed") => {
    const timer = setTimeout(() => {
      socket.destroy();
      cb(new NetError(code === "proxy-failed" ? "proxy-failed" : "timeout", code === "proxy-failed" ? "proxy did not answer in time" : "connection timed out"));
    }, options.connectTimeoutMs);
    return () => clearTimeout(timer);
  };

  const wrapTls = (socket: net.Socket, cb: Callback) => {
    if (!isHttps) return cb(null, socket);
    // `host` is what the certificate is checked against (the validated name or IP literal); the
    // socket is already connected to the pinned address, so it is not used to connect.
    const secure = tls.connect({ socket, host: target.host, servername, ca: options.ca, ALPNProtocols: ["http/1.1"] });
    const done = withTimeout(secure, cb, "connect-failed");
    secure.once("secureConnect", () => {
      done();
      cb(null, secure);
    });
    secure.once("error", (e) => {
      done();
      cb(new NetError("connect-failed", `TLS to ${target.host} failed: ${(e as NodeJS.ErrnoException).code ?? e.message}`));
    });
  };

  return (_opts: unknown, rawCb: Callback): void => {
    // A timeout and a late socket error must not both answer undici.
    let answered = false;
    const cb: Callback = (error, socket) => {
      if (answered) {
        if (socket && error === null) socket.destroy();
        return;
      }
      answered = true;
      cb0(error, socket);
    };
    const cb0 = rawCb;
    options.onConnect?.({ host: target.host, address: target.address, port: target.port, via: proxy?.kind ?? "direct" });

    if (!proxy) {
      const socket = net.connect({ host: target.address, port: target.port });
      const done = withTimeout(socket, cb, "connect-failed");
      socket.once("connect", () => {
        done();
        wrapTls(socket, cb);
      });
      socket.once("error", (e) => {
        done();
        cb(new NetError("connect-failed", `could not connect to ${target.host}: ${(e as NodeJS.ErrnoException).code ?? e.message}`));
      });
      return;
    }

    if (proxy.kind === "socks5") {
      SocksClient.createConnection({
        proxy: { host: proxy.host, port: proxy.port, type: 5, userId: proxy.username, password: proxy.password },
        command: "connect",
        // An IP literal: the SOCKS server is never asked to resolve a name (no "socks5h").
        destination: { host: target.address, port: target.port },
        timeout: options.connectTimeoutMs,
      }).then(
        ({ socket }) => wrapTls(socket, cb),
        (e: Error) => cb(proxyError(`SOCKS5 proxy failed: ${e.message}`, proxy)),
      );
      return;
    }

    // HTTP or HTTPS proxy: CONNECT to the validated IP literal.
    const toProxy: net.Socket =
      proxy.kind === "https"
        ? tls.connect({ host: proxy.host, port: proxy.port, ca: proxy.ca, servername: net.isIP(proxy.host) ? undefined : proxy.host })
        : net.connect({ host: proxy.host, port: proxy.port });
    const done = withTimeout(toProxy, cb, "proxy-failed");
    const onEarlyError = (e: Error) => {
      done();
      cb(proxyError(`proxy unreachable: ${(e as NodeJS.ErrnoException).code ?? e.message}`, proxy));
    };
    toProxy.once("error", onEarlyError);
    toProxy.once(proxy.kind === "https" ? "secureConnect" : "connect", () => {
      toProxy.off("error", onEarlyError);
      const to = authority(target.address, target.port);
      const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}\r\n` : "";
      toProxy.write(`CONNECT ${to} HTTP/1.1\r\nHost: ${to}\r\n${auth}\r\n`);
      readConnectResponse(toProxy, proxy).then(
        (rest) => {
          done();
          if (rest.length) toProxy.unshift(rest);
          wrapTls(toProxy, cb);
        },
        (e: Error) => {
          done();
          toProxy.destroy();
          cb(e);
        },
      );
    });
  };
}
