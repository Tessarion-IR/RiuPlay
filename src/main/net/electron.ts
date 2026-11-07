// RiuPlay M3: the Electron piece behind the secure proxy store - Electron 45's asynchronous
// safeStorage (no synchronous safeStorage call). On Windows the data key is protected with DPAPI
// for the current Windows user and kept in this profile's "Local State": a copy of the database on
// another account or profile cannot decrypt it (it then loads as "unavailable" and fails closed).
import { safeStorage } from "electron";
import type { ProxyCipher } from "./secureProxyStore";
import { SecureProxyStore } from "./secureProxyStore";
import { appSettingsStore } from "./settingsStore";

export const asyncSafeStorageCipher: ProxyCipher = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptStringAsync(plaintext),
  decrypt: async (ciphertext) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(ciphertext);
    return { text: result, shouldReEncrypt: Boolean(shouldReEncrypt) };
  },
};

let store: SecureProxyStore | null = null;
/** The one store in the app: its write queue serializes every proxy write in the main process. */
export function secureProxyStore(): SecureProxyStore {
  store ??= new SecureProxyStore(appSettingsStore, asyncSafeStorageCipher);
  return store;
}
