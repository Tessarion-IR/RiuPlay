// RiuPlay M2: a source's stream links are checked before they reach the player (runtime.ts).
import { describe, expect, it, vi } from "vitest";
import type { PlayerLink } from "@shared/types";
import type { Platform } from "../../platform/types";
import { installPlatform } from "../platform";
import { withoutBlockedDestinations } from "./runtime";

vi.mock("../logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function withChecker(blocked: (url: string) => string | null) {
  const asked: Array<{ url: string; caller?: string }> = [];
  installPlatform({
    http: {
      request: async () => {
        throw new Error("no request expected");
      },
      checkDestination: async (url: string, caller?: string) => {
        asked.push({ url, caller });
        const code = blocked(url);
        return code ? { ok: false, code } : { ok: true, code: null };
      },
    },
  } as unknown as Platform);
  return asked;
}

const link = (url: string, extra: Partial<PlayerLink> = {}): PlayerLink => ({ url, type: "HLS", ...extra }) as PlayerLink;

describe("stream destination guard", () => {
  it("drops links whose stream, audio or subtitle URL is refused, keeping the rest, attributed to the source", async () => {
    const asked = withChecker((url) => (/169\.254|10\.0\.0|localhost/.test(url) ? "blocked-address" : null));
    const links = [
      link("https://cdn.example/a.m3u8"),
      link("http://169.254.169.254/latest/meta-data/"),
      link("https://cdn.example/b.m3u8", { audioUrl: "http://10.0.0.5/audio.m4a" }),
      link("https://cdn.example/c.m3u8", { subtitles: [{ url: "http://localhost:8080/sub.vtt" }] }),
      link("https://cdn.example/d.m3u8", { subtitles: [{ url: "data:text/vtt,WEBVTT" }] }),
    ];
    const kept = await withoutBlockedDestinations("src-a", links);
    expect(kept.map((l) => l.url)).toEqual(["https://cdn.example/a.m3u8", "https://cdn.example/d.m3u8"]);
    expect(asked.every((a) => a.caller === "extension:src-a")).toBe(true);
    expect(asked.some((a) => a.url.startsWith("data:"))).toBe(false);
  });

  it("refuses non-web schemes outright", async () => {
    withChecker(() => null);
    const kept = await withoutBlockedDestinations("src-a", [link("file:///C:/Windows/win.ini"), link("riuplay-media://unit/1"), link("javascript:alert(1)"), link("https://ok.example/x.mp4")]);
    expect(kept.map((l) => l.url)).toEqual(["https://ok.example/x.mp4"]);
  });

  it("passes links unchanged where the platform has no checker", async () => {
    installPlatform({ http: { request: async () => ({}) } } as unknown as Platform);
    const links = [link("http://10.0.0.5/a.m3u8")];
    expect(await withoutBlockedDestinations("src-a", links)).toBe(links);
  });
});
