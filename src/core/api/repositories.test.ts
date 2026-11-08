// The preinstalled repositories, over a real migrated database (node:sqlite, as in sync/changes.test.ts).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import { sourceRepositories } from "../db/schema";
import { applyMigrations, type MigrationJournal } from "../db/migrate";
import { BUILTIN_REPOSITORY_URL, DEFAULT_APK_REPOSITORY_URL, DEFAULT_REPOSITORY_URL, fetchExtensionFiles, fetchRepositoryIndex, repositoryIndexCandidates, repositoryKey, setBuiltinRepositoryReader } from "../marketplace";
import { getPlatform, installPlatform } from "../platform";
import type { Platform } from "../../platform/types";
import { createRepositoriesApi } from "./repositories";

vi.mock("../logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const migrationsDir = fileURLToPath(new URL("../db/migrations", import.meta.url));
const journal = JSON.parse(readFileSync(`${migrationsDir}/meta/_journal.json`, "utf-8")) as MigrationJournal;
const sqlByTag = Object.fromEntries(
  readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).map((name) => [name.replace(/\.sql$/, ""), readFileSync(`${migrationsDir}/${name}`, "utf-8")]),
);

async function install(options: { apk: boolean; markers?: string[]; repositories?: string[] }) {
  const sqlite = new DatabaseSync(":memory:");
  const values = (sql: string, params: unknown[]) => sqlite.prepare(sql).all(...(params as SQLInputValue[])).map((row) => Object.values(row));
  const db = drizzle(async (sql, params, method) => {
    if (method === "run") {
      sqlite.prepare(sql).run(...(params as SQLInputValue[]));
      return { rows: [] };
    }
    const rows = values(sql, params);
    return { rows: method === "get" ? (rows[0] as unknown as unknown[]) : rows };
  }, { schema });
  await applyMigrations(journal, sqlByTag, {
    exec: async (sql) => void sqlite.exec(sql),
    values: async (sql) => values(sql, []),
  }, async (text) => createHash("sha256").update(text).digest("hex"));
  for (const url of options.repositories ?? []) await db.insert(sourceRepositories).values({ url, addedAt: 1 }).run();
  const files = new Set((options.markers ?? []).map((name) => `data/${name}`));
  installPlatform({
    db: { get: () => db },
    paths: { userData: "data" },
    files: { join: (...parts: string[]) => parts.join("/"), exists: async (path: string) => files.has(path), writeText: async (path: string) => void files.add(path) },
    apkSources: options.apk ? {} : undefined,
  } as unknown as Platform);
  return createRepositoriesApi().repositories;
}

// RiuPlay: no repository is preinstalled (see repositories.ts and docs/EXTENSION_REPOSITORY_AUDIT.md).
describe("preinstalled repositories", () => {
  it("there are none: a fresh install starts with an empty list, with or without APK sources", async () => {
    expect(await (await install({ apk: true })).list()).toEqual([]);
    expect(await (await install({ apk: false })).list()).toEqual([]);
  });

  it("an existing install keeps the repositories hibiki had seeded into it", async () => {
    const repositories = await install({ apk: true, markers: ["default-repository-seeded", "apk-repository-seeded"], repositories: [DEFAULT_REPOSITORY_URL, DEFAULT_APK_REPOSITORY_URL] });
    expect(await repositories.list()).toEqual([DEFAULT_REPOSITORY_URL, DEFAULT_APK_REPOSITORY_URL]);
  });

  it("a removed repository is not added back", async () => {
    const repositories = await install({ apk: true, repositories: [DEFAULT_REPOSITORY_URL] });
    expect(await repositories.remove(DEFAULT_REPOSITORY_URL)).toEqual([]);
    expect(await repositories.list()).toEqual([]);
    expect(await (await install({ apk: true })).list()).toEqual([]);
  });
});

describe("typed repository addresses", () => {
  const raw = "https://raw.githubusercontent.com/akkirrai1337/hibiki-sources/main/repository/index.json";

  it("turn a GitHub file page into its raw copy, and leave a raw URL alone", () => {
    expect(repositoryIndexCandidates("https://github.com/akkirrai1337/hibiki-sources/blob/main/repository/index.json")).toEqual([raw]);
    expect(repositoryIndexCandidates(raw)).toEqual([raw]);
  });

  it("turn a repository page into the usual index places, on its branch when one is named", () => {
    const fromRepo = repositoryIndexCandidates("github.com/akkirrai1337/hibiki-sources.git");
    expect(fromRepo[0]).toBe(raw);
    expect(fromRepo).toContain("https://raw.githubusercontent.com/akkirrai1337/hibiki-sources/repo/index.min.json");
    expect(repositoryIndexCandidates("https://github.com/yuzono/anime-repo/tree/repo")).toEqual([
      "https://raw.githubusercontent.com/yuzono/anime-repo/repo/repository/index.json",
      "https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json",
      "https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.json",
    ]);
  });

  it("save the first place that really holds an index", async () => {
    const repositories = await install({ apk: false, markers: ["default-repository-seeded"] });
    const platform = getPlatform() as unknown as Record<string, unknown>;
    platform.http = {
      request: async ({ url }: { url: string }) => url.includes("/someone/sources/master/repository/index.json")
        ? { status: 200, url, headers: {}, body: JSON.stringify({ extensions: [] }) }
        : { status: 404, url, headers: {}, body: "" },
    };
    expect(await repositories.add("https://github.com/someone/sources")).toEqual(["https://raw.githubusercontent.com/someone/sources/master/repository/index.json"]);
    await expect(repositories.add("https://github.com/someone/nothing-here")).rejects.toThrow("No repository index found");
  });
});

