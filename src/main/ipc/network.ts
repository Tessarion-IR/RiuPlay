// RiuPlay M3: IPC for the encrypted proxy (main/net/secureProxyStore.ts) and the user-started
// migration of the legacy plaintext proxy. The renderer can read a status that never contains the
// password, save / clear an encrypted proxy, preview and (after confirmation) run the migration,
// and verify the effective proxy on BOTH network paths. The plaintext copy itself lives in the
// renderer's store; removing it is the renderer's own explicit action, offered only when
// `plaintextRemovalAllowed` (the encrypted proxy is in force and passed on both paths).
import { app, ipcMain } from "electron";
import { apkRuntimeEnabled, writeApkOptIn } from "../../platform/electron/apkOptIn";
import { getApkHost } from "../../platform/electron/apkHost";
import { IPC } from "@shared/ipc";
import type { SecureProxyInput, SecureProxyStatus, SecureProxyVerification } from "@shared/types";
import { logger } from "../../core/logger";
import { verifyChromiumPath } from "../net/chromiumVerify";
import { secureProxyStore } from "../net/electron";
import { NetError } from "../net/errors";
import { applyLegacyProxyMigration, planLegacyProxyMigration } from "../net/legacyProxyMigration";
import {
  beginSecureProxyLoad,
  chromiumNetworkPlan,
  describeNetworkPath,
  effectiveProxy,
  lastVerification,
  legacyProxyString,
  netClient,
  plaintextRemovalAllowed,
  recordVerification,
  setSecureProxy,
  verificationSubject,
} from "../net/state";
import { validateProxyInput } from "../net/secureProxyStore";

/** A public, IP-literal endpoint with a tiny body: no DNS needed for the check itself. */
const TEST_URL = "https://1.1.1.1/cdn-cgi/trace";
const TEST_TIMEOUT_MS = 15_000;

function sanitize(input: unknown): SecureProxyInput {
  if (!input || typeof input !== "object") throw new TypeError("proxy settings must be an object");
  const i = input as Record<string, unknown>;
  const value: SecureProxyInput = {
    kind: i.kind as SecureProxyInput["kind"],
    host: typeof i.host === "string" ? i.host.trim() : "",
    port: typeof i.port === "number" ? i.port : Number.NaN,
    username: typeof i.username === "string" && i.username ? i.username : null,
    password: typeof i.password === "string" && i.password ? i.password : null,
    dnsMode: i.dnsMode === "local" ? "local" : "doh-via-proxy",
    enabled: i.enabled !== false,
  };
  const problem = validateProxyInput(value);
  if (problem) throw new TypeError(problem);
  return value;
}

async function status(): Promise<SecureProxyStatus> {
  const store = secureProxyStore();
  const { source, state } = effectiveProxy();
  const plan = chromiumNetworkPlan();
  const legacy = planLegacyProxyMigration(legacyProxyString());
  return {
    stored: await store.summary(),
    effectiveSource: source,
    effectiveState: state.status,
    effectiveReason: state.status === "invalid" || state.status === "unavailable" ? state.reason : null,
    path: describeNetworkPath(),
    chromium: { mode: plan.mode, reason: plan.mode === "blocked" ? plan.reason : null },
    legacy: legacy.action === "migrate" ? { action: "migrate", display: legacy.display, hasPassword: legacy.target.hasPassword, reason: null } : { action: legacy.action, display: null, hasPassword: false, reason: legacy.reason },
    verification: lastVerification(),
    plaintextRemovalAllowed: plaintextRemovalAllowed(),
  };
}

async function reload(): Promise<void> {
  await setSecureProxy(await secureProxyStore().load());
}

async function verify(): Promise<SecureProxyVerification> {
  const subject = verificationSubject();
  const main = await netClient
    .request({ url: TEST_URL, caller: { kind: "app", purpose: "proxy-test" }, timeoutMs: TEST_TIMEOUT_MS })
    .then((r) => ({ ok: r.status === 200, code: r.status === 200 ? null : `http-${r.status}` }))
    .catch((error: unknown) => ({ ok: false, code: error instanceof NetError ? error.code : "error" }));
  // Chromium: the default session, i.e. the same network stack the player and pictures use.
  const chromium = await verifyChromiumPath(TEST_URL, TEST_TIMEOUT_MS);
  const result = { subject, main, chromium, at: Date.now() };
  recordVerification(result);
  logger.info("network", `proxy verification (${subject.replace(/\/\/[^@]*@/, "//")}): main ${main.ok ? "ok" : main.code}, chromium ${chromium.ok ? "ok" : chromium.code}`);
  return { ...result, plaintextRemovalAllowed: plaintextRemovalAllowed() };
}

export function registerNetworkHandlers(): void {
  // RiuPlay M2: the APK (Java) runtime opt-in; takes effect on the next start.
  ipcMain.handle(IPC.extensionsApkRuntimeGet, () => ({ enabled: apkRuntimeEnabled(app.getPath("userData")), running: Boolean(getApkHost()) }));
  ipcMain.handle(IPC.extensionsApkRuntimeSet, (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
    writeApkOptIn(app.getPath("userData"), enabled);
    logger.info("ext", `APK (Java) runtime ${enabled ? "enabled by the user (from the next start)" : "disabled (from the next start)"}`);
    return { enabled, running: Boolean(getApkHost()) };
  });

  const store = secureProxyStore();
  void beginSecureProxyLoad(() => store.load()).then(() => logger.info("network", `main-process requests: ${describeNetworkPath()}`));

  ipcMain.handle(IPC.networkSecureProxyStatus, () => status());
  ipcMain.handle(IPC.networkSecureProxySet, async (_e, input: unknown) => {
    await store.save(sanitize(input));
    await reload();
    logger.info("network", `encrypted proxy saved; main-process requests: ${describeNetworkPath()}`);
    return status();
  });
  ipcMain.handle(IPC.networkSecureProxyClear, async () => {
    await store.clear();
    await setSecureProxy({ status: "none" });
    logger.info("network", `encrypted proxy cleared; main-process requests: ${describeNetworkPath()}`);
    return status();
  });
  ipcMain.handle(IPC.networkSecureProxyVerify, () => verify());
  // The migration runs only with the preview the user confirmed: if the legacy string changed
  // since (another window, a restore), the confirmation no longer applies.
  ipcMain.handle(IPC.networkLegacyProxyMigrate, async (_e, confirmedDisplay: unknown) => {
    const plan = planLegacyProxyMigration(legacyProxyString());
    if (plan.action !== "migrate" || typeof confirmedDisplay !== "string" || confirmedDisplay !== plan.display) {
      return { outcome: "refused", reason: "the proxy changed since the preview; review it again" };
    }
    const result = await applyLegacyProxyMigration(legacyProxyString(), store);
    await reload();
    logger.info("network", `legacy proxy migration: ${result.outcome}`);
    return result;
  });
}
