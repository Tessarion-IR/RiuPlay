# Database, migrations, backups and recovery

RiuPlay keeps everything in one SQLite file, `%APPDATA%\RiuPlay\riuplay.db` (WAL mode, so `riuplay.db-wal` and `riuplay.db-shm` sit next to it while the app runs).

## How migrations run
- Schema: `src/core/db/schema.ts`. Migrations are generated with `npx drizzle-kit generate --name <name>` into `src/core/db/migrations/`, as SQL files plus `meta/_journal.json`.
- At startup `src/main/db/index.ts`:
  1. opens the database;
  2. **if it already exists and has pending migrations, writes a snapshot first** with `VACUUM INTO` (`src/main/db/preMigrationBackup.ts`) to `%APPDATA%\RiuPlay\backups\pre-migration\riuplay-<UTC time>-before-<newest migration>.db`. The last 5 snapshots are kept. If the snapshot can't be written, the app stops and does **not** migrate;
  3. runs drizzle's migrator, which applies every pending migration **in one transaction**. If any statement fails, everything rolls back, the database stays as it was, and the error is logged with the snapshot path.
- Brand-new databases have nothing to protect, so no snapshot is taken.

## Rules for new migrations
- Prefer additive changes (new tables, nullable or defaulted columns). Never drop or rewrite user data in a migration without a reviewed plan and an explicit note in `CHANGELOG.md`.
- Every migration needs a test in `src/main/db/migrations.test.ts`: upgrade from the previous schema with data present, assert pre-existing rows are byte-identical, and check `PRAGMA integrity_check` and `foreign_key_check`.
- Before release, run `scripts/verify-db-upgrade.ts` (below) against a real older database.

## Verifying an upgrade on a real database (never touches the original)
```bat
set ELECTRON_RUN_AS_NODE=1
node_modules\electron\dist\electron.exe node_modules\tsx\dist\cli.mjs scripts\verify-db-upgrade.ts "C:\path\to\copy-of\riuplay.db" "%TEMP%\riuplay-check"
```
The script copies the database (with `-wal`/`-shm`) into the work folder, snapshots it, migrates it with the same code the app uses, and reports added tables, whether every pre-existing table is unchanged, the integrity and foreign-key checks, and whether the snapshot matches. It prints `RESULT: PASS` or `RESULT: FAIL`.

## Rolling back / recovering
Migrations are forward-only: there are no "down" migrations, because they can't restore data a migration changed. To return to the state before an upgrade:
1. Quit RiuPlay completely (check the tray and Task Manager).
2. In `%APPDATA%\RiuPlay\`, move `riuplay.db`, `riuplay.db-wal` and `riuplay.db-shm` somewhere safe. Don't delete them.
3. Copy the snapshot you want from `backups\pre-migration\` to `%APPDATA%\RiuPlay\riuplay.db`.
4. Run the **older RiuPlay version** that matches that snapshot. A newer version would apply the same migrations again on startup, taking a fresh snapshot first.

Settings → Backup also offers full manual backups (database plus installed extensions) that you can restore inside the app.

## Migration history (RiuPlay-specific)
| Migration | Change | Data impact |
|---|---|---|
| 0000–0022 | Inherited from hibiki v3.3.0 | — |
| 0023_riuplay_merged_schema | New tables `app_settings`, `local_media`, `local_media_units`, `collections`, `collection_items` (from the original RiuPlay prototype model) | Additive only: no existing table or row changes. Verified on two real databases (598-title library and empty): 14/14 tables identical, integrity ok |
