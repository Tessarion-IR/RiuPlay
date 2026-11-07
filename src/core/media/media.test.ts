import { beforeEach, describe, expect, it } from "vitest";
import { cachedAnime, library, localLibrary, localMediaUnits, localProgress } from "../db/schema";
import { on, openDevice, type Db } from "../sync/syncDevices.testkit";
import { createMediaApi } from "./index";
import { COMPLETION_THRESHOLD, insertMedia, isUnitComplete, resumePosition } from "./media";

let db: Db;
const media = createMediaApi();

beforeEach(async () => {
  db = on(await openDevice());
});

const video = (title = "Show", urls = ["https://cdn.example/ep1.m3u8", "https://cdn.example/ep2.mp4"]) =>
  media.add({ type: "video", origin: "direct", title, units: urls.map((url) => ({ url })) });
const manga = (title = "Comic", chapters = [["https://img.example/1/1.jpg", "https://img.example/1/2.jpg", "https://img.example/1/3.jpg"], ["https://img.example/2/1.jpg"]]) =>
  media.add({ type: "manga", origin: "direct", title, units: chapters.map((pages) => ({ pages })) });
const audio = (title = "Album", urls = ["https://audio.example/1.mp3", "https://audio.example/2.mp3"]) =>
  media.add({ type: "audio", origin: "direct", title, units: urls.map((url) => ({ url })) });

describe("adding media", () => {
  it("adds a video by URL with its episodes, in order", async () => {
    const { item, existed } = await video();
    expect(existed).toBe(false);
    expect(item).toMatchObject({ type: "video", title: "Show", origin: "direct", originRef: "https://cdn.example/ep1.m3u8" });
    const details = (await media.get(item.id))!;
    expect(details.units.map((u) => [u.kind, u.number, u.url])).toEqual([
      ["episode", 1, "https://cdn.example/ep1.m3u8"],
      ["episode", 2, "https://cdn.example/ep2.mp4"],
    ]);
    expect(details.library).toBeNull();
  });

  it("adds manga chapters with pages and audio tracks, each with its own unit kind", async () => {
    const m = (await media.get((await manga()).item.id))!;
    expect(m.units.map((u) => [u.kind, u.pages.length])).toEqual([["chapter", 3], ["chapter", 1]]);
    const a = (await media.get((await audio()).item.id))!;
    expect(a.units.map((u) => u.kind)).toEqual(["track", "track"]);
  });

  it("returns the existing title for the same URL instead of a duplicate", async () => {
    const first = await video("First");
    const again = await video("Second name");
    expect(again.existed).toBe(true);
    expect(again.item.id).toBe(first.item.id);
    expect(await media.list()).toHaveLength(1);
  });

  it("keeps each hand-entered title separate, and can put it straight into the library", async () => {
    const a = await media.add({ type: "manga", origin: "manual", title: "Notes", libraryStatus: "planned" });
    const b = await media.add({ type: "manga", origin: "manual", title: "Notes" });
    expect(a.item.id).not.toBe(b.item.id);
    expect((await media.get(a.item.id))!.library).toMatchObject({ status: "planned", favorite: false });
  });

  it("rejects what is not a safe, well-formed title", async () => {
    await expect(media.add({ type: "video", origin: "direct", title: "x", units: [{ url: "file:///C:/secret.mp4" }] })).rejects.toThrow(/http\(s\) URL.*\(invalid\)/);
    await expect(media.add({ type: "video", origin: "direct", title: "x", units: [{ url: "javascript:alert(1)" }] })).rejects.toThrow(/invalid/);
    await expect(media.add({ type: "video", origin: "direct", title: "x", units: [] })).rejects.toThrow(/at least one/);
    await expect(media.add({ type: "manga", origin: "direct", title: "x", units: [{ url: "https://a.example/x" }] })).rejects.toThrow(/invalid/);
    await expect(media.add({ type: "audio", origin: "direct", title: "x", units: [{ url: "https://a.example/1.mp3", pages: ["https://a.example/p.jpg"] }] })).rejects.toThrow(/only chapters have pages/);
    await expect(media.add({ type: "video", origin: "manual", title: "   " })).rejects.toThrow(/title is required/);
    await expect(media.add({ type: "podcast" as never, origin: "manual", title: "x" })).rejects.toThrow(/invalid/);
    await expect(media.add({ type: "video", origin: "manual", title: "x", cover: "ftp://x/y.png" })).rejects.toThrow(/invalid/);
    await expect(media.add({ type: "video", origin: "manual", title: "x", extra: 1 } as never)).rejects.toThrow(/invalid/);
    expect(await media.list()).toEqual([]);
  });

  it("serves imported files through riuplay-media URLs and never exposes their paths", async () => {
    const { item } = await insertMedia({
      type: "manga",
      title: "Scans",
      origin: "file",
      originRef: "C:\\Users\\me\\Scans",
      cover: "C:\\Users\\me\\Scans\\cover.jpg",
      units: [{ number: 1, pages: ["C:\\Users\\me\\Scans\\01\\a.jpg", "C:\\Users\\me\\Scans\\01\\b.jpg"] }],
    });
    expect(item.originRef).toBe("");
    expect(item.cover).toBe(`riuplay-media://cover/${item.id}`);
    const [chapter] = (await media.get(item.id))!.units;
    expect(chapter.pages).toEqual([`riuplay-media://page/${chapter.id}/0`, `riuplay-media://page/${chapter.id}/1`]);
    expect(JSON.stringify(await media.get(item.id))).not.toContain("C:\\\\Users");
  });
});

