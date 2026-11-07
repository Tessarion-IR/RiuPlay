// RiuPlay M3: moving a proxy that Settings > Network keeps in plaintext into the encrypted store.
//
// DESIGNED AND TESTED, NOT INVOKED. Nothing in the app calls this module: the user's existing
// proxy setting is not read, migrated, overwritten or deleted until the migration plan
// (docs/M3_NETWORKING.md, "Legacy proxy migration") is approved. The legacy string keeps being
// consumed at runtime exactly as before.
//
// Steps, each one separately:
//   plan(legacy)      pure - what would be stored (password shown only as present/absent), or why not.
//   apply(legacy)     writes the encrypted record ONLY if none exists, then verifies it decrypts
//                     back to exactly the legacy values. On a failed verify the new record is
//                     removed again, so the legacy setting stays the one in force.
//   The plaintext legacy value is never deleted here. Removing it from the renderer's store is a
//   separate, later, user-confirmed step (a UI change, after the user has seen the encrypted proxy
//   work), so a failed migration can always fall back to what the user had.
import { describeProxy, parseLegacyProxyString, type ProxyConfig } from "./proxy";
import type { SecureProxyStore } from "./secureProxyStore";

export type MigrationPlan =
  | { action: "nothing"; reason: string }
  | { action: "refuse"; reason: string }
  | { action: "migrate"; target: { kind: ProxyConfig["kind"]; host: string; port: number; username: string | null; hasPassword: boolean }; display: string };

export function planLegacyProxyMigration(legacy: string | null | undefined): MigrationPlan {
  const parsed = parseLegacyProxyString(legacy);
  if (parsed.status === "none") return { action: "nothing", reason: "no legacy proxy is configured" };
  if (parsed.status === "invalid") return { action: "refuse", reason: `the legacy proxy can't be migrated automatically: ${parsed.reason}` };
  const c = parsed.config;
  return { action: "migrate", target: { kind: c.kind, host: c.host, port: c.port, username: c.username ?? null, hasPassword: Boolean(c.password) }, display: describeProxy(c) };
}

export type MigrationResult =
  | { outcome: "nothing" | "refused" | "already-migrated"; reason: string }
  | { outcome: "migrated"; display: string; legacyStillPresent: true }
  | { outcome: "failed"; reason: string; legacyStillPresent: true };

export async function applyLegacyProxyMigration(legacy: string | null | undefined, store: SecureProxyStore): Promise<MigrationResult> {
  const plan = planLegacyProxyMigration(legacy);
  if (plan.action === "nothing") return { outcome: "nothing", reason: plan.reason };
  if (plan.action === "refuse") return { outcome: "refused", reason: plan.reason };
  // Never overwrite: a record already in the encrypted store is the user's newer choice.
  if ((await store.raw()) !== null) return { outcome: "already-migrated", reason: "an encrypted proxy is already stored; nothing was changed" };

  const parsed = parseLegacyProxyString(legacy);
  if (parsed.status !== "ok") return { outcome: "refused", reason: "legacy proxy changed while migrating" };
  const c = parsed.config;
  try {
    await store.save({ kind: c.kind, host: c.host, port: c.port, username: c.username ?? null, password: c.password ?? null, dnsMode: "doh-via-proxy", enabled: true });
    const loaded = await store.load();
    const same =
      loaded.status === "ok" &&
      loaded.config.kind === c.kind &&
      loaded.config.host === c.host &&
      loaded.config.port === c.port &&
      (loaded.config.username ?? null) === (c.username ?? null) &&
      (loaded.config.password ?? null) === (c.password ?? null);
    if (!same) {
      await store.clear();
      return { outcome: "failed", reason: "the encrypted copy did not verify; it was removed and the legacy setting stays in force", legacyStillPresent: true };
    }
    return { outcome: "migrated", display: plan.display, legacyStillPresent: true };
  } catch (error) {
    await store.clear().catch(() => {});
    return { outcome: "failed", reason: `encryption failed (${error instanceof Error ? error.message : "error"}); the legacy setting stays in force`, legacyStillPresent: true };
  }
}
