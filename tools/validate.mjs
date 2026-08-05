#!/usr/bin/env node
// Validates one or more registry package directories.
//
//   node tools/validate.mjs registry/skins/my-skin
//   node tools/validate.mjs                          # every package
//
// Exits non-zero with a list of problems. Every check here exists because
// tripping it would either break the store page or produce a .ybskin Amee
// refuses to import — this is the gate that keeps "merged" and "installable"
// the same thing.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_EXTENSIONS,
  KINDS,
  MAX_EXTRACTED_BYTES,
  MAX_MEDIA_BYTES,
  REPO_ROOT,
  RESERVED_IDS,
  STORE_ONLY,
  checkSchema,
  compareSemver,
  dimBounds,
  exists,
  findPublished,
  listExampleDirs,
  listPackageDirs,
  loadSchemas,
  parsePackageDir,
  pngSize,
  readIndex,
  readJson,
  totalBytes,
  validateManifestRules,
  walk,
} from "./lib.mjs";

/// Set by CI to the login that opened the PR. Unset locally, where the
/// ownership check is meaningless (you're validating your own working copy).
const PR_AUTHOR = process.env.PR_AUTHOR || "";
/// Logins allowed to publish updates to any package, e.g. to land a security
/// fix in a skin whose author has gone quiet.
const MAINTAINERS = new Set(["thiennguyen93"]);

/// The packages this PR actually submits, set by CI from the diff.
///
/// Distinct from the list being validated, which is *everything* whenever a
/// tools/ or schema/ change could have invalidated any package. Two rules below
/// — bump the version, updates come from the owner — are about a submission, not
/// about shape, and applying them to a package the PR never touched fails a PR
/// for someone else's already-published skin.
///
/// Empty means "no submissions", not "everything": a schema-only PR genuinely
/// submits nothing, and neither does a publish.yml sweep.
///
/// **Set-but-empty and absent are different, and the difference is load-bearing.**
/// GitHub still exports the variable when the expression behind it is empty, so
/// an empty string is CI saying "I looked, there were none". Absent means nobody
/// told us — a workflow that lost the `env:` line, or a new workflow that never
/// had it. Both would otherwise disable the two rules, and silently disabling an
/// authorization check is the failure mode worth being loud about. `assertScoped`
/// makes the second case an error.
const SUBMITTED_RAW = process.env.SUBMITTED_DIRS;
const SUBMITTED = new Set(
  (SUBMITTED_RAW || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeDir),
);

/// Refuses to run the submission rules on guesswork.
///
/// Called once, up front, rather than per package — a scoping mistake is a
/// property of the run, and reporting it as one error beats repeating it for
/// every package in the registry.
function assertScoped() {
  if (PR_AUTHOR && SUBMITTED_RAW === undefined) {
    console.error(
      "PR_AUTHOR is set but SUBMITTED_DIRS is not. The version-bump and " +
        "ownership checks need to know which packages this PR submits, and " +
        "guessing would mean skipping them. Pass SUBMITTED_DIRS from the " +
        "workflow (empty string is a valid answer meaning 'no packages').",
    );
    process.exit(1);
  }
}

/// Callers disagree on the shape of a package path in two ways: trailing slash
/// (publish.yml passes `registry/*/*/` from a glob, the PR path passes
/// `registry/skins/x` from a sed) and absoluteness (`listPackageDirs` returns
/// absolute paths, CI's diff produces repo-relative ones).
///
/// Resolving both sides is what makes the comparison mean anything. A plain
/// string compare silently never matches on a full sweep, which would leave the
/// two submission rules permanently off instead of scoped — failing open on the
/// exact checks that exist to stop someone publishing over another author's
/// package.
function normalizeDir(dir) {
  return path.resolve(dir).replace(/\/+$/, "");
}

/// Whether this package is one the PR submitted, and so subject to the
/// submission rules rather than only to the shape checks.
function isSubmitted(dir) {
  return SUBMITTED.has(normalizeDir(dir));
}

