import { eq } from "drizzle-orm";
import type { HibikiApi } from "@shared/hibikiApi";
import type { RepositoryFetchResult } from "@shared/types";
import { sourceRepositories } from "../db/schema";
import { repositoryAlreadyAddedError } from "@shared/repositoryErrors";
import { fetchRepositoryResult, repositoryIndexCandidates, repositoryKey, resolveRepositoryUrl } from "../marketplace";
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

async function listRepositoryUrls(): Promise<string[]> {
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
export function createRepositoriesApi(): Pick<HibikiApi["sources"], "repositories" | "marketplace"> {
  return {
    repositories: {
      list: (): Promise<string[]> => listRepositoryUrls(),

      // Anything that points at a repository - its raw index, the index's page on GitHub, or the
      // repository itself - is saved as the raw index URL it resolves to, checked to be an index.
      async add(input: string): Promise<string[]> {
        let url: string;
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
        await getDb().delete(sourceRepositories).where(eq(sourceRepositories.url, url)).run();
        logger.info("sources", `repository removed: ${url}`);
        return listRepositoryUrls();
      },
    },

    marketplace: async (urls: string[]): Promise<RepositoryFetchResult[]> => {
      const results = await Promise.all(urls.map(fetchRepositoryResult));
      for (const result of results) {
        if (!result.ok) logger.warn("sources", `repository unavailable, ${result.url}: ${result.error ?? "?"}`);
      }
      return results;
    },
  };
}