describe("listing and editing", () => {
  it("filters by type, by text (wildcards taken literally) and by library membership", async () => {
    const v = await video("Frieren 100%");
    await manga("Berserk");
    await audio("Rain sounds");
    expect((await media.list({ type: "manga" })).map((s) => s.item.title)).toEqual(["Berserk"]);
    expect((await media.list({ search: "100%" })).map((s) => s.item.title)).toEqual(["Frieren 100%"]);
    expect(await media.list({ search: "%" })).toHaveLength(1);
    await media.setLibrary(v.item.id, { status: "active" });
    expect((await media.list({ inLibrary: true })).map((s) => s.item.id)).toEqual([v.item.id]);
    expect((await media.list({ type: "video" }))[0].unitCount).toBe(2);
  });

  it("updates metadata and numbers new units after the last one", async () => {
    const { item } = await video();
    expect((await media.update(item.id, { title: "Renamed", genres: ["Drama"] })).genres).toEqual(["Drama"]);
    const unit = await media.addUnit(item.id, { url: "https://cdn.example/ep3.mp4", title: "Finale" });
    expect(unit).toMatchObject({ number: 3, kind: "episode", title: "Finale" });
    await expect(media.addUnit(item.id, { pages: ["https://a.example/p.jpg"] })).rejects.toThrow(/invalid/);
    await expect(media.update(item.id, { cover: "javascript:x" })).rejects.toThrow(/invalid/);
  });

  it("removes a title with everything that hangs off it", async () => {
    const { item } = await video();
    const [unit] = (await media.get(item.id))!.units;
    await media.setLibrary(item.id, { status: "active" });
    await media.saveProgress(unit.id, 30_000, 600_000);
    const collection = await media.collections.create("Watch later");
    await media.collections.addItem(collection.id, { sourceId: "local", titleId: String(item.id) });

    await media.remove(item.id);
    expect(await media.get(item.id)).toBeNull();
    expect(await db.select().from(localMediaUnits).all()).toEqual([]);
    expect(await db.select().from(localProgress).all()).toEqual([]);
    expect(await db.select().from(localLibrary).all()).toEqual([]);
    expect(await media.collections.items(collection.id)).toEqual([]);
  });
});

