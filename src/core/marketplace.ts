// Talks to hibiki-sources-style repositories over plain HTTPS: a `repository/index.json` listing
// available extensions, and a `<id>.manifest.json` + `<id>.js` pair per extension (see
// hibiki-sources' own layout) — the exact same convention the Android app's
// ExtensionMarketplaceClient speaks, so both clients can share a repository. Unlike Android,
// which merges manifest+payload into one on-device JSON file, the desktop runtime already reads
// extensions as separate `<id>.manifest.json`/`<id>.js` files (see extensions/runtime.ts), so
// installing here just means fetching and writing those two files as-is — no merge step needed.
import type { MarketplaceExtension, RepositoryFetchResult } from "@shared/types";
import { getPlatform } from "./platform";

// --- RiuPlay M7: the built-in repository --------------------------------------------------------
// RiuPlay's own extensions (extensions/official/, GPL-3.0) ship inside the app and are read from
// there, so the user needs no address and no network to see or install them. Their index carries a
// SHA-256 for every file, and an install from it is refused unless both files match.

export const BUILTIN_REPOSITORY_URL = "riuplay-builtin://official/index.json";
const BUILTIN_PREFIX = "riuplay-builtin://official/";
const BUILTIN_FILE = /^[a-z0-9][\w.-]*\.(json|js)$/i;

let builtinReader: ((file: string) => Promise<string>) | null = null;

/** Set by the platform at startup: reads one file of the bundled repository by its bare name. */
export function setBuiltinRepositoryReader(reader: ((file: string) => Promise<string>) | null): void {
  builtinReader = reader;
}

export function hasBuiltinRepository(): boolean {
  return builtinReader !== null;
}

export function isBuiltinRepositoryUrl(url: string): boolean {
  return url.startsWith(BUILTIN_PREFIX);
}

async function readBuiltin(url: string): Promise<string> {
  const file = url.slice(BUILTIN_PREFIX.length);
  if (!builtinReader) throw new Error("The built-in repository is not available in this build");
  if (!BUILTIN_FILE.test(file)) throw new Error("Not a file of the built-in repository");
  return builtinReader(file);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const DEFAULT_REPOSITORY_URL =
  "https://raw.githubusercontent.com/akkirrai1337/hibiki-sources/main/repository/index.json";

const MANIFEST_SUFFIX = ".manifest.json";
const GITHUB_RAW_MAIN_URL = /^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+)\/main\/(.+)$/;

export function isHttpsRepositoryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.host.length > 0;
  } catch {
    return false;
  }
}

// raw.githubusercontent.com sits behind a CDN that caches each URL for a few minutes and ignores
// no-cache request headers from anonymous clients — a per-request query param is the only
// reliable bypass, and the fully-qualified branch ref (.../refs/heads/main/...) reaches the fresh
// object more reliably than the short branch form. Mirrors the Android client's workaround.
function stableUrl(url: string): string {
  const withStableRef = url.replace(GITHUB_RAW_MAIN_URL, (_m, repo, rest) => `${repo}/refs/heads/main/${rest}`);
  const separator = withStableRef.includes("?") ? "&" : "?";
  return `${withStableRef}${separator}cachebust=${Date.now()}`;
}

async function getText(url: string, label: string): Promise<string> {
  if (isBuiltinRepositoryUrl(url)) return readBuiltin(url);
  if (!isHttpsRepositoryUrl(url)) throw new Error(`${label} URL must use HTTPS`);
  const response = await getPlatform().http.request({
    url: stableUrl(url),
    headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`${label} request failed: HTTP ${response.status}`);
  return response.body;
}

/** The Aniyomi APK repository the Android build starts with, beside DEFAULT_REPOSITORY_URL. */
export const DEFAULT_APK_REPOSITORY_URL = "https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json";

interface AniyomiIndexEntry {
  name: string;
  pkg: string;
  apk: string;
  lang?: string;
  version?: string;
  nsfw?: number;
  sources?: Array<{ name: string; lang?: string; id: string; baseUrl?: string }>;
}

export async function fetchRepositoryIndex(url: string): Promise<MarketplaceExtension[]> {
  const text = await getText(url, "Repository index");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Repository index is invalid");
  }
  // An Aniyomi/Mihon-style repository: an array of APK entries (index.min.json beside apk/ and icon/).
  if (Array.isArray(parsed)) return apkIndexEntries(url, parsed as AniyomiIndexEntry[]);
  // RiuPlay K3: a Keiyoushi (Tachiyomi 1.6) repository: repo.json naming a protobuf index (index_v2).
  if (parsed && typeof parsed === "object" && "index_v2" in parsed) {
    const port = getPlatform().apkSources;
    const cards = port?.readRepository ? await port.readRepository(url) : null;
    if (!cards) throw new Error("Manga APK repositories (Keiyoushi) are not available in this build");
    return cards;
  }
  return (parsed as { extensions?: MarketplaceExtension[] }).extensions ?? [];
}