describe("the same repository twice", () => {
  const longForm = "https://raw.githubusercontent.com/akkirrai1337/hibiki-sources/refs/heads/main/repository/index.json";

  it("is one repository under any spelling of its raw address", () => {
    expect(repositoryKey(longForm)).toBe(repositoryKey(DEFAULT_REPOSITORY_URL));
    expect(repositoryKey("https://RAW.githubusercontent.com/AkkirRai1337/Hibiki-Sources/main/repository/index.json?x=1#top")).toBe(repositoryKey(DEFAULT_REPOSITORY_URL));
    expect(repositoryKey("https://raw.githubusercontent.com/akkirrai1337/hibiki-sources/dev/repository/index.json")).not.toBe(repositoryKey(DEFAULT_REPOSITORY_URL));
  });

  it("is refused before anything is fetched, and through a GitHub page too", async () => {
    const repositories = await install({ apk: false, repositories: [DEFAULT_REPOSITORY_URL] });
    const request = vi.fn(async ({ url }: { url: string }) => ({ status: 200, url, headers: {}, body: JSON.stringify({ extensions: [] }) }));
    (getPlatform() as unknown as Record<string, unknown>).http = { request };
    await expect(repositories.add(longForm)).rejects.toThrow("[repository-already-added]");
    await expect(repositories.add(DEFAULT_REPOSITORY_URL)).rejects.toThrow("[repository-already-added]");
    expect(request).not.toHaveBeenCalled();
    await expect(repositories.add("github.com/akkirrai1337/hibiki-sources")).rejects.toThrow("[repository-already-added]");
    expect(await repositories.list()).toEqual([DEFAULT_REPOSITORY_URL]);
  });

  it("saved before this check is cleaned up, the earliest copy staying", async () => {
    const repositories = await install({ apk: false, markers: ["default-repository-seeded"], repositories: [DEFAULT_REPOSITORY_URL, longForm] });
    expect(await repositories.list()).toEqual([DEFAULT_REPOSITORY_URL]);
    expect(await repositories.remove(DEFAULT_REPOSITORY_URL)).toEqual([]);
  });
});

// RiuPlay M7: the built-in repository (extensions/official/, bundled with the app).
describe("the built-in repository", () => {
  const officialDir = fileURLToPath(new URL("../../../extensions/official", import.meta.url));
  const readOfficial = async (file: string) => readFileSync(`${officialDir}/${file}`, "utf-8");

  it("is listed first and cannot be removed, but can be disabled", async () => {
    const repositories = await install({ apk: false, repositories: ["https://example.org/index.json"] });
    setBuiltinRepositoryReader(readOfficial);
    try {
      expect(await repositories.list()).toEqual([BUILTIN_REPOSITORY_URL, "https://example.org/index.json"]);
      await expect(repositories.remove(BUILTIN_REPOSITORY_URL)).rejects.toThrow(/can't be removed/);
      await expect(repositories.add(BUILTIN_REPOSITORY_URL)).rejects.toThrow();
      const [builtin] = await repositories.details!();
      expect(builtin).toMatchObject({ url: BUILTIN_REPOSITORY_URL, builtin: true, enabled: true, trust: "trusted", name: "RiuPlay (built-in)" });
      const [disabled] = await repositories.setEnabled!(BUILTIN_REPOSITORY_URL, false);
      expect(disabled.enabled).toBe(false);
    } finally {
      setBuiltinRepositoryReader(null);
    }
  });

  it("lists RiuPlay's video, manga and audio extensions, each with SHA-256 hashes", async () => {
    setBuiltinRepositoryReader(readOfficial);
    try {
      const entries = await fetchRepositoryIndex(BUILTIN_REPOSITORY_URL);
      expect(new Set(entries.map((e) => e.contentType))).toEqual(new Set(["video", "manga", "audio"]));
      for (const entry of entries) {
        expect(entry.sha256?.manifest).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.permissions?.hosts?.length).toBeGreaterThan(0);
        expect(entry.permissions?.browser).toBe(false);
        const files = await fetchExtensionFiles(entry);
        expect(JSON.parse(files.manifestJson).id).toBe(entry.id);
      }
    } finally {
      setBuiltinRepositoryReader(null);
    }
  });

  it("refuses a file that does not match its hash, and ignores hashes handed in from outside", async () => {
    setBuiltinRepositoryReader(async (file) => (file.endsWith(".js") ? `${await readOfficial(file)}\n// tampered` : readOfficial(file)));
    try {
      const [entry] = await fetchRepositoryIndex(BUILTIN_REPOSITORY_URL);
      await expect(fetchExtensionFiles(entry)).rejects.toThrow(/SHA-256/);
      const forged = { ...entry, sha256: { manifest: "0".repeat(64), script: "0".repeat(64) } };
      await expect(fetchExtensionFiles(forged)).rejects.toThrow(/SHA-256/);
      await expect(fetchExtensionFiles({ ...entry, id: "riuplay.not-there" })).rejects.toThrow(/not in the built-in repository/);
    } finally {
      setBuiltinRepositoryReader(null);
    }
  });

  it("reads bare file names of its own folder only", async () => {
    setBuiltinRepositoryReader(readOfficial);
    try {
      await expect(fetchRepositoryIndex("riuplay-builtin://official/../../package.json")).rejects.toThrow(/Not a file/);
    } finally {
      setBuiltinRepositoryReader(null);
    }
  });
});
