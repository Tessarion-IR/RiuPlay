// The Electron transports against the shared port contracts. Only the adapters that run under
// plain Node are here; safeStorage, BrowserWindow and the Electron-built better-sqlite3 need the
// Electron runtime itself.
// RiuPlay M3: both transports run through the controlled request path. The contract servers listen
// on 127.0.0.1, so the contract runs on a client whose classifier lets 127.0.0.1 alone stand in for
// a public site; the app's own transports (electronHttp / electronDownloadTransfer) refuse it.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockedReason } from "../../main/net/addresses";
import { NetClient } from "../../main/net/client";
import { startTestServer } from "../contract/testServer";
import { describeDownloadTransferContract } from "../contract/downloadTransfer.contract";
import { describeFilesContract } from "../contract/files.contract";
import { describeHttpContract } from "../contract/http.contract";
import { createElectronDownloadTransfer, electronDownloadTransfer } from "./downloadTransfer";
import { electronFiles } from "./files";
import { createElectronHttp, electronHttp } from "./http";

let scratch = "";
beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "hibiki-platform-"));
});
afterAll(() => fs.rm(scratch, { recursive: true, force: true }));

const lab = new NetClient({ classify: (address) => (address === "127.0.0.1" ? null : blockedReason(address)) });

describeHttpContract("electron", createElectronHttp(lab));
describeFilesContract("electron", electronFiles, () => scratch);
describeDownloadTransferContract("electron", createElectronDownloadTransfer(lab), electronFiles, () => scratch);

describe("the app's own transports refuse loopback", () => {
  it("platform.http and downloads", async () => {
    const server = await startTestServer();
    try {
      await expect(electronHttp.request({ url: `${server.url}/echo` })).rejects.toMatchObject({ code: "blocked-address" });
      await expect(electronHttp.request({ url: `${server.url}/echo`, caller: "connection:x" })).rejects.toMatchObject({ code: "blocked-address" });
      await expect(electronDownloadTransfer.fetchToFile({ url: `${server.url}/echo`, filePath: path.join(scratch, "x"), append: false })).rejects.toMatchObject({ code: "blocked-address" });
    } finally {
      await server.close();
    }
  });
});
