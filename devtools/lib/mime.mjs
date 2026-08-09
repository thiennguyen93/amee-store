// MIME types, split into two tables that must not be confused.
//
// `guessAssetMime` is a port of `guess_mime()` in Amee's
// src-tauri/src/skin.rs. It decides the type inside the `data:` URI that
// `getSkinAsset()` resolves to, so it has to produce exactly what the real one
// produces — a skin that branches on the prefix (or feeds the URI to something
// that does) must see the same string here as after install. Keep the two in
// step, including the fallthrough to application/octet-stream, which is a
// deliberate part of the contract and not an oversight.
//
// `harnessMime` is for the harness's own static files. It exists separately
// precisely so nobody "helpfully" adds `.html` to the ported table: a skin
// package shipping an .html asset gets application/octet-stream in production,
// and the harness must not paper over that.

const ASSET_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  css: "text/css",
  json: "application/json",
  txt: "text/plain",
  js: "text/javascript",
  mjs: "text/javascript",
};

function ext(file) {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function guessAssetMime(file) {
  return ASSET_MIME[ext(file)] ?? "application/octet-stream";
}

const HARNESS_MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  // Audio, for --audio: the browser only needs enough to pick a decoder, and
  // decodeAudioData sniffs the container anyway.
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

export function harnessMime(file) {
  return HARNESS_MIME[ext(file)] ?? "application/octet-stream";
}
