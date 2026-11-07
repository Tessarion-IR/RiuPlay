// RiuPlay M3: moving the proxy that Settings > Network keeps in plaintext into the encrypted store.
//
// Only ever started by the user (Settings > Network > "Move to encrypted storage", after a preview
// and a confirmation). The input is the legacy string the main process ALREADY holds in memory
// (handed over by the renderer at runtime, main/net/state.ts): nothing else is read.
//
//   plan(legacy)    pure - what would be stored (password shown only as present/absent), or why not.
//   apply(legacy)   one at a time (module-level lock). Writes the encrypted record with an ATOMIC
//                   insert-if-absent, so a record saved through Settings in the meantime is never
//                   overwritten. Then decrypts it back and compares every field. On a mismatch or
//                   any failure, the record is removed again - but only if it is still exactly the
//                   one this migration wrote (compare-and-swap) - and the legacy setting stays in force.
//   The plaintext is never deleted here. Removing it is a separate user action in the renderer,
//   offered only after the encrypted proxy has been verified on BOTH network paths.
//
// Interrupted (crash/power loss) at any point: the single-row insert is atomic, so there is either
// no record (nothing happened) or a complete record whose password already passed a round-trip
// check before it was written. The next attempt reports "already-migrated"; the user can Test it
// or Clear it, and the legacy string is still there either way.
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
  | { outcome: "nothing" | "refused" | "already-migrated" | "busy"; reason: string }
  | { outcome: "migrated"; display: string; legacyStillPresent: true }
  | { outcome: "failed"; reason: string; legacyStillPresent: true };

let running = false;

export async function applyLegacyProxyMigration(legacy: string | null | undefined, store: SecureProxyStore): Promise<MigrationResult> {
  if (running) return { outcome: "busy", reason: "a migration is already running" };
  running = true;
  try {
    return await migrate(legacy, store);
  } finally {
    running = false;
  }
}

async function migrate(legacy: string | null | undefined, store: SecureProxyStore): Promise<MigrationResult> {
  const plan = planLegacyProxyMigration(legacy);
  if (plan.action === "nothing") return { outcome: "nothing", reason: plan.reason };
  if (plan.action === "refuse") return { outcome: "refused", reason: plan.reason };
  const parsed = parseLegacyProxyString(legacy);
  if (parsed.status !== "ok") return { outcome: "refused", reason: "legacy proxy changed while migrating" };
  const c = parsed.config;

  let written: string | null;
  try {
    written = await store.saveIfAbsent({ kind: c.kind, host: c.host, port: c.port, username: c.username ?? null, password: c.password ?? null, dnsMode: "doh-via-proxy", enabled: true });
  } catch (error) {
    return { outcome: "failed", reason: `encryption failed (${error instanceof Error ? error.message : "error"}); nothing was stored and the legacy setting stays in force`, legacyStillPresent: true };
  }
  // Never overwrite: a record already in the encrypted store is the user's own (newer) choice.
  if (written === null) return { outcome: "already-migrated", reason: "an encrypted proxy is already stored; nothing was changed" };

  try {
    const loaded = await store.load();
    const same =
      loaded.status === "ok" &&
      loaded.config.kind === c.kind &&
      loaded.config.host === c.host &&
      loaded.config.port === c.port &&
      (loaded.config.username ?? null) === (c.username ?? null) &&
      (loaded.config.password ?? null) === (c.password ?? null);
    if (same) return { outcome: "migrated", display: plan.display, legacyStillPresent: true };
  } catch {
    // fall through to the undo
  }
  await store.removeIfUnchanged(written).catch(() => false);
  return { outcome: "failed", reason: "the encrypted copy did not verify; it was removed and the legacy setting stays in force", legacyStillPresent: true };
}
