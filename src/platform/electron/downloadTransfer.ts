import { createWriteStream } from "node:fs";
import type { Readable } from "node:stream";
import type { DownloadTransferPort, FetchToFileRequest } from "../types";
import type { NetClient } from "../../main/net/client";
import type { Caller } from "../../main/net/policy";
import { netClient } from "../../main/net/state";

/** Streams a response into a write stream. RiuPlay M3: through the controlled request path (the
 * same address rules, DNS pinning, redirect checks and proxy as every other request - downloads
 * used to bypass the proxy entirely). A response outside 2xx is an error and nothing is written. */
export function createElectronDownloadTransfer(client: NetClient, caller: Caller = { kind: "download" }): DownloadTransferPort {
  return {
    async fetchToFile(request: FetchToFileRequest) {
      const response = await client.stream({ url: request.url, caller, headers: request.headers, signal: request.signal, timeoutMs: 30_000 });
      const body: Readable = response.body;
      if (response.status < 200 || response.status >= 300) {
        body.destroy();
        throw new Error(`HTTP ${response.status}`);
      }
      const headers = response.headers;
      const append = typeof request.append === "function" ? request.append({ status: response.status, headers }) : request.append;
      const contentLength = Number(headers["content-length"]?.[0] ?? 0);
      const totalBytes = contentLength > 0 ? contentLength : null;
      const onAbort = () => body.destroy(new Error("aborted"));
      request.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        if (request.buffered) {
          const chunks: Buffer[] = [];
          for await (const chunk of body) chunks.push(chunk as Buffer);
          const data = Buffer.concat(chunks);
          const out = createWriteStream(request.filePath, { flags: append ? "a" : "w" });
          try {
            await new Promise<void>((resolve, reject) => out.write(data, (error) => (error ? reject(error) : resolve())));
          } finally {
            await new Promise<void>((resolve) => out.end(resolve));
          }
          request.onProgress?.(data.byteLength, totalBytes);
          return { status: response.status, headers, bytesWritten: data.byteLength };
        }

        const out = createWriteStream(request.filePath, { flags: append ? "a" : "w" });
        let bytesWritten = 0;
        try {
          for await (const chunk of body) {
            const value = chunk as Buffer;
            await new Promise<void>((resolve, reject) => out.write(value, (error) => (error ? reject(error) : resolve())));
            bytesWritten += value.byteLength;
            request.onProgress?.(bytesWritten, totalBytes);
          }
        } finally {
          await new Promise<void>((resolve) => out.end(resolve));
        }
        return { status: response.status, headers, bytesWritten };
      } finally {
        request.signal?.removeEventListener("abort", onAbort);
        body.destroy();
      }
    },
  };
}

export const electronDownloadTransfer: DownloadTransferPort = createElectronDownloadTransfer(netClient);
