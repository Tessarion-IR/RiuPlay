// RiuPlay: LAN sync must open nothing on the network unless the user turned it on. These tests use
// real sockets on loopback and ephemeral ports, and check from the outside: a TCP connect is
// refused and the UDP port can be bound by someone else, i.e. nothing of ours holds it.
import dgram from "node:dgram";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanSyncDisabledError, createLanSyncController, type LanSyncController } from "./lanSync";
import { MAX_SYNC_CONNECTIONS, startSyncServer, type SyncServerHandle } from "./sync";

vi.mock("../core/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const HOST = "127.0.0.1";

async function freeTcpPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, HOST, resolve));
  const { port } = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

/** Whether something accepts TCP connections on the port. */
function tcpOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Whether the UDP port is free: we can bind it ourselves, without address reuse. */
async function udpFree(port: number): Promise<boolean> {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
  const ok = await new Promise<boolean>((resolve) => {
    socket.once("error", () => resolve(false));
    socket.bind(port, HOST, () => resolve(true));
  });
  await new Promise<void>((resolve) => {
    try {
      socket.close(() => resolve());
    } catch {
      resolve();
    }
  });
  return ok;
}

interface Harness {
  lan: LanSyncController;
  tcpPort: number;
  udpPort: number;
  startServer: ReturnType<typeof vi.fn<() => Promise<SyncServerHandle>>>;
  syncNow: ReturnType<typeof vi.fn<() => Promise<void>>>;
  stopPairing: ReturnType<typeof vi.fn<() => void>>;
  stored: { value: boolean };
}

const open: LanSyncController[] = [];
afterEach(async () => {
  for (const lan of open.splice(0)) await lan.shutdown();
});

async function harness(initiallyEnabled: boolean | "error" = false): Promise<Harness> {
  const tcpPort = await freeTcpPort();
  const udpPort = await freeUdpPort();
  const stored = { value: initiallyEnabled === true };
  const startServer = vi.fn(() => startSyncServer({ host: HOST, tcpPort, udpPort }));
  const syncNow = vi.fn(async () => {});
  const stopPairing = vi.fn();
  const lan = createLanSyncController({
    readEnabled: async () => {
      if (initiallyEnabled === "error") throw new Error("database unreadable");
      return stored.value;
    },
    writeEnabled: async (value) => void (stored.value = value),
    startServer,
    syncNow,
    stopPairing,
    firstSyncDelayMs: 10,
    syncIntervalMs: 20,
  });
  open.push(lan);
  return { lan, tcpPort, udpPort, startServer, syncNow, stopPairing, stored };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("LAN sync is opt-in", () => {
  it("opens no port and contacts no device when it was never turned on", async () => {
    const h = await harness(false);
    await h.lan.init();
    await sleep(60);
    expect(h.lan.isEnabled()).toBe(false);
    expect(h.lan.server()).toBeNull();
    expect(h.startServer).not.toHaveBeenCalled();
    expect(h.syncNow).not.toHaveBeenCalled();
    expect(await tcpOpen(h.tcpPort)).toBe(false);
    expect(await udpFree(h.udpPort)).toBe(true);
  });

  it("stays off when the setting can't be read", async () => {
    const h = await harness("error");
    await h.lan.init();
    expect(h.lan.isEnabled()).toBe(false);
    expect(h.startServer).not.toHaveBeenCalled();
    expect(await tcpOpen(h.tcpPort)).toBe(false);
  });

  it("refuses every network action while off", async () => {
    const h = await harness(false);
    await h.lan.init();
    expect(() => h.lan.assertEnabled()).toThrow(LanSyncDisabledError);
    expect(() => h.lan.assertEnabled()).toThrow(/lan-sync-disabled/);
  });

  it("opens the ports and starts background syncs only once turned on, and remembers it", async () => {
    const h = await harness(false);
    await h.lan.init();
    expect(await h.lan.setEnabled(true)).toBe(true);
    expect(h.stored.value).toBe(true);
    expect(h.startServer).toHaveBeenCalledTimes(1);
    expect(h.lan.server()?.tcpPort).toBe(h.tcpPort);
    expect(h.lan.server()?.udpPort).toBe(h.udpPort);
    expect(await tcpOpen(h.tcpPort)).toBe(true);
    await sleep(60);
    expect(h.syncNow).toHaveBeenCalled();
    expect(() => h.lan.assertEnabled()).not.toThrow();
  });

  it("starts at launch when the user had turned it on", async () => {
    const h = await harness(true);
    await h.lan.init();
    expect(h.lan.isEnabled()).toBe(true);
    expect(await tcpOpen(h.tcpPort)).toBe(true);
  });

  it("closes the ports, the pairing window and background syncs when turned off", async () => {
    const h = await harness(true);
    await h.lan.init();
    // A connection held open by a peer must not keep the port alive.
    const lingering = net.connect({ host: HOST, port: h.tcpPort });
    await new Promise((resolve) => lingering.once("connect", resolve));
    const lingeringClosed = new Promise((resolve) => lingering.once("close", resolve));

    expect(await h.lan.setEnabled(false)).toBe(false);
    expect(h.stored.value).toBe(false);
    expect(h.stopPairing).toHaveBeenCalled();
    expect(h.lan.server()).toBeNull();
    await lingeringClosed;
    expect(await tcpOpen(h.tcpPort)).toBe(false);
    expect(await udpFree(h.udpPort)).toBe(true);

    const calls = h.syncNow.mock.calls.length;
    await sleep(80);
    expect(h.syncNow.mock.calls.length).toBe(calls);
  });

  it("ends up with exactly one server after quick on/off toggling", async () => {
    const h = await harness(false);
    await h.lan.init();
    await Promise.all([h.lan.setEnabled(true), h.lan.setEnabled(false), h.lan.setEnabled(true), h.lan.setEnabled(true)]);
    expect(h.lan.isEnabled()).toBe(true);
    expect(h.startServer).toHaveBeenCalledTimes(2);
    expect(await tcpOpen(h.tcpPort)).toBe(true);
    await h.lan.setEnabled(false);
    expect(await tcpOpen(h.tcpPort)).toBe(false);
  });
});

describe("the sync server", () => {
  it(`accepts at most ${MAX_SYNC_CONNECTIONS} connections at once`, async () => {
    const handle = await startSyncServer({ host: HOST, tcpPort: 0, udpPort: await freeUdpPort() });
    try {
      const sockets = await Promise.all(
        Array.from({ length: MAX_SYNC_CONNECTIONS + 2 }, () => {
          const socket = net.connect({ host: HOST, port: handle.tcpPort! });
          const closed = new Promise<boolean>((resolve) => {
            socket.once("close", () => resolve(true));
            setTimeout(() => resolve(false), 300);
          });
          socket.on("error", () => {});
          return closed.then((wasClosed) => ({ socket, wasClosed }));
        }),
      );
      expect(sockets.filter((s) => s.wasClosed)).toHaveLength(2);
      for (const { socket } of sockets) socket.destroy();
    } finally {
      await handle.close();
    }
  });
});
