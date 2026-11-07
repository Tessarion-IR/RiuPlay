// RiuPlay M2: APK (Aniyomi) sources run native Android code in a Java process with the user's full
// Windows rights - RiuPlay cannot sandbox that (Phase 7 R4). So the Java helper is OFF by default
// and starts only after the user turned it on in Settings, which they see with that warning. The
// choice is a small file in the profile, read synchronously at startup (before the database opens);
// a missing or unreadable file means off. Changing it takes effect on the next start.
import fs from "node:fs";
import path from "node:path";

const FILE = "apk-runtime-optin.json";

export function readApkOptIn(userData: string): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(userData, FILE), "utf8")) as { enabled?: unknown; acknowledgedAt?: unknown };
    return value.enabled === true && typeof value.acknowledgedAt === "number";
  } catch {
    return false;
  }
}

export function writeApkOptIn(userData: string, enabled: boolean): void {
  fs.writeFileSync(path.join(userData, FILE), JSON.stringify(enabled ? { enabled: true, acknowledgedAt: Date.now() } : { enabled: false }));
}
