import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG_GAPS, ECOSYSTEM_REPOSITORY_URLS, SOURCE_CATALOG } from "@shared/sourceCatalog";

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

  it("offers Hibiki's anime repository as a third-party, one-click entry that is never trusted by default", () => {
    const hibiki = SOURCE_CATALOG.find((e) => e.id === "hibiki-sources")!;
    expect(hibiki.category).toBe("anime");
    expect(hibiki.action).toMatchObject({ kind: "add-repository", requires: null });
    expect(hibiki.cautions.join(" ")).toMatch(/not reviewed/i);
    expect(hibiki.cautions.join(" ")).toMatch(/no license/i);
    expect(ECOSYSTEM_REPOSITORY_URLS).toContain((hibiki.action as { indexUrl: string }).indexUrl);
  });

  it("each category has a source - a catalog repository or a built-in extension - or an honest gap statement", () => {
    const builtin = JSON.parse(readFileSync(fileURLToPath(new URL("../../extensions/official/index.json", import.meta.url)), "utf-8")) as { extensions: Array<{ contentType: string }> };
    const builtinTypes = new Set(builtin.extensions.map((e) => e.contentType));
    const asType = { anime: "video", manga: "manga", audio: "audio" } as const;
    for (const category of ["anime", "manga", "audio"] as const) {
      const hasRepository = SOURCE_CATALOG.some((e) => e.category === category && e.action.kind !== "run-server");
      expect(hasRepository || builtinTypes.has(asType[category]) || Boolean(CATALOG_GAPS[category])).toBe(true);
    }
  });

  it("APK repositories say they need the opt-in Java runtime", () => {
    for (const e of SOURCE_CATALOG) if (e.action.kind === "add-repository" && e.action.requires === "apk-runtime") expect(e.cautions.join(" ")).toMatch(/full user rights/);
  });
});
