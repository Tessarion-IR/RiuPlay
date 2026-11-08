// RiuPlay M1: extension lifecycle, repositories and trust.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceExtension } from "@shared/types";
import { HOST_API } from "@shared/hostApi";
import { library, watchProgress } from "../db/schema";
import { on, openDevice, type Db } from "../sync/syncDevices.testkit";
import { getPlatform, installPlatform } from "../platform";
import type { Platform } from "../../platform/types";
import { compatibilityOf, consentCheck, declaredPermissions, describePermissions, effectivePermissions } from "./lifecycle";
import {
  disabledExtensionIds,
  extensionStates,
  forgetExtensionState,
  grantedPermissionsOf,
  isRepositoryEnabled,
  recordGrant,
  recordRepositoryCheck,
  repositoryInfos,
  setExtensionEnabled,
  setRepositoryEnabled,
  setRepositoryTrust,
} from "../api/extensionState";
import { annotateEntry, createRepositoriesApi } from "../api/repositories";
import { sourceRepositories } from "../db/schema";

vi.mock("../logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const entry = (extra: Partial<MarketplaceExtension> = {}): MarketplaceExtension => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  lang: "en",
  capabilities: [],
  resolverDependencies: [],
  isNsfw: false,
  type: "source",
  manifestUrl: "https://repo.example/demo.manifest.json",
  ...extra,
});

describe("permissions", () => {
  it("legacy manifests get the legacy grant, stated honestly", () => {
    expect(effectivePermissions(entry())).toEqual({ hosts: "any-public", browser: true });
    const ids = describePermissions(entry()).map((p) => p.id);
    expect(ids).toEqual(["network:any-public", "browser-pages", "storage"]);
    expect(describePermissions(entry()).find((p) => p.id === "network:any-public")!.text).toMatch(/local network.*blocked/);
  });

  it("a declaration narrows hosts and can drop browser pages; malformed declarations are ignored", () => {
    expect(declaredPermissions({ hosts: ["Example.com", "*.cdn.example.com"], browser: false })).toEqual({ hosts: ["*.cdn.example.com", "example.com"], browser: false });
    expect(declaredPermissions({ hosts: ["example.com", "http://evil"] })).toBeNull();
    expect(declaredPermissions({ hosts: ["localhost"] })).toBeNull();
    expect(declaredPermissions("all")).toBeNull();
    expect(describePermissions(entry({ permissions: { hosts: ["example.com"], browser: false } })).map((p) => p.id)).toEqual(["network:example.com", "storage"]);
  });

  it("APK extensions are labelled as sandboxed native code; NSFW is shown", () => {
    const list = describePermissions(entry({ apkPackage: "eu.kanade.x", isNsfw: true }));
    expect(list[0]).toMatchObject({ id: "native-code", level: "warning" });
    expect(list[0].text).toMatch(/sandbox/);
    expect(list.map((p) => p.id)).toContain("nsfw");
  });

  it("nothing can ask for filesystem, process or private-network access", () => {
    const list = describePermissions(entry({ permissions: { hosts: ["example.com"], browser: true, files: true, process: true, private: true } as never }));
    expect(list.map((p) => p.id).some((id) => /file|process|private|local/.test(id))).toBe(false);
  });
});

describe("compatibility (from metadata, before any download)", () => {
  it.each([
    [entry(), true],
    [entry({ type: "theme" }), false],
    [entry({ hostApi: HOST_API + 1 }), false],
    [entry({ manifestUrl: "http://repo.example/demo.manifest.json" }), false],
    [entry({ id: "../../evil" }), false],
    [entry({ apkPackage: "eu.kanade.x" }), false],
  ])("%#", (ext, compatible) => {
    expect(compatibilityOf(ext, { apkSources: false }).compatible).toBe(compatible);
  });
  it("APK entries are compatible only where the Java helper is enabled", () => {
    expect(compatibilityOf(entry({ apkPackage: "eu.kanade.x" }), { apkSources: true }).compatible).toBe(true);
  });
});