/**
 * An APK repository's entries as marketplace entries - one per source (the ids are the ones the
 * installed source will have, "apk:<Aniyomi id>"), all pointing at their package's APK. Only a
 * platform that runs APK sources can use them.
 */
function apkIndexEntries(indexUrl: string, entries: AniyomiIndexEntry[]): MarketplaceExtension[] {
  if (!getPlatform().apkSources) throw new Error("APK repositories (Aniyomi extensions) are not available in this build");
  const resolve = (path: string) => new URL(path, indexUrl).toString();
  return entries.flatMap((entry) => {
    if (!entry.pkg || !entry.apk) return [];
    const extensionName = entry.name.replace(/^(Aniyomi|Tachiyomi): /, "");
    const sources = entry.sources?.length ? entry.sources : [];
    // One card per distinct source name: the language variants of one source (AnimeWorld India in
    // nine languages) are one source to pick, not nine look-alike rows - the package installs them
    // all anyway. The card stands for the variant in no particular language, else English, else the first.
    const byName = new Map<string, typeof sources>();
    for (const source of sources) byName.set(source.name, [...(byName.get(source.name) ?? []), source]);
    const distinctNames = byName.size;
    return [...byName.values()].map((variants): MarketplaceExtension => {
      const source = variants.find((v) => v.lang === "all") ?? variants.find((v) => v.lang === "en") ?? variants[0];
      return {
        id: `apk:${source.id}`,
        name: distinctNames > 1 ? source.name : extensionName,
        version: entry.version ?? "0",
        website: source.baseUrl ?? null,
        iconUrl: resolve(`icon/${entry.pkg}.png`),
        lang: variants.length > 1 ? "all" : source.lang ?? entry.lang ?? "all",
        capabilities: ["PLAYBACK"],
        resolverDependencies: [],
        isNsfw: entry.nsfw === 1,
        type: "source",
        manifestUrl: resolve(`apk/${entry.apk}`),
        apkPackage: entry.pkg,
      };
    });
  });
}

// Where an index usually sits in a GitHub repository: hibiki-sources' own layout, then an
// Aniyomi/Mihon repository's (index.min.json, often on a "repo" branch), then a bare index.json.
const INDEX_PATHS = ["repository/index.json", "index.min.json", "index.json"];
const DEFAULT_BRANCHES = ["main", "master", "repo"];

/**
 * The raw index URLs a typed repository address may stand for, most likely first. A direct index
 * URL is itself; a GitHub file page (github.com/o/r/blob/<ref>/path) is that file's raw copy; a
 * GitHub repository page (github.com/o/r, or a branch or folder of it) is each usual index location
 * on that branch, or on the usual branches. The scheme may be left out.
 */
export function repositoryIndexCandidates(input: string): string[] {
  const text = /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return [text];
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return [url.toString()];
  const [owner, repository, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repository) return [url.toString()];
  const repo = repository.replace(/\.git$/, "");
  const raw = (branch: string, path: string) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  if ((kind === "blob" || kind === "raw") && ref && rest.length > 0) return [raw(ref, rest.join("/"))];
  const branches = kind === "tree" && ref ? [ref] : DEFAULT_BRANCHES;
  const folder = kind === "tree" && rest.length > 0 ? `${rest.join("/")}/` : "";
  return branches.flatMap((branch) => INDEX_PATHS.map((path) => raw(branch, folder + path)));
}

