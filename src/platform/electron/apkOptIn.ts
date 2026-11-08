// RiuPlay: the APK (Java) source host's on/off switch. Until K4 the host ran with the person's full Windows
// rights, so it was off unless they opted in. It now runs confined (AppContainer, Job Object, network only
// through RiuPlay's broker - apkHost.ts), so it is ON unless they switched it off. The choice is a small
// file in the profile, read synchronously at startup; a file that says enabled:false means off. Changing it
// takes effect on the next start.
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

/** True unless the person switched the confined host off. */
export function apkRuntimeEnabled(userData: string): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(userData, FILE), "utf8")) as { enabled?: unknown };
    return value.enabled !== false;
  } catch {
    return true;
  }
}

export function writeApkOptIn(userData: string, enabled: boolean): void {
  fs.writeFileSync(path.join(userData, FILE), JSON.stringify(enabled ? { enabled: true, acknowledgedAt: Date.now() } : { enabled: false }));
}
