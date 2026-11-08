// Builds the built-in RiuPlay repository (extensions/official/) from extensions/official/src/:
//   <id>.manifest.json and <id>.js per extension (with //@include files inlined), and index.json
//   listing each one with the SHA-256 of both files. The app verifies those hashes before it
//   installs anything from this repository (core/marketplace.ts).
//
//   node scripts/build-official-repo.mjs          writes the files
//   node scripts/build-official-repo.mjs --check  fails when the committed files are out of date
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extensions", "official");
const src = path.join(root, "src");
const BASE = "riuplay-builtin://official/";
const check = process.argv.includes("--check");

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const inline = (file) =>
  readFileSync(path.join(src, file), "utf8").replace(/^\/\/@include ([\w.-]+)\r?\n/gm, (_m, name) => `${readFileSync(path.join(src, name), "utf8").trimEnd()}\n\n`).replace(/\r\n/g, "\n");

const manifests = JSON.parse(readFileSync(path.join(src, "manifests.json"), "utf8"));
const outputs = new Map();
const entries = [];
for (const manifest of manifests) {
  if (!/^riuplay\.[a-z0-9-]+$/.test(manifest.id)) throw new Error(`bad id ${manifest.id}`);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const script = inline(`${manifest.id}.js`);
  outputs.set(`${manifest.id}.manifest.json`, manifestJson);
  outputs.set(`${manifest.id}.js`, script);
  entries.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: "RiuPlay",
    website: manifest.website ?? null,
    iconUrl: null,
    lang: manifest.lang,
    capabilities: manifest.capabilities,
    resolverDependencies: [],
    isNsfw: manifest.isNsfw === true,
    type: "source",
    hostApi: manifest.hostApi,
    contentType: manifest.contentType,
    description: manifest.description,
    contentLicense: manifest.contentLicense,
    permissions: manifest.permissions,
    manifestUrl: `${BASE}${manifest.id}.manifest.json`,
    sha256: { manifest: sha256(manifestJson), script: sha256(script) },
  });
}
outputs.set(
  "index.json",
  `${JSON.stringify({ schemaVersion: 1, name: "RiuPlay (built-in)", license: "GPL-3.0-only", extensions: entries }, null, 2)}\n`,
);

let stale = 0;
for (const [name, content] of outputs) {
  const file = path.join(root, name);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (current === content) continue;
  stale++;
  if (check) console.error(`out of date: extensions/official/${name}`);
  else writeFileSync(file, content);
}
if (check && stale) process.exit(1);
console.log(check ? "official repository is up to date" : `official repository: ${entries.length} extensions, ${stale} file(s) written`);
