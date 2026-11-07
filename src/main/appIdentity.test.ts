import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const app = {
  setName: vi.fn((name: string) => calls.push(`name:${name}`)),
  setAppUserModelId: vi.fn(),
  getPath: vi.fn((which: string) => (which === "appData" ? "C:\\Users\\u\\AppData\\Roaming" : "unexpected")),
  setPath: vi.fn((which: string, value: string) => calls.push(`${which}:${value}`)),
};
vi.mock("electron", () => ({ app }));

describe("app identity", () => {
  it("pins the profile folder to %APPDATA%\\RiuPlay, whatever the package is called", async () => {
    await import("./appIdentity");
    expect(app.setName).toHaveBeenCalledWith("RiuPlay");
    expect(app.setAppUserModelId).toHaveBeenCalledWith("io.github.tessarion.riuplay");
    expect(calls).toContain(`userData:${path.join("C:\\Users\\u\\AppData\\Roaming", "RiuPlay")}`);
  });

  it("is the first import of the main process, before anything reads userData", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf-8");
    const firstImport = source.split(/\r?\n/).find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./appIdentity";');
  });
});
