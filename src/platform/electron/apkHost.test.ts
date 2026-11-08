import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ApkHostError, ApkHostProcess, apkIconUrl, apkSourcesPort, confinedCommand, locateApkHost, redactQueries, systemLocateOptions, type LocateOptions } from "./apkHost";

const options = (existing: string[], overrides: Partial<LocateOptions> = {}): LocateOptions => ({
  resourcesPath: null,
  appPath: path.join("/app"),
  platform: "linux",
  env: {},
  exists: (p) => existing.includes(p),
  ...overrides,
});

describe("locateApkHost", () => {
  const resources = path.join("/res");
  const bundled = path.join(resources, "apk-host");
  const java = path.join(bundled, "runtime", "bin", "java.exe");
  const lib = path.join(bundled, "lib");
  const sandbox = path.join(bundled, "riuplay-sandbox.exe");

  it("uses the bundled jars, runtime and sandbox launcher of a packaged app", () => {
    expect(locateApkHost(options([lib, java, sandbox], { resourcesPath: resources, platform: "win32" }))).toEqual({
      java,
      runtimeDir: path.join(bundled, "runtime"),
      libDir: lib,
      sandbox,
    });
  });

  it("is off without the sandbox launcher: APK sources never run unconfined", () => {
    expect(locateApkHost(options([lib, java], { resourcesPath: resources, platform: "win32" }))).toBeNull();
  });

  it("is off where the host cannot be confined (not Windows)", () => {
    expect(locateApkHost(options([lib, java, sandbox], { resourcesPath: resources, platform: "linux" }))).toBeNull();
  });

  it("is off when a packaged app lacks its runtime, rather than falling back to whatever java is around", () => {
    expect(locateApkHost(options([lib, sandbox], { resourcesPath: resources, platform: "win32" }))).toBeNull();
  });

  it("finds the Gradle bundle and the built launcher in development", () => {
    const dev = path.join("/app", "apk-host", "build");
    const found = locateApkHost(options([path.join(dev, "bundle-dev", "lib"), path.join(dev, "bundle-dev", "runtime", "bin", "java.exe"), path.join(dev, "bundle-dev", "riuplay-sandbox.exe")], { platform: "win32" }));
    expect(found?.libDir).toBe(path.join(dev, "bundle-dev", "lib"));
    expect(locateApkHost(options([], { platform: "win32" }))).toBeNull();
  });
});

describe("confinedCommand", () => {
  it("starts java through the launcher with only its runtime readable and its data folder writable", () => {
    const location = { java: "C:\\h\\runtime\\bin\\java.exe", runtimeDir: "C:\\h\\runtime", libDir: "C:\\h\\lib", sandbox: "C:\\h\\riuplay-sandbox.exe" };
    const { command, args } = confinedCommand(location, "C:\\data", "Main", ["--x", "1"]);
    expect(command).toBe(location.sandbox);
    const separator = args.indexOf("--");
    const options = args.slice(0, separator);
    expect(options.filter((_, i) => options[i - 1] === "--read")).toEqual([location.runtimeDir, location.libDir, path.join(path.dirname(location.libDir), "native")]);
    expect(options.filter((_, i) => options[i - 1] === "--write")).toEqual(["C:\\data"]);
    expect(options[options.indexOf("--name") + 1]).toBe("RiuPlay.ApkHost");
    expect(args[separator + 1]).toBe(location.java);
    expect(args.slice(-3)).toEqual(["Main", "--x", "1"]);
  });
});

describe("redactQueries", () => {
  it("keeps addresses but drops their query strings and fragments from the host's log lines", () => {
    expect(redactQueries("GET https://api.example/a/b?token=SECRET&x=1 failed")).toBe("GET https://api.example/a/b?<redacted> failed");
    expect(redactQueries("see http://x.test/p#access_token=abc")).toBe("see http://x.test/p?<redacted>");
    expect(redactQueries("no address here")).toBe("no address here");
  });
});

describe("apkIconUrl", () => {
  it("is addressed by package name, escaped", () => {
    expect(apkIconUrl("eu.kanade.tachiyomi.animeextension.ru.animevost")).toBe("hibiki-apk-image://icon/eu.kanade.tachiyomi.animeextension.ru.animevost");
    expect(apkIconUrl("a b")).toBe("hibiki-apk-image://icon/a%20b");
  });
});

