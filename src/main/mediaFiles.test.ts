import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { on, openDevice } from "../core/sync/syncDevices.testkit";
import { createMediaApi } from "../core/media";
import { insertMedia } from "../core/media/media";
import { resolveMediaUrl } from "../core/media/resolve";
import { buildFromFiles, PickedPaths } from "./mediaFiles";
import { handleMediaRequest, parseRange } from "./mediaProtocol";

let dir: string;
const write = (rel: string, content: string | Buffer = "x") => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-media-"));
  on(await openDevice());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("building titles from picked files", () => {
  it("video: one episode per file in natural order, with a same-named .vtt as subtitles", async () => {
    const e10 = write("Show/Episode 10.mp4");
    const e2 = write("Show/Episode 2.mkv");
    write("Show/Episode 2.vtt", "WEBVTT");
    write("Show/notes.txt");
    const built = await buildFromFiles({ type: "video", paths: [e10, e2] });
    expect(built.units.map((u) => [u.number, u.title, u.url])).toEqual([
      [1, "Episode 2", e2],
      [2, "Episode 10", e10],
    ]);
    expect(built.units[0].subtitleUrl).toBe(path.join(dir, "Show", "Episode 2.vtt"));
    expect(built.units[1].subtitleUrl).toBeNull();
    expect(built).toMatchObject({ origin: "file", title: "Show" });
  });

  it("audio: a folder becomes an album with tracks, lyrics and its cover", async () => {
    write("Album/cover.jpg");
    write("Album/01 Intro.mp3");
    write("Album/01 Intro.lrc", "[00:01.00]hi");
    write("Album/CD2/02 Outro.flac");
    const built = await buildFromFiles({ type: "audio", paths: [path.join(dir, "Album")] });
    expect(built.title).toBe("Album");
    expect(built.cover).toBe(path.join(dir, "Album", "cover.jpg"));
    expect(built.units.map((u) => u.title)).toEqual(["01 Intro", "02 Outro"]);
    expect(built.units[0].subtitleUrl).toBe(path.join(dir, "Album", "01 Intro.lrc"));
  });

  it("manga: subfolders of images become chapters; a flat folder is one chapter", async () => {
    write("Comic/Chapter 10/001.png");
    write("Comic/Chapter 2/001.jpg");
    write("Comic/Chapter 2/002.jpg");
    write("Comic/Empty/readme.txt");
    const built = await buildFromFiles({ type: "manga", paths: [path.join(dir, "Comic")] });
    expect(built.units.map((u) => [u.number, u.title, u.pages?.length])).toEqual([
      [1, "Chapter 2", 2],
      [2, "Chapter 10", 1],
    ]);
    write("OneShot/p2.webp");
    write("OneShot/p10.webp");
    const flat = await buildFromFiles({ type: "manga", paths: [path.join(dir, "OneShot")] });
    expect(flat.units).toHaveLength(1);
    expect(flat.units[0].pages!.map((p) => path.basename(p))).toEqual(["p2.webp", "p10.webp"]);
  });

  it("refuses picks with nothing usable", async () => {
    await expect(buildFromFiles({ type: "video", paths: [write("a.txt")] })).rejects.toThrow(/No video files/);
    await expect(buildFromFiles({ type: "manga", paths: [write("b.jpg")] })).rejects.toThrow(/one folder/);
    fs.mkdirSync(path.join(dir, "empty"));
    await expect(buildFromFiles({ type: "manga", paths: [path.join(dir, "empty")] })).rejects.toThrow(/No images/);
  });
});

describe("only picked paths are accepted", () => {
  it("allows picked files and anything inside a picked folder, nothing else", () => {
    const picked = new PickedPaths();
    picked.remember([path.join(dir, "a.mp4")], "files");
    picked.remember([path.join(dir, "Album")], "folder");
    expect(picked.allows(path.join(dir, "a.mp4"))).toBe(true);
    expect(picked.allows(path.join(dir, "A.MP4"))).toBe(true);
    expect(picked.allows(path.join(dir, "Album", "CD2", "x.mp3"))).toBe(true);
    expect(picked.allows(path.join(dir, "Album2", "x.mp3"))).toBe(false);
    expect(picked.allows(path.join(dir, "Album", "..", "secret.txt"))).toBe(false);
    expect(picked.allows(path.join(dir, "b.mp4"))).toBe(false);
    expect(picked.allows("relative/a.mp4")).toBe(false);
  });
});

describe("riuplay-media:// resolution and serving", () => {
  async function importAlbum() {
    const track = write("Album/1.mp3", Buffer.from("0123456789"));
    const lyric = write("Album/1.lrc", "[00:00.00]x");
    const cover = write("Album/cover.png", "PNG");
    const { item } = await insertMedia({ type: "audio", title: "Album", origin: "file", originRef: path.join(dir, "Album"), cover, units: [{ number: 1, url: track, subtitleUrl: lyric }] });
    const details = (await createMediaApi().get(item.id))!;
    return { item: details.item, unit: details.units[0], track, lyric, cover };
  }

  it("resolves only URLs that point at stored local files", async () => {
    const { item, unit, track, lyric, cover } = await importAlbum();
    expect(unit.url).toBe(`riuplay-media://unit/${unit.id}`);
    expect(await resolveMediaUrl(unit.url)).toBe(track);
    expect(await resolveMediaUrl(unit.subtitleUrl!)).toBe(lyric);
    expect(await resolveMediaUrl(item.cover)).toBe(cover);
    expect(await resolveMediaUrl("riuplay-media://unit/999")).toBeNull();
    expect(await resolveMediaUrl("riuplay-media://unit/../../etc/passwd")).toBeNull();
    expect(await resolveMediaUrl(`riuplay-media://unit/${unit.id}?x=1`)).toBeNull();
    expect(await resolveMediaUrl("riuplay-media://file/C:/Windows/win.ini")).toBeNull();
    expect(await resolveMediaUrl("https://example.com/x")).toBeNull();
    // A title added by URL has no local file to serve.
    const remote = await createMediaApi().add({ type: "audio", origin: "direct", title: "R", units: [{ url: "https://a.example/1.mp3" }] });
    const [remoteUnit] = (await createMediaApi().get(remote.item.id))!.units;
    expect(await resolveMediaUrl(`riuplay-media://unit/${remoteUnit.id}`)).toBeNull();
  });

  it("serves the file with the right type and honours byte ranges", async () => {
    const { unit } = await importAlbum();
    const full = await handleMediaRequest(new Request(unit.url));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(await full.text()).toBe("0123456789");

    const part = await handleMediaRequest(new Request(unit.url, { headers: { range: "bytes=2-5" } }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");

    const bad = await handleMediaRequest(new Request(unit.url, { headers: { range: "bytes=50-60" } }));
    expect(bad.status).toBe(416);
    expect((await handleMediaRequest(new Request("riuplay-media://unit/424242"))).status).toBe(404);
  });

  it("reports a moved or deleted file as missing", async () => {
    const { unit, track } = await importAlbum();
    fs.rmSync(track);
    expect((await handleMediaRequest(new Request(unit.url))).status).toBe(404);
  });

  it("parses byte ranges, including suffix ranges", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=5-100", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=9-2", 10)).toBe("invalid");
    expect(parseRange("items=0-1", 10)).toBe("invalid");
  });
});
