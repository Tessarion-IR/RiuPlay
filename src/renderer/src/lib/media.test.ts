import { describe, expect, it } from "vitest";
import { formatClock, parseUnitLines, playerLinkTypeFor, progressFraction, statusLabelKey, titleFromUrl, unitName } from "./media";

describe("parseUnitLines", () => {
  it("makes one episode or track per URL line and reports the rest", () => {
    expect(parseUnitLines("video", "https://a.example/1.mp4\n\n  https://a.example/2.m3u8  \nnot a url\nfile:///c:/x.mp4")).toEqual({
      units: [{ url: "https://a.example/1.mp4" }, { url: "https://a.example/2.m3u8" }],
      invalid: ["not a url", "file:///c:/x.mp4"],
    });
  });

  it("groups manga pages into chapters separated by blank lines", () => {
    expect(parseUnitLines("manga", "https://i.example/1a.jpg\r\nhttps://i.example/1b.jpg\r\n\r\n\r\nhttps://i.example/2a.jpg\n").units).toEqual([
      { pages: ["https://i.example/1a.jpg", "https://i.example/1b.jpg"] },
      { pages: ["https://i.example/2a.jpg"] },
    ]);
    expect(parseUnitLines("manga", "").units).toEqual([]);
  });
});

describe("display helpers", () => {
  it("derives a title from a URL", () => {
    expect(titleFromUrl("https://cdn.example/shows/My_Show.Episode-01.mp4?token=1")).toBe("My Show Episode 01");
    expect(titleFromUrl("https://radio.example/")).toBe("radio.example");
    expect(titleFromUrl("nope")).toBe("");
  });

  it("measures progress per unit kind", () => {
    expect(progressFraction({ position: 30_000, duration: 60_000, completed: false }, "episode")).toBe(0.5);
    expect(progressFraction({ position: 4, duration: 10, completed: false }, "chapter")).toBe(0.5);
    expect(progressFraction({ position: 0, duration: 0, completed: true }, "track")).toBe(1);
    expect(progressFraction(null, "track")).toBe(0);
  });

  it("words statuses per type", () => {
    expect(statusLabelKey("manga", "active")).toBe("media.status.active.manga");
    expect(statusLabelKey("audio", "completed")).toBe("media.status.completed");
  });

  it("formats clocks and unit names", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(unitName({ number: 3, title: "" }, "Episode")).toBe("Episode 3");
    expect(unitName({ number: 12.5, title: "Extra" }, "Chapter")).toBe("12.5. Extra");
  });

  it("picks the player link type from the URL", () => {
    expect(playerLinkTypeFor("https://a.example/master.m3u8?x=1")).toBe("DIRECT_HLS");
    expect(playerLinkTypeFor("https://a.example/manifest.mpd")).toBe("DIRECT_DASH");
    expect(playerLinkTypeFor("riuplay-media://unit/4")).toBe("DIRECT_MP4");
  });
});
