import { eq } from "drizzle-orm";
import type { HibikiApi } from "@shared/hibikiApi";
import type { MarketplaceExtension, RepositoryFetchResult, RepositoryInfo } from "@shared/types";
import { compatibilityOf, describePermissions } from "../extensions/lifecycle";
import { forgetRepositoryState, isRepositoryEnabled, recordRepositoryCheck, repositoryInfos, repositoryStateOf, setRepositoryEnabled, setRepositoryTrust } from "./extensionState";
import { sourceRepositories } from "../db/schema";
import { repositoryAlreadyAddedError } from "@shared/repositoryErrors";
import { BUILTIN_REPOSITORY_URL, fetchRepositoryResult, hasBuiltinRepository, isBuiltinRepositoryUrl, repositoryIndexCandidates, repositoryKey, resolveRepositoryUrl } from "../marketplace";
import { logger } from "../logger";
import { getPlatform } from "../platform";

const getDb = () => getPlatform().db.get();

// RiuPlay ships with NO preinstalled repository. hibiki seeded its own hibiki-sources index (and,
// where APK sources run, the yuzono Aniyomi index) into every fresh install. RiuPlay does not: those
// are third-party repositories RiuPlay neither owns nor reviews, hibiki-sources carries no license,
// and their scripts run with the app's rights (see SECURITY.md and
// docs/EXTENSION_REPOSITORY_AUDIT.md). Users add repositories themselves, behind the trust prompt.
// Existing installs keep whatever their list already holds - nothing is removed from user data.
// marketplace.ts keeps DEFAULT_REPOSITORY_URL / DEFAULT_APK_REPOSITORY_URL only as known addresses
// (legacy import on Android matches against the APK one); they are never added automatically.

// RiuPlay M7: the built-in repository (RiuPlay's own, bundled, hash-checked extensions) is always
// listed first. It is not a row in source_repositories: it can be disabled, but not removed.
async function listRepositoryUrls(): Promise<string[]> {
  const builtin = hasBuiltinRepository() ? [BUILTIN_REPOSITORY_URL] : [];
  return [...builtin, ...(await listStoredRepositoryUrls())];
}

async function listStoredRepositoryUrls(): Promise<string[]> {
  const rows = await getDb().select().from(sourceRepositories).all();
  // One URL per repository: copies saved before add() compared addresses (another spelling of the
  // same index) go, the earliest-added one stays.
  const seen = new Set<string>();
  const kept = new Set<string>();
  for (const { url } of [...rows].sort((a, b) => a.addedAt - b.addedAt)) {
    const key = repositoryKey(url);
    if (seen.has(key)) {
      await getDb().delete(sourceRepositories).where(eq(sourceRepositories.url, url)).run();
      logger.info("sources", `duplicate repository removed: ${url}`);
      continue;
    }
    seen.add(key);
    kept.add(url);
  }
  return rows.map((r) => r.url).filter((url) => kept.has(url));
}

/** Throws when the list already holds this repository under any spelling of its address. */
async function assertNotListed(url: string): Promise<void> {
  const key = repositoryKey(url);
  const existing = (await listRepositoryUrls()).find((listed) => repositoryKey(listed) === key);
  if (existing) throw repositoryAlreadyAddedError(existing);
}

/** The repository list and marketplace browsing parts of `window.hibiki.sources`. */
/** RiuPlay M1: what the Sources screen needs per entry - computed from metadata only, no code run. */
export function annotateEntry(extension: MarketplaceExtension): MarketplaceExtension {
  const compatibility = compatibilityOf(extension, { apkSources: Boolean(getPlatform().apkSources) });
  return {
    ...extension,
    compatibility: compatibility.compatible ? { compatible: true, reason: null } : { compatible: false, reason: compatibility.reason },
    permissionList: describePermissions(extension),
  };
}

/** The repository details, the built-in repository first: reviewed (it is RiuPlay's own) unless the
 * user changed that, enabled unless the user disabled it. */