describe("install consent", () => {
  it("a new install needs consent for exactly the listed permissions", () => {
    const ext = entry();
    const ids = describePermissions(ext).map((p) => p.id);
    expect(consentCheck(ext, null, undefined).ok).toBe(false);
    expect(consentCheck(ext, null, { acceptedPermissions: ids.slice(1) }).ok).toBe(false);
    expect(consentCheck(ext, null, { acceptedPermissions: [...ids].reverse() }).ok).toBe(true);
  });
  it("an update with the same permissions needs no new consent; changed permissions do", () => {
    const ext = entry();
    const granted = describePermissions(ext).map((p) => p.id);
    expect(consentCheck(ext, granted, undefined).ok).toBe(true);
    const wider = entry({ isNsfw: true });
    expect(consentCheck(wider, granted, undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/different permissions/) });
  });
});

describe("repository and extension state (real SQLite)", () => {
  let db: Db;
  beforeEach(async () => {
    db = on(await openDevice());
  });

  it("a repository starts enabled and untrusted; trust and enabled are separate, explicit choices", async () => {
    await db.insert(sourceRepositories).values({ url: "https://r.example/index.json", addedAt: 1 }).run();
    expect(await repositoryInfos()).toEqual([expect.objectContaining({ url: "https://r.example/index.json", enabled: true, trust: "untrusted", trustedAt: null })]);
    await setRepositoryTrust("https://r.example/index.json", "trusted");
    await setRepositoryEnabled("https://r.example/index.json", false);
    expect(await isRepositoryEnabled("https://r.example/index.json")).toBe(false);
    await recordRepositoryCheck("https://r.example/index.json", { ok: false, error: "HTTP 404" });
    expect((await repositoryInfos())[0]).toMatchObject({ trust: "trusted", enabled: false, lastError: "HTTP 404" });
  });

  it("a disabled repository is not fetched; entries are annotated, never executed", async () => {
    const asked: string[] = [];
    const platform = getPlatform();
    installPlatform({
      ...platform,
      http: {
        request: async (r: { url: string }) => {
          asked.push(r.url);
          return { status: 200, url: r.url, headers: {}, body: JSON.stringify({ extensions: [entry()] }) };
        },
      },
    } as unknown as Platform);
    await db.insert(sourceRepositories).values([{ url: "https://a.example/index.json", addedAt: 1 }, { url: "https://b.example/index.json", addedAt: 2 }]).run();
    await setRepositoryEnabled("https://b.example/index.json", false);
    const results = await createRepositoriesApi().marketplace(["https://a.example/index.json", "https://b.example/index.json"]);
    expect(results.map((r) => r.url)).toEqual(["https://a.example/index.json"]);
    expect(asked.every((u) => u.startsWith("https://a.example/index.json"))).toBe(true);
    expect(asked.some((u) => /\.js(\?|$)/.test(u))).toBe(false); // discovery never downloads code
    const first = results[0];
    expect(first.ok && first.extensions[0]).toMatchObject({ compatibility: { compatible: true }, permissionList: expect.any(Array) });
  });

  it("removing a repository keeps its installed extensions' data; removing an extension keeps the library and history", async () => {
    await db.insert(sourceRepositories).values({ url: "https://r.example/index.json", addedAt: 1 }).run();
    await setRepositoryTrust("https://r.example/index.json", "trusted");
    await db.insert(library).values({ animeId: "a1", sourceId: "demo", category: "watching", addedAt: 1, animeJson: "{}" }).run();
    await db.insert(watchProgress).values({ sourceId: "demo", titleId: "a1", episodeId: "e1", episodeNumber: 1, positionMs: 5, durationMs: 10, updatedAt: 1 }).run();
    await recordGrant("demo", ["storage"]);
    await setExtensionEnabled("demo", false);
    expect(await disabledExtensionIds()).toEqual(["demo"]);
    await createRepositoriesApi().repositories.remove("https://r.example/index.json");
    expect(await grantedPermissionsOf("demo")).toEqual(["storage"]);
    await forgetExtensionState("demo");
    expect(await extensionStates()).toEqual([]);
    expect(await db.select().from(library).all()).toHaveLength(1);
    expect(await db.select().from(watchProgress).all()).toHaveLength(1);
  });

  it("annotateEntry marks incompatible entries with a reason", () => {
    expect(annotateEntry(entry({ hostApi: HOST_API + 5 })).compatibility).toMatchObject({ compatible: false, reason: expect.stringMatching(/newer RiuPlay/) });
  });
});
