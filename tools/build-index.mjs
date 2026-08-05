#!/usr/bin/env node
// Regenerates index.json — the store's public API — from registry/ + dist/.
//
//   node tools/build.mjs && node tools/build-index.mjs
//
// Run after build.mjs: the digest and size for each entry come from the
// dist/<kind>-<id>.json that build.mjs wrote, so index.json can never
// advertise a hash for an artifact that was never produced. A package with no
// fresh build falls back to whatever is already published, which is what lets
// publish.yml rebuild only the packages a merge touched.
//
// index.json is committed by CI, never by hand.

import fs from "node:fs/promises";
import path from "node:path";
import {
  KINDS,
  REPO_ROOT,
  checkSchema,
  downloadUrl,
  exists,
  findPublished,
  listPackageDirs,
  loadSchemas,
  parsePackageDir,
  rawUrl,
  readIndex,
  readJson,
  sourceUrl,
} from "./lib.mjs";

const DIST = path.join(REPO_ROOT, "dist");
const INDEX_PATH = path.join(REPO_ROOT, "index.json");

async function entryFor(dirArg, previous) {
  const { kind, id, dir } = parsePackageDir(dirArg);
  const manifest = await readJson(path.join(dir, "manifest.json"));
  const store = await readJson(path.join(dir, "store.json"));

  const metaPath = path.join(DIST, `${kind}-${id}.json`);
  const published = findPublished(previous, kind, id);
  let meta;
  if (await exists(metaPath)) {
    meta = await readJson(metaPath);
  } else if (published && published.version === manifest.version) {
    meta = { version: published.version, sha256: published.sha256, sizeBytes: published.sizeBytes };
  } else {
    throw new Error(
      `${kind}/${id}: no dist/${kind}-${id}.json and nothing matching published — run tools/build.mjs first`,
    );
  }
  if (meta.version !== manifest.version) {
    throw new Error(
      `${kind}/${id}: dist holds ${meta.version} but manifest.json says ${manifest.version} — rebuild`,
    );
  }

  const relDir = `registry/${kind}/${id}`;
  // publishedAt is the moment this *version* first appeared, so it survives
  // regeneration. A new version resets it; anything else would make "recently
  // updated" meaningless.
  const publishedAt =
    published && published.version === manifest.version
      ? published.publishedAt
      : new Date().toISOString();

  return {
    id,
    name: manifest.name,
    author: manifest.author ?? null,
    description: manifest.description ?? null,
    version: manifest.version,
    license: store.license,
    tags: store.tags ?? [],
    homepage: store.homepage ?? null,
    sdkVersion: store.sdkVersion ?? null,
    minAmeeVersion: store.minAmeeVersion ?? null,
    width: manifest.width ?? 420,
    height: manifest.height ?? 84,
    resizable: manifest.resizable ?? false,
    preview: rawUrl(`${relDir}/${store.preview}`),
    screenshots: (store.screenshots ?? []).map((s) => rawUrl(`${relDir}/${s}`)),
    download: downloadUrl(kind, id, manifest.version),
    sha256: meta.sha256,
    sizeBytes: meta.sizeBytes,
    sourceUrl: sourceUrl(kind, id),
    publishedAt,
  };
}

async function main() {
  const previous = await readIndex();
  const kinds = {};
  for (const kind of KINDS) {
    const dirs = await listPackageDirs(kind);
    const entries = [];
    for (const dir of dirs) entries.push(await entryFor(dir, previous));
    // Newest first — the store page renders in index order.
    entries.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
    kinds[kind] = entries;
  }

  const next = { schemaVersion: 1, generatedAt: previous.generatedAt, kinds };
  const schemas = await loadSchemas();
  const errors = checkSchema(next, schemas.index);
  if (errors.length) {
    console.error("index.json would not match schema/index.schema.json:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  // Only stamp a new generatedAt when something actually changed, so a
  // no-op run doesn't produce a commit whose whole diff is a timestamp.
  const unchanged = JSON.stringify(next.kinds) === JSON.stringify(previous.kinds ?? {});
  if (!unchanged) next.generatedAt = new Date().toISOString();

  await fs.writeFile(INDEX_PATH, `${JSON.stringify(next, null, 2)}\n`);
  const total = KINDS.reduce((n, k) => n + kinds[k].length, 0);
  console.log(`${unchanged ? "= index.json unchanged" : "✓ index.json written"} (${total} package(s))`);
}

await main();
