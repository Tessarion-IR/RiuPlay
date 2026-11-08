import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeKeiyoushiIndex, parseRepoJson } from "./keiyoushiIndex";

// A minimal protobuf writer for the fixture: what decodeKeiyoushiIndex reads, built field by field.
const varint = (value: bigint): Buffer => {
  const bytes: number[] = [];
  let v = BigInt.asUintN(64, value);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0n);
  return Buffer.from(bytes);
};
const str = (field: number, value: string | Buffer) => {
  const data = typeof value === "string" ? Buffer.from(value) : value;
  return Buffer.concat([varint(BigInt((field << 3) | 2)), varint(BigInt(data.length)), data]);
};
const num = (field: number, value: bigint) => Buffer.concat([varint(BigInt(field << 3)), varint(value)]);

/** Tachiyomi's source id: the first 64 bits of MD5("name/lang/versionId"), sign bit cleared (HttpSource.generateId). */
const sourceId = (name: string, lang: string, version = 1) => {
  const md5 = createHash("md5").update(`${name.toLowerCase()}/${lang}/${version}`).digest();
  return (md5.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
};

describe("Keiyoushi's v2 index", () => {
  const extension = Buffer.concat([
    str(1, "Example"),
    str(2, "eu.kanade.tachiyomi.extension.en.example"),
    str(3, Buffer.concat([str(1, "https://example.test/a.apk"), str(2, "https://example.test/i.png"), str(501, "https://example.test/a.jar")])),
    str(4, "1.6"),
    num(5, 106001n),
    str(6, "1.6.1"),
    num(7, 1n),
    str(8, Buffer.concat([num(1, BigInt(sourceId("Example", "en"))), str(2, "Example"), str(3, "en"), str(4, "https://example.test"), str(7, "a note")])),
    str(99, "an unknown field"),
  ]);
  const index = Buffer.concat([str(1, "Repo"), str(2, "R"), str(3, "AB".repeat(32)), str(4, str(1, "https://example.test")), str(101, str(1, extension))]);

  it("reads the extensions, their signed jar and their sources, gzip'd or not", () => {
    for (const data of [zlib.gzipSync(index), index]) {
      const decoded = decodeKeiyoushiIndex(data);
      expect(decoded.name).toBe("Repo");
      expect(decoded.signingKey).toBe("ab".repeat(32));
      expect(decoded.extensions).toEqual([
        {
          name: "Example",
          packageName: "eu.kanade.tachiyomi.extension.en.example",
          apkUrl: "https://example.test/a.apk",
          iconUrl: "https://example.test/i.png",
          jarUrl: "https://example.test/a.jar",
          extensionLib: "1.6",
          versionCode: 106001,
          versionName: "1.6.1",
          contentWarning: 1,
          sources: [{ id: sourceId("Example", "en"), name: "Example", language: "en", homeUrl: "https://example.test" }],
        },
      ]);
    }
  });

  it("refuses a truncated index", () => {
    expect(() => decodeKeiyoushiIndex(index.subarray(0, index.length - 3))).toThrow(/Truncated/);
  });

  it("reads repo.json and insists on a full fingerprint and an https index", () => {
    expect(parseRepoJson({ index_v2: "https://x.test/index.pb", meta: { name: "K", signingKeyFingerprint: "AB".repeat(32) } })).toEqual({ indexUrl: "https://x.test/index.pb", fingerprint: "ab".repeat(32), name: "K" });
    expect(parseRepoJson({ index_v2: "http://x.test/index.pb", meta: { signingKeyFingerprint: "ab".repeat(32) } })).toBeNull();
    expect(parseRepoJson({ index_v2: "https://x.test/index.pb", meta: { signingKeyFingerprint: "abc" } })).toBeNull();
    expect(parseRepoJson([])).toBeNull();
  });

  // The real index, when a copy was saved to .tmp (it is the repository's data, so it is not committed).
  const real = path.join(process.cwd(), ".tmp", "index.pb");
  it.skipIf(!fs.existsSync(real))("decodes the live repository's index, with ids in Tachiyomi's formula", () => {
    const decoded = decodeKeiyoushiIndex(fs.readFileSync(real));
    expect(decoded.signingKey).toBe("9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2");
    expect(decoded.extensions.length).toBeGreaterThan(1000);
    expect(decoded.extensions.every((e) => e.jarUrl.endsWith(".jar") && e.extensionLib === "1.6")).toBe(true);
    const gunnerkrigg = decoded.extensions.find((e) => e.name === "Gunnerkrigg Court")!;
    expect(gunnerkrigg.sources[0].id).toBe(sourceId("Gunnerkrigg Court", "en"));
  });
});
