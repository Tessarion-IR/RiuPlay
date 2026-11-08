// RiuPlay K4: this process's side of the confined APK host's only channel (apk-host/.../Broker.kt).
//
// Frames on the host's stdin/stdout:  u32 length (of what follows) | u8 type | u32 channel | payload
//
//   READY   host -> app   it serves requests from now on
//   REQ     app -> host   {"method","path","body"} on a fresh channel; answered by
//   RES     host -> app   u16 status | u16 type length | content type | body
//   OPEN    host -> app   {"host","port"}: the host wants a connection. This process decides it (the
//                         TunnelOpener: RiuPlay's network rules, NetClient.openTunnel) and answers
//   OPENED  app -> host   connected, or
//   CLOSE   both ways     closed or refused (payload: why)
//   DATA    both ways     the connection's bytes (TLS end to end inside the host: never readable here)
//   EVENT   host -> app   a command for the pages the host's extensions open (RemotePages), one JSON each
import type net from "node:net";
import type { Writable } from "node:stream";
import { logger } from "../../core/logger";

export const FRAME = { READY: 0, REQ: 1, RES: 2, OPEN: 10, OPENED: 11, DATA: 12, CLOSE: 13, EVENT: 20 } as const;
const MAX_FRAME = 8 * 1024 * 1024;
const DATA_CHUNK = 64 * 1024;
/** Connections the host may hold open at once. */
export const MAX_TUNNELS = 64;
const REQUEST_TIMEOUT_MS = 180_000;

/** Opens the connection the host asked for, or throws why it may not have it. */
export type TunnelOpener = (host: string, port: number, signal: AbortSignal) => Promise<net.Socket>;

export function encodeFrame(type: number, channel: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(9);
  head.writeUInt32BE(payload.length + 5, 0);
  head.writeUInt8(type, 4);
  head.writeUInt32BE(channel >>> 0, 5);
  return Buffer.concat([head, payload]);
}

