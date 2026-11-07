// RiuPlay M1: a disabled extension is not listed and does not run; a "browser": false declaration
// removes hidden browser pages; the broker is told an extension's declared hosts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "../../platform/types";
import { installPlatform } from "../platform";
import { ExtensionRuntime } from "./runtime";

vi.mock("../logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const manifests: Record<string, object> = {
  "open.manifest.json": { id: "open", name: "Open", version: "1.0.0" },
  "narrow.manifest.json": { id: "narrow", name: "Narrow", version: "1.0.0", permissions: { hosts: ["api.example.com"], browser: false } },
};

let ran: string[] = [];
let challenged = 0;

beforeEach(() => {
  ran = [];
  challenged = 0;
  const join = (...parts: string[]) => parts.join("/");
  installPlatform({
    files: {
      join,
      list: async (dir: string) => (dir === "ext" ? [...Object.keys(manifests), "open.js", "narrow.js"] : []),
      readText: async (path: string) => JSON.stringify(manifests[path.split("/").pop()!] ?? {}),
      exists: async (path: string) => !path.endsWith(".origin"),
      remove: async () => undefined,
      mkdir: async () => undefined,
      writeText: async () => undefined,
    },
    extensionHost: {
      warm: () => undefined,
      run: async (call: { sourceId: string }, bridge: (kind: string, payload: Record<string, unknown>) => Promise<unknown>) => {
        ran.push(call.sourceId);
        try {
          await bridge("challenge", { url: "https://x.example/", cookieNames: [] });
        } catch (error) {
          return { ok: false, error: String((error as Error).message) };
        }
        return { ok: true, result: [] };
      },
    },
    browser: { challenge: async () => (challenged++, {}), browserFetch: async () => ({}) },
    db: { get: () => ({ select: () => ({ from: () => ({ where: () => ({ get: async () => undefined, all: async () => [] }), all: async () => [] }) }) }) },
  } as unknown as Platform);
});

async function runtime(): Promise<ExtensionRuntime> {
  const r = new ExtensionRuntime("ext");
  (r as unknown as { storage: { read: () => Promise<object>; apply: () => Promise<void> } }).storage = { read: async () => ({}), apply: async () => undefined };
  await r.reload();
  return r;
}

describe("extension enabled state and declared permissions", () => {
  it("a disabled extension is not listed and its calls are refused before any code runs", async () => {
    const r = await runtime();
    expect(r.list().map((s) => s.id).sort()).toEqual(["narrow", "open"]);
    r.setDisabled(["open"]);
    expect(r.list().map((s) => s.id)).toEqual(["narrow"]);
    expect(r.installedIds().sort()).toEqual(["narrow", "open"]);
    await expect(r.search("open", { query: "x" } as never)).rejects.toThrow(/disabled/);
    expect(ran).not.toContain("open");
    r.setDisabled([]);
    expect(r.list()).toHaveLength(2);
  });

  it("permissionsOf reads the manifest declaration, or the legacy grant", async () => {
    const r = await runtime();
    expect(r.permissionsOf("open")).toEqual({ hosts: "any-public", browser: true });
    expect(r.permissionsOf("narrow")).toEqual({ hosts: ["api.example.com"], browser: false });
    expect(r.permissionsOf("apk:123")).toMatchObject({ native: true });
  });

  it('"browser": false refuses hidden browser pages; the legacy grant allows them', async () => {
    const r = await runtime();
    await r.search("narrow", { query: "x" } as never).catch(() => undefined);
    expect(challenged).toBe(0);
    await r.search("open", { query: "x" } as never).catch(() => undefined);
    expect(challenged).toBe(1);
  });
});
