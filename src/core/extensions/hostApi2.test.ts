// RiuPlay host API 2: the multi-media extension contract (docs/PRODUCT_GAP_ANALYSIS.md, M6).
import { describe, expect, it } from "vitest";
import { contentTypeOf } from "@shared/types";
import { HOST_API, supportsHostApi } from "@shared/hostApi";
import { normalisePages } from "./runtime";

describe("contentTypeOf", () => {
  it("defaults to video, so every hibiki-format source keeps working", () => {
    expect(contentTypeOf({})).toBe("video");
    expect(contentTypeOf(null)).toBe("video");
    expect(contentTypeOf({ contentType: "podcast" })).toBe("video");
  });
  it("reads manga and audio", () => {
    expect(contentTypeOf({ contentType: "manga" })).toBe("manga");
    expect(contentTypeOf({ contentType: "audio" })).toBe("audio");
  });
});

describe("host API version", () => {
  it("accepts manifests written for host API 2", () => {
    expect(HOST_API).toBeGreaterThanOrEqual(2);
    expect(supportsHostApi({ hostApi: 2 })).toBe(true);
    expect(supportsHostApi({ hostApi: HOST_API + 1 })).toBe(false);
  });
});

describe("normalisePages", () => {
  it("keeps http(s) URLs and string headers only", () => {
    expect(
      normalisePages([
        "https://a.example/1.jpg",
        { url: "http://a.example/2.png", headers: { Referer: "https://a.example/", bad: 3 } },
        "file:///C:/secret.jpg",
        "javascript:alert(1)",
        { url: 42 },
        null,
      ]),
    ).toEqual([{ url: "https://a.example/1.jpg" }, { url: "http://a.example/2.png", headers: { Referer: "https://a.example/" } }]);
  });
  it("is empty for anything but an array, and caps the count", () => {
    expect(normalisePages({ url: "https://a.example" })).toEqual([]);
    expect(normalisePages(Array.from({ length: 2500 }, (_, i) => `https://a.example/${i}.jpg`))).toHaveLength(2000);
  });
});
