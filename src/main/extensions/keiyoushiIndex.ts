// RiuPlay K3: Keiyoushi's repository index, version 2. repo.json names the index ("index_v2") and the key the
// repository signs with ("meta.signingKeyFingerprint"); the index is a gzip'd protobuf message (Keiyoushi's
// .github/scripts/index.proto, from mihonapp/tachiyomix, with Resources.jarUrl as field 501). The old
// index.min.json now only serves an "Outdated App" placeholder. Decoded here with a small reader of the wire
// format - only the fields RiuPlay uses; unknown fields are skipped, as protobuf intends.
import zlib from "node:zlib";

export interface KeiyoushiSource {
  /** The source's id (int64), as the decimal string RiuPlay ids use ("apk:<id>"). */
  id: string;
  name: string;
  language: string;
  homeUrl: string;
}

export interface KeiyoushiExtension {
  name: string;
  packageName: string;
  apkUrl: string;
  iconUrl: string;
  /** The signed JVM jar built beside the APK: what RiuPlay installs. */
  jarUrl: string;
  extensionLib: string;
  versionCode: number;
  versionName: string;
  /** 0 unspecified, 1 safe, 2 mixed, 3 NSFW. */
  contentWarning: number;
  sources: KeiyoushiSource[];
}

export interface KeiyoushiIndex {
  name: string;
  signingKey: string;
  extensions: KeiyoushiExtension[];
}

type Field = { field: number; wire: number; value: bigint | Buffer };

const MAX_INDEX_BYTES = 64 * 1024 * 1024;

function varint(buffer: Buffer, at: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (let i = at; i < buffer.length && shift < 70n; i++) {
    const byte = buffer[i];
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if (byte < 0x80) return [result, i + 1];
  }
  throw new Error("Truncated varint in the repository index");
}

function fields(buffer: Buffer): Field[] {
  const out: Field[] = [];
  let at = 0;
  while (at < buffer.length) {
    const [key, next] = varint(buffer, at);
    at = next;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [value, after] = varint(buffer, at);
      at = after;
      out.push({ field, wire, value });
    } else if (wire === 2) {
      const [length, after] = varint(buffer, at);
      const end = after + Number(length);
      if (end > buffer.length) throw new Error("Truncated field in the repository index");
      out.push({ field, wire, value: buffer.subarray(after, end) });
      at = end;
    } else if (wire === 1) {
      at += 8;
    } else if (wire === 5) {
      at += 4;
    } else {
      throw new Error(`Unsupported wire type ${wire} in the repository index`);
    }
  }
  return out;
}

const text = (list: Field[], field: number) => {
  const hit = list.find((f) => f.field === field && f.wire === 2);
  return hit ? (hit.value as Buffer).toString("utf8") : "";
};
const integer = (list: Field[], field: number) => {
  const hit = list.find((f) => f.field === field && f.wire === 0);
  return hit ? (hit.value as bigint) : 0n;
};
const messages = (list: Field[], field: number) => list.filter((f) => f.field === field && f.wire === 2).map((f) => fields(f.value as Buffer));

/** Decodes a gzip'd (or plain) index.pb. */
export function decodeKeiyoushiIndex(data: Buffer): KeiyoushiIndex {
  const raw = data[0] === 0x1f && data[1] === 0x8b ? zlib.gunzipSync(data, { maxOutputLength: MAX_INDEX_BYTES }) : data;
  const top = fields(raw);
  const list = messages(top, 101)[0] ?? [];
  const extensions = messages(list, 1).map((e): KeiyoushiExtension => {
    const resources = messages(e, 3)[0] ?? [];
    return {
      name: text(e, 1),
      packageName: text(e, 2),
      apkUrl: text(resources, 1),
      iconUrl: text(resources, 2),
      jarUrl: text(resources, 501),
      extensionLib: text(e, 4),
      versionCode: Number(integer(e, 5)),
      versionName: text(e, 6),
      contentWarning: Number(integer(e, 7)),
      sources: messages(e, 8).map((s) => ({
        // int64 on the wire: a varint of the two's complement; Tachiyomi ids are positive (sign bit cleared).
        id: BigInt.asUintN(64, integer(s, 1)).toString(),
        name: text(s, 2),
        language: text(s, 3),
        homeUrl: text(s, 4),
      })),
    };
  });
  return { name: text(top, 1), signingKey: text(top, 3).toLowerCase(), extensions };
}

/** repo.json: where the v2 index is and the key the repository signs with. */
export function parseRepoJson(json: unknown): { indexUrl: string; fingerprint: string; name: string } | null {
  if (!json || typeof json !== "object") return null;
  const record = json as { index_v2?: unknown; meta?: { name?: unknown; signingKeyFingerprint?: unknown } };
  if (typeof record.index_v2 !== "string" || !/^https:\/\//.test(record.index_v2)) return null;
  const fingerprint = record.meta?.signingKeyFingerprint;
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(fingerprint)) return null;
  return { indexUrl: record.index_v2, fingerprint: fingerprint.toLowerCase(), name: typeof record.meta?.name === "string" ? record.meta.name : "" };
}
