// RiuPlay M2: the code that runs inside a sandboxed extension host - a Web Worker in a hidden,
// Chromium-sandboxed window (no Node, no Electron, no preload). Productionised from the M0 spike
// (research/m0/sandbox/worker-src.ts). It is hibiki's own host API - buildExtensionGlobals
// (globals.ts: Jsoup on cheerio, Base64, Gzip, Url, AnimeTitle, collectPaginated, fetch, fetchAll,
// storage, challenge, browserFetch) and invokeProvider (dispatch.ts) - bundled for the browser
// (vite.config.ts builds it into dist-electron/main/extension-host-worker.js). Every host call goes
// to the main-process broker as a synchronous XHR to riuplay-ext-host://host/broker/... - the only
// destination this window's session lets through. The extension's identity is the session the
// broker answers on, never anything this code sends.
import { Buffer } from "buffer";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { buildExtensionGlobals } from "../globals";
import { invokeProvider } from "../../../core/extensions/dispatch";
import type { ExtensionMethod } from "../../../core/extensions/methods";
import { createCallStorage, type ExtensionStorageBinding } from "@shared/extensionCallStorage";

// This file is type-checked with the Node project (no DOM/WebWorker lib), so the few worker
// globals it uses are declared here instead of pulling those libs into every main-process file.
declare const self: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void };
declare function importScripts(...urls: string[]): void;
declare class XMLHttpRequest {
  status: number;
  responseText: string;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body: string): void;
}
type Worker = { postMessage(message: unknown): void };
type MessageEvent = { data: unknown };

const HOST = "riuplay-ext-host://host";

function brokerSync<T>(path: string, payload: unknown): T {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${HOST}${path}`, false); // synchronous: extension scripts expect fetch() to return
  xhr.setRequestHeader("content-type", "application/json");
  xhr.send(JSON.stringify(payload));
  if (xhr.status !== 200) throw new Error(`host call ${path} failed: ${xhr.responseText.slice(0, 300) || `HTTP ${xhr.status}`}`);
  return JSON.parse(xhr.responseText) as T;
}

interface BridgeAnswer {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function bridge<T>(kind: string, payload: Record<string, unknown>): T {
  const answer = brokerSync<BridgeAnswer>("/broker/bridge", { kind, payload });
  if (!answer.ok) throw new Error(answer.error ?? `${kind}() failed`);
  return answer.result as T;
}

// Storage is per call, exactly as in the node:vm path: the call brings the source's snapshot and
// hands back the keys it wrote (the main process persists them).
let callStorage: ExtensionStorageBinding = createCallStorage({}).binding;
const storageProxy: ExtensionStorageBinding = {
  get: (key) => callStorage.get(key),
  set: (key, value) => callStorage.set(key, value),
  remove: (key) => callStorage.remove(key),
} as ExtensionStorageBinding;

const globals = buildExtensionGlobals({
  logger: {
    log: (m) => void brokerSync("/broker/log", { level: "info", message: String(m) }),
    warn: (m) => void brokerSync("/broker/log", { level: "warn", message: String(m) }),
    error: (m) => void brokerSync("/broker/log", { level: "error", message: String(m) }),
  },
  // As in the node:vm path (execute.ts): the language the bundled sources were written for.
  preferredLanguage: "ru",
  challenge: { acquire: (url, cookieNames, forceRefresh) => bridge("challenge", { url, cookieNames, forceRefresh }) },
  browserFetch: { fetch: (pageUrl, targetUrl, options) => bridge("browserFetch", { pageUrl, targetUrl, options }) },
  netFetch: {
    fetch: (url, options) => bridge("netFetch", { url, options }),
    fetchAll: (requests) => bridge("netFetchAll", { requests }),
  },
  storage: storageProxy,
} as Parameters<typeof buildExtensionGlobals>[0]);

// Expose the globals the way the vm context did. `fetch` deliberately shadows the native one; the
// native network stack is still reachable by a hostile script (WorkerGlobalScope fetch,
// XMLHttpRequest, WebSocket, importScripts) - and refused by the session, which lets nothing
// through but riuplay-ext-host://host/ (tested).
Object.assign(globalThis, globals);

type Scope = typeof globalThis & { Provider?: Record<string, unknown> };
const scope = globalThis as Scope;
let sourceId = "";
let loaded = false;

self.onmessage = (event: MessageEvent) => {
  const data = event.data as { id: number; type: string; method?: ExtensionMethod; args?: unknown[]; storage?: Record<string, string> };
  const reply = (message: Record<string, unknown>) => (self as unknown as Worker).postMessage({ id: data.id, ...message });
  if (data.type === "start") {
    // Only now - after the main process has put this renderer into its memory-limited job - is
    // the extension's code loaded.
    try {
      sourceId = String(brokerSync<{ id: string }>("/broker/whoami", {}).id);
      importScripts(`${HOST}/ext.js`);
      loaded = true;
      reply({ ok: true });
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
    return;
  }
  if (data.type !== "call") return;
  const storage = createCallStorage(data.storage ?? {});
  callStorage = storage.binding;
  try {
    if (!loaded) throw new Error("extension not loaded");
    if (!scope.Provider) throw new Error("extension did not define Provider");
    const result = invokeProvider(scope.Provider, sourceId, data.method!, data.args ?? []);
    reply({ ok: true, result, storageWrites: storage.writes });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error), storageWrites: storage.writes });
  }
};
(self as unknown as Worker).postMessage({ id: 0, ready: true });