describe("library", () => {
  it("sets, changes and clears a title's status; a favourite joins the library as planned", async () => {
    const { item } = await audio();
    expect(await media.setFavorite(item.id, true)).toMatchObject({ status: "planned", favorite: true });
    expect(await media.setLibrary(item.id, { status: "completed" })).toMatchObject({ status: "completed", favorite: true });
    expect(await media.setLibrary(item.id, null)).toBeNull();
    await expect(media.setLibrary(item.id, { status: "watching" as never })).rejects.toThrow(/invalid/);
    await expect(media.setLibrary(999, { status: "active" })).rejects.toThrow(/not-found/);
  });
});

describe("progress", () => {
  it("decides completion per unit kind", () => {
    expect(isUnitComplete("episode", COMPLETION_THRESHOLD * 1000, 1000)).toBe(true);
    expect(isUnitComplete("track", 800, 1000)).toBe(false);
    expect(isUnitComplete("chapter", 2, 3)).toBe(true);
    expect(isUnitComplete("chapter", 1, 3)).toBe(false);
    expect(isUnitComplete("episode", 10, 0)).toBe(false);
  });

  it("resumes only from somewhere worth resuming", () => {
    const p = (position: number, completed = false) => ({ unitId: 1, mediaId: 1, position, duration: 100_000, completed, updatedAt: 0 });
    expect(resumePosition("episode", p(5_000))).toBeNull();
    expect(resumePosition("episode", p(40_000))).toBe(40_000);
    expect(resumePosition("episode", p(99_000, true))).toBeNull();
    expect(resumePosition("chapter", p(4))).toBe(4);
  });

  it("saves progress, moves a planned title to active, and keeps a finished unit finished", async () => {
    const { item } = await video();
    const [ep1] = (await media.get(item.id))!.units;
    await media.setLibrary(item.id, { status: "planned" });
    expect(await media.saveProgress(ep1.id, 60_000, 1_000_000)).toMatchObject({ completed: false, position: 60_000 });
    expect((await media.get(item.id))!.library?.status).toBe("active");
    expect((await media.saveProgress(ep1.id, 950_000, 1_000_000)).completed).toBe(true);
    expect((await media.saveProgress(ep1.id, 1_000, 1_000_000)).completed).toBe(true);
    expect((await media.setUnitCompleted(ep1.id, false)).completed).toBe(false);
    await expect(media.saveProgress(ep1.id, -1, 10)).rejects.toThrow(/invalid/);
    await expect(media.saveProgress(ep1.id, Number.NaN, 10)).rejects.toThrow(/invalid/);
  });

  it("does not add a title to the library just because it was played", async () => {
    const { item } = await audio();
    const [track] = (await media.get(item.id))!.units;
    await media.saveProgress(track.id, 20_000, 200_000);
    expect((await media.get(item.id))!.library).toBeNull();
  });
});

describe("continue lists", () => {
  it("resume the unfinished unit, else the next one, per type and most recent first", async () => {
    const v = await video("Video A");
    const m = await manga("Manga A");
    const a = await audio("Audio A");
    const [ep1, ep2] = (await media.get(v.item.id))!.units;
    const [ch1] = (await media.get(m.item.id))!.units;
    const [tr1] = (await media.get(a.item.id))!.units;

    await media.saveProgress(ep1.id, 990_000, 1_000_000); // finished -> continue with ep2
    await media.saveProgress(ch1.id, 1, 3); // page 2 of 3
    await media.saveProgress(tr1.id, 30_000, 300_000);

    const watching = await media.continueList("video");
    expect(watching.map((e) => [e.item.title, e.unit.id, e.progress.position])).toEqual([["Video A", ep2.id, 0]]);
    expect(watching[0].next).toBeNull();
    expect((await media.continueList("manga")).map((e) => [e.unit.id, e.progress.position, e.next?.number])).toEqual([[ch1.id, 1, 2]]);
    expect((await media.continueList("audio")).map((e) => e.unit.id)).toEqual([tr1.id]);
  });

  it("drop a title whose last unit is finished", async () => {
    const v = await video("Done", ["https://cdn.example/only.mp4"]);
    const [only] = (await media.get(v.item.id))!.units;
    await media.saveProgress(only.id, 999_000, 1_000_000);
    expect(await media.continueList("video")).toEqual([]);
  });

  it("list the most recently touched title first and respect the limit", async () => {
    const first = await audio("First", ["https://audio.example/a.mp3"]);
    const second = await audio("Second", ["https://audio.example/b.mp3"]);
    const [a] = (await media.get(first.item.id))!.units;
    const [b] = (await media.get(second.item.id))!.units;
    await media.saveProgress(a.id, 20_000, 100_000);
    await new Promise((r) => setTimeout(r, 5));
    await media.saveProgress(b.id, 20_000, 100_000);
    expect((await media.continueList("audio")).map((e) => e.item.title)).toEqual(["Second", "First"]);
    expect(await media.continueList("audio", 1)).toHaveLength(1);
  });

  it("recently added lists newest first", async () => {
    await video("Old");
    await manga("New");
    expect((await media.recentlyAdded(5)).map((s) => s.item.title)).toEqual(["New", "Old"]);
  });
});

