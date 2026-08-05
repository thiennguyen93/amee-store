#!/usr/bin/env node

// Verifies index.json against index.json.minisig the way Amee does.
//
// This is a deliberate mirror of `verify_and_parse` in Amee's
// src-tauri/src/store_index.rs. If you change one, change the other — a guard
// that is more permissive than the app passes CI and then fails in the field,
// which is the worst of the two failure directions.
//
// Two things it mirrors that a stock `minisign -V` would not:
//
//   * The app calls verify(..., allow_legacy = false), so only the prehashed
//     "ED" algorithm is accepted. minisign(1) accepts legacy "Ed" too, so using
//     it here would green-light a signature the app refuses.
//   * The app reads the *raw* 4-line .minisig. `tauri signer sign` writes
//     base64 OF that file, and mistaking one for the other is the single
//     easiest way to publish an unverifiable signature.
//
// Node stdlib only — no deps, matching tools/lib.mjs. Exit code is the API:
// 0 = this signature is current and valid, non-zero = it needs (re)signing.
//
// Usage: node tools/verify-index-sig.mjs [index] [signature] [pubkey]

import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

const [
  ,
  ,
  indexPath = "index.json",
  sigPath = "index.json.minisig",
  pubPath = "keys/store-index.pub",
] = process.argv;

// Node won't take a bare 32-byte Ed25519 key, so wrap it in the fixed SPKI
// prefix for id-Ed25519. Constant for every key of this type.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const TRUSTED_PREFIX = "trusted comment: ";

function fail(message) {
  console.error(`verify-index-sig: ${message}`);
  process.exit(1);
}

/// minisign prints key ids least-significant byte first, so reverse before
/// hexing — otherwise the id in an error message doesn't match the one in the
/// `.pub` file's own comment line, and the reader concludes it's a third key.
function keyIdHex(buf) {
  return Buffer.from(buf).reverse().toString("hex").toUpperCase();
}

/// The `.pub` file `tauri signer generate` writes is base64 of the two-line
/// minisign key file — not the key file itself. Amee's constant carries that
/// same base64, so accept either and normalise.
function readPublicKeyFile(path) {
  const text = readFileSync(path, "utf8").trim();
  if (text.startsWith("untrusted comment:")) return text;
  let decoded;
  try {
    decoded = Buffer.from(text, "base64").toString("utf8");
  } catch {
    fail(`${path}: not a minisign public key file, and not base64 of one`);
  }
  if (!decoded.startsWith("untrusted comment:")) {
    fail(`${path}: not a minisign public key file, and not base64 of one`);
  }
  return decoded;
}

function parsePublicKey(text) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) fail(`${pubPath}: expected a comment line then a key line`);
  const raw = Buffer.from(lines[1].trim(), "base64");
  // 2-byte algorithm + 8-byte key id + 32-byte Ed25519 key.
  if (raw.length !== 42) fail(`${pubPath}: key payload is ${raw.length} bytes, expected 42`);
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) };
}

function parseSignature(text) {
  const lines = text.split("\n");
  if (lines.length < 4) {
    fail(
      `${sigPath}: expected the raw 4-line minisign format, got ${lines.length} line(s). ` +
        `If this is one long base64 blob it is tauri's .sig — pipe it through ` +
        `'base64 --decode' first.`,
    );
  }
  const payload = Buffer.from(lines[1].trim(), "base64");
  // 2-byte algorithm + 8-byte key id + 64-byte signature.
  if (payload.length !== 74) {
    fail(`${sigPath}: signature payload is ${payload.length} bytes, expected 74`);
  }
  if (!lines[2].startsWith(TRUSTED_PREFIX)) {
    fail(`${sigPath}: line 3 is not a trusted comment`);
  }
  return {
    algorithm: payload.subarray(0, 2).toString("latin1"),
    keyId: payload.subarray(2, 10),
    signature: payload.subarray(10),
    trustedComment: lines[2].slice(TRUSTED_PREFIX.length),
    globalSignature: Buffer.from(lines[3].trim(), "base64"),
  };
}

const pub = parsePublicKey(readPublicKeyFile(pubPath));
const sig = parseSignature(readFileSync(sigPath, "utf8"));
const indexBytes = readFileSync(indexPath);

// Checked before the crypto so a rotated key reports as a rotated key rather
// than as a bad signature — that difference decides whether CI re-signs or
// whether someone goes looking for an attacker.
if (!sig.keyId.equals(pub.keyId)) {
  fail(
    `signed by key ${keyIdHex(sig.keyId)}, but ${pubPath} is ${keyIdHex(pub.keyId)} — ` +
      `rotated key, or the wrong signature`,
  );
}
if (sig.algorithm !== "ED") {
  fail(
    `signature algorithm is "${sig.algorithm}", not prehashed "ED". Amee verifies with ` +
      `allow_legacy = false and would refuse this. Sign with 'tauri signer sign'.`,
  );
}

const key = createPublicKey({
  key: Buffer.concat([SPKI_ED25519_PREFIX, pub.key]),
  format: "der",
  type: "spki",
});

// Prehashed minisign signs BLAKE2b-512 of the file, not the file.
if (!edVerify(null, createHash("blake2b512").update(indexBytes).digest(), key, sig.signature)) {
  fail(`signature does not match the bytes of ${indexPath}`);
}

// The trusted comment is covered by its own signature over (signature ||
// comment). Skipping this would leave it forgeable, which matters because it
// carries the timestamp CI reads back.
if (
  !edVerify(
    null,
    Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, "utf8")]),
    key,
    sig.globalSignature,
  )
) {
  fail("the trusted comment's signature does not match");
}

console.log(`verify-index-sig: ok — ${indexPath} (${sig.trustedComment})`);
