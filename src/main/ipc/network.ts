// RiuPlay M3: IPC for the encrypted proxy (main/net/secureProxyStore.ts). The renderer can set,
// clear and test it, and read a summary that never contains the password. No Settings screen uses
// it yet, and nothing here reads or touches the legacy Settings > Network proxy.
import { ipcMain } from "electron";
import { IPC } from "@shared/ipc";
import type { SecureProxyInput, SecureProxyTestResult } from "@shared/types";
import { logger } from "../../core/logger";
import { secureProxyStore } from "../net/electron";
import { NetError } from "../net/errors";
import { beginSecureProxyLoad, describeNetworkPath, netClient, setSecureProxy } from "../net/state";
import { validateProxyInput } from "../net/secureProxyStore";

/** A public, IP-literal endpoint with a tiny body: no DNS needed for the test itself. */
const TEST_URL = "https://1.1.1.1/cdn-cgi/trace";

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

export function registerNetworkHandlers(): void {
  const store = secureProxyStore();
  void beginSecureProxyLoad(() => store.load()).then(() => logger.info("network", `main-process requests: ${describeNetworkPath()}`));

  ipcMain.handle(IPC.networkSecureProxyGet, () => store.summary());
  ipcMain.handle(IPC.networkSecureProxySet, async (_e, input: unknown) => {
    const summary = await store.save(sanitize(input));
    await setSecureProxy(await store.load());
    logger.info("network", `encrypted proxy saved; main-process requests: ${describeNetworkPath()}`);
    return summary;
  });
  ipcMain.handle(IPC.networkSecureProxyClear, async () => {
    await store.clear();
    await setSecureProxy({ status: "none" });
    logger.info("network", `encrypted proxy cleared; main-process requests: ${describeNetworkPath()}`);
  });
  ipcMain.handle(IPC.networkSecureProxyTest, async (): Promise<SecureProxyTestResult> => {
    const startedAt = Date.now();
    try {
      const response = await netClient.request({ url: TEST_URL, caller: { kind: "app", purpose: "proxy-test" }, timeoutMs: 15_000 });
      return { ok: response.status === 200, code: response.status === 200 ? null : `http-${response.status}`, elapsedMs: Date.now() - startedAt, path: describeNetworkPath() };
    } catch (error) {
      return { ok: false, code: error instanceof NetError ? error.code : "error", elapsedMs: Date.now() - startedAt, path: describeNetworkPath() };
    }
  });
}