describe("collections", () => {
  it("hold local titles and source titles together, resolved for display", async () => {
    const { item } = await manga("Local manga");
    await db.insert(cachedAnime).values({ sourceId: "src", animeId: "a1", animeJson: JSON.stringify({ id: "a1", sourceId: "src", englishName: "Cached Anime", posterUrl: "https://p/1.jpg" }), cachedAt: 1 }).run();
    await db.insert(library).values({ sourceId: "src", animeId: "a2", category: "watching", addedAt: 1, animeJson: JSON.stringify({ id: "a2", sourceId: "src", originalName: "Library Anime" }) }).run();

    const c = await media.collections.create("  Favourites 2026  ", "mixed");
    expect(c).toMatchObject({ name: "Favourites 2026", itemCount: 0 });
    await media.collections.addItem(c.id, { sourceId: "local", titleId: String(item.id) });
    await media.collections.addItem(c.id, { sourceId: "src", titleId: "a1" });
    await media.collections.addItem(c.id, { sourceId: "src", titleId: "a2" });
    await media.collections.addItem(c.id, { sourceId: "src", titleId: "a2" }); // no duplicate
    await media.collections.addItem(c.id, { sourceId: "src", titleId: "unknown" });

    expect((await media.collections.list())[0].itemCount).toBe(4);
    const items = await media.collections.items(c.id);
    const byId = Object.fromEntries(items.map((i) => [i.titleId, i]));
    expect(byId[String(item.id)].local?.title).toBe("Local manga");
    expect(byId.a1.remote).toEqual({ title: "Cached Anime", cover: "https://p/1.jpg" });
    expect(byId.a2.remote?.title).toBe("Library Anime");
    expect(byId.unknown.remote).toBeNull();
    expect(await media.collections.of({ sourceId: "src", titleId: "a1" })).toEqual([c.id]);
    expect((await media.get(item.id))!.collectionIds).toEqual([c.id]);
  });

  it("rename, remove items, and delete without touching the titles", async () => {
    const { item } = await video();
    const c = await media.collections.create("A");
    await media.collections.addItem(c.id, { sourceId: "local", titleId: String(item.id) });
    expect((await media.collections.update(c.id, { name: "B" })).name).toBe("B");
    await media.collections.removeItem(c.id, { sourceId: "local", titleId: String(item.id) });
    expect(await media.collections.items(c.id)).toEqual([]);
    await media.collections.remove(c.id);
    expect(await media.collections.list()).toEqual([]);
    expect(await media.get(item.id)).not.toBeNull();
  });

  it("refuse bad input", async () => {
    await expect(media.collections.create("")).rejects.toThrow(/name is required/);
    const c = await media.collections.create("A");
    await expect(media.collections.addItem(c.id, { sourceId: "local", titleId: "424242" })).rejects.toThrow(/not-found/);
    await expect(media.collections.addItem(c.id, { sourceId: "", titleId: "x" })).rejects.toThrow(/invalid/);
    await expect(media.collections.addItem(999, { sourceId: "s", titleId: "x" })).rejects.toThrow(/not-found/);
  });
});
