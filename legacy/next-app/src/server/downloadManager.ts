import fs from "fs";
import { createDownloadRecord, getDownload, updateDownloadRecord } from "@/server/queries";
import { buildDispatcher } from "@/server/net";
import { downloadFilePath, getFreeDiskSpace } from "@/server/storage";
import type { ProxySettings } from "@/lib/types";

// In-memory registry of in-flight downloads so they can be cancelled.
// NOTE: this registry is process-local; if the server restarts, previously
// "downloading" records are reconciled to "failed" on next listing fetch by
// the client reissuing a fresh download instead of resuming silently.
const controllers = new Map<number, AbortController>();

export async function startDownload(
  mediaItemId: number,
  unitId: number | null,
  unitType: "episode" | "track",
  title: string,
  sourceUrl: string,
  proxy?: ProxySettings | null,
) {
  const space = await getFreeDiskSpace(process.cwd());
  if (space && space.free < 200 * 1024 * 1024) {
    throw new Error("Less than 200MB of free disk space remains. Free up space before downloading.");
  }

  const record = await createDownloadRecord({ mediaItemId, unitId, unitType, title, sourceUrl });
  const filePath = downloadFilePath(mediaItemId, unitId, title || `download-${record.id}`);

  void runDownload(record.id, filePath, sourceUrl, proxy);
  return record;
}

async function runDownload(id: number, filePath: string, sourceUrl: string, proxy?: ProxySettings | null) {
  const controller = new AbortController();
  controllers.set(id, controller);
  await updateDownloadRecord(id, { status: "downloading" });

  try {
    const dispatcher = buildDispatcher(proxy);
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher option
      dispatcher,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Source returned HTTP ${res.status}.`);
    }
    const totalBytes = Number(res.headers.get("content-length") ?? 0);
    await updateDownloadRecord(id, { totalBytes });

    const writeStream = fs.createWriteStream(filePath);
    let received = 0;
    let lastUpdate = Date.now();

    const reader = res.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        await new Promise<void>((resolve, reject) => {
          writeStream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
        });
        if (Date.now() - lastUpdate > 400) {
          lastUpdate = Date.now();
          await updateDownloadRecord(id, { progressBytes: received });
        }
      }
    }
    await new Promise<void>((resolve) => writeStream.end(resolve));
    await updateDownloadRecord(id, {
      status: "completed",
      progressBytes: received,
      totalBytes: totalBytes || received,
      filePath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed.";
    const canceled = err instanceof Error && err.name === "AbortError";
    await updateDownloadRecord(id, {
      status: canceled ? "canceled" : "failed",
      errorMessage: canceled ? "Canceled by user." : message,
    });
  } finally {
    controllers.delete(id);
  }
}

export async function cancelDownload(id: number) {
  const controller = controllers.get(id);
  if (controller) {
    controller.abort();
    return true;
  }
  const record = await getDownload(id);
  if (record && (record.status === "queued" || record.status === "downloading")) {
    await updateDownloadRecord(id, { status: "canceled", errorMessage: "Canceled by user." });
    return true;
  }
  return false;
}

export async function retryDownload(id: number, proxy?: ProxySettings | null) {
  const record = await getDownload(id);
  if (!record) throw new Error("Download not found.");
  const filePath = downloadFilePath(record.mediaItemId, record.unitId, record.title || `download-${record.id}`);
  await updateDownloadRecord(id, { status: "queued", errorMessage: null, progressBytes: 0 });
  void runDownload(id, filePath, record.sourceUrl, proxy);
}
