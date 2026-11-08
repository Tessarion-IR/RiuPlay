import { describe, expect, it } from "vitest";
import { CATALOG_EXCLUDED_HOSTS, CATALOG_GAPS, SOURCE_CATALOG } from "@shared/sourceCatalog";

describe("built-in source catalog", () => {
  it("every entry is complete, HTTPS, dated, and never claims safety", () => {
    const ids = new Set<string>();
    for (const e of SOURCE_CATALOG) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      for (const url of [e.homepage, e.sourceCode, "indexUrl" in e.action ? e.action.indexUrl : null].filter(Boolean) as string[]) {
        expect(new URL(url).protocol).toBe("https:");
      }
      expect(e.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.name && e.description && e.maintenance).toBeTruthy();
      expect(`${e.description} ${e.maintenance}`).not.toMatch(/\b(safe|trusted|verified safe|reviewed by riuplay)\b/i);
    }
  });

  it("never offers the excluded hibiki-sources repository", () => {
    const text = JSON.stringify(SOURCE_CATALOG);
    for (const host of CATALOG_EXCLUDED_HOSTS) expect(text).not.toContain(host);
    expect(text).not.toMatch(/hibiki-sources/);
  });

  it("each category has an entry or an honest gap statement", () => {
    for (const category of ["anime", "manga", "audio"] as const) {
      const hasRepository = SOURCE_CATALOG.some((e) => e.category === category && e.action.kind !== "run-server");
      expect(hasRepository || Boolean(CATALOG_GAPS[category])).toBe(true);
    }
  });

  it("APK repositories say they need the opt-in Java runtime", () => {
    for (const e of SOURCE_CATALOG) if (e.action.kind === "add-repository" && e.action.requires === "apk-runtime") expect(e.cautions.join(" ")).toMatch(/full user rights/);
  });
});
