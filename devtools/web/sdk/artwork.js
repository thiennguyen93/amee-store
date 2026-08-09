// Cover art, drawn rather than shipped.
//
// Two reasons it isn't a set of committed PNGs. One is repo weight: this
// registry caps a published skin's own preview image at 1 MB and has no
// dependencies, and a handful of real covers is a permanent multi-megabyte
// addition to something CI clones on every pull request. The other is that
// generated pixels are *real* pixels, so getDominantColors() computes an
// answer here instead of reading a fixture — including for the deliberately
// near-monochrome cover below, where it degrades the way it degrades in the
// app.
//
// Sizes match what an OS-supplied cover looks like: 512x512, PNG, tens to a
// couple hundred KB as a data URI. That matters more than it sounds. A skin
// that reassigns `img.src` on every now-playing tick is re-decoding that much
// base64 twice a second, and at fixture sizes the cost would be invisible here
// and painful in the app.

const SIZE = 512;

/// Deterministic PRNG, so a given seed always draws the same cover. Byte-stable
/// artwork is what makes byte-stable getDominantColors() output possible, which
/// in turn is what makes a visualizer or an accent-colour effect testable at
/// all.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} spec
 * @param {number} spec.seed
 * @param {[string, string]} spec.gradient  Two CSS colours for the backdrop.
 * @param {string} spec.mark                Colour of the large geometric mark.
 * @param {"circle"|"bars"|"triangle"|"rings"} spec.shape
 * @param {number} [spec.grain]             0-1, how much noise to lay over it.
 * @returns {string} a PNG data URI
 */
export function renderCover(spec) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(spec.seed);

  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, spec.gradient[0]);
  bg.addColorStop(1, spec.gradient[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = spec.mark;
  ctx.strokeStyle = spec.mark;
  ctx.lineWidth = SIZE * 0.035;

  switch (spec.shape) {
    case "circle":
      ctx.beginPath();
      ctx.arc(SIZE * 0.5, SIZE * 0.46, SIZE * 0.24, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "bars":
      for (let i = 0; i < 7; i++) {
        const h = SIZE * (0.12 + rand() * 0.5);
        ctx.fillRect(SIZE * (0.16 + i * 0.1), SIZE * 0.78 - h, SIZE * 0.055, h);
      }
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(SIZE * 0.5, SIZE * 0.24);
      ctx.lineTo(SIZE * 0.78, SIZE * 0.72);
      ctx.lineTo(SIZE * 0.22, SIZE * 0.72);
      ctx.closePath();
      ctx.fill();
      break;
    case "rings":
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(SIZE * 0.5, SIZE * 0.5, SIZE * (0.1 + i * 0.09), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
  }

  // Grain, so the quantizer in getDominantColors has something to actually
  // quantize. A perfectly flat gradient would bucket suspiciously cleanly and
  // make the function look more decisive than it is on a real cover.
  const grain = spec.grain ?? 0.06;
  if (grain > 0) {
    const image = ctx.getImageData(0, 0, SIZE, SIZE);
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
      const n = (rand() - 0.5) * 255 * grain;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
    ctx.putImageData(image, 0, 0);
  }

  return canvas.toDataURL("image/png");
}
