import crypto from "crypto";

/**
 * Lightweight, local-only reversible obfuscation for the proxy password field.
 *
 * IMPORTANT / HONEST LIMITATION:
 * This project runs as a local web server backed by PostgreSQL rather than an
 * OS-level secure credential vault (e.g. Windows Credential Manager, which is
 * only reachable from native code such as a Tauri/Rust backend). Since no
 * native secure-storage API is available in this Next.js/Node environment,
 * we encrypt the password at rest with AES-256-GCM using a key derived from
 * a local-only secret file instead of storing it in plaintext. This is
 * better than plaintext but it is NOT equivalent to a hardware-backed
 * secure enclave or OS credential vault. This limitation is documented in
 * README.md under "Security notes".
 */

const KEY_ENV = "RIUPLAY_LOCAL_SECRET";

function getKey(): Buffer {
  const secret = process.env[KEY_ENV] || "riuplay-local-dev-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