/// Whether git has anything under `relPath`. Used instead of a filesystem
/// check wherever the question is "did the author commit this?" rather than
/// "is it on disk right now?".
function isTracked(relPath) {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", relPath], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  if (r.status === 0) return true;
  // A directory never matches --error-unmatch; ask for its contents instead.
  const listed = spawnSync("git", ["ls-files", "--", `${relPath}/`], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  return listed.status === 0 && listed.stdout.toString().trim().length > 0;
}

async function validatePackage(dirArg, { schemas, index }) {
  const errors = [];
  const { kind, id, dir, isExample } = parsePackageDir(dirArg);
  const rel = path.relative(REPO_ROOT, dir);
  const fail = (msg) => errors.push(`${rel}: ${msg}`);

  // 1. Both files present and schema-valid.
  const manifestPath = path.join(dir, "manifest.json");
  const storePath = path.join(dir, "store.json");
  if (!(await exists(manifestPath))) return [`${rel}: missing manifest.json`];
  if (!(await exists(storePath))) return [`${rel}: missing store.json`];

  const manifest = await readJson(manifestPath);
  const store = await readJson(storePath);
  errors.push(...checkSchema(manifest, schemas.manifest).map((e) => `${rel}/manifest.json ${e}`));
  errors.push(...checkSchema(store, schemas.package).map((e) => `${rel}/store.json ${e}`));
  if (errors.length) return errors;

  // 2. Identity.
  if (manifest.id !== id) {
    fail(`manifest.json \`id\` is "${manifest.id}" but the directory is named "${id}" — they must match`);
  }
  if (RESERVED_IDS.has(manifest.id)) {
    fail(`"${manifest.id}" is the id of a built-in skin. Amee prefers the built-in on a collision, so a store skin with this id could never be selected — pick another.`);
  }
  const expectedKind = { skins: "skin", extensions: "extension" }[kind];
  if (store.kind !== expectedKind) {
    fail(`store.json \`kind\` is "${store.kind}" but the package lives under registry/${kind}/`);
  }

  // 3. Everything Amee itself would reject when importing the package.
  errors.push(...validateManifestRules(manifest, dimBounds(schemas.manifest)).map((e) => `${rel}: ${e}`));

  // 4. Version is present, semver (schema-checked) and strictly increasing.
  //    Amee treats `version` as optional free text; the store does not, because
  //    releases are tagged by it and an unchanged version can't be published.
  if (!manifest.version) {
    fail("manifest.json must set `version` — the store tags releases by it");
  } else if (!isExample) {
    const published = findPublished(index, kind, id);
    if (published) {
      const cmp = compareSemver(manifest.version, published.version);
      if (cmp < 0) {
        // Always wrong, in any context: the index would end up advertising an
        // older build than the one already released under this id.
        fail(`version ${manifest.version} is older than the published ${published.version}`);
      } else if (cmp === 0 && PR_AUTHOR && isSubmitted(dir)) {
        // Only a submitted package has to bump.
        //
        // publish.yml re-validates every package on main, including ones whose
        // version hasn't moved since their last release — treating that as an
        // error would fail every publish run after the first. Re-publishing an
        // unchanged version is a no-op there anyway: the release step skips a
        // tag that already exists.
        //
        // `PR_AUTHOR` alone used to stand in for "this is a submission", and
        // that was wrong in one case: a PR touching tools/ or schema/ makes CI
        // re-validate everything, so every already-published package tripped
        // this even though the PR never touched it. `isSubmitted` is the actual
        // question. Both conditions stay — PR_AUTHOR keeps local runs quiet.
        fail(`version ${manifest.version} is already published — bump it`);
      }
    }
  }

  // 5. Contents. `build` packages are checked again in build.mjs once the
  //    output exists; here we can only check what's committed.
  const files = await walk(dir, { skipTop: STORE_ONLY });
  if (files.length === 0) fail("package contains no files");

  const entry = manifest.entry ?? "main.js";
  if (store.build) {
    // Tracked-by-git, not exists-on-disk: after a local `tools/build.mjs` run
    // the output directory is sitting right there, and failing on that would
    // punish the exact workflow CONTRIBUTING.md tells authors to use.
    if (isTracked(path.join(rel, store.build.output))) {
      fail(`\`${store.build.output}/\` is committed but this package declares a build — CI builds it, so the output must not be in git`);
    }
    if (!(await exists(path.join(dir, "package.json")))) {
      fail("a package that declares `build` must commit package.json");
    }
    const hasLock = (await Promise.all(
      ["package-lock.json", "pnpm-lock.yaml"].map((f) => exists(path.join(dir, f))),
    )).some(Boolean);
    if (!hasLock) {
      fail("a package that declares `build` must commit its lockfile — CI installs with --frozen-lockfile so the built output is reproducible and reviewable");
    }
  } else if (!files.includes(entry)) {
    fail(`manifest.json declares entry "${entry}" but the package doesn't contain that file`);
  }

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      fail(`${f} has an extension (${ext || "none"}) that isn't allowed in a package. Skins run unsandboxed, so a reviewer has to be able to read everything that ships.`);
    }
    if (f.endsWith(".ybskin")) fail(`${f} is a built package — commit the source, CI does the zipping`);
  }

  const bytes = await totalBytes(dir, files);
  if (bytes > MAX_EXTRACTED_BYTES) {
    fail(`package is ${(bytes / 1024 / 1024).toFixed(1)} MiB unpacked, over Amee's ${MAX_EXTRACTED_BYTES / 1024 / 1024} MiB import limit`);
  }

  // 6. Media.
  const previewPath = path.join(dir, store.preview);
  if (!(await exists(previewPath))) {
    fail(`store.json \`preview\` points at ${store.preview}, which doesn't exist`);
  } else {
    const size = (await fs.stat(previewPath)).size;
    if (size > MAX_MEDIA_BYTES) {
      fail(`${store.preview} is ${(size / 1024).toFixed(0)} KB, over the ${MAX_MEDIA_BYTES / 1024} KB limit — every store visitor downloads it`);
    }
    const dims = await pngSize(previewPath);
    if (!dims) {
      fail(`${store.preview} isn't a valid PNG`);
    } else {
      const want = (manifest.width ?? 420) / (manifest.height ?? 84);
      const got = dims.width / dims.height;
      if (Math.abs(got - want) / want > 0.1) {
        fail(`${store.preview} is ${dims.width}x${dims.height} (ratio ${got.toFixed(2)}) but the skin's window is ${manifest.width}x${manifest.height} (ratio ${want.toFixed(2)}) — the card would show a distorted or letterboxed preview`);
      }
    }
  }
  for (const shot of store.screenshots ?? []) {
    const p = path.join(dir, shot);
    if (!(await exists(p))) fail(`store.json \`screenshots\` lists ${shot}, which doesn't exist`);
    else if ((await fs.stat(p)).size > MAX_MEDIA_BYTES) {
      fail(`${shot} is over the ${MAX_MEDIA_BYTES / 1024} KB limit`);
    }
  }

  // 7. Ownership — only meaningful in CI, only for a package this PR submits,
  //    and only for one that already exists. A brand-new package has no
  //    established owner to check against; that's what human review is for.
  //
  //    `isSubmitted` for the same reason as the version check above: without it
  //    a tools/-only PR from a non-maintainer fails on every package in the
  //    registry, none of which it proposed to change.
  if (PR_AUTHOR && isSubmitted(dir) && !isExample && findPublished(index, kind, id)) {
    if (store.owner !== PR_AUTHOR && !MAINTAINERS.has(PR_AUTHOR)) {
      fail(`this package is owned by @${store.owner}, but this PR is from @${PR_AUTHOR}. Updates have to come from the owner or a maintainer.`);
    }
  }

  return errors;
}

async function main() {
  assertScoped();
  const args = process.argv.slice(2);
  const schemas = await loadSchemas();
  const index = await readIndex();

  let dirs = args;
  if (dirs.length === 0) {
    dirs = [...(await Promise.all(KINDS.map(listPackageDirs))).flat(), ...(await listExampleDirs())];
    if (dirs.length === 0) {
      console.log("No packages in registry/ or examples/ yet — nothing to validate.");
      return;
    }
  }

  const errors = [];
  for (const dir of dirs) {
    try {
      errors.push(...(await validatePackage(dir, { schemas, index })));
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error("");
    process.exit(1);
  }
  console.log(`✓ ${dirs.length} package(s) valid`);
}

await main();