async function builtinFirst(): Promise<RepositoryInfo[]> {
  await listStoredRepositoryUrls(); // drops duplicate spellings first
  const infos = await repositoryInfos();
  if (!hasBuiltinRepository()) return infos;
  const state = await repositoryStateOf(BUILTIN_REPOSITORY_URL);
  return [
    {
      url: BUILTIN_REPOSITORY_URL,
      addedAt: 0,
      enabled: state?.enabled ?? true,
      trust: state?.trust ?? "trusted",
      trustedAt: state?.trustedAt ?? null,
      name: "RiuPlay (built-in)",
      lastCheckedAt: state?.lastCheckedAt ?? null,
      lastError: state?.lastError ?? null,
      builtin: true,
    },
    ...infos,
  ];
}

export function createRepositoriesApi(): Pick<HibikiApi["sources"], "repositories" | "marketplace"> {
  return {
    repositories: {
      list: (): Promise<string[]> => listRepositoryUrls(),

      // Anything that points at a repository - its raw index, the index's page on GitHub, or the
      // repository itself - is saved as the raw index URL it resolves to, checked to be an index.
      async add(input: string): Promise<string[]> {
        let url: string;
        if (isBuiltinRepositoryUrl(input.trim())) throw repositoryAlreadyAddedError(BUILTIN_REPOSITORY_URL);
        try {
          // A direct index address is checked before anything is fetched: re-adding one needs no network.
          const candidates = repositoryIndexCandidates(input);
          if (candidates.length === 1) await assertNotListed(candidates[0]);
          url = await resolveRepositoryUrl(input);
          await assertNotListed(url);
        } catch (error) {
          logger.warn("sources", `repository not added, ${input}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
        await getDb().insert(sourceRepositories).values({ url, addedAt: Date.now() }).onConflictDoNothing().run();
        logger.info("sources", `repository added: ${url}`);
        return listRepositoryUrls();
      },

      async remove(url: string): Promise<string[]> {
        if (isBuiltinRepositoryUrl(url)) throw new Error("The built-in RiuPlay repository can't be removed; you can disable it instead");
        // Only the repository entry and its state go: installed extensions stay installed (and
        // keep working) - removing them is a separate choice. No media, library or history row
        // refers to a repository.
        await getDb().delete(sourceRepositories).where(eq(sourceRepositories.url, url)).run();
        await forgetRepositoryState(url);
        logger.info("sources", `repository removed: ${url}`);
        return listRepositoryUrls();
      },

      details: async () => builtinFirst(),
      async setEnabled(url: string, enabled: boolean) {
        if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
        await setRepositoryEnabled(url, enabled);
        logger.info("sources", `repository ${enabled ? "enabled" : "disabled"}: ${url}`);
        return builtinFirst();
      },
      async setTrust(url: string, trust: "untrusted" | "trusted") {
        if (trust !== "trusted" && trust !== "untrusted") throw new TypeError("trust must be trusted or untrusted");
        await setRepositoryTrust(url, trust);
        logger.info("sources", `repository marked ${trust}: ${url}`);
        return builtinFirst();
      },
    },

    marketplace: async (urls: string[]): Promise<RepositoryFetchResult[]> => {
      // RiuPlay M1: a disabled repository is not fetched at all.
      const enabled: string[] = [];
      for (const url of urls) if (await isRepositoryEnabled(url)) enabled.push(url);
      const results = await Promise.all(enabled.map(fetchRepositoryResult));
      for (const result of results) {
        if (!result.ok) logger.warn("sources", `repository unavailable, ${result.url}: ${result.error ?? "?"}`);
        await recordRepositoryCheck(result.url, result.ok ? { ok: true } : { ok: false, error: result.error }).catch(() => undefined);
      }
      return results.map((result) => (result.ok ? { ...result, extensions: result.extensions.map(annotateEntry) } : result));
    },
  };
}
