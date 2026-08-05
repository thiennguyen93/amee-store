// Shared helpers for validate.mjs / build.mjs / build-index.mjs.
//
// Deliberately zero-dependency: a skin author should be able to clone this
// repo and run `node tools/validate.mjs <dir>` with nothing installed. That
// rules out ajv, so the JSON Schemas in schema/ are enforced by the small
// draft-07 subset validator below. The subset is exactly what those schemas
// use — if you add a keyword to a schema, teach `checkSchema` about it or it
// will be silently ignored, which is worse than not having it.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTRY_DIR = path.join(REPO_ROOT, "registry");
export const INDEX_PATH = path.join(REPO_ROOT, "index.json");

export const OWNER = "thiennguyen93";
export const REPO = "amee-store";

/// Amee refuses to import a package that exceeds this once extracted, so a
/// package that trips it here would be un-installable anyway. Keep in step
/// with the limit Amee enforces.
export const MAX_EXTRACTED_BYTES = 25 * 1024 * 1024;

/// Ids that a built-in skin already occupies. Amee prefers the built-in copy
/// on a collision, so an installed skin sharing one of these would be
/// silently shadowed and unreachable forever.
export const RESERVED_IDS = new Set(["classic"]);

/// Preview/screenshot budget. These are fetched by every visitor to the
/// store page, so they are held to a stricter limit than package files.
export const MAX_MEDIA_BYTES = 1024 * 1024;

/// What may appear inside a package directory. An allowlist rather than a
/// denylist: the review burden is on things a reviewer can actually read, and
/// an unexpected binary is exactly what shouldn't slip through quietly.
export const ALLOWED_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".css", ".html", ".json", ".md", ".txt",
  ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif",
  ".woff", ".woff2", ".ttf", ".otf",
  ".yaml", ".yml", ".lock", ".map",
]);

/// Never zipped into the .ybskin: store-only metadata, store-only media, and
/// the package's README (documentation for people browsing this repo, not
/// something Amee needs on the user's disk). Amee should receive exactly the
/// files it needs, so a package built here is byte-comparable with one an
/// author zipped by hand following docs/SKINS.md.
export const STORE_ONLY = new Set(["store.json", "media", "README.md"]);

/// Never zipped and never counted, wherever they appear.
export const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".DS_Store"]);

export async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.relative(REPO_ROOT, file)} is not valid JSON: ${err.message}`);
  }
}

export async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

let schemaCache = null;
export async function loadSchemas() {
  if (!schemaCache) {
    const dir = path.join(REPO_ROOT, "schema");
    schemaCache = {
      manifest: await readJson(path.join(dir, "manifest.schema.json")),
      package: await readJson(path.join(dir, "package.schema.json")),
      index: await readJson(path.join(dir, "index.schema.json")),
    };
  }
  return schemaCache;
}

/// Numeric bounds are read back out of the manifest schema rather than
/// re-declared here, so schema/manifest.schema.json stays the one place a
/// bound is written on the JS side (and the one place to update if Amee's own
/// dimension limits ever change).
export function dimBounds(manifestSchema) {
  const w = manifestSchema.properties.width;
  const t = manifestSchema.properties.graceful_shutdown_timeout_ms;
  return { MIN_DIM: w.minimum, MAX_DIM: w.maximum, MIN_MS: t.minimum, MAX_MS: t.maximum };
}

// ---------------------------------------------------------------------------
// Minimal draft-07 subset validator
// ---------------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, key) => node[key], root);
}

/// Returns an array of human-readable error strings; empty means valid.
/// `where` is a dotted path used only for messages.
export function checkSchema(value, schema, root = schema, where = "") {
  const errors = [];
  const at = where || "(root)";

  if (schema.$ref) return checkSchema(value, resolveRef(schema.$ref, root), root, where);

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${at}: expected ${types.join(" or ")}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: must be at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: must have at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: must have at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...checkSchema(item, schema.items, root, `${at}[${i}]`));
      });
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: missing required property \`${key}\``);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${at}: unknown property \`${key}\``);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        errors.push(...checkSchema(value[key], sub, root, where ? `${where}.${key}` : key));
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Manifest rules JSON Schema can't express
// ---------------------------------------------------------------------------

