// RiuPlay K3: a Keiyoushi (Tachiyomi extensions-lib 1.6) repository for the confined APK host. Read in the
// main process through NetClient: repo.json, then the v2 index it names, whose signing key must equal the
// fingerprint repo.json publishes. Each extension is installed from its signed jar (the index's jarUrl) and
// only when signed by that key - checked in a JVM of its own (ApkHostProcess.verify) and again by the host.
import type { MarketplaceExtension } from "@shared/types";
import { decodeKeiyoushiIndex, parseRepoJson, type KeiyoushiExtension } from "../../main/extensions/keiyoushiIndex";

/** Fetches a URL's bytes (NetClient, as an app request). */
export type FetchBytes = (url: string) => Promise<Buffer>;

export interface KeiyoushiRepository {
  fingerprint: string;
  extensions: KeiyoushiExtension[];
}

/** The extensions-lib versions the host implements (apk-host: eu/kanade/tachiyomi/source). */
export const SUPPORTED_MANGA_LIBS = ["1.6"];

/** Null when the URL is not a Keiyoushi v2 repository (no repo.json with index_v2). */
export async function readKeiyoushiRepository(url: string, fetchBytes: FetchBytes): Promise<KeiyoushiRepository | null> {
  let repo: ReturnType<typeof parseRepoJson>;
  try {
    repo = parseRepoJson(JSON.parse((await fetchBytes(url)).toString("utf8")));
  } catch {
    return null;
  }
  if (!repo) return null;
  const index = decodeKeiyoushiIndex(await fetchBytes(repo.indexUrl));
  if (index.signingKey !== repo.fingerprint) throw new Error("The repository's index is signed for another key than repo.json names - not used");
  return { fingerprint: repo.fingerprint, extensions: index.extensions };
}

/** The repository's extensions as marketplace cards: one per extension, standing for its English (or "all") source. */
export function keiyoushiCards(repository: KeiyoushiRepository): MarketplaceExtension[] {
  return repository.extensions.flatMap((e): MarketplaceExtension[] => {
    if (!e.packageName || !e.jarUrl.startsWith("https://") || e.sources.length === 0) return [];
    const source = e.sources.find((s) => s.language === "all") ?? e.sources.find((s) => s.language === "en") ?? e.sources[0];
    const languages = new Set(e.sources.map((s) => s.language));
    const supported = SUPPORTED_MANGA_LIBS.includes(e.extensionLib);
    return [{
      id: `apk:${source.id}`,
      name: e.name,
      version: e.versionName,
      website: source.homeUrl || null,
      iconUrl: e.iconUrl || null,
      lang: languages.size > 1 ? "all" : source.language || "all",
      capabilities: [],
      resolverDependencies: [],
      // 3 is NSFW; 2 ("mixed") is marked too, so the default filter hides both.
      isNsfw: e.contentWarning === 3 || e.contentWarning === 2,
      type: "source",
      manifestUrl: e.jarUrl,
      apkPackage: e.packageName,
      contentType: "manga",
      signingFingerprint: repository.fingerprint,
      ...(supported ? {} : { compatibility: { compatible: false, reason: `Needs Tachiyomi extensions-lib ${e.extensionLib}` } }),
    }];
  });
}

/** The jar to install for a package and the key it must be signed with, read again from the repository. */
export async function keiyoushiInstallTarget(repositoryUrl: string, packageName: string, fetchBytes: FetchBytes): Promise<{ jarUrl: string; fingerprint: string } | null> {
  const repository = await readKeiyoushiRepository(repositoryUrl, fetchBytes);
  if (!repository) return null;
  const entry = repository.extensions.find((e) => e.packageName === packageName);
  if (!entry) throw new Error(`${packageName} is not in the repository`);
  if (!SUPPORTED_MANGA_LIBS.includes(entry.extensionLib)) throw new Error(`${entry.name} needs Tachiyomi extensions-lib ${entry.extensionLib}`);
  return { jarUrl: entry.jarUrl, fingerprint: repository.fingerprint };
}