/** Splits a byte stream into frames; throws on a frame that breaks the protocol. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Array<{ type: number; channel: number; payload: Buffer }> {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const frames: Array<{ type: number; channel: number; payload: Buffer }> = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length < 5 || length > MAX_FRAME) throw new Error(`bad frame length ${length}`);
      if (this.buffer.length < 4 + length) break;
      frames.push({ type: this.buffer.readUInt8(4), channel: this.buffer.readUInt32BE(5), payload: Buffer.from(this.buffer.subarray(9, 4 + length)) });
      this.buffer = this.buffer.subarray(4 + length);
    }
    return frames;
  }
}

interface Pending {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class BrokerConnection {
  private readonly reader = new FrameReader();
  private readonly pending = new Map<number, Pending>();
  private readonly tunnels = new Map<number, { socket: net.Socket | null; abort: AbortController }>();
  private readonly commandListeners = new Set<(line: string) => void>();
  private readyListener: (() => void) | null = null;
  private errorListener: ((message: string) => void) | null = null;
  private nextChannel = 1;
  private closed = false;
  /** Connections opened, by host, for the log. */
  readonly opened = new Map<string, number>();

  constructor(
    private readonly output: Writable,
    private readonly openTunnel: TunnelOpener,
  ) {}

  onReady(listener: () => void) {
    this.readyListener = listener;
  }

  onProtocolError(listener: (message: string) => void) {
    this.errorListener = listener;
  }

  receive(chunk: Buffer) {
    let frames;
    try {
      frames = this.reader.push(chunk);
    } catch (error) {
      this.errorListener?.(error instanceof Error ? error.message : String(error));
      return;
    }
    for (const frame of frames) this.dispatch(frame.type, frame.channel, frame.payload);
  }

  private send(type: number, channel: number, payload?: Buffer): boolean {
    if (this.closed) return false;
    return this.output.write(encodeFrame(type, channel, payload));
  }

  private dispatch(type: number, channel: number, payload: Buffer) {
    switch (type) {
      case FRAME.READY:
        this.readyListener?.();
        return;
      case FRAME.RES:
        return this.answer(channel, payload);
      case FRAME.EVENT: {
        const line = payload.toString("utf8");
        for (const listener of this.commandListeners) listener(line);
        return;
      }
      case FRAME.OPEN:
        return void this.open(channel, payload);
      case FRAME.DATA: {
        const tunnel = this.tunnels.get(channel);
        if (tunnel?.socket && !tunnel.socket.destroyed) tunnel.socket.write(payload);
        return;
      }
      case FRAME.CLOSE: {
        const tunnel = this.tunnels.get(channel);
        if (!tunnel) return;
        this.tunnels.delete(channel);
        tunnel.abort.abort();
        tunnel.socket?.destroy();
        return;
      }
      default:
        this.errorListener?.(`unknown frame type ${type}`);
    }
  }

  // --- requests -------------------------------------------------------------------------------------------

  request(method: string, path: string, body: string): Promise<Response> {
    if (this.closed) return Promise.reject(new Error("The APK source host is not running"));
    const channel = this.nextChannel++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(channel);
        reject(new Error("The APK source host did not answer in time"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(channel, { resolve, reject, timer });
      this.send(FRAME.REQ, channel, Buffer.from(JSON.stringify({ method, path, body }), "utf8"));
    });
  }

  private answer(channel: number, payload: Buffer) {
    const pending = this.pending.get(channel);
    if (!pending) return;
    this.pending.delete(channel);
    clearTimeout(pending.timer);
    const status = payload.readUInt16BE(0);
    const typeLength = payload.readUInt16BE(2);
    const contentType = payload.subarray(4, 4 + typeLength).toString("utf8");
    const body = payload.subarray(4 + typeLength);
    pending.resolve(new Response(status === 204 ? null : new Uint8Array(body), { status, headers: { "Content-Type": contentType } }));
  }

  /** GET /pages/commands as a stream: the host's EVENT frames, a JSON line each. */
  commandStream(signal?: AbortSignal): Response {
    const encoder = new TextEncoder();
    let listener: ((line: string) => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        listener = (line) => controller.enqueue(encoder.encode(line + "\n"));
        this.commandListeners.add(listener);
        signal?.addEventListener("abort", () => {
          if (listener) this.commandListeners.delete(listener);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel: () => {
        if (listener) this.commandListeners.delete(listener);
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }

  // --- connections ----------------------------------------------------------------------------------------

  private async open(channel: number, payload: Buffer) {
    let target: { host?: unknown; port?: unknown };
    try {
      target = JSON.parse(payload.toString("utf8"));
    } catch {
      this.send(FRAME.CLOSE, channel, Buffer.from("bad request"));
      return;
    }
    const host = typeof target.host === "string" ? target.host.toLowerCase() : "";
    const port = typeof target.port === "number" ? target.port : 0;
    if (!host || host.length > 253) return void this.send(FRAME.CLOSE, channel, Buffer.from("bad host"));
    if (this.tunnels.size >= MAX_TUNNELS) return void this.send(FRAME.CLOSE, channel, Buffer.from("too many connections"));
    const abort = new AbortController();
    this.tunnels.set(channel, { socket: null, abort });
    let socket: net.Socket;
    try {
      socket = await this.openTunnel(host, port, abort.signal);
    } catch (error) {
      this.tunnels.delete(channel);
      const why = error instanceof Error ? error.message : String(error);
      logger.debug("apk-host", `connection to ${host}:${port} refused: ${why}`);
      this.send(FRAME.CLOSE, channel, Buffer.from(why.slice(0, 300)));
      return;
    }
    const tunnel = this.tunnels.get(channel);
    if (!tunnel || this.closed) {
      socket.destroy();
      return;
    }
    tunnel.socket = socket;
    this.opened.set(host, (this.opened.get(host) ?? 0) + 1);
    this.send(FRAME.OPENED, channel);
    socket.on("data", (chunk: Buffer) => {
      for (let at = 0; at < chunk.length; at += DATA_CHUNK) {
        if (!this.send(FRAME.DATA, channel, chunk.subarray(at, at + DATA_CHUNK))) {
          // The host's stdin is full: hold this connection until it drains.
          socket.pause();
          this.output.once("drain", () => socket.resume());
        }
      }
    });
    const done = () => {
      if (this.tunnels.get(channel)?.socket === socket) {
        this.tunnels.delete(channel);
        this.send(FRAME.CLOSE, channel);
      }
    };
    socket.on("end", done);
    socket.on("close", done);
    socket.on("error", done);
  }

  /** The host is gone: every request and connection ends. */
  close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    for (const tunnel of this.tunnels.values()) {
      tunnel.abort.abort();
      tunnel.socket?.destroy();
    }
    this.tunnels.clear();
    this.commandListeners.clear();
  }
}