/// Mirror of the validation Amee runs when it imports a package. Every branch
/// below corresponds to one rejection there, in the same order, so the two can
/// be read side by side. Anything Amee would reject at import time must be
/// rejected here, or a skin merges into the store and then fails to install.
export function validateManifestRules(m, bounds) {
  const { MIN_DIM, MAX_DIM, MIN_MS, MAX_MS } = bounds;
  const errors = [];

  const entry = m.entry ?? "main.js";
  if (!entry.trim() || /[/\\]/.test(entry) || entry.includes("..")) {
    errors.push("manifest.json: `entry` must be a plain filename with no path separators");
  }

  const width = m.width ?? 420;
  const height = m.height ?? 84;

  if (m.content_height !== undefined && (m.content_height < MIN_DIM || m.content_height > height)) {
    errors.push(
      `manifest.json: \`content_height\` must be between ${MIN_DIM} and \`height\` (${height})`,
    );
  }

  const rangeKeys = ["min_width", "max_width", "min_height", "max_height"];
  const hasRange = rangeKeys.some((k) => m[k] !== undefined);
  if (!m.resizable && hasRange) {
    errors.push(
      "manifest.json: `min_width`/`max_width`/`min_height`/`max_height` require `resizable: true`",
    );
  }

  if (m.resizable) {
    for (const [label, min, max, base] of [
      ["width", m.min_width, m.max_width, width],
      ["height", m.min_height, m.max_height, height],
    ]) {
      if (min !== undefined && (min < MIN_DIM || min > MAX_DIM || min > base)) {
        errors.push(
          `manifest.json: \`min_${label}\` must be between ${MIN_DIM} and ${MAX_DIM}, and not exceed \`${label}\``,
        );
      }
      if (max !== undefined && (max < MIN_DIM || max > MAX_DIM || max < base)) {
        errors.push(
          `manifest.json: \`max_${label}\` must be between ${MIN_DIM} and ${MAX_DIM}, and not be smaller than \`${label}\``,
        );
      }
      if (min !== undefined && max !== undefined && min > max) {
        errors.push(`manifest.json: \`min_${label}\` must not exceed \`max_${label}\``);
      }
    }
    // A resizable skin with a real height range can't also reserve
    // content_height dead-space: content_inset/click_through/snap_mini_player
    // all derive from the manifest's *static* height. Note the fallbacks —
    // an unset min_height/max_height resolves to the global bounds, which are
    // never equal, so omitting them is itself a failure here (same as Rust).
    if (m.content_height !== undefined) {
      const minH = m.min_height ?? MIN_DIM;
      const maxH = m.max_height ?? MAX_DIM;
      if (minH !== maxH) {
        errors.push(
          "manifest.json: a resizable skin with a real height range can't also declare `content_height` — pin `min_height`/`max_height` equal to `height` if you need both",
        );
      }
    }
  }

  if (!m.graceful_shutdown && m.graceful_shutdown_timeout_ms !== undefined) {
    errors.push(
      "manifest.json: `graceful_shutdown_timeout_ms` requires `graceful_shutdown: true`",
    );
  }
  if (
    m.graceful_shutdown_timeout_ms !== undefined &&
    (m.graceful_shutdown_timeout_ms < MIN_MS || m.graceful_shutdown_timeout_ms > MAX_MS)
  ) {
    errors.push(
      `manifest.json: \`graceful_shutdown_timeout_ms\` must be between ${MIN_MS} and ${MAX_MS} ms`,
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

/// Every file under `dir`, as paths relative to it, skipping IGNORED_DIRS.
/// `skipTop` drops top-level names outright (used for store.json / media/).
export async function walk(dir, { skipTop = new Set() } = {}) {
  const out = [];
  async function rec(rel) {
    const abs = path.join(dir, rel);
    for (const dirent of await fs.readdir(abs, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, dirent.name) : dirent.name;
      if (IGNORED_DIRS.has(dirent.name)) continue;
      if (!rel && skipTop.has(dirent.name)) continue;
      if (dirent.isDirectory()) await rec(childRel);
      else if (dirent.isFile()) out.push(childRel);
    }
  }
  await rec("");
  return out.sort();
}

export async function totalBytes(dir, files) {
  let sum = 0;
  for (const f of files) sum += (await fs.stat(path.join(dir, f))).size;
  return sum;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/// Width/height of a PNG, straight out of the IHDR chunk. Avoids an image
/// dependency for the one thing we need images for (aspect-ratio checking).
/// Returns null when the file isn't a PNG.
export async function pngSize(file) {
  const head = Buffer.alloc(24);
  const fh = await fs.open(file, "r");
  try {
    const { bytesRead } = await fh.read(head, 0, 24, 0);
    if (bytesRead < 24) return null;
  } finally {
    await fh.close();
  }
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!head.subarray(0, 8).equals(SIGNATURE)) return null;
  if (head.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const KINDS = ["skins", "extensions"];

export const EXAMPLES_DIR = path.join(REPO_ROOT, "examples");

/// Locates a package directory and works out which registry it belongs to.
///
/// `registry/<kind>/<id>` is the real thing. `examples/<id>` is also accepted
/// and treated as a skin, so CI validates and builds the starter templates on
/// every PR — an example that has quietly stopped being a valid package is a
/// worse first impression than no example at all. Examples are never indexed
/// or released; `isExample` is what keeps them out of index.json.
export function parsePackageDir(dir) {
  const abs = path.resolve(dir);

  const fromExamples = path.relative(EXAMPLES_DIR, abs).split(path.sep);
  if (fromExamples.length === 1 && fromExamples[0] && !fromExamples[0].startsWith("..")) {
    return { kind: "skins", id: fromExamples[0], dir: abs, isExample: true };
  }

  const parts = path.relative(REGISTRY_DIR, abs).split(path.sep);
  if (parts.length !== 2 || !KINDS.includes(parts[0]) || parts[1].startsWith(".")) {
    throw new Error(
      `${dir} is not a package directory — expected registry/<${KINDS.join("|")}>/<id> or examples/<id>`,
    );
  }
  return {
    kind: parts[0],
    id: parts[1],
    dir: path.join(REGISTRY_DIR, parts[0], parts[1]),
    isExample: false,
  };
}

export async function listExampleDirs() {
  if (!(await exists(EXAMPLES_DIR))) return [];
  const entries = await fs.readdir(EXAMPLES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => path.join(EXAMPLES_DIR, e.name))
    .sort();
}

export async function listPackageDirs(kind) {
  const base = path.join(REGISTRY_DIR, kind);
  if (!(await exists(base))) return [];
  const entries = await fs.readdir(base, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => path.join(base, e.name))
    .sort();
}

export const EMPTY_INDEX = {
  schemaVersion: 1,
  generatedAt: new Date(0).toISOString(),
  kinds: { skins: [], extensions: [] },
};

export async function readIndex() {
  if (!(await exists(INDEX_PATH))) return structuredClone(EMPTY_INDEX);
  return readJson(INDEX_PATH);
}

export function findPublished(index, kind, id) {
  return (index.kinds?.[kind] ?? []).find((e) => e.id === id) ?? null;
}

/// Semver compare, enough for the `version must increase` rule. Prerelease
/// tags order before their release (1.0.0-rc.1 < 1.0.0) and are compared
/// dot-part by dot-part, numeric parts numerically — the subset of semver
/// §11 that a store actually hits.
export function compareSemver(a, b) {
  const split = (v) => {
    const [core, pre] = v.split("-");
    return { nums: core.split(".").map(Number), pre: pre ? pre.split(".") : null };
  };
  const A = split(a);
  const B = split(b);
  for (let i = 0; i < 3; i++) {
    if (A.nums[i] !== B.nums[i]) return A.nums[i] - B.nums[i];
  }
  if (!A.pre && !B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function releaseTag(kind, id, version) {
  return `${kind}-${id}-v${version}`;
}

export function downloadUrl(kind, id, version) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/${releaseTag(kind, id, version)}/${id}-${version}.ybskin`;
}

export function rawUrl(relPath) {
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${relPath}`;
}

export function sourceUrl(kind, id) {
  return `https://github.com/${OWNER}/${REPO}/tree/main/registry/${kind}/${id}`;
}
