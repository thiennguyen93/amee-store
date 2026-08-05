#!/usr/bin/env node
// Builds one or more registry packages into installable .ybskin archives.
//
//   node tools/build.mjs registry/skins/my-skin
//   node tools/build.mjs                          # every package
//
// Output: dist/<id>-<version>.ybskin plus dist/<kind>-<id>.json holding the
// digest and size (build-index.mjs reads those rather than re-hashing).
//
// A .ybskin is just a zip with manifest.json at its root — exactly what
// docs/SKINS.md tells an author to make by hand. This script exists to do it
// identically every time, and to run the build step for packages that ship
// source instead of a prebuilt entry file.
//
// Archives are byte-reproducible: staged files get a fixed mtime and the zip
// runs under TZ=UTC, so the same source always yields the same SHA-256. That
// is what lets a reviewer confirm a published release asset really was built
// from the merged source.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  KINDS,
  REPO_ROOT,
  STORE_ONLY,
  exists,
  listExampleDirs,
  listPackageDirs,
  parsePackageDir,
  readJson,
  sha256File,
  walk,
} from "./lib.mjs";

const DIST = path.join(REPO_ROOT, "dist");
const STAGE = path.join(REPO_ROOT, ".build");

/// Zip's own epoch. Anything earlier can't be represented in a DOS timestamp.
const FIXED_MTIME = new Date("1980-01-01T00:00:00Z");

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, TZ: "UTC" } });
  if (r.error) throw new Error(`${cmd} could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

async function copyInto(fromDir, files, toDir) {
  for (const rel of files) {
    const dest = path.join(toDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(fromDir, rel), dest);
  }
}

/// Runs the package's declared build. The command is never passed to a shell:
/// `command` is a package.json script name (schema-restricted to a safe
/// charset) handed to `<pm> run` as one argv element, so a package can't smuggle
/// shell syntax through it. What the script itself does is arbitrary — that is
/// exactly why validate.yml runs on `pull_request` (read-only token, no
/// secrets) rather than `pull_request_target`.
function runDeclaredBuild(dir, build) {
  const pm = build.packageManager;
  const install = pm === "pnpm" ? ["install", "--frozen-lockfile"] : ["ci"];
  run(pm, install, dir);
  run(pm, ["run", build.command], dir);
}

async function buildPackage(dirArg) {
  const { kind, id, dir } = parsePackageDir(dirArg);
  const manifest = await readJson(path.join(dir, "manifest.json"));
  const store = await readJson(path.join(dir, "store.json"));
  const version = manifest.version;
  if (!version) throw new Error(`${id}: manifest.json must set \`version\``);

  const stage = path.join(STAGE, `${kind}-${id}`);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  if (store.build) {
    runDeclaredBuild(dir, store.build);
    const outDir = path.join(dir, store.build.output);
    if (!(await exists(outDir))) {
      throw new Error(`${id}: build finished but ${store.build.output}/ doesn't exist`);
    }
    await copyInto(outDir, await walk(outDir), stage);
    // The manifest is store-side source of truth, not build output — copy it
    // in afterwards so a build that also emits one can't shadow it.
    await fs.copyFile(path.join(dir, "manifest.json"), path.join(stage, "manifest.json"));
  } else {
    await copyInto(dir, await walk(dir, { skipTop: STORE_ONLY }), stage);
  }

  const entry = manifest.entry ?? "main.js";
  if (!(await exists(path.join(stage, entry)))) {
    throw new Error(
      `${id}: manifest.json declares entry "${entry}" but it isn't in the package${store.build ? ` (checked ${store.build.output}/ after the build)` : ""}`,
    );
  }

  // Fixed mtimes, deepest-first so directory stamps survive their children.
  const staged = await walk(stage);
  for (const rel of staged) await fs.utimes(path.join(stage, rel), FIXED_MTIME, FIXED_MTIME);

  await fs.mkdir(DIST, { recursive: true });
  const archive = path.join(DIST, `${id}-${version}.ybskin`);
  await fs.rm(archive, { force: true });
  // -X drops extra attribute fields (uid/gid, Finder metadata) that would
  // otherwise vary by machine and break reproducibility.
  run("zip", ["-q", "-r", "-X", archive, "."], stage);

  const sha256 = await sha256File(archive);
  const sizeBytes = (await fs.stat(archive)).size;
  const meta = { kind, id, version, file: path.basename(archive), sha256, sizeBytes };
  await fs.writeFile(
    path.join(DIST, `${kind}-${id}.json`),
    `${JSON.stringify(meta, null, 2)}\n`,
  );

  await fs.rm(stage, { recursive: true, force: true });
  return meta;
}

async function main() {
  let dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    dirs = [...(await Promise.all(KINDS.map(listPackageDirs))).flat(), ...(await listExampleDirs())];
    if (dirs.length === 0) {
      console.log("No packages in registry/ or examples/ yet — nothing to build.");
      return;
    }
  }

  for (const dir of dirs) {
    const meta = await buildPackage(dir);
    console.log(
      `✓ dist/${meta.file}  ${(meta.sizeBytes / 1024).toFixed(1)} KB  sha256:${meta.sha256}`,
    );
  }
  await fs.rm(STAGE, { recursive: true, force: true });
}

await main();
