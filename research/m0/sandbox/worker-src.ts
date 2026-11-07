// M0 research: the code that runs inside the sandboxed extension host's Web Worker.
// It is hibiki's own host API - buildExtensionGlobals (globals.ts: Jsoup on cheerio, Base64, Gzip,
// Url, AnimeTitle, collectPaginated, fetch, fetchAll, storage) and invokeProvider (dispatch.ts) -
// bundled for the browser, with the network and storage bridged to the main-process broker through
// synchronous XHR to riuplay-ext-host://. The extension script is then loaded with importScripts.
import { Buffer } from "buffer";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { buildExtensionGlobals } from "../../../src/main/extensions/globals";
import { invokeProvider } from "../../../src/core/extensions/dispatch";
import type { ExtensionMethod } from "../../../src/core/extensions/methods";

const HOST = "riuplay-ext-host://host";

function brokerSync<T>(path: string, payload: unknown): T {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${HOST}${path}`, false); // synchronous: hibiki scripts expect fetch() to return
  xhr.setRequestHeader("content-type", "application/json");
  xhr.send(JSON.stringify(payload));
  if (xhr.status !== 200) throw new Error(`broker ${path} failed: HTTP ${xhr.status} ${xhr.responseText.slice(0, 200)}`);
  return JSON.parse(xhr.responseText) as T;
}

interface BrokerFetchResult {
  status: number;
  ok: boolean;
  body: string;
  headers: Record<string, string>;
  error?: string;
}

const globals = buildExtensionGlobals({
  logger: {
    log: (m) => brokerSync("/broker/log", { level: "log", message: String(m) }),
    warn: (m) => brokerSync("/broker/log", { level: "warn", message: String(m) }),
    error: (m) => brokerSync("/broker/log", { level: "error", message: String(m) }),
  },
  preferredLanguage: "en",
  challenge: {
    acquire: () => {
      throw new Error("challenge: not granted in the M0 spike");
    },
  },
  browserFetch: {
    fetch: () => {
      throw new Error("browserFetch: not granted in the M0 spike");
    },
  },
  netFetch: {
    fetch: (url, options) => {
      const result = brokerSync<BrokerFetchResult>("/broker/fetch", { url, options });
      if (result.error) throw new Error(result.error);
      return result;
    },
    fetchAll: (requests) => brokerSync<{ results: BrokerFetchResult[] }>("/broker/fetchAll", { requests }).results,
  },
  storage: {
    get: (key) => brokerSync<{ value: string | null }>("/broker/storage", { op: "get", key }).value,
    set: (key, value) => void brokerSync("/broker/storage", { op: "set", key, value }),
    remove: (key) => void brokerSync("/broker/storage", { op: "remove", key }),
  },
});

// Expose hibiki's globals the way the vm context did. `fetch` deliberately shadows the native one;
// the native network stack is still reachable by a hostile script (WorkerGlobalScope.prototype.fetch,
// XMLHttpRequest, WebSocket, importScripts) - stopping that is the session's job, and the
// experiments test exactly that.
Object.assign(globalThis, globals);

const sourceId = String(brokerSync<{ id: string }>("/broker/whoami", {}).id);
importScripts(`${HOST}/ext.js`);

type Scope = typeof globalThis & {
  Provider?: Record<string, unknown>;
  Attacks?: Record<string, () => unknown | Promise<unknown>>;
};
const scope = globalThis as Scope;

self.onmessage = async (event: MessageEvent) => {
  const { id, type } = event.data as { id: number; type: string };
  try {
    if (type === "call") {
      const { method, args } = event.data as { method: ExtensionMethod; args: unknown[] };
      if (!scope.Provider) throw new Error("extension did not define Provider");
      const started = performance.now();
      const value = invokeProvider(scope.Provider, sourceId, method, args);
      (self as unknown as Worker).postMessage({ id, ok: true, value, ms: performance.now() - started });
    } else if (type === "attacks") {
      const results: Record<string, unknown> = {};
      for (const [name, attack] of Object.entries(scope.Attacks ?? {})) {
        try {
          results[name] = { outcome: "returned", value: await Promise.race([Promise.resolve().then(attack), new Promise((r) => setTimeout(() => r("attack-timeout"), 4000))]) };
        } catch (error) {
          results[name] = { outcome: "threw", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
        }
      }
      (self as unknown as Worker).postMessage({ id, ok: true, value: results });
    } else if (type === "methods") {
      const provider = scope.Provider ?? {};
      (self as unknown as Worker).postMessage({ id, ok: true, value: Object.keys(provider).filter((k) => typeof provider[k] === "function") });
    } else if (type === "eval") {
      // Used only by the memory/CPU experiments, which ship their workload as an extension too.
      const fn = scope.Attacks?.[(event.data as { name: string }).name];
      const value = fn ? await fn() : "missing";
      (self as unknown as Worker).postMessage({ id, ok: true, value });
    }
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
};
(self as unknown as Worker).postMessage({ id: 0, ready: true, sourceId });
