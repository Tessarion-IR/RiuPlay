// RiuPlay: schema migration safety. Exercises the real migration files in core/db/migrations, the
// way existing installations meet them: a database already at the previous schema (with data in
// it) upgraded to the current one, plus the pre-migration snapshot that guards that step.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, type MigrationJournal } from "../../core/db/migrate";
import { journal, sqlByTag } from "../../core/sync/syncDevices.testkit";
import { KEEP_BACKUPS, backupBeforeMigrating, pendingMigrations } from "./preMigrationBackup";

const MERGED = "0023_riuplay_merged_schema";
/** Every migration RiuPlay itself added on top of hibiki's, oldest first. All must be additive. */
const RIUPLAY_MIGRATIONS = [MERGED, "0024_riuplay_local_library"];
const NEW_TABLES = ["app_settings", "collection_items", "collections", "local_library", "local_media", "local_media_units", "local_progress"];

function upTo(tag: string): MigrationJournal {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`no migration ${tag}`);
  return { entries: journal.entries.slice(0, index + 1) };
}
const before = (tag: string) => {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  return journal.entries[index - 1].tag;
};

function migrate(db: DatabaseSync, target: MigrationJournal) {
  return applyMigrations(target, sqlByTag, {
    exec: async (sql) => void db.exec(sql),
    values: async (sql) => db.prepare(sql).all().map((row) => Object.values(row)),
  }, async (text) => createHash("sha256").update(text).digest("hex"));
}

const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
const count = (db: DatabaseSync, table: string) => Number((db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n);
const run = (db: DatabaseSync, sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);

/** Every table's full contents, for before/after comparison. */
function dump(db: DatabaseSync, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

describe("RiuPlay migrations (0023 onwards)", () => {
  it("are the newest migrations, in order, and only create tables and indexes", () => {
    expect(journal.entries.slice(-RIUPLAY_MIGRATIONS.length).map((entry) => entry.tag)).toEqual(RIUPLAY_MIGRATIONS);
    for (const tag of RIUPLAY_MIGRATIONS) {
      const statements = sqlByTag[tag].split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
      for (const statement of statements) expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) /);
    }
  });

  it("upgrades a database at the previous schema without changing any existing row", async () => {
    const db = new DatabaseSync(":memory:");
    await migrate(db, upTo(before(MERGED)));
    const oldTables = tables(db);
    expect(oldTables).not.toContain("local_media");

    run(db, "INSERT INTO library (anime_id, source_id, category, added_at, anime_json) VALUES ('a1', 's1', 'watching', 100, '{\"title\":\"One\"}')");
    run(db, "INSERT INTO library (anime_id, source_id, category, added_at, anime_json) VALUES ('a2', 's1', 'favorite', 200, '{}')");
    run(db, "INSERT INTO watch_progress (source_id, title_id, episode_id, episode_number, position_ms, duration_ms, updated_at) VALUES ('s1', 'a1', 'e1', 1, 5000, 60000, 300)");
    run(db, "INSERT INTO title_ratings (source_id, anime_id, rating, rated_at) VALUES ('s1', 'a1', 9, 400)");
    run(db, "INSERT INTO source_repositories (url, added_at) VALUES ('https://example.org/index.json', 1)");
    const snapshot = dump(db, oldTables.filter((name) => name !== "__drizzle_migrations"));

    expect(await migrate(db, journal)).toBe(RIUPLAY_MIGRATIONS.length);

    expect(tables(db)).toEqual([...oldTables, ...NEW_TABLES].sort());
    expect(dump(db, Object.keys(snapshot))).toEqual(snapshot);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // Running again is a no-op, as on every later launch.
    expect(await migrate(db, journal)).toBe(0);
  });

  it("migrates a brand-new database straight to the current schema", async () => {
    const db = new DatabaseSync(":memory:");
    expect(await migrate(db, journal)).toBe(journal.entries.length);
    for (const name of NEW_TABLES) expect(tables(db)).toContain(name);
  });

  describe("the new tables", () => {
    let db: DatabaseSync;
    beforeEach(async () => {
      db = new DatabaseSync(":memory:");
      await migrate(db, journal);
    });

    const addMedia = (type: string, origin = "direct", ref = "https://e.org/v.m3u8") =>
      run(db, "INSERT INTO local_media (content_type, title, origin, origin_ref, created_at, updated_at) VALUES (?, 'T', ?, ?, 1, 1)", type, origin, ref);

    it("accepts the three content types and rejects anything else", () => {
      addMedia("video", "direct", "a");
      addMedia("manga", "direct", "b");
      addMedia("audio", "direct", "c");
      expect(() => addMedia("anime", "direct", "d")).toThrow(/CHECK constraint failed/);
    });

    it("refuses a duplicate title from the same origin, as the prototype did", () => {
      addMedia("video");
      expect(() => addMedia("video")).toThrow(/UNIQUE constraint failed/);
      addMedia("video", "file", "https://e.org/v.m3u8");
      expect(count(db, "local_media")).toBe(2);
    });

    it("keeps units valid and removes them with their title", () => {
      addMedia("manga");
      const { id } = db.prepare("SELECT id FROM local_media").get() as { id: number };
      run(db, "INSERT INTO local_media_units (media_id, kind, number, pages_json, created_at) VALUES (?, 'chapter', 1, '[\"p1\"]', 1)", id);
      expect(() => run(db, "INSERT INTO local_media_units (media_id, kind, number, created_at) VALUES (?, 'page', 2, 1)", id)).toThrow(/CHECK constraint failed/);
      expect(() => run(db, "INSERT INTO local_media_units (media_id, kind, number, created_at) VALUES (999, 'episode', 1, 1)")).toThrow(/FOREIGN KEY constraint failed/);
      run(db, "DELETE FROM local_media WHERE id = ?", id);
      expect(count(db, "local_media_units")).toBe(0);
    });

    it("removes a collection's items with the collection, and nothing else", () => {
      run(db, "INSERT INTO library (anime_id, source_id, category, added_at, anime_json) VALUES ('a1', 's1', 'watching', 1, '{}')");
      run(db, "INSERT INTO collections (name, created_at, updated_at) VALUES ('Rewatch', 1, 1)");
      run(db, "INSERT INTO collection_items (collection_id, source_id, title_id, added_at) VALUES (1, 's1', 'a1', 1)");
      expect(() => run(db, "INSERT INTO collection_items (collection_id, source_id, title_id, added_at) VALUES (1, 's1', 'a1', 2)")).toThrow(/UNIQUE constraint failed/);
      run(db, "DELETE FROM collections WHERE id = 1");
      expect(count(db, "collection_items")).toBe(0);
      expect(count(db, "library")).toBe(1);
    });
  });
});

