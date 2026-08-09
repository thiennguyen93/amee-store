// getDominantColors(), ported verbatim from Amee's src/sdk/ameeSdk.ts
// (`loadImage` / `rgbToHex` / `extractDominantColors`, lines 704-751).
//
// Pure canvas work with no Tauri in it, so this is a straight JS translation of
// the TypeScript — same constants, same bucketing, same rejection messages. It
// runs against whatever `artwork_data_uri` the mock backend is reporting, and
// because the harness generates real cover images pixel by pixel rather than
// serving a fixture, the colours that come back are genuinely computed.

/** @param {string} src */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("getDominantColors: failed to load artwork image"));
    img.src = src;
  });
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Downscaling first keeps the pixel scan (and thus a huge full-resolution
// cover) cheap; quantizing into 24-wide buckets merges near-identical pixels
// (JPEG noise, gradients) into the same bucket so frequency counting finds
// genuine dominant colors instead of one-off exact RGB values.
const ANALYSIS_SIZE = 64;
const QUANTIZE_STEP = 24;

/**
 * @param {string} artworkDataUri
 * @param {number} count
 * @returns {Promise<string[]>}
 */
export async function extractDominantColors(artworkDataUri, count) {
  const img = await loadImage(artworkDataUri);
  const canvas = document.createElement("canvas");
  canvas.width = ANALYSIS_SIZE;
  canvas.height = ANALYSIS_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("getDominantColors: 2d canvas context unavailable");
  ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);

  const { data } = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const quantize = (v) => Math.round(v / QUANTIZE_STEP) * QUANTIZE_STEP;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip (near-)transparent pixels
    const r = quantize(data[i]);
    const g = quantize(data[i + 1]);
    const b = quantize(data[i + 2]);
    const key = `${r},${g},${b}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.count++;
    else buckets.set(key, { count: 1, r, g, b });
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    .map((b) => rgbToHex(b.r, b.g, b.b));
}
