// RiuPlay M1: repository trust/enabled state and per-extension state, in their own tables
// (repository_state, extension_state; migration 0025). A repository without a row is enabled and
// untrusted - which is what every repository added before M1 is.
import { eq, inArray } from "drizzle-orm";
import type { ExtensionStateInfo, RepositoryInfo } from "@shared/types";
import { extensionState, repositoryState, sourceRepositories } from "../db/schema";
import { getPlatform } from "../platform";

const db = () => getPlatform().db.get();

export async function repositoryInfos(): Promise<RepositoryInfo[]> {
  const repos = await db().select().from(sourceRepositories).all();
  const states = new Map((await db().select().from(repositoryState).all()).map((s) => [s.url, s]));
  return repos
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((r) => {
      const s = states.get(r.url);
      return {
        url: r.url,
        addedAt: r.addedAt,
        enabled: s?.enabled ?? true,
        trust: s?.trust ?? "untrusted",
        trustedAt: s?.trustedAt ?? null,
        name: s?.name ?? null,
        lastCheckedAt: s?.lastCheckedAt ?? null,
        lastError: s?.lastError ?? null,
      };
    });
}

async function upsertRepositoryState(url: string, patch: Partial<typeof repositoryState.$inferInsert>): Promise<void> {
  const now = Date.now();
  await db()
    .insert(repositoryState)
    .values({ url, updatedAt: now, ...patch })
    .onConflictDoUpdate({ target: repositoryState.url, set: { ...patch, updatedAt: now } })
    .run();
}

/** RiuPlay M7: the stored state of one repository (the built-in one has no source_repositories row). */
export async function repositoryStateOf(url: string): Promise<{ enabled: boolean; trust: "untrusted" | "trusted"; trustedAt: number | null; lastCheckedAt: number | null; lastError: string | null } | null> {
  const row = await db().select().from(repositoryState).where(eq(repositoryState.url, url)).get();
  return row ? { enabled: row.enabled, trust: row.trust as "untrusted" | "trusted", trustedAt: row.trustedAt ?? null, lastCheckedAt: row.lastCheckedAt ?? null, lastError: row.lastError ?? null } : null;
}

export async function isRepositoryEnabled(url: string): Promise<boolean> {
  const row = await db().select().from(repositoryState).where(eq(repositoryState.url, url)).get();
  return row?.enabled ?? true;
}

export async function setRepositoryEnabled(url: string, enabled: boolean): Promise<void> {
  await upsertRepositoryState(url, { enabled });
}

export async function setRepositoryTrust(url: string, trust: "untrusted" | "trusted"): Promise<void> {
  await upsertRepositoryState(url, { trust, trustedAt: trust === "trusted" ? Date.now() : null });
}

export async function recordRepositoryCheck(url: string, result: { ok: boolean; error?: string; name?: string | null }): Promise<void> {
  await upsertRepositoryState(url, { lastCheckedAt: Date.now(), lastError: result.ok ? null : (result.error ?? "unavailable").slice(0, 300), ...(result.name ? { name: result.name.slice(0, 120) } : {}) });
}

export async function forgetRepositoryState(url: string): Promise<void> {
  await db().delete(repositoryState).where(eq(repositoryState.url, url)).run();
}

export async function extensionStates(ids?: string[]): Promise<ExtensionStateInfo[]> {
  const rows = ids ? await db().select().from(extensionState).where(inArray(extensionState.id, ids)).all() : await db().select().from(extensionState).all();
  return rows.map((r) => ({ id: r.id, enabled: r.enabled, grantedPermissions: r.grantedPermissions ? (JSON.parse(r.grantedPermissions) as string[]) : null }));
}

export async function grantedPermissionsOf(id: string): Promise<string[] | null> {
  const row = await db().select().from(extensionState).where(eq(extensionState.id, id)).get();
  return row?.grantedPermissions ? (JSON.parse(row.grantedPermissions) as string[]) : null;
}

export async function recordGrant(id: string, permissions: string[]): Promise<void> {
  const now = Date.now();
  const granted = JSON.stringify(permissions);
  await db()
    .insert(extensionState)
    .values({ id, enabled: true, grantedPermissions: granted, grantedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: extensionState.id, set: { grantedPermissions: granted, grantedAt: now, updatedAt: now } })
    .run();
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
  const now = Date.now();
  await db().insert(extensionState).values({ id, enabled, updatedAt: now }).onConflictDoUpdate({ target: extensionState.id, set: { enabled, updatedAt: now } }).run();
}

export async function disabledExtensionIds(): Promise<string[]> {
  return (await db().select().from(extensionState).where(eq(extensionState.enabled, false)).all()).map((r) => r.id);
}

/** Removing an extension removes only its own state row - never library, history or media rows. */
export async function forgetExtensionState(id: string): Promise<void> {
  await db().delete(extensionState).where(eq(extensionState.id, id)).run();
}
