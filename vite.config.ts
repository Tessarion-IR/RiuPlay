import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { buildSecret } from "./scripts/buildSecret";

const root = fileURLToPath(new URL(".", import.meta.url));
// AniList's client id (core/tracking/anilist.ts), from wherever the Kotlin app's build finds its own
// (see scripts/buildSecret.ts). Not a secret - it is in every sign-in URL - but it belongs to
// whoever registered it, so it stays out of the repository.
const anilistClientId = buildSecret("ANILIST_CLIENT_ID", root);
// RiuPlay: the Discord application id for Rich Presence (see main/discordRpc.ts); none by default.
const discordClientId = buildSecret("RIUPLAY_DISCORD_CLIENT_ID", root);

// RiuPlay M2: the code that runs inside each sandboxed extension host (a Web Worker in a sandboxed
// window) - hibiki's host API bundled for the browser. Node built-ins it reached for become browser
// equivalents: zlib -> fflate, createRequire -> a static cheerio (nothing else can be required).
async function buildExtensionHostWorker(): Promise<void> {
  const { build } = await import("esbuild");
  const shims = {
    name: "riuplay-sandbox-shims",
    setup(b: import("esbuild").PluginBuild) {
      b.onResolve({ filter: /^node:zlib$/ }, () => ({ path: "zlib", namespace: "shim" }));
      b.onResolve({ filter: /^node:module$/ }, () => ({ path: "module", namespace: "shim" }));
      b.onLoad({ filter: /^zlib$/, namespace: "shim" }, () => ({
        contents: `import { gunzipSync as g, inflateSync as i } from "fflate";
          export function gunzipSync(bytes) { return Buffer.from(g(new Uint8Array(bytes))); }
          export function inflateSync(bytes) { return Buffer.from(i(new Uint8Array(bytes))); }
          export default { gunzipSync, inflateSync };`,
        resolveDir: root,
      }));
      b.onLoad({ filter: /^module$/, namespace: "shim" }, () => ({
        contents: `import * as cheerio from "cheerio/slim";
          export function createRequire() {
            return (name) => {
              if (name === "cheerio") return cheerio;
              throw new Error("require(" + name + ") is not available in the extension sandbox");
            };
          }`,
        resolveDir: root,
      }));
    },
  };
  await build({
    entryPoints: [path.join(root, "src/main/extensions/sandbox/hostWorker.ts")],
    outfile: path.join(root, "dist-electron/main/extension-host-worker.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome130",
    minify: true,
    legalComments: "eof",
    plugins: [shims],
    alias: { "@shared": path.join(root, "src/shared") },
    define: { "import.meta.url": '"riuplay-ext-host://host/worker.js"', "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
}

export default defineConfig({
  root: "src/renderer",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  plugins: [
    { name: "riuplay-extension-host-worker", buildStart: () => buildExtensionHostWorker() },
    TanStackRouterVite({
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    electron({
      main: {
        entry: {
          index: path.join(root, "src/main/index.ts"),
          extensionWorker: path.join(root, "src/main/extensions/worker.ts"),
        },
        vite: {
          define: { __ANILIST_CLIENT_ID__: JSON.stringify(anilistClientId), __DISCORD_CLIENT_ID__: JSON.stringify(discordClientId) },
          resolve: {
            alias: {
              "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
            },
          },
          build: {
            outDir: path.join(root, "dist-electron/main"),
            rollupOptions: {
              external: (id) =>
                id === "electron" ||
                id === "better-sqlite3" ||
                id === "undici" ||
                id === "sync-fetch" ||
                // Loaded on demand by jsoupShim. JSON-only sources should not parse Cheerio's
                // whole dependency tree merely because the compatibility global exists.
                id === "cheerio" ||
                id.startsWith("cheerio/") ||
                // ws's own optional-native-addon acceleration (used by @xhayper/discord-rpc's
                // websocket transport option) - neither is installed (ws falls back to a pure-JS
                // path at runtime when they're missing, which is fine), but Rollup tries to
                // eagerly resolve the import at bundle time and fails outright since they're not
                // in node_modules at all, crashing the whole app before it even loads.
                id === "bufferutil" ||
                id === "utf-8-validate" ||
                id.startsWith("node:"),
            },
          },
        },
      },
      preload: {
        input: path.join(root, "src/preload/index.ts"),
        vite: {
          resolve: {
            alias: {
              "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
            },
          },
          build: {
            outDir: path.join(root, "dist-electron/preload"),
          },
        },
      },
      renderer: {},
    }),
  ],
  // The Anime4K worker (features/player/upscaleWorker.ts) loads its library with a dynamic import,
  // which only an ES-module worker can split out.
  worker: { format: "es" },
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
  },
});
