// Builds the M0 sandbox spike: the worker bundle (browser) and the broker bundle (Electron main).
// Usage: node research/m0/sandbox/build.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "dist");

// hibiki's globals.ts/jsoupShim.ts reach Node through `node:zlib` and `node:module`'s createRequire
// (for cheerio and sync-fetch). In the browser worker those become fflate and a static cheerio.
const nodeShims = {
  name: "node-shims",
  setup(b) {
    b.onResolve({ filter: /^node:zlib$/ }, () => ({ path: "zlib", namespace: "shim" }));
    b.onResolve({ filter: /^node:module$/ }, () => ({ path: "module", namespace: "shim" }));
    b.onLoad({ filter: /^zlib$/, namespace: "shim" }, () => ({
      contents: `import { gunzipSync as g, inflateSync as i } from "fflate";
        export function gunzipSync(bytes) { return Buffer.from(g(new Uint8Array(bytes))); }
        export function inflateSync(bytes) { return Buffer.from(i(new Uint8Array(bytes))); }
        export default { gunzipSync, inflateSync };`,
      resolveDir: here,
    }));
    b.onLoad({ filter: /^module$/, namespace: "shim" }, () => ({
      contents: `import * as cheerio from "cheerio/slim";
        export function createRequire() {
          return (name) => {
            if (name === "cheerio") return cheerio;
            throw new Error("require(" + name + ") is not available in the extension sandbox");
          };
        }`,
      resolveDir: here,
    }));
  },
};

await build({
  entryPoints: [path.join(here, "worker-src.ts")],
  outfile: path.join(out, "worker.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  plugins: [nodeShims],
  define: { "import.meta.url": '"riuplay-ext-host://host/worker.js"', "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

await build({
  entryPoints: [path.join(here, "..", "net", "guardedFetch.ts")],
  outfile: path.join(out, "broker.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["undici", "socks"],
  logLevel: "warning",
});
// Reference: hibiki's current in-process node:vm path, used to compare results byte for byte.
await build({
  entryPoints: [path.join(here, "..", "..", "..", "src", "main", "extensions", "execute.ts")],
  outfile: path.join(out, "vmref.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["cheerio", "sync-fetch", "electron"],
  // globals.ts/jsoupShim.ts use createRequire(import.meta.url) to load cheerio: point it at the repo.
  define: { "import.meta.url": JSON.stringify(pathToFileURL(path.join(here, "..", "..", "..", "src", "main", "extensions", "globals.ts")).href) },
  logLevel: "warning",
});
console.log("built", out);
