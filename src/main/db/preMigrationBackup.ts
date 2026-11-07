// RiuPlay: a consistent snapshot of the user's database, taken before any schema migration touches
// it. drizzle's migrator already runs pending migrations inside one transaction (a failure rolls
// back), but a migration that *succeeds* and turns out wrong can't be undone that way - this copy
// is what makes that recoverable. See docs/DATABASE_MIGRATIONS.md for how to restore one.
//
// Written against the small surface both better-sqlite3 (the app, Electron ABI) and node:sqlite
// (the tests, plain Node) share, so the same code is exercised by the test suite.
import fs from "node:fs";
import path from "node:path";

export interface SqliteLike {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  exec(sql: string): unknown;
}

export interface JournalLike {
  entries: Array<{ tag: string; when: number }>;
}

/** Keep this many pre-migration snapshots; older ones are deleted, newest first kept. */
export const KEEP_BACKUPS = 5;

/** Tags of journal migrations the database has not applied yet, decided the way drizzle's SQLite
 * migrator decides it: every migration newer than the last applied one's `created_at`. Null when
 * the database has never been migrated (a brand-new file: nothing to protect). */
export function pendingMigrations(db: SqliteLike, journal: JournalLike): string[] | null {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!table) return null;
  const last = db.prepare("SELECT created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1").get() as
    | { createdAt: number | bigint | null }
    | undefined;
  const lastApplied = last?.createdAt == null ? -Infinity : Number(last.createdAt);
  return journal.entries.filter((entry) => entry.when > lastApplied).map((entry) => entry.tag);
}

/** Writes a snapshot of `db` into `backupDir` when it has pending migrations, and prunes old ones.
 * Returns the snapshot path, or null when no backup was needed. Throws if the snapshot can't be
 * written - the caller must then NOT migrate. */
export function backupBeforeMigrating(db: SqliteLike, journal: JournalLike, backupDir: string, now: Date = new Date()): string | null {
  const pending = pendingMigrations(db, journal);
  if (!pending || pending.length === 0) return null;

  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `riuplay-${stamp}-before-${pending[pending.length - 1]}.db`);
  // VACUUM INTO writes a transactionally consistent copy, WAL contents included, without closing
  // the connection. It refuses to overwrite an existing file, which is what we want.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) throw new Error(`pre-migration backup was not written: ${target}`);

  const snapshots = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("riuplay-") && name.endsWith(".db"))
    .sort()
    .reverse();
  for (const old of snapshots.slice(KEEP_BACKUPS)) fs.rmSync(path.join(backupDir, old), { force: true });
  return target;
}
