// RiuPlay: the built-in DISCOVERY catalog - places a fresh install can start from, by category.
// It is data, not trust and not installation:
//   - nothing here is added, installed or run automatically; adding a repository is an explicit
//     user action, the repository then starts "not reviewed" (M1), and installing an extension
//     from it is a second, separate choice with its own permission dialog;
//   - every entry records what was checked, where, and when; nothing claims "safe" or "reviewed";
//   - a category without a suitable verified option says so instead of being padded.
// The old hibiki-sources repository is deliberately absent (no license, single-owner control,
// unsigned scripts, NSFW content - docs/EXTENSION_REPOSITORY_AUDIT.md).
// To update: re-check each entry's page, then update `checked` and the facts. Tested by
// sourceCatalog.test.ts (shape, HTTPS, no excluded repositories).

export type CatalogCategory = "anime" | "manga" | "audio";

/** What the user can do with an entry. */
export type CatalogAction =
  /** A repository RiuPlay itself can add (Sources > Repositories). */
  | { kind: "add-repository"; indexUrl: string; requires: "apk-runtime" | null }
  /** A repository to add in the user's OWN Suwayomi server (RiuPlay can't run Mihon extensions itself). */
  | { kind: "add-in-suwayomi"; indexUrl: string }
  /** Server software the user runs themselves, then connects in Settings > Media servers. */
  | { kind: "run-server"; connectAs: "suwayomi" | "kikoeru" };

export interface CatalogEntry {
  id: string;
  category: CatalogCategory;
  name: string;
  description: string;
  /** Project page (where the facts below were read). */
  homepage: string;
  /** Where the code lives, when it is not the homepage. */
  sourceCode: string | null;
  /** As shown by the project; null when the page showed none. */
  license: string | null;
  /** Only what the project page showed; never a judgement of safety. */
  maintenance: string;
  /** Things the user should know before using it. */
  cautions: string[];
  action: CatalogAction;
  /** ISO date the facts were last checked. */
  checked: string;
}

export const CATALOG_CHECKED = "2026-11-08";

export const SOURCE_CATALOG: readonly CatalogEntry[] = [
  {
    id: "yuzono-anime-extensions",
    category: "anime",
    name: "Anime extensions (yuzono)",
    description: "Aniyomi/Anikku-format anime extensions, served as an APK repository.",
    homepage: "https://github.com/yuzono/anime-extensions",
    sourceCode: "https://github.com/yuzono/anime-extensions",
    license: "Apache-2.0",
    maintenance: "Public, not archived, with open issues and pull requests when checked.",
    cautions: [
      "APK extensions run native code in a Java process with your full user rights; RiuPlay runs them only after you turn on APK sources in Settings.",
      "The built repository's page appeared under a different account (mojuru/anime-repo) than its source code when checked; its README gives this index address.",
      "Not reviewed by RiuPlay. Sites the extensions reach are third parties.",
    ],
    action: { kind: "add-repository", indexUrl: "https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json", requires: "apk-runtime" },
    checked: CATALOG_CHECKED,
  },
  {
    id: "keiyoushi-extensions",
    category: "manga",
    name: "Keiyoushi extensions (for your Suwayomi server)",
    description: "Mihon/Tachiyomi-format manga extensions. Add this repository in your Suwayomi server's own settings; RiuPlay then reads through the server.",
    homepage: "https://github.com/keiyoushi/extensions",
    sourceCode: "https://github.com/keiyoushi/extensions-source",
    license: "Apache-2.0 (source code)",
    maintenance: "Public, not archived; the source repository had several thousand commits and open pull requests when checked.",
    cautions: ["Runs inside your Suwayomi server, not in RiuPlay.", "Not reviewed by RiuPlay. Sites the extensions reach are third parties."],
    action: { kind: "add-in-suwayomi", indexUrl: "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json" },
    checked: CATALOG_CHECKED,
  },
  {
    id: "suwayomi-server",
    category: "manga",
    name: "Suwayomi-Server",
    description: "A self-hosted manga server that runs Mihon (Tachiyomi) extensions. Run it yourself, then connect it under Settings > Media servers.",
    homepage: "https://github.com/Suwayomi/Suwayomi-Server",
    sourceCode: null,
    license: "MPL-2.0",
    maintenance: "Public, not archived, with open issues and pull requests when checked.",
    cautions: ["Software you install and run yourself; RiuPlay only talks to it."],
    action: { kind: "run-server", connectAs: "suwayomi" },
    checked: CATALOG_CHECKED,
  },
  {
    id: "kikoeru-express",
    category: "audio",
    name: "Kikoeru (kikoeru-express)",
    description: "A self-hosted server for your own audio works collection (doujin voice works / ASMR). Run it yourself, then connect it under Settings > Media servers.",
    homepage: "https://github.com/kikoeru-project/kikoeru-express",
    sourceCode: null,
    license: "GPL-3.0",
    maintenance: "Public, not archived, with open issues when checked.",
    cautions: ["Serves files you already have; it has no online source repositories.", "Software you install and run yourself; RiuPlay only talks to it."],
    action: { kind: "run-server", connectAs: "kikoeru" },
    checked: CATALOG_CHECKED,
  },
];

/** Shown for a category with no verified source repository. */
export const CATALOG_GAPS: Partial<Record<CatalogCategory, string>> = {
  audio: "No audio or ASMR source repository could be verified for RiuPlay. Your own files, links, and your own Kikoeru server work today.",
};

/** Repositories never offered by the catalog (and never added by default). */
export const CATALOG_EXCLUDED_HOSTS: readonly string[] = ["raw.githubusercontent.com/akkirrai1337/hibiki-sources"];
