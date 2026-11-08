// RiuPlay K4: the confined APK host, for real (Windows, with `gradlew bundle` built in apk-host/).
//
//  1. Escape tests, like M2's for the extension sandbox: code inside riuplay-sandbox.exe (the same launcher,
//     AppContainer and Job the host runs in) tries to read and list the person's files, write outside its
//     folder, connect out (internet and loopback), resolve names and start a program. Every one must fail;
//     writing its own folder and reading its runtime must work.
//  2. The broker: the host's connections reach the network only through RiuPlay's NetClient.openTunnel,
//     which refuses private addresses and non-web ports.
//  3. Keiyoushi, end to end through the confined host (live; RIUPLAY_E2E_KEIYOUSHI=1 and a folder of the
//     repository's signed jars in RIUPLAY_KEI_JARS): signer check in a process of its own, install,
//     popular, search, details, chapters, pages and a page's picture.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { APK_APPCONTAINER, ApkHostProcess, confinedCommand, locateApkHost, systemLocateOptions } from "./apkHost";
import { NetClient } from "../../main/net/client";
import type { Caller } from "../../main/net/policy";

const location = locateApkHost(systemLocateOptions(process.cwd(), null));
const KEIYOUSHI_KEY = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2";
const caller: Caller = { kind: "extension", sourceId: "apk:host" };

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

describe.skipIf(!location)("the APK host's sandbox", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-sandbox-e2e-"));
  const data = path.join(root, "data");
  const outside = path.join(root, "outside");
  fs.mkdirSync(data);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "the person's file");
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("denies every way out and allows only its own folder", async () => {
    const server = net.createServer((socket) => socket.end("reached")).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as net.AddressInfo).port;
    let connectedFromInside = false;
    server.on("connection", () => (connectedFromInside = true));
    const { command, args } = confinedCommand(location!, data, "app.riuplay.apkhost.EscapeProbeKt", ["--data", data, "--secret", path.join(outside, "secret.txt"), "--outside", outside, "--port", String(port)]);
    const result = await run(command, args);
    server.close();
    expect(result.code, result.stderr).toBe(0);
    const probe = JSON.parse(result.stdout.trim().split(/\r?\n/).pop()!) as Record<string, string>;
    expect(probe.writeData).toMatch(/^ok/);
    expect(probe.readRuntime).toMatch(/^ok/);
    for (const attempt of ["readSecret", "listOutside", "writeOutside", "listProfile", "connectInternet", "connectLoopback", "resolveDns", "startProcess"]) {
      expect(probe[attempt], attempt).toMatch(/^denied/);
    }
    expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
    expect(connectedFromInside).toBe(false);
  }, 120_000);

  it("runs in RiuPlay's own AppContainer", () => {
    expect(confinedCommand(location!, data, "X", []).args.slice(0, 2)).toEqual(["--name", APK_APPCONTAINER]);
  });
});

describe("the broker's connections go through NetClient's rules", () => {
  const client = new NetClient({ resolver: () => ({ mode: "system", resolve: async (host) => (host === "evil.test" ? ["10.0.0.5"] : host === "mixed.test" ? ["93.184.215.14", "127.0.0.1"] : ["127.0.0.1"]) }) });
  const signal = new AbortController().signal;

  it("refuses private and loopback addresses, whatever the name", async () => {
    await expect(client.openTunnel(caller, "evil.test", 443, signal)).rejects.toThrow(/blocked/);
    await expect(client.openTunnel(caller, "mixed.test", 443, signal)).rejects.toThrow(/blocked/);
    await expect(client.openTunnel(caller, "127.0.0.1", 443, signal)).rejects.toThrow(/blocked/);
    await expect(client.openTunnel(caller, "localhost", 80, signal)).rejects.toThrow(/loopback|blocked/);
    await expect(client.openTunnel(caller, "169.254.169.254", 80, signal)).rejects.toThrow(/blocked/);
  });

  it("refuses ports other than the web's", async () => {
    await expect(client.openTunnel(caller, "example.com", 22, signal)).rejects.toThrow(/web port/);
    await expect(client.openTunnel(caller, "example.com", 8080, signal)).rejects.toThrow(/web port/);
  });

  it("never bypasses a proxy that cannot be used", async () => {
    const broken = new NetClient({ proxy: () => ({ status: "unavailable", reason: "locked" }) });
    await expect(broken.openTunnel(caller, "example.com", 443, signal)).rejects.toThrow(/proxy/);
  });
});

const jars = process.env.RIUPLAY_KEI_JARS ?? path.join(process.cwd(), ".tmp", "kei-jar2");
const live = process.env.RIUPLAY_E2E_KEIYOUSHI === "1" && location !== null && fs.existsSync(jars);

describe.skipIf(!live)("Keiyoushi through the confined host, live", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-kei-e2e-"));
  const client = new NetClient();
  const hosts: string[] = [];
  const host = new ApkHostProcess(location!, data, (h, p, signal) => {
    hosts.push(`${h}:${p}`);
    return client.openTunnel(caller, h, p, signal);
  });
  afterAll(async () => {
    await host.stop();
    fs.rmSync(data, { recursive: true, force: true });
  });

  for (const file of fs.existsSync(jars) ? fs.readdirSync(jars).filter((f) => /arknights|gunnerkrigg/.test(f)) : []) {
    it(`${file}: verified, installed and read`, async () => {
      fs.mkdirSync(host.inboxDir, { recursive: true });
      const inbox = `${Date.now()}-${file}`;
      fs.copyFileSync(path.join(jars, file), path.join(host.inboxDir, inbox));
      const signer = await host.verify(path.join(host.inboxDir, inbox));
      expect(signer.fingerprint).toBe(KEIYOUSHI_KEY);
      const installed = await host.request<{ kind: string; packageName: string }>("POST", "/install-file", { file: inbox, packageName: signer.packageName, fingerprint: KEIYOUSHI_KEY });
      expect(installed.kind).toBe("manga");
      const listing = await host.request<{ sources: Array<{ id: string; packageName: string; contentType: string }> }>("GET", "/extensions");
      const source = listing.sources.find((s) => s.packageName === installed.packageName)!;
      expect(source.contentType).toBe("manga");
      const call = <T>(method: string, body: unknown) => host.request<T>("POST", `/source/${encodeURIComponent(source.id)}/${method}`, body);
      const popular = (await call<{ items: Array<{ id: string }> }>("search", { request: { limit: 5 } })).items;
      expect(popular.length).toBeGreaterThan(0);
      const title = await call<{ englishName: string }>("getById", { id: popular[0].id });
      expect(title.englishName).toBeTruthy();
      const chapters = (await call<{ items: Array<{ episodes: Array<{ id: string }> }> }>("playbackGroups", { titleId: popular[0].id })).items[0].episodes;
      expect(chapters.length).toBeGreaterThan(0);
      const pages = (await call<{ items: Array<{ url: string }> }>("pages", { titleId: popular[0].id, chapterId: chapters[0].id })).items;
      expect(pages.length).toBeGreaterThan(0);
      const picture = await host.fetchRaw(`/page?s=${encodeURIComponent(source.id)}&t=${encodeURIComponent(pages[0].url)}`);
      expect(picture.status).toBe(200);
      expect(picture.headers.get("Content-Type")).toMatch(/^image\//);
      expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      // Every connection it made was asked of this process.
      expect(hosts.length).toBeGreaterThan(0);
    }, 240_000);
  }
});
