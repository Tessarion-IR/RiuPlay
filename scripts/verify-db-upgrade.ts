// Verifies that an existing RiuPlay/hibiki database upgrades safely with the code the desktop app
// runs (better-sqlite3 + drizzle's migrator + the pre-migration snapshot). Works on a COPY: the
// given database is never opened for writing.
//
//   set ELECTRON_RUN_AS_NODE=1
//   node_modules\electron\dist\electron.exe node_modules\tsx\dist\cli.mjs scripts\verify-db-upgrade.ts <db-file> <work-dir>
//
// (Electron's Node is needed because better-sqlite3 is built for Electron's ABI.)
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backupBeforeMigrating, pendingMigrations } from "../src/main/db/preMigrationBackup";

const [source, workDir] = process.argv.slice(2);
if (!source || !workDir) {
  console.error("usage: verify-db-upgrade.ts <db-file> <work-dir>");
  process.exit(2);
}
const migrationsFolder = path.resolve("src/core/db/migrations");
const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf-8"));

fs.mkdirSync(workDir, { recursive: true });
const copy = path.join(workDir, "upgrade-test.db");
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(copy + suffix, { force: true });
  if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copy + suffix);
}

const sqlite = new Database(copy);
sqlite.pragma("journal_mode = WAL");
const userTables = () =>
  (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
const snapshot = (names: string[]) =>
  Object.fromEntries(names.map((n) => [n, JSON.stringify(sqlite.prepare(`SELECT * FROM "${n}" ORDER BY rowid`).all())]));
const counts = (names: string[]) => Object.fromEntries(names.map((n) => [n, (sqlite.prepare(`SELECT count(*) AS c FROM "${n}"`).get() as { c: number }).c]));

const beforeTables = userTables();
const beforeData = snapshot(beforeTables);
const pending = pendingMigrations(sqlite, journal);
console.log(`source: ${source}`);
console.log(`tables before: ${beforeTables.length}; pending migrations: ${pending === null ? "(fresh db)" : pending.join(", ") || "none"}`);
console.log("row counts before:", JSON.stringify(counts(beforeTables)));

const backup = backupBeforeMigrating(sqlite, journal, path.join(workDir, "pre-migration"));
console.log(`pre-migration backup: ${backup ?? "(none needed)"}`);

migrate(drizzle(sqlite), { migrationsFolder });

const afterTables = userTables();
const unchanged = beforeTables.filter((n) => snapshot([n])[n] === beforeData[n]);
const changed = beforeTables.filter((n) => !unchanged.includes(n));
console.log(`tables after: ${afterTables.length}; added: ${afterTables.filter((n) => !beforeTables.includes(n)).join(", ") || "none"}`);
console.log(`pre-existing tables with identical contents: ${unchanged.length}/${beforeTables.length}${changed.length ? `; CHANGED: ${changed.join(", ")}` : ""}`);
console.log("integrity_check:", (sqlite.prepare("PRAGMA integrity_check").get() as Record<string, string>).integrity_check);
console.log("foreign_key_check violations:", sqlite.prepare("PRAGMA foreign_key_check").all().length);
console.log("pending after:", JSON.stringify(pendingMigrations(sqlite, journal)));
if (backup) {
  const b = new Database(backup, { readonly: true });
  const ok = beforeTables.every((n) => JSON.stringify(b.prepare(`SELECT * FROM "${n}" ORDER BY rowid`).all()) === beforeData[n]);
  console.log(`backup matches pre-migration data: ${ok}`);
  b.close();
}
sqlite.close();
const failed = changed.length > 0 || pendingMigrations(new Database(copy, { readonly: true }), journal)?.length !== 0;
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
