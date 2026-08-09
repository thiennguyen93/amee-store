#!/usr/bin/env node
// Headless smoke test for the harness. No browser, no dependencies, ~2s.
//
//   node devtools/selftest.mjs
//
// What it is actually protecting: devtools/lib/resolve.mjs mirrors the staging
// step in tools/build.mjs, which decides what ends up inside a .ybskin and
// therefore what getSkinAsset() can see after install. That mirror is exactly
// the kind of thing that drifts silently — the harness keeps working, and the
// lie only surfaces on a user's machine. Every assertion below is about the
// mirror or about a path-escape rule, not about the UI.
//
// It deliberately asserts on *resolved paths and error strings*, never on
// built files: a fresh checkout has no dist/, and CI runs this before any
// package is built.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEVTOOLS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DEVTOOLS, "..");
const PORT = 45173;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

const json = (p) => fetch(BASE + p).then((r) => r.json());

async function asset(pkg, assetPath) {
  return json(`/__amee/asset?pkg=${encodeURIComponent(pkg)}&path=${encodeURIComponent(assetPath)}`);
}

async function run() {
  console.log("resolution");

  const hello = (await json("/__amee/manifest?pkg=examples/hello-skin")).resolution;
  check(
    "hello-skin entry resolves to the package root",
    hello.entryPath === "examples/hello-skin/main.js",
    hello.entryPath,
  );
  check("hello-skin asset root is the package root", hello.assetRoot === "examples/hello-skin");
  check("hello-skin declares no build", hello.buildDeclared === false);

  const react = (await json("/__amee/manifest?pkg=examples/react-skin")).resolution;
  check(
    "react-skin entry resolves into dist/",
    react.entryPath === "examples/react-skin/dist/main.js",
    react.entryPath,
  );
  check("react-skin asset root is dist/", react.assetRoot === "examples/react-skin/dist");
  check("react-skin declares a build", react.buildDeclared === true);
  // Asserting the *message*, never entryExists: on a machine where someone has
  // run `npm run build` the file is there, and that must not fail the test.
  check(
    "an unbuilt build package gets an actionable hint",
    react.entryExists || (react.hint ?? "").includes("npm run dev"),
    react.hint,
  );

  console.log("assets");

  const css = await asset("examples/hello-skin", "style.css");
  check(
    "a package asset comes back as a data: URI with the ported mime",
    (css.dataUri ?? "").startsWith("data:text/css;base64,"),
    css.error ?? (css.dataUri ?? "").slice(0, 40),
  );

  const escape = await asset("examples/hello-skin", "../../../etc/passwd");
  check("a .. escape is rejected verbatim", escape.error === "invalid path", escape.error);

  const absolute = await asset("examples/hello-skin", "/etc/passwd");
  check("an absolute path is rejected verbatim", absolute.error === "invalid path", absolute.error);

  // STORE_ONLY is stripped by tools/build.mjs, so on a user's disk there is
  // nothing to find. The harness must agree, or an author ships a skin that
  // reads its own store.json and breaks for everyone.
  const storeJson = await asset("examples/hello-skin", "store.json");
  check(
    "store.json is invisible to a non-build package",
    storeJson.error === "'store.json' not found",
    storeJson.error,
  );
  const media = await asset("examples/hello-skin", "media/preview.png");
  check(
    "media/ is invisible to a non-build package",
    media.error === "'media/preview.png' not found",
    media.error,
  );
  const readme = await asset("examples/hello-skin", "README.md");
  check("README.md is invisible to a non-build package", readme.error === "'README.md' not found");

  // The build staging overlays manifest.json from the package root, and
  // classic's about.js reads its own manifest at runtime, so this must work
  // whether or not the package has been built.
  for (const pkg of ["examples/hello-skin", "examples/react-skin"]) {
    const m = await asset(pkg, "manifest.json");
    check(
      `${pkg}: manifest.json is readable`,
      (m.dataUri ?? "").startsWith("data:application/json;base64,"),
      m.error,
    );
  }

  const nodeModules = await asset("examples/react-skin", "node_modules/react/package.json");
  check(
    "node_modules is invisible",
    nodeModules.error === "'node_modules/react/package.json' not found",
    nodeModules.error,
  );

  console.log("serving");

  const entry = await fetch(`${BASE}/__amee/entry?pkg=examples/hello-skin`);
  const source = await entry.text();
  check(
    "the entry file is served as text, not as a script",
    (entry.headers.get("content-type") ?? "").startsWith("text/plain"),
    entry.headers.get("content-type"),
  );
  check("the entry file is the skin's source", source.includes("export function mount"));

  const packages = await json("/__amee/packages");
  check(
    "both examples and the published skin are listed",
    ["examples/hello-skin", "examples/react-skin", "registry/skins/amee-v2"].every((rel) =>
      packages.packages.some((p) => p.rel === rel),
    ),
    packages.packages.map((p) => p.rel).join(", "),
  );

  const missing = await fetch(`${BASE}/nope`);
  check("an unknown route 404s", missing.status === 404, String(missing.status));

  const escapeStatic = await fetch(`${BASE}/web/../../tools/lib.mjs`);
  check(
    "static serving can't escape devtools/web",
    escapeStatic.status === 404,
    String(escapeStatic.status),
  );
}

// ---------------------------------------------------------------------------

const server = spawn(
  process.execPath,
  [path.join(DEVTOOLS, "dev.mjs"), "examples/hello-skin", "--port", String(PORT), "--no-open"],
  { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
);

let serverOutput = "";
server.stdout.on("data", (c) => (serverOutput += c));
server.stderr.on("data", (c) => (serverOutput += c));

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`dev.mjs exited early:\n${serverOutput}`);
    try {
      await fetch(`${BASE}/__amee/packages`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`dev.mjs never came up:\n${serverOutput}`);
}

try {
  await waitForServer();
  await run();
} catch (err) {
  failures++;
  console.error(`\n  FAIL  ${err.message}`);
} finally {
  server.kill();
}

console.log("");
if (failures > 0) {
  console.error(`✗ ${failures} harness check(s) failed`);
  process.exit(1);
}
console.log("✓ harness self-test passed");
