// APK sources (Aniyomi anime and Tachiyomi/Keiyoushi manga extensions) on the desktop. Their code runs in
// a JVM process of its own (apk-host/), started the first time something asks for it.
//
// RiuPlay K4: the JVM is CONFINED. It is started through riuplay-sandbox.exe (apk-host/sandbox) inside a
// Windows AppContainer with no capabilities and a Job Object: it can open no network connection and no
// file outside its runtime (read) and its data folder (write), and cannot start other processes. Its only
// channel is its stdin/stdout, spoken in frames (apkBroker.ts): this process sends it requests, and it
// asks this process for every outbound connection, which goes through RiuPlay's network rules
// (NetClient.openTunnel). Where that confinement is not available (not Windows, no sandbox launcher) APK
// sources are off - they never run with the person's full rights.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ApkSourcesPort } from "../types";
import type { SourceInfo } from "@shared/types";
import { logger } from "../../core/logger";
import { BrokerConnection, type TunnelOpener } from "./apkBroker";
import { keiyoushiCards, keiyoushiInstallTarget, readKeiyoushiRepository, type FetchBytes } from "./keiyoushiRepository";

/** The scheme the page loads APK sources' pictures through (main/index.ts serves it from the host). */
export const APK_IMAGE_SCHEME = "hibiki-apk-image";
const IMAGE_BASE = `${APK_IMAGE_SCHEME}://img`;
const ICON_BASE = `${APK_IMAGE_SCHEME}://icon`;
const START_TIMEOUT_MS = 45_000;
/** The AppContainer every confined host process runs in (its profile is created on first use). */
export const APK_APPCONTAINER = "RiuPlay.ApkHost";

/**
 * How the JVM runs. Bytecode verification of extension classes is off: dex2jar output of R8-optimised
 * code fails it although ART runs it, and it is no security boundary here - extension code already has
 * the whole JVM (reflection, Unsafe). The boundary is the AppContainer and the broker.
 */
