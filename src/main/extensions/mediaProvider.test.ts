// RiuPlay M8: the provider adapter's pure parts - stored references, link choice, and how stored
// extension content maps to riuplay-media://ext/... (never a raw third-party URL in the page).
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

import { toItem, toUnit } from "../../core/media/media";
import { EXT_PAGE, EXT_UNIT, parseOriginRef, parseUnitRef, pickDirectLink } from "./mediaProvider";
import type { PlayerLink } from "@shared/types";

describe("stored references", () => {
  it("round-trip a unit's group and episode, whatever characters they hold", () => {
    const url = `${EXT_UNIT}${JSON.stringify(["files", "Content/big buck:bunny.mp4"])}`;
    expect(parseUnitRef(url)).toEqual({ groupId: "files", episodeId: "Content/big buck:bunny.mp4" });
  });
  it("reject anything that is not an extension unit", () => {
    expect(parseUnitRef("remote:kikoeru-track:/x")).toBeNull();
    expect(parseUnitRef(`${EXT_UNIT}not json`)).toBeNull();
    expect(parseUnitRef(`${EXT_UNIT}${JSON.stringify(["only one"])}`)).toBeNull();
    expect(parseUnitRef(`${EXT_UNIT}${JSON.stringify([1, 2])}`)).toBeNull();
  });
  it("split origin_ref at the first colon: source ids have none, title ids may", () => {
    expect(parseOriginRef("riuplay.librivox:200")).toEqual({ sourceId: "riuplay.librivox", titleId: "200" });
    expect(parseOriginRef("src:a:b")).toEqual({ sourceId: "src", titleId: "a:b" });
    expect(parseOriginRef("nocolon")).toBeNull();
  });
});

describe("pickDirectLink", () => {
  const link = (type: PlayerLink["type"], url = "https://cdn.example/f") => ({ type, url }) as PlayerLink;
  it("takes an audio file for audio, falling back to an mp4 container", () => {
    expect(pickDirectLink([link("EMBED"), link("DIRECT_AUDIO", "https://a.example/t.mp3")], "audio")?.url).toBe("https://a.example/t.mp3");
    expect(pickDirectLink([link("DIRECT_MP4")], "audio")?.type).toBe("DIRECT_MP4");
  });
  it("takes an mp4 for video, and nothing that is not http(s)", () => {
    expect(pickDirectLink([link("DIRECT_HLS"), link("DIRECT_MP4")], "video")?.type).toBe("DIRECT_MP4");
    expect(pickDirectLink([link("DIRECT_MP4", "file:///C:/x.mp4")], "video")).toBeNull();
    expect(pickDirectLink([link("EMBED")], "video")).toBeNull();
  });
});

describe("extension content in the media model", () => {
  const base = { id: 7, mediaId: 3, kind: "chapter", number: 1, title: "Ep 1", subtitleUrl: null, durationMs: null };
  it("serves units and pages through riuplay-media://ext/, never as their upstream URL", () => {
    const unit = toUnit({ ...base, url: `${EXT_UNIT}["g","e"]`, pagesJson: JSON.stringify([`${EXT_PAGE}https://img.example/1.jpg`, `${EXT_PAGE}https://img.example/2.jpg`]) } as never);
    expect(unit.url).toBe("riuplay-media://ext/7");
    expect(unit.pages).toEqual(["riuplay-media://ext/7/page/0", "riuplay-media://ext/7/page/1"]);
  });
  it("keeps the extension origin and reference on the title", () => {
    const item = toItem({ id: 3, contentType: "audio", title: "Alice", altTitlesJson: "[]", description: "", cover: "https://archive.org/services/img/x", genresJson: "[]", releaseInfo: "", origin: "extension", originRef: "riuplay.librivox:200", createdAt: 1, updatedAt: 1 } as never);
    expect(item.origin).toBe("extension");
    expect(item.originRef).toBe("riuplay.librivox:200");
    expect(item.cover).toBe("https://archive.org/services/img/x");
  });
});
