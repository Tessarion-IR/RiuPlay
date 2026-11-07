// RiuPlay M3: the Electron/app pieces behind the secure proxy store - Electron 45's asynchronous
// safeStorage (no synchronous safeStorage call) and the app_settings table.
import { safeStorage } from "electron";
import { eq } from "drizzle-orm";
import { appSettings } from "../../core/db/schema";
import { getPlatform } from "../../core/platform";
import type { ProxyCipher, SettingsStore } from "./secureProxyStore";
import { SecureProxyStore } from "./secureProxyStore";

export const asyncSafeStorageCipher: ProxyCipher = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptStringAsync(plaintext),
  decrypt: async (ciphertext) => (await safeStorage.decryptStringAsync(ciphertext)).result,
};

/** Only the key it is asked for - this store never lists or reads other settings. */
export const appSettingsStore: SettingsStore = {
  async get(key) {
    const row = await getPlatform().db.get().select().from(appSettings).where(eq(appSettings.key, key)).get();
    return row?.value ?? null;
  },
  async set(key, value) {
    const updatedAt = Date.now();
    await getPlatform().db.get().insert(appSettings).values({ key, value, updatedAt }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } }).run();
  },
  async delete(key) {
    await getPlatform().db.get().delete(appSettings).where(eq(appSettings.key, key)).run();
  },
};

let store: SecureProxyStore | null = null;
export function secureProxyStore(): SecureProxyStore {
  store ??= new SecureProxyStore(appSettingsStore, asyncSafeStorageCipher);
  return store;
}