export const HOST_JVM_ARGS = ["-Xmx768m", "-XX:+UnlockDiagnosticVMOptions", "-XX:-BytecodeVerificationRemote", "-XX:-UsePerfData", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8"];

export interface ApkHostLocation {
  /** The `java` executable of the host's own runtime. */
  java: string;
  /** The runtime folder java is in (granted read to the AppContainer). */
  runtimeDir: string;
  /** The directory holding the host's jars. */
  libDir: string;
  /** riuplay-sandbox.exe. */
  sandbox: string;
}

export interface LocateOptions {
  /** Where a packaged app keeps its resources, or null in development. */
  resourcesPath: string | null;
  /** The project folder in development. */
  appPath: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
}

/**
 * Finds the host: its jars, the trimmed Java runtime it ships with and the sandbox launcher. A packaged app
 * carries all three under resources/apk-host; in development they come from the Gradle build
 * (`gradlew bundle` in apk-host/: build/bundle-dev) or RIUPLAY_APK_HOST_DIR, in the same layout. Null when any
 * is missing or the platform cannot confine it, which leaves APK sources switched off rather than unconfined.
 */
export function locateApkHost(options: LocateOptions): ApkHostLocation | null {
  const { resourcesPath, appPath, platform, env, exists } = options;
  if (platform !== "win32") return null;
  const root = resourcesPath
    ? path.join(resourcesPath, "apk-host")
    : (env.RIUPLAY_APK_HOST_DIR ?? path.join(appPath, "apk-host", "build", "bundle-dev"));
  const sandbox = path.join(root, "riuplay-sandbox.exe");
  const runtimeDir = path.join(root, "runtime");
  const java = path.join(runtimeDir, "bin", "java.exe");
  const libDir = path.join(root, "lib");
  return exists(libDir) && exists(java) && exists(sandbox) ? { java, runtimeDir, libDir, sandbox } : null;
}

export function systemLocateOptions(appPath: string, resourcesPath: string | null): LocateOptions {
  return { resourcesPath, appPath, platform: process.platform, env: process.env, exists: (p) => fs.existsSync(p) };
}

/** Native libraries the host loads, shipped read-only beside lib/ (see apk-host/build.gradle.kts, bundleNative). */
export const nativeDir = (location: ApkHostLocation) => path.join(path.dirname(location.libDir), "native");

/** The sandbox launcher's command line for one confined JVM run. */
export function confinedCommand(location: ApkHostLocation, dataDir: string, mainClass: string, args: string[], extraReads: string[] = []): { command: string; args: string[] } {
  const tmp = path.join(dataDir, "tmp");
  return {
    command: location.sandbox,
    args: [
      "--name", APK_APPCONTAINER,
      "--read", location.runtimeDir,
      "--read", location.libDir,
      "--read", nativeDir(location),
      ...extraReads.flatMap((dir) => ["--read", dir]),
      "--write", dataDir,
      "--memory-mb", "1536",
      "--env", `TEMP=${tmp}`,
      "--env", `TMP=${tmp}`,
      "--",
      location.java,
      ...HOST_JVM_ARGS,
      `-Djava.io.tmpdir=${tmp}`,
      `-Duser.home=${dataDir}`,
      `-Driuplay.native.dir=${nativeDir(location)}`,
      // The host's own jar first: its classes replace a library's where they must (com.squareup.zstd's loader).
      "-cp", [path.join(location.libDir, "apk-host.jar"), path.join(location.libDir, "*")].join(path.delimiter),
      mainClass,
      ...args,
    ],
  };
}

/** What the host answers a failed call with. */
export class ApkHostError extends Error {}

/**
 * The host process: started on first use, restarted if it dies, stopped with the app. All calls
 * go through [request]; [fetchRaw] is for pictures, which are streamed on to the page.
 */
export class ApkHostProcess {
  private child: ChildProcess | null = null;
  private broker: BrokerConnection | null = null;
  private starting: Promise<BrokerConnection> | null = null;
  private readonly startedListeners: Array<() => void> = [];
  private readonly stoppedListeners: Array<() => void> = [];

  constructor(
    private readonly location: ApkHostLocation,
    private readonly dataDir: string,
    private readonly openTunnel: TunnelOpener,
  ) {}

  /** Where downloads for /install-file go (the host may read them; nothing else of the person's). */
  get inboxDir(): string {
    return path.join(this.dataDir, "inbox");
  }

  private start(): Promise<BrokerConnection> {
    this.starting ??= new Promise((resolve, reject) => {
      fs.mkdirSync(path.join(this.dataDir, "tmp"), { recursive: true });
      fs.mkdirSync(this.inboxDir, { recursive: true });
      const { command, args } = confinedCommand(this.location, this.dataDir, "app.hibiki.apkhost.MainKt", ["--data", this.dataDir, "--image-base", IMAGE_BASE]);
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      this.child = child;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.reset(child);
        child.kill();
        reject(new ApkHostError(message));
      };
      const timer = setTimeout(() => fail("The APK source host did not start in time"), START_TIMEOUT_MS);
      const broker = new BrokerConnection(child.stdin!, this.openTunnel);
      this.broker = broker;
      child.stdout!.on("data", (chunk: Buffer) => broker.receive(chunk));
      broker.onReady(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(broker);
        // After the promise settles, so a listener that calls the host finds it ready.
        queueMicrotask(() => this.startedListeners.forEach((listener) => listener()));
      });
      broker.onProtocolError((message) => {
        logger.warn("apk-host", `protocol error: ${message}`);
        child.kill();
      });
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) if (line.trim()) logger.debug("apk-host", line);
      });
      child.on("error", (error) => fail(`The APK source host could not be started: ${error.message}`));
      child.on("exit", (code) => {
        logger.info("apk-host", `exited with ${code}`);
        broker.close("The APK source host exited");
        fail(`The APK source host exited (${code}) before it was ready`);
        this.reset(child);
      });
    });
    return this.starting;
  }

  /** Called each time the host process has started and is ready for requests. */
  onStarted(listener: () => void) {
    this.startedListeners.push(listener);
  }

  /** Called when the host process is gone: it exited, or was stopped. */
  onStopped(listener: () => void) {
    this.stoppedListeners.push(listener);
  }

  private reset(child: ChildProcess) {
    if (this.child === child) {
      this.child = null;
      this.starting = null;
      this.broker = null;
      this.stoppedListeners.forEach((listener) => listener());
    }
  }

  /**
   * Closing its stdin is how the host knows to quit; the kill is for one that does not (killing the
   * launcher ends the Job Object, and with it the JVM). Resolves once the process is gone.
   */
  stop(): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.child = null;
    this.starting = null;
    this.broker?.close("stopped");
    this.broker = null;
    this.stoppedListeners.forEach((listener) => listener());
    return new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.stdin?.end();
      setTimeout(() => child.kill(), 2_000).unref();
    });
  }

  async fetchRaw(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
    const broker = await this.start();
    if (pathAndQuery === "/pages/commands") return broker.commandStream(init.signal ?? undefined);
    const body = init.body == null ? "" : typeof init.body === "string" ? init.body : String(init.body);
    return broker.request(init.method ?? "GET", pathAndQuery, body);
  }

  async request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    const response = await this.fetchRaw(route, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new ApkHostError(`The APK source host answered something unreadable (${response.status})`);
    }
    if (!response.ok) throw new ApkHostError((json as { error?: string }).error ?? `The APK source host answered ${response.status}`);
    return json as T;
  }

  /**
   * RiuPlay K3: the verified signer of a downloaded APK or signed jar, from a confined JVM of its own that
   * loads no extension (so an installed one cannot influence the answer). Null when it does not verify.
   */
  async verify(file: string): Promise<{ fingerprint: string | null; packageName: string | null; versionName: string | null }> {
    fs.mkdirSync(path.join(this.dataDir, "tmp"), { recursive: true });
    const { command, args } = confinedCommand(this.location, this.dataDir, "app.hibiki.apkhost.MainKt", ["--verify", file]);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let out = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => (out += chunk));
      child.stderr!.on("data", () => {});
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on("error", (error) => reject(new ApkHostError(error.message)));
      child.on("exit", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(out.trim().split(/\r?\n/).pop() ?? ""));
        } catch {
          reject(new ApkHostError("The signature check did not answer"));
        }
      });
    });
  }
}