/**
 * What makes two repository URLs the same repository: case-insensitive host, no query or fragment,
 * no trailing slash, and on raw.githubusercontent.com a case-insensitive owner and repository with
 * the long branch form (refs/heads/<branch>) read as the short one - so ".../refs/heads/main/..."
 * typed by hand is the preinstalled ".../main/..." and not a second copy of it.
 */
export function repositoryKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url.trim();
  }
  const host = parsed.hostname.toLowerCase();
  let segments = parsed.pathname.split("/").filter(Boolean);
  if (host === "raw.githubusercontent.com" && segments.length >= 2) {
    const [owner, repo, ...rest] = segments;
    const path = rest[0] === "refs" && rest[1] === "heads" ? rest.slice(2) : rest;
    segments = [owner.toLowerCase(), repo.toLowerCase(), ...path];
  }
  return `${host}${parsed.port ? `:${parsed.port}` : ""}/${segments.join("/")}`;
}

/** The first of a typed address's candidates (repositoryIndexCandidates) that really is an index. */
export async function resolveRepositoryUrl(input: string): Promise<string> {
  const candidates = repositoryIndexCandidates(input);
  if (candidates.length === 1) {
    if (!isHttpsRepositoryUrl(candidates[0])) throw new Error("Repository URL must use HTTPS");
    await fetchRepositoryIndex(candidates[0]);
    return candidates[0];
  }
  for (const candidate of candidates) {
    try {
      await fetchRepositoryIndex(candidate);
      return candidate;
    } catch {
      // Not there (404) or not an index: the next usual place.
    }
  }
  throw new Error(`No repository index found at ${input.trim()}`);
}

export async function fetchRepositoryResult(url: string): Promise<RepositoryFetchResult> {
  try {
    return { url, ok: true, extensions: await fetchRepositoryIndex(url) };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function payloadUrlFor(manifestUrl: string): string {
  if (!manifestUrl.endsWith(MANIFEST_SUFFIX)) {
    throw new Error(`Manifest URL doesn't follow the <id>${MANIFEST_SUFFIX} convention: ${manifestUrl}`);
  }
  return manifestUrl.slice(0, -MANIFEST_SUFFIX.length) + ".js";
}

export async function fetchExtensionFiles(
  extension: MarketplaceExtension,
): Promise<{ manifestJson: string; jsPayload: string }> {
  let expected = extension.sha256 ?? null;
  if (isBuiltinRepositoryUrl(extension.manifestUrl)) {
    // The entry comes back from the renderer: for the built-in repository the hashes (and the
    // address) are taken from the bundled index itself, never from what was handed in.
    const entry = (await fetchRepositoryIndex(BUILTIN_REPOSITORY_URL)).find((e) => e.id === extension.id);
    if (!entry || entry.manifestUrl !== extension.manifestUrl || !entry.sha256) throw new Error(`'${extension.id}' is not in the built-in repository`);
    expected = entry.sha256;
  }
  const manifestJson = await getText(extension.manifestUrl, `manifest for '${extension.id}'`);
  const jsPayload = await getText(payloadUrlFor(extension.manifestUrl), `payload for '${extension.id}'`);
  if (expected) {
    if ((await sha256Hex(manifestJson)) !== String(expected.manifest).toLowerCase()) throw new Error(`The manifest of '${extension.id}' does not match its published SHA-256`);
    if ((await sha256Hex(jsPayload)) !== String(expected.script).toLowerCase()) throw new Error(`The script of '${extension.id}' does not match its published SHA-256`);
  }
  return { manifestJson, jsPayload };
}

/** Basic-semver (x.y.z) comparison; a non-matching string never triggers an update prompt. */
export function isExtensionVersionNewer(remoteVersion: string, installedVersion: string): boolean {
  const remote = remoteVersion.trim().split(".").map(Number).filter((n) => !Number.isNaN(n));
  const installed = installedVersion.trim().split(".").map(Number).filter((n) => !Number.isNaN(n));
  if (remote.length === 0 || installed.length === 0) return false;
  for (let i = 0; i < Math.max(remote.length, installed.length); i++) {
    const comparison = (remote[i] ?? 0) - (installed[i] ?? 0);
    if (comparison !== 0) return comparison > 0;
  }
  return false;
}
