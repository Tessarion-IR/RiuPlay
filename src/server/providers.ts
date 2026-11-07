import { z } from "zod";
import { safeFetchJson, sanitizeText, isHttpUrl, NetError } from "@/server/net";
import type { ProxySettings } from "@/lib/types";

// ---------------------------------------------------------------------------
// Tachiyomi/Aniyomi-style repository index parsing (yuzono / keiyoushi format)
// ---------------------------------------------------------------------------
// Verified live against:
//   https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json
//   https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json
// Both expose a JSON array of entries shaped like:
//   { name, pkg, apk, lang, code, version, nsfw, sources: [{name, lang, id, baseUrl}] }
// These are compiled Android APK packages targeting the Aniyomi/Mihon (Kotlin)
// extension runtime. RiuPlay is a Node/Next.js web application and cannot
// execute Android/Kotlin bytecode in-process. We treat all parsed entries as
// metadata-only and mark their install format as unsupported in this build
// (see README "Extension compatibility" section) rather than pretending they
// can be installed or executed natively.

const RepoSourceSchema = z.object({
  name: z.string().optional().default(""),
  lang: z.string().optional().default("all"),
  id: z.string().optional().default(""),
  baseUrl: z.string().optional().default(""),
});

const RepoEntrySchema = z.object({
  name: z.string(),
  pkg: z.string(),
  apk: z.string().optional().default(""),
  lang: z.string().optional().default("all"),
  code: z.union([z.number(), z.string()]).optional(),
  version: z.union([z.string(), z.number()]).optional().default("0.0.0"),
  nsfw: z.union([z.number(), z.boolean()]).optional().default(0),
  sources: z.array(RepoSourceSchema).optional().default([]),
});

const RepoIndexSchema = z.array(RepoEntrySchema).max(5000);

export interface ParsedExtension {
  pkgName: string;
  name: string;
  version: string;
  lang: string;
  author: string;
  iconUrl: string | null;
  nsfw: boolean;
  format: "apk";
  rawMeta: Record<string, unknown>;
}

export class RepoParseError extends Error {}

/**
 * Fetches and strictly validates a remote repository index. Treats all
 * remote data as untrusted: unknown fields are ignored, text fields are
 * length-capped, and non-conforming documents are rejected rather than
 * partially trusted.
 */
export async function fetchRepositoryIndex(
  url: string,
  proxy?: ProxySettings | null,
): Promise<ParsedExtension[]> {
  if (!isHttpUrl(url)) {
    throw new RepoParseError("Repository URL must be a valid http(s) URL.");
  }
  let raw: unknown;
  try {
    raw = await safeFetchJson<unknown>(url, { proxy, maxBytes: 12 * 1024 * 1024 });
  } catch (err) {
    if (err instanceof NetError) throw new RepoParseError(err.message);
    throw new RepoParseError("Failed to fetch repository index.");
  }

  const result = RepoIndexSchema.safeParse(raw);
  if (!result.success) {
    throw new RepoParseError(
      "Repository index did not match the expected Aniyomi/Tachiyomi index.min.json schema.",
    );
  }

  return result.data.map((entry) => {
    const primarySource = entry.sources[0];
    return {
      pkgName: sanitizeText(entry.pkg, 300) || entry.pkg,
      name: sanitizeText(entry.name, 200) || entry.pkg,
      version: String(entry.version ?? "0.0.0").slice(0, 40),
      lang: sanitizeText(entry.lang, 20) || "all",
      author: sanitizeText(primarySource?.name, 120) || "Unknown",
      iconUrl: null,
      nsfw: Boolean(entry.nsfw),
      format: "apk" as const,
      rawMeta: {
        apk: sanitizeText(entry.apk, 300),
        sources: entry.sources.slice(0, 50).map((s) => ({
          name: sanitizeText(s.name, 120),
          lang: sanitizeText(s.lang, 20),
          id: sanitizeText(s.id, 64),
          baseUrl: isHttpUrl(s.baseUrl) ? s.baseUrl : "",
        })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Suwayomi Server client (REST /api/v1) — see README "Manga server" section.
// Verified against Suwayomi-Server CONTRIBUTING.md and public API docs:
// REST endpoints live under {baseUrl}/api/v1/*, Swagger UI at /api/swagger-ui.
// ---------------------------------------------------------------------------

export interface SuwayomiAbout {
  name?: string;
  version?: string;
  revision?: string;
  buildType?: string;
  buildTime?: number;
  [key: string]: unknown;
}

export async function suwayomiTestConnection(baseUrl: string, proxy?: ProxySettings | null) {
  if (!isHttpUrl(baseUrl)) {
    return { connected: false as const, error: "Server URL must be a valid http(s) URL." };
  }
  const normalized = baseUrl.replace(/\/+$/, "");
  try {
    const about = await safeFetchJson<SuwayomiAbout>(`${normalized}/api/v1/settings/about`, {
      proxy,
      timeoutMs: 6000,
    });
    return { connected: true as const, about };
  } catch (err) {
    const message = err instanceof NetError ? err.message : "Could not reach the Suwayomi server.";
    return { connected: false as const, error: message };
  }
}

export async function suwayomiListSources(baseUrl: string, proxy?: ProxySettings | null) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return safeFetchJson<unknown[]>(`${normalized}/api/v1/source/list`, { proxy });
}

export async function suwayomiSearch(
  baseUrl: string,
  sourceId: string,
  query: string,
  proxy?: ProxySettings | null,
) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const url = `${normalized}/api/v1/source/${encodeURIComponent(sourceId)}/search?searchTerm=${encodeURIComponent(query)}&pageNum=1`;
  return safeFetchJson<unknown>(url, { proxy });
}

export async function suwayomiGetManga(baseUrl: string, mangaId: string, proxy?: ProxySettings | null) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return safeFetchJson<unknown>(`${normalized}/api/v1/manga/${encodeURIComponent(mangaId)}`, { proxy });
}

export async function suwayomiGetChapters(baseUrl: string, mangaId: string, proxy?: ProxySettings | null) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return safeFetchJson<unknown[]>(`${normalized}/api/v1/manga/${encodeURIComponent(mangaId)}/chapters`, {
    proxy,
  });
}

export function suwayomiPageUrl(baseUrl: string, mangaId: string, chapterIndex: string, page: number) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized}/api/v1/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterIndex)}/page/${page}`;
}