interface ExtensionsListing {
  sources: Array<SourceInfo & { packageName: string }>;
  extensions: Array<{ packageName: string; iconPath: string | null }>;
}

/** The address the page loads an extension's icon from (main/index.ts serves it from the host). */
export function apkIconUrl(packageName: string): string {
  return `${ICON_BASE}/${encodeURIComponent(packageName)}`;
}

/** The calls ExtensionRuntime makes of an APK source, each as the host's route for it. */
export function apkSourcesPort(host: ApkHostProcess, fetchBytes?: FetchBytes): ApkSourcesPort {
  const call = <T>(sourceId: string, route: string, body: Record<string, unknown> = {}) =>
    host.request<T>("POST", `/source/${encodeURIComponent(sourceId)}/${route}`, body);
  const items = async <T>(sourceId: string, route: string, body: Record<string, unknown>) => (await call<{ items: T[] }>(sourceId, route, body)).items;
  return {
    list: async () => {
      const { sources, extensions } = await host.request<ExtensionsListing>("GET", "/extensions");
      const hasIcon = new Set(extensions.filter((extension) => extension.iconPath).map((extension) => extension.packageName));
      return sources.map((source) => ({ ...source, iconUrl: hasIcon.has(source.packageName) ? apkIconUrl(source.packageName) : null }));
    },
    install: async (url, packageName, repositoryUrl) => {
      // RiuPlay K3: a Keiyoushi repository's extension comes as its signed jar, and only signed by the key
      // the repository publishes. Both are read again here, in the main process, from the repository itself.
      const target = repositoryUrl && fetchBytes ? await keiyoushiInstallTarget(repositoryUrl, packageName, fetchBytes) : null;
      if (!target) {
        await host.request("POST", "/install", { url, packageName });
        return;
      }
      fs.mkdirSync(host.inboxDir, { recursive: true });
      const file = `${packageName}-${Date.now()}.jar`;
      const full = path.join(host.inboxDir, file);
      fs.writeFileSync(full, await fetchBytes!(target.jarUrl));
      try {
        // In a JVM of its own, with no extension loaded: nothing installed can sway the answer.
        const signer = await host.verify(full);
        if (signer.fingerprint !== target.fingerprint) throw new ApkHostError("The extension is not signed by the repository's key - not installed");
        if (signer.packageName !== packageName) throw new ApkHostError(`The file is ${signer.packageName ?? "not an extension"}, not ${packageName} - not installed`);
        await host.request("POST", "/install-file", { file, packageName, fingerprint: target.fingerprint });
      } finally {
        fs.rmSync(full, { force: true });
      }
    },
    readRepository: async (url) => {
      if (!fetchBytes) return null;
      const repository = await readKeiyoushiRepository(url, fetchBytes);
      return repository ? keiyoushiCards(repository) : null;
    },
    page: async (sourceId, token) => {
      const response = await host.fetchRaw(`/page?s=${encodeURIComponent(sourceId)}&t=${encodeURIComponent(token)}`);
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApkHostError(error.error ?? `The page could not be loaded (${response.status})`);
      }
      return { contentType: response.headers.get("Content-Type") ?? "image/jpeg", body: new Uint8Array(await response.arrayBuffer()) };
    },
    uninstall: async (packageName) => {
      await host.request("POST", "/uninstall", { packageName });
    },
    applyClearance: async (url, session) => {
      await host.request("POST", "/clearance", { url, userAgent: session.userAgent, cookies: session.cookies });
    },
    resetClearances: async () => {
      await host.request("POST", "/clearance/reset", {});
    },
    call: async (sourceId, method, args) => {
      switch (method) {
        case "search": return items(sourceId, "search", { request: args[0] ?? {} });
        case "latest": return items(sourceId, "latest", { limit: Number(args[0] ?? 24) });
        case "getById": return call(sourceId, "getById", { id: String(args[0]) });
        case "getPlaybackGroups": return items(sourceId, "playbackGroups", { titleId: String(args[0]) });
        // RiuPlay: a manga source's pages (titleId, groupId, chapterId), as tokens for page().
        case "getPages": return items(sourceId, "pages", { titleId: String(args[0]), chapterId: String(args[2]) });
        // (titleId, groupId, episodeId): an Aniyomi episode is found by its own id; the title is
        // for reading its number and name when the episode list hasn't been loaded this run.
        case "getPlayerLinks": return items(sourceId, "playerLinks", { titleId: String(args[0]), episodeId: String(args[2]) });
        case "getSettings": return call(sourceId, "filterCatalog");
        case "readSettings": return call(sourceId, "readSettings");
        case "writeSetting": return call(sourceId, "writeSetting", { key: String(args[0]), value: args[1] == null ? null : String(args[1]) });
        default: throw new Error(`APK sources do not support ${method}()`);
      }
    },
  };
}

let instance: ApkHostProcess | null = null;

/** The running application's host, or null when this install cannot run APK sources. */
export function getApkHost(): ApkHostProcess | null {
  return instance;
}

export function setApkHost(host: ApkHostProcess | null) {
  instance = host;
}
