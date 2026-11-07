import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "../../core/logger";
import { backupBeforeMigrating, type JournalLike } from "./preMigrationBackup";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import * as schema from "../../core/db/schema";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteInstance: Database.Database | null = null;

export const DB_PATH = path.join(app.getPath("userData"), "riuplay.db");
export const PRE_MIGRATION_BACKUP_DIR = path.join(app.getPath("userData"), "backups", "pre-migration");

export function getDb() {
  if (dbInstance) return dbInstance;
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqliteInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema });
  const migrationsFolder = app.isPackaged
    ? path.join(process.resourcesPath, "migrations")
    : path.join(app.getAppPath(), "src/core/db/migrations");
  // RiuPlay: snapshot an existing database before any pending migration runs (see
  // preMigrationBackup.ts). If the snapshot can't be written, this throws and nothing is migrated.
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf-8")) as JournalLike;
  const backup = backupBeforeMigrating(sqlite, journal, PRE_MIGRATION_BACKUP_DIR);
  if (backup) logger.info("db", `pre-migration backup written: ${backup}`);
  try {
    migrate(dbInstance, { migrationsFolder });
  } catch (error) {
    // drizzle runs the pending migrations in one transaction, so a failure leaves the database as
    // it was. Point at the snapshot anyway, for anyone reading the log after the fact.
    logger.error("db", `migration failed (database left unchanged${backup ? `; snapshot at ${backup}` : ""}): ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  return dbInstance;
}

// Backs up/restores (see main/backup.ts) both need the on-disk .db file to be a single,
// self-contained snapshot - WAL journal mode (see above) normally leaves recent writes sitting in
// a separate `-wal` file instead, which a plain copy of just `riuplay.db` would silently miss.
// TRUNCATE folds everything back into the main file and empties the WAL, rather than the default
// PASSIVE checkpoint, which only does that opportunistically when nothing else has the WAL open.
export function checkpointDb(): void {
  sqliteInstance?.pragma("wal_checkpoint(TRUNCATE)");
}

// Restoring a backup overwrites riuplay.db out from under this open handle - closing it first
// (rather than leaving better-sqlite3 to find out the hard way on its next query) means the next
// getDb() call after the app relaunches opens the freshly-restored file cleanly.
export function closeDb(): void {
  sqliteInstance?.close();
  sqliteInstance = null;
  dbInstance = null;
}
