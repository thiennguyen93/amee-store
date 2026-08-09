// The spectrum, shaped exactly like the one Amee emits.
//
// Ported from src-tauri/src/audio_tap.rs. What a skin receives from
// onSpectrum() in the real app is:
//
//     FFT_SIZE      = 1024      (audio_tap.rs:34)   -> 512 bins
//     magnitudes    = sqrt(re^2 + im^2)             -> raw, linear, UNBOUNDED
//     no window function                            -> rustfft is fed raw samples
//     SMOOTHING     = 0.65      (audio_tap.rs:255)  -> exponential moving average
//     EMIT_INTERVAL = 33ms      (audio_tap.rs:252)  -> ~30 fps
//
// This matters more than anything else in the harness. Amee's own in-app skin
// preview fakes 32 bins clamped to 0-1, which is wrong in both length and
// scale — a visualizer tuned against it maps 32 values across its bars and
// then receives 512, and normalises against a ceiling of 1 and then receives
// values well above it. Reproducing the real shape here is the point.
//
// Two deliberate implementation choices:
//
//   * getFloatTimeDomainData + our own FFT, NOT getFloatFrequencyData. The
//     built-in frequency data is decibels, Blackman-windowed, and separately
//     smoothed — three deviations from the Rust path at once.
//   * the output is NOT normalised. Do not "fix" this. A skin has to normalise
//     for itself, because in production nothing normalises for it.
//
// One honest divergence: getFloatTimeDomainData hands back the analyser's most
// recent 1024 samples rather than draining a ring buffer, so successive frames
// overlap slightly differently from audio_tap.rs's `drain(0..excess)`. At 30fps
// that is not observable in a visualizer, and pretending otherwise by
// hand-rolling a ScriptProcessor would cost far more than it buys.

export const FFT_SIZE = 1024;
export const BIN_COUNT = FFT_SIZE / 2;
export const SMOOTHING = 0.65;
export const EMIT_INTERVAL_MS = 33;

/// The one fudge factor in the file. The real tap reads post-mix system audio
/// at whatever level the OS is at; this reads our own graph, so absolute
/// magnitudes are ours to pick. Bin *shape* and *count* are exact; this scales
/// the whole array so the numbers land in the same order of magnitude a skin
/// sees in the app. The inspector shows a live peak readout so you can see
/// what your skin is actually being handed.
export const SPECTRUM_SCALE = 2.0;

/// Iterative in-place radix-2 Cooley-Tukey. N is fixed at FFT_SIZE and is a
/// power of two, so no padding or bit-length generality is needed.
function fftInPlace(re, im) {
  const n = re.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Drives an AnalyserNode at the real emit rate and calls `emit(bins)` with a
 * 512-element array of smoothed, unbounded magnitudes.
 *
 * @param {AnalyserNode} analyser
 * @param {(bins: number[]) => void} emit
 */
export function createSpectrumSource(analyser, emit) {
  analyser.fftSize = FFT_SIZE;
  // The analyser's own smoothing is turned off because we apply the Rust
  // side's 0.65 EMA ourselves, below. Leaving both on would smooth twice.
  analyser.smoothingTimeConstant = 0;

  const timeDomain = new Float32Array(FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const smoothed = new Float64Array(BIN_COUNT);

  let timer = null;
  let peak = 0;

  function frame() {
    analyser.getFloatTimeDomainData(timeDomain);

    // No window function, because rustfft is fed the raw ring-buffer samples.
    // Adding a Hann window here would produce cleaner-looking bins than a skin
    // will ever actually receive.
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = timeDomain[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    peak = 0;
    const bins = new Array(BIN_COUNT);
    for (let i = 0; i < BIN_COUNT; i++) {
      const magnitude = Math.hypot(re[i], im[i]) * SPECTRUM_SCALE;
      smoothed[i] = smoothed[i] * SMOOTHING + magnitude * (1 - SMOOTHING);
      bins[i] = smoothed[i];
      if (smoothed[i] > peak) peak = smoothed[i];
    }
    emit(bins);
  }

  return {
    start() {
      if (timer !== null) return;
      timer = setInterval(frame, EMIT_INTERVAL_MS);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      smoothed.fill(0);
      peak = 0;
    },
    get running() {
      return timer !== null;
    },
    /// Harness-only, for the inspector's readout: the largest bin in the last
    /// frame. Seeing this sit at 40 rather than 1 is usually the moment an
    /// author realises they have to normalise.
    get peak() {
      return peak;
    },
  };
}
