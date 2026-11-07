import { beforeEach, describe, expect, it } from "vitest";
import { appSettings } from "./db/schema";
import { APP_SETTING_DEFAULTS, getAppSetting, setAppSetting } from "./appSettings";
import { on, openDevice, type Db } from "./sync/syncDevices.testkit";

let db: Db;
beforeEach(async () => {
  db = on(await openDevice());
});

describe("app settings", () => {
  it("defaults LAN sync to off on a fresh database", async () => {
    expect(APP_SETTING_DEFAULTS["lanSync.enabled"]).toBe(false);
    expect(await getAppSetting("lanSync.enabled")).toBe(false);
  });

  it("stores and replaces a value", async () => {
    await setAppSetting("lanSync.enabled", true);
    expect(await getAppSetting("lanSync.enabled")).toBe(true);
    await setAppSetting("lanSync.enabled", false);
    expect(await getAppSetting("lanSync.enabled")).toBe(false);
    expect(await db.select().from(appSettings).all()).toHaveLength(1);
  });

  it("reads a damaged or wrongly typed value as the safe default", async () => {
    await db.insert(appSettings).values({ key: "lanSync.enabled", value: "{not json", updatedAt: 1 }).run();
    expect(await getAppSetting("lanSync.enabled")).toBe(false);
    await db.update(appSettings).set({ value: '"true"' }).run();
    expect(await getAppSetting("lanSync.enabled")).toBe(false);
  });

  it("refuses to store a value of the wrong type", async () => {
    await expect(setAppSetting("lanSync.enabled", "yes" as unknown as boolean)).rejects.toThrow(TypeError);
  });
});
