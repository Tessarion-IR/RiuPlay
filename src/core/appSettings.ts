// RiuPlay: settings kept in the database (app_settings) rather than the renderer's stores, for the
// ones the main process must know before any window exists - LAN sync being off or on is the first.
// Values are JSON; a missing or unreadable value reads as the caller's fallback, never as an error,
// so a damaged row can't stop the app from starting.
import { eq } from "drizzle-orm";
import { appSettings } from "./db/schema";
import { getPlatform } from "./platform";

const getDb = () => getPlatform().db.get();

/** Known keys and their defaults. Anything security-relevant defaults to the safe value. */
export const APP_SETTING_DEFAULTS = {
  /** LAN device sync: listening sockets, discovery answers and background syncs. Off until the user turns it on. */
  "lanSync.enabled": false,
} as const;

export type AppSettingKey = keyof typeof APP_SETTING_DEFAULTS;
type ValueOf<K extends AppSettingKey> = (typeof APP_SETTING_DEFAULTS)[K] extends boolean ? boolean : (typeof APP_SETTING_DEFAULTS)[K];

export async function getAppSetting<K extends AppSettingKey>(key: K): Promise<ValueOf<K>> {
  const fallback = APP_SETTING_DEFAULTS[key] as ValueOf<K>;
  const row = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (!row) return fallback;
  try {
    const value = JSON.parse(row.value) as unknown;
    return typeof value === typeof fallback ? (value as ValueOf<K>) : fallback;
  } catch {
    return fallback;
  }
}

export async function setAppSetting<K extends AppSettingKey>(key: K, value: ValueOf<K>): Promise<void> {
  if (typeof value !== typeof APP_SETTING_DEFAULTS[key]) throw new TypeError(`setting ${key} must be a ${typeof APP_SETTING_DEFAULTS[key]}`);
  const json = JSON.stringify(value);
  const updatedAt = Date.now();
  await getDb()
    .insert(appSettings)
    .values({ key, value: json, updatedAt })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: json, updatedAt } })
    .run();
}
