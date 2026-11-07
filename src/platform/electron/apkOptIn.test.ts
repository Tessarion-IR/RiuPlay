import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readApkOptIn, writeApkOptIn } from "./apkOptIn";

describe("APK runtime opt-in", () => {
  it("is off unless the user turned it on, and off again when damaged", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "riuplay-apk-optin-"));
    try {
      expect(readApkOptIn(dir)).toBe(false);
      writeApkOptIn(dir, true);
      expect(readApkOptIn(dir)).toBe(true);
      writeApkOptIn(dir, false);
      expect(readApkOptIn(dir)).toBe(false);
      fs.writeFileSync(path.join(dir, "apk-runtime-optin.json"), '{"enabled":true}'); // no acknowledgement
      expect(readApkOptIn(dir)).toBe(false);
      fs.writeFileSync(path.join(dir, "apk-runtime-optin.json"), "{broken");
      expect(readApkOptIn(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
