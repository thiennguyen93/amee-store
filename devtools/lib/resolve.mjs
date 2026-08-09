// Where a package's entry file and its assets actually live.
//
// This mirrors `buildPackage()` in tools/build.mjs — specifically the staging
// step at its heart, which decides what ends up inside the .ybskin and
// therefore what `getSkinAsset()` can see on the user's disk:
//
//   store.build declared  ->  everything under <output>/, plus manifest.json
//                             overlaid from the package root
//   no store.build        ->  the package directory minus STORE_ONLY
//
// Getting this wrong is not a cosmetic bug. If the harness resolved assets
// against the package root for a build package, `getSkinAsset("style.css")`
// would succeed locally and fail for every user after install — the exact
// class of failure a preview harness exists to prevent. Change this file and
// tools/build.mjs together.

import fs from "node:fs/promises";
import path from "node:path";
import {
  EXAMPLES_DIR,
  IGNORED_DIRS,
  KINDS,
  REPO_ROOT,
  STORE_ONLY,
  exists,
  listExampleDirs,
  listPackageDirs,
  parsePackageDir,
  readJson,
} from "../../tools/lib.mjs";
import { guessAssetMime } from "./mime.mjs";

/**
 * @typedef {object} ResolvedPackage
 * @property {string} dir         Absolute package directory.
 * @property {string} rel         Repo-relative package directory, the `pkg` key used over HTTP.
 * @property {string} id          Package id (equals the directory name).
 * @property {string} kind        "skins" | "extensions".
 * @property {boolean} isExample  Under examples/ rather than registry/.
 * @property {object} manifest
 * @property {object|null} store
 * @property {string} entry       manifest.entry ?? "main.js".
 * @property {string} assetRoot   Absolute dir that `getSkinAsset` resolves against.
 * @property {string} entryPath   Absolute path to the entry file.
 * @property {boolean} entryExists
 * @property {object|null} build  store.build, if declared.
 * @property {Record<string,string>} overlay  Files layered over assetRoot by the build staging.
 * @property {Set<string>} hiddenTop          Top-level names assetRoot must pretend not to have.
 */

/** @returns {Promise<ResolvedPackage>} */
export async function resolvePackage(dirArg) {
  const { kind, id, dir, isExample } = parsePackageDir(dirArg);

  const manifestPath = path.join(dir, "manifest.json");
  if (!(await exists(manifestPath))) {
    throw new Error(`${path.relative(REPO_ROOT, dir)} has no manifest.json — not a skin package`);
  }
  const manifest = await readJson(manifestPath);

  const storePath = path.join(dir, "store.json");
  // store.json is required to publish but not to preview. Someone sketching a
  // skin should be able to run the harness before they have decided on a
  // licence, so a missing one is a warning at startup, not an error here.
  const store = (await exists(storePath)) ? await readJson(storePath) : null;

  const build = store?.build ?? null;
  const entry = manifest.entry ?? "main.js";

  const assetRoot = build ? path.join(dir, build.output) : dir;
  const overlay = build ? { "manifest.json": manifestPath } : {};
  // Only meaningful without a build: these files sit in the package directory
  // but are stripped before packaging, so they must be invisible to
  // getSkinAsset. Under a build they were never in <output>/ to begin with.
  const hiddenTop = build ? new Set() : new Set(STORE_ONLY);

  const entryPath = path.join(assetRoot, entry);

  return {
    dir,
    rel: path.relative(REPO_ROOT, dir),
    id,
    kind,
    isExample,
    manifest,
    store,
    entry,
    assetRoot,
    entryPath,
    entryExists: await exists(entryPath),
    build,
    overlay,
    hiddenTop,
  };
}

