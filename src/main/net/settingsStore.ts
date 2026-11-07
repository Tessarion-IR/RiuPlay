// RiuPlay M3: the app_settings table as the secure proxy store's key/value backend. Only the key it
// is asked for - this never lists or reads other settings. The conditional writes are one SQL
// statement each (atomic in SQLite) and report success through RETURNING, which every drizzle
// SQLite driver passes back (unlike a driver-specific change count).
import { and, eq } from "drizzle-orm";
import { appSettings } from "../../core/db/schema";
import { getPlatform } from "../../core/platform";
import type { SettingsStore } from "./secureProxyStore";

const db = () => getPlatform().db.get();

export const appSettingsStore: SettingsStore = {
  async get(key) {
    const row = await db().select().from(appSettings).where(eq(appSettings.key, key)).get();
    return row?.value ?? null;
  },
  async set(key, value) {
    const updatedAt = Date.now();
    await db().insert(appSettings).values({ key, value, updatedAt }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } }).run();
  },
  async delete(key) {
    await db().delete(appSettings).where(eq(appSettings.key, key)).run();
  },
  async insertIfAbsent(key, value) {
    const rows = await db().insert(appSettings).values({ key, value, updatedAt: Date.now() }).onConflictDoNothing().returning({ key: appSettings.key }).all();
    return rows.length > 0;
  },
  async replaceIfEquals(key, expected, next) {
    const where = and(eq(appSettings.key, key), eq(appSettings.value, expected));
    const rows =
      next === null
        ? await db().delete(appSettings).where(where).returning({ key: appSettings.key }).all()
        : await db().update(appSettings).set({ value: next, updatedAt: Date.now() }).where(where).returning({ key: appSettings.key }).all();
    return rows.length > 0;
  },
};
