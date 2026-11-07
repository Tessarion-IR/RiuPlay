// Device sync on the computer: listening for phones on the local network (see core/sync/protocol.ts).
// TCP for requests - one framed request and its answer per connection - and UDP for the discovery
// probe phones broadcast to find a computer. All logic is core's; this is only the sockets.
import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import { logger } from "../core/logger";
import { DISCOVERY_PORT, MAX_MESSAGE_BYTES, SYNC_PORT, frame } from "../core/sync/protocol";
import { answerProbe, handleSyncRequest } from "../core/sync/server";

const CONNECTION_TIMEOUT_MS = 60_000;

function computerName(): string {
  return os.hostname() || "hibiki";
}

/** One connection: a framed request in, a framed answer out. Exported for tests, which run it on a port of their own. */
export function serveConnection(socket: net.Socket): void {
  const address = (socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  let buffer = Buffer.alloc(0);
  let expected: number | null = null;
  let handled = false;
  socket.setTimeout(CONNECTION_TIMEOUT_MS, () => {
    logger.warn("sync", `connection from ${address} timed out before a whole request (${buffer.length} bytes)`);
    socket.destroy();
  });
  socket.on("error", (error) => {
    logger.debug("sync", `connection from ${address}: ${error.message}`);
    socket.destroy();
  });
  socket.on("data", (chunk) => {
    if (handled) return;
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    if (expected === null && buffer.length >= 4) {
      expected = buffer.readUInt32BE(0);
      if (expected > MAX_MESSAGE_BYTES) {
        logger.warn("sync", `request from ${address} too large (${expected} bytes), dropped`);
        socket.destroy();
        return;
      }
    }
    if (expected === null || buffer.length < 4 + expected) return;
    handled = true;
    const text = buffer.subarray(4, 4 + expected).toString("utf-8");
    void handleSyncRequest(text, address, computerName()).then(
      (answer) => socket.end(Buffer.from(frame(answer))),
      (error: unknown) => {
        logger.warn("sync", `request from ${address} not answered: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      },
    );
  });
}

/** RiuPlay: at most this many sync connections at once. A request is read whole (up to
 * MAX_MESSAGE_BYTES) before its sender is known to be a paired device, so without a cap anyone on
 * the network could make the app hold many large buffers at once. Paired devices sync one at a time. */
export const MAX_SYNC_CONNECTIONS = 4;

export interface SyncServerOptions {
  /** Interface to bind; the LAN needs all of them. Tests pass 127.0.0.1. */
  host?: string;
  tcpPort?: number;
  udpPort?: number;
}

/** The listening sockets, and how to close them again. */
export interface SyncServerHandle {
  /** The TCP port actually bound (useful when 0 was asked for), or null if it could not be bound. */
  tcpPort: number | null;
  udpPort: number | null;
  close(): Promise<void>;
}

/** Starts listening and resolves once both sockets are bound or have failed. A port already taken
 * (another copy of the app) is logged, not fatal. Only called while the user has LAN sync on
 * (see lanSync.ts). */
export async function startSyncServer(options: SyncServerOptions = {}): Promise<SyncServerHandle> {
  const host = options.host ?? "0.0.0.0";
  const tcpPort = options.tcpPort ?? SYNC_PORT;
  const udpPort = options.udpPort ?? DISCOVERY_PORT;

  const server = net.createServer(serveConnection);
  server.maxConnections = MAX_SYNC_CONNECTIONS;
  // Turning sync off has to drop live connections too: server.close() alone waits for them.
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const boundTcp = await new Promise<number | null>((resolve) => {
    server.once("error", (error) => {
      logger.warn("sync", `sync server not started: ${error.message}`);
      resolve(null);
    });
    server.listen(tcpPort, host, () => {
      const port = (server.address() as net.AddressInfo).port;
      logger.info("sync", `listening on ${host}:${port}`);
      resolve(port);
    });
  });
  server.on("error", (error) => logger.warn("sync", `sync server: ${error.message}`));

  const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("message", (message, remote) => {
    // Silence unless the probe is one this device answers right now (see answerProbe).
    void answerProbe(message.toString("utf-8").trim(), computerName(), boundTcp ?? tcpPort, "computer").then((answer) => {
      if (!answer) return;
      logger.debug("sync", `discovery probe from ${remote.address}:${remote.port}`);
      udp.send(JSON.stringify(answer), remote.port, remote.address);
    }).catch((error: unknown) => logger.warn("sync", `discovery answer not sent: ${error instanceof Error ? error.message : String(error)}`));
  });
  const boundUdp = await new Promise<number | null>((resolve) => {
    udp.once("error", (error) => {
      logger.warn("sync", `discovery not started: ${error.message}`);
      resolve(null);
    });
    udp.bind(udpPort, host, () => {
      const port = udp.address().port;
      logger.info("sync", `answering discovery on ${host}:${port}`);
      resolve(port);
    });
  });

  let closed = false;
  return {
    tcpPort: boundTcp,
    udpPort: boundUdp,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => (boundTcp === null ? resolve() : server.close(() => resolve()))),
        new Promise<void>((resolve) => {
          try {
            udp.close(() => resolve());
          } catch {
            resolve(); // never bound, or already closed
          }
        }),
      ]);
      logger.info("sync", "LAN sync sockets closed");
    },
  };
}
