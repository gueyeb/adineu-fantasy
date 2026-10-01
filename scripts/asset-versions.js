#!/usr/bin/env node
/**
 * Adineu Fantasy — cache-busting automatique des assets (plus aucun `?v=N` à la main).
 *
 * Chaque référence à un asset du site reçoit `?v=<hash>`, où le hash dépend du contenu du fichier
 * ET des versions de tout ce qu'il importe (récursivement). Modifier `league-settings.js` change
 * donc la version de chaque module qui l'importe, jusqu'aux pages HTML : impossible d'oublier un
 * importeur, ou de charger deux versions du même module (`matchups-live.js?v=3` et `?v=7`).
 *
 * Références gérées :
 *   - dans public/assets/*.js : spécifiers `"./x.js"` / `"./x.css"` (import, export, import())
 *   - dans public/**\/*.html  : `"/assets/x.js"` / `"/assets/x.css"` (script, link)
 *
 * Usage :
 *   npm run assets:version          # réécrit les références
 *   npm run assets:check            # échoue si une référence n'est pas à jour (lancé par npm run check)
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC_ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const ASSETS = join(PUBLIC_ROOT, "assets");
// A quoted asset specifier, with an optional existing version.
const JS_REFERENCE = /(["'])\.\/([\w.-]+\.(?:js|css))(?:\?v=[\w]+)?\1/g;
const HTML_REFERENCE = /(["'])\/assets\/([\w.-]+\.(?:js|css))(?:\?v=[\w]+)?\1/g;

async function listFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path, extension));
    else if (entry.name.endsWith(extension)) files.push(path);
  }
  return files;
}

/** Version of every asset: hash(own content without versions + sorted dependency versions). */
export function computeVersions(sources) {
  const versions = new Map();
  const visiting = new Set();
  const versionOf = name => {
    if (versions.has(name)) return versions.get(name);
    if (!sources.has(name)) throw new Error(`Asset référencé introuvable : assets/${name}`);
    if (visiting.has(name)) throw new Error(`Import circulaire autour de assets/${name}`);
    visiting.add(name);
    const content = sources.get(name);
    const dependencies = [...new Set([...content.matchAll(JS_REFERENCE)].map(match => match[2]))].sort();
    const hash = createHash("sha256").update(content.replace(JS_REFERENCE, (_, quote, file) => `${quote}./${file}${quote}`));
    for (const dependency of dependencies) hash.update(`\n${dependency}@${versionOf(dependency)}`);
    const version = hash.digest("hex").slice(0, 10);
    visiting.delete(name);
    versions.set(name, version);
    return version;
  };
  for (const name of sources.keys()) versionOf(name);
  return versions;
}

export function rewrite(content, versions, pattern, prefix) {
  return content.replace(pattern, (match, quote, file) => {
    if (!versions.has(file)) throw new Error(`Asset référencé introuvable : assets/${file}`);
    return `${quote}${prefix}${file}?v=${versions.get(file)}${quote}`;
  });
}

export async function syncAssetVersions({ write = true } = {}) {
  const assetFiles = [...await listFiles(ASSETS, ".js"), ...await listFiles(ASSETS, ".css")];
  const sources = new Map();
  for (const file of assetFiles) sources.set(relative(ASSETS, file), await readFile(file, "utf8"));
  const versions = computeVersions(sources);
  const stale = [];
  const targets = [
    ...assetFiles.map(file => ({ file, pattern: JS_REFERENCE, prefix: "./" })),
    ...(await listFiles(PUBLIC_ROOT, ".html")).map(file => ({ file, pattern: HTML_REFERENCE, prefix: "/assets/" }))
  ];
  for (const { file, pattern, prefix } of targets) {
    const content = await readFile(file, "utf8");
    const next = rewrite(content, versions, pattern, prefix);
    if (next !== content) {
      stale.push(relative(resolve(PUBLIC_ROOT, ".."), file));
      if (write) await writeFile(file, next);
    }
  }
  return { versions, stale };
}

async function main() {
  const check = process.argv.includes("--check");
  const { stale, versions } = await syncAssetVersions({ write: !check });
  if (check && stale.length) {
    console.error(`Versions d'assets périmées dans : ${stale.join(", ")}\nLance : npm run assets:version`);
    process.exitCode = 1;
    return;
  }
  console.log(check ? `Versions d'assets à jour (${versions.size} assets).` : `Versions d'assets mises à jour : ${stale.length ? stale.join(", ") : "rien à changer"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