describe("apkSourcesPort", () => {
  const calls: Array<{ method: string; route: string; body?: unknown }> = [];
  const host = {
    request: async (method: string, route: string, body?: unknown) => {
      calls.push({ method, route, body });
      if (route === "/extensions") {
        return {
          sources: [
            { id: "apk:1", name: "A", packageName: "pkg.a" },
            { id: "apk:2", name: "B", packageName: "pkg.b" },
          ],
          extensions: [{ packageName: "pkg.a", iconPath: "/x/pkg.a.png" }, { packageName: "pkg.b", iconPath: null }],
        };
      }
      return { items: [{ id: "x" }] };
    },
  } as unknown as ApkHostProcess;
  const port = apkSourcesPort(host);

  it("lists sources with an icon only where the extension has one", async () => {
    const list = await port.list();
    expect(list.map((source) => source.iconUrl)).toEqual([apkIconUrl("pkg.a"), null]);
  });

  it("turns the runtime's calls into the host's routes", async () => {
    calls.length = 0;
    await port.call("apk:5", "search", [{ query: "naruto" }]);
    await port.call("apk:5", "latest", [10]);
    await port.call("apk:5", "getById", ["/title/1"]);
    await port.call("apk:5", "getPlaybackGroups", ["/title/1"]);
    await port.call("apk:5", "getPlayerLinks", ["/title/1", "episodes", "/ep/3"]);
    await port.call("apk:5", "getSettings", []);
    await port.call("apk:5", "readSettings", []);
    await port.call("apk:5", "writeSetting", ["quality", "720"]);
    await port.call("apk:5", "writeSetting", ["quality", null]);
    expect(calls.map((call) => [call.route, call.body])).toEqual([
      ["/source/apk%3A5/search", { request: { query: "naruto" } }],
      ["/source/apk%3A5/latest", { limit: 10 }],
      ["/source/apk%3A5/getById", { id: "/title/1" }],
      ["/source/apk%3A5/playbackGroups", { titleId: "/title/1" }],
      ["/source/apk%3A5/playerLinks", { titleId: "/title/1", episodeId: "/ep/3" }],
      ["/source/apk%3A5/filterCatalog", {}],
      ["/source/apk%3A5/readSettings", {}],
      ["/source/apk%3A5/writeSetting", { key: "quality", value: "720" }],
      ["/source/apk%3A5/writeSetting", { key: "quality", value: null }],
    ]);
  });

  it("hands over a passed check and a reset, to the host's routes", async () => {
    calls.length = 0;
    await port.applyClearance!("https://x.example/", { cookies: { cf_clearance: "a" }, cookieHeader: "cf_clearance=a", userAgent: "UA" });
    await port.resetClearances!();
    expect(calls.map((call) => [call.route, call.body])).toEqual([
      ["/clearance", { url: "https://x.example/", userAgent: "UA", cookies: { cf_clearance: "a" } }],
      ["/clearance/reset", {}],
    ]);
  });

  it("unwraps lists and refuses what it does not know", async () => {
    expect(await port.call("apk:5", "search", [{}])).toEqual([{ id: "x" }]);
    await expect(port.call("apk:5", "explode", [])).rejects.toThrow(/do not support/);
  });
});

// The real thing: the built bundle in its sandbox (apk-host: `gradlew bundle`).
const realLocation = locateApkHost(systemLocateOptions(process.cwd(), null));

describe.skipIf(!realLocation)("ApkHostProcess with the real, confined host", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-apk-host-"));
  const refused: string[] = [];
  const host = new ApkHostProcess(realLocation!, dataDir, async (h, p) => {
    refused.push(`${h}:${p}`);
    throw new Error("no network in this test");
  });
  afterAll(async () => {
    await host.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("starts on first use and answers", async () => {
    const listing = await host.request<{ sources: unknown[]; extensions: unknown[] }>("GET", "/extensions");
    expect(listing).toEqual({ sources: [], extensions: [] });
  }, 60_000);

  it("reports a host error with its message", async () => {
    await expect(host.request("POST", "/source/apk%3A1/search", {})).rejects.toThrow(/not installed/);
    await expect(host.request("POST", "/install", { url: "http://insecure.example/x.apk" })).rejects.toThrow(ApkHostError);
  }, 30_000);

  it("asks this process for every connection it wants", async () => {
    await expect(host.request("POST", "/install", { url: "https://example.com/x.apk" })).rejects.toThrow(ApkHostError);
    expect(refused).toContain("example.com:443");
  }, 60_000);

  it("starts again after the process died", async () => {
    (host as unknown as { child: { kill(): void } }).child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const listing = await host.request<{ extensions: unknown[] }>("GET", "/extensions");
    expect(listing.extensions).toEqual([]);
  }, 60_000);
});
