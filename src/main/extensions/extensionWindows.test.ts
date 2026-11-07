// RiuPlay M2: what an extension's browser windows may request (literal checks; DNS-based checks go
// through the broker preflight, tested in main/net/client.test.ts).
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ session: { fromPartition: () => ({}) } }));
vi.mock("../../core/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { partitionForSource, windowRequestAllowed } = await import("./extensionWindows");

describe("extension window request rules", () => {
  it.each([
    ["https://site.example/page", true],
    ["http://site.example/", true],
    ["wss://site.example/socket", true],
    ["data:text/plain,hi", true],
    ["about:blank", true],
    ["file:///C:/Windows/win.ini", false],
    ["chrome://settings", false],
    ["devtools://devtools/bundled/inspector.html", false],
    ["riuplay-media://unit/1", false],
    ["http://127.0.0.1:8080/", false],
    ["http://localhost/", false],
    ["http://app.localhost/", false],
    ["http://10.0.0.1/", false],
    ["http://169.254.169.254/latest/meta-data/", false],
    ["http://[::1]/", false],
    ["http://[::ffff:192.168.1.1]/", false],
    ["http://2130706433/", false],
    ["https://user:pw@site.example/", false],
  ])("%s -> %s", (url, allowed) => {
    expect(windowRequestAllowed(url)).toBe(allowed);
  });

  it("gives every source its own partition", () => {
    expect(partitionForSource("anilibria")).toBe("persist:riuplay-src-anilibria");
    expect(partitionForSource("Evil/../x")).toBe("persist:riuplay-src-evil_x");
    expect(partitionForSource("a")).not.toBe(partitionForSource("b"));
  });
});