describe("pre-migration backup", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-premig-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("does nothing for a brand-new database", () => {
    const db = new DatabaseSync(":memory:");
    expect(pendingMigrations(db, journal)).toBeNull();
    expect(backupBeforeMigrating(db, journal, dir)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does nothing when the database is already current", async () => {
    const db = new DatabaseSync(":memory:");
    await migrate(db, journal);
    expect(pendingMigrations(db, journal)).toEqual([]);
    expect(backupBeforeMigrating(db, journal, dir)).toBeNull();
  });

  it("snapshots an older database, data included, before it is migrated", async () => {
    const file = path.join(dir, "riuplay.db");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    await migrate(db, upTo(before(MERGED)));
    run(db, "INSERT INTO library (anime_id, source_id, category, added_at, anime_json) VALUES ('kept', 's', 'watching', 1, '{}')");
    expect(pendingMigrations(db, journal)).toEqual(RIUPLAY_MIGRATIONS);

    const backup = backupBeforeMigrating(db, journal, path.join(dir, "backups"), new Date("2026-11-07T12:00:00Z"));
    expect(backup).toBe(path.join(dir, "backups", `riuplay-2026-11-07T12-00-00-000Z-before-${RIUPLAY_MIGRATIONS.at(-1)}.db`));

    const copy = new DatabaseSync(backup!);
    expect(copy.prepare("SELECT anime_id FROM library").all()).toEqual([{ anime_id: "kept" }]);
    expect(tables(copy)).not.toContain("local_media");
    expect(copy.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    copy.close();
    db.close();
  });

  it(`keeps only the newest ${KEEP_BACKUPS} snapshots`, async () => {
    const backups = path.join(dir, "backups");
    for (let i = 0; i < KEEP_BACKUPS + 3; i++) {
      const db = new DatabaseSync(":memory:");
      await migrate(db, upTo(before(MERGED)));
      backupBeforeMigrating(db, journal, backups, new Date(Date.UTC(2026, 0, 1 + i)));
      db.close();
    }
    const left = fs.readdirSync(backups).sort();
    expect(left).toHaveLength(KEEP_BACKUPS);
    expect(left[0]).toContain("2026-01-04");
    expect(left.at(-1)).toContain("2026-01-08");
  });
});