/// What the startup banner and the picker page need, without reading every
/// file. Silently skips directories that aren't packages, so a stray folder
/// under examples/ doesn't take the whole picker down.
export async function listPackages() {
  const dirs = [
    ...(await listExampleDirs()),
    ...(await Promise.all(KINDS.map(listPackageDirs))).flat(),
  ];
  const out = [];
  for (const dir of dirs) {
    try {
      const pkg = await resolvePackage(dir);
      out.push({
        rel: pkg.rel,
        id: pkg.id,
        kind: pkg.kind,
        isExample: pkg.isExample,
        name: pkg.manifest.name ?? pkg.id,
        description: pkg.manifest.description ?? null,
        width: pkg.manifest.width ?? 420,
        height: pkg.manifest.height ?? 84,
        buildDeclared: !!pkg.build,
        entryExists: pkg.entryExists,
      });
    } catch {
      // Not a package. Nothing to preview, nothing to report.
    }
  }
  return out;
}

/// Reads an asset the way `get_skin_asset` does, down to the error strings.
///
/// Ported from `resolve_skin_path` + `get_skin_asset` in Amee's
/// src-tauri/src/skin.rs. The strings are part of the contract: a skin that
/// catches a rejection and matches on the message must behave identically
/// here and in the app, so "invalid path" and "'x' not found" are reproduced
/// verbatim, in the same order of checks.
export async function resolveAsset(pkg, requested) {
  if (typeof requested !== "string" || requested === "") {
    return { error: "invalid path" };
  }
  const parts = requested.split(/[\\/]/);
  if (path.isAbsolute(requested) || parts.includes("..")) {
    return { error: "invalid path" };
  }
  // Not in the Rust original, which has no equivalent: these directories are
  // stripped by walk() before packaging, so on a user's disk there is nothing
  // to find. Reported as not-found rather than invalid for that reason.
  if (parts.some((p) => IGNORED_DIRS.has(p))) {
    return { error: `'${requested}' not found` };
  }
  if (pkg.hiddenTop.has(parts[0])) {
    return { error: `'${requested}' not found` };
  }

  const overlaid = Object.prototype.hasOwnProperty.call(pkg.overlay, requested);
  const candidate = overlaid ? pkg.overlay[requested] : path.join(pkg.assetRoot, requested);

  let real;
  try {
    real = await fs.realpath(candidate);
  } catch {
    return { error: `'${requested}' not found` };
  }

  // An overlaid file lives outside assetRoot by construction (manifest.json
  // comes from the package root), so it is exempt from the containment check —
  // the overlay map is ours, not the skin's, and holds exactly one key.
  if (!overlaid) {
    let base;
    try {
      base = await fs.realpath(pkg.assetRoot);
    } catch {
      return { error: `'${requested}' not found` };
    }
    if (real !== base && !real.startsWith(base + path.sep)) {
      return { error: "invalid path" };
    }
  }

  let bytes;
  try {
    bytes = await fs.readFile(real);
  } catch (err) {
    return { error: `failed to read asset '${requested}': ${err.message}` };
  }

  const mime = guessAssetMime(real);
  return {
    dataUri: `data:${mime};base64,${bytes.toString("base64")}`,
    mime,
    bytes: bytes.length,
  };
}

/// The one-paragraph explanation the banner and the harness both show when a
/// build package hasn't been built yet. Returns null when there's nothing to
/// say — a plain-JS package with a missing entry is a real error, not a
/// pending build.
export function buildHint(pkg) {
  if (pkg.entryExists || !pkg.build) return null;
  const pm = pkg.build.packageManager ?? "npm";
  const install = pm === "pnpm" ? "pnpm install" : "npm install";
  return [
    `${pkg.rel} declares a build (${pm} run ${pkg.build.command} -> ${pkg.build.output}/).`,
    `${path.join(pkg.build.output, pkg.entry)} doesn't exist yet. In another terminal:`,
    ``,
    `    cd ${pkg.rel} && ${install} && ${pm} run dev`,
    ``,
    `...or re-run the harness with --build-watch and it will do that for you.`,
  ].join("\n");
}
