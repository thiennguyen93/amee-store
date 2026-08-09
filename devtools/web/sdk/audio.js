// The audio engine: a transport clock, a procedural synthesiser, and the
// analyser tap the spectrum is computed from.
//
// Why synthesised rather than a few committed mp3s: this repository has no
// dependencies and caps a published skin's preview image at 1 MB, and a
// handful of licensable tracks is 15-30 MB checked in forever, in a repo CI
// clones on every pull request, plus a provenance claim someone has to stand
// behind. What an mp3 would actually buy is spectral *richness*, not spectral
// *reality* — the analyser sees the real output graph either way — and richness
// is recoverable by building a broadband graph instead of reaching for
// Math.sin, which is precisely where the app's own fake spectrum fails. If you
// want your own music, --audio and the drop zone take any file and route it
// through this same transport and the same analyser.
//
// The clock is authoritative and independent of the sound:
//
//     positionAt(t) = anchorPosition + (playing ? t - anchorCtxTime : 0)
//
// So elapsed_seconds stays exact even if the scheduler stutters under load, and
// a decoded user file drops into the same transport with nothing else changed.
//
// Signal chain:
//
//     voices -> trackGain -> muteGain -> volumeGain -> analyser -> outputGain -> destination
//
// The analyser sits *after* mute and volume, so muting genuinely zeroes the
// spectrum the way a system-audio tap would, and *before* outputGain, which is
// what the harness-only "silence the speakers, keep the spectrum" toggle drives
// for anyone working without headphones.

import { createSpectrumSource } from "./fft.js";

/// Standard lookahead scheduling: a timer that wakes often and schedules a
/// little way ahead, so note starts are sample-accurate rather than
/// setTimeout-accurate.
const SCHEDULE_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;

const PATCHES = {
  arcade: { bpm: 124, key: 0, voices: ["kick", "hat", "bass", "lead", "pad"] },
  nocturne: { bpm: 76, key: -3, voices: ["pad", "bass", "noise"] },
  sparse: { bpm: 92, key: 2, voices: ["hat", "bass"] },
  raga: { bpm: 64, key: -5, voices: ["pad", "noise", "lead"] },
  broadcast: { bpm: 108, key: 0, voices: ["kick", "snare", "hat", "noise", "bass"] },
  focus: { bpm: 90, key: -1, voices: ["pad", "kick", "hat", "bass"] },
};

const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic — hard to make sound wrong

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

export function createAudioEngine({ onSpectrum }) {
  const ctx = new (window.AudioContext ?? window.webkitAudioContext)();

  const trackGain = ctx.createGain();
  const muteGain = ctx.createGain();
  const volumeGain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  const outputGain = ctx.createGain();

  trackGain.gain.value = 0.5;
  muteGain.gain.value = 1;
  // Equal-power-ish: the reported volume stays linear (that is what the SDK
  // contract says), but a linear gain sounds wrong, so the curve is applied
  // here and only here.
  volumeGain.gain.value = 0.6 * 0.6;
  outputGain.gain.value = 1;

  trackGain.connect(muteGain);
  muteGain.connect(volumeGain);
  volumeGain.connect(analyser);
  analyser.connect(outputGain);
  outputGain.connect(ctx.destination);

  const spectrum = createSpectrumSource(analyser, onSpectrum);

  // One shared noise buffer for every percussive and textural voice — two
  // seconds of white noise is enough to slice from without ever repeating
  // audibly, and generating it once keeps voice creation cheap.
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const data = noiseBuffer.getChannelData(0);
    const rand = mulberry32(0xa11ce);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  }

  // --- transport ------------------------------------------------------------

  let playing = false;
  let anchorPosition = 0;
  let anchorCtxTime = ctx.currentTime;
  let duration = null;
  let patch = PATCHES.arcade;
  let rand = mulberry32(1);
  let nextNoteTime = 0;
  let step = 0;
  let scheduler = null;
  /// A decoded --audio / dropped file. When set, it replaces the synth
  /// entirely; the transport is unchanged.
  let userBuffer = null;
  let userSource = null;

  function positionAt(t) {
    const raw = anchorPosition + (playing ? t - anchorCtxTime : 0);
    if (duration != null && duration > 0) return Math.max(0, Math.min(duration, raw));
    return Math.max(0, raw);
  }

  function reanchor(position) {
    anchorPosition = position;
    anchorCtxTime = ctx.currentTime;
  }

  // --- voices ---------------------------------------------------------------

  function noise() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    return src;
  }

  function envelope(node, at, peak, attack, release) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    node.connect(g);
    g.connect(trackGain);
    return g;
  }

  const VOICES = {
    // A sine sweeping 120 -> 45 Hz. Genuine energy in the lowest bins, which
    // is where a bar-style visualizer usually puts its tallest bar.
    kick(at) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(120, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      envelope(osc, at, 0.9, 0.004, 0.24);
      osc.start(at);
      osc.stop(at + 0.3);
    },

    snare(at) {
      const src = noise();
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1800;
      band.Q.value = 0.9;
      src.connect(band);
      envelope(band, at, 0.35, 0.003, 0.14);
      src.start(at);
      src.stop(at + 0.2);
    },

    // Highpassed noise with a 40 ms decay: real high-bin content, which a pure
    // oscillator bank never produces and which is why a synthetic spectrum
    // usually looks dead above the midpoint.
    hat(at) {
      const src = noise();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7000;
      src.connect(hp);
      envelope(hp, at, 0.18, 0.002, 0.04);
      src.start(at);
      src.stop(at + 0.08);
    },

    // Sawtooth into a resonant lowpass — harmonically rich, so it lights a wide
    // span of bins rather than one.
    bass(at, note) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiToHz(note - 24);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(320, at);
      lp.frequency.exponentialRampToValueAtTime(900, at + 0.1);
      lp.Q.value = 6;
      osc.connect(lp);
      envelope(lp, at, 0.32, 0.01, 0.32);
      osc.start(at);
      osc.stop(at + 0.4);
    },

    // Three detuned saws through a lowpass whose cutoff is swept by an LFO.
    // The moving spectral centroid is what makes a visualizer look alive
    // instead of like a static equaliser curve.
    pad(at, note) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      lp.Q.value = 3;

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.18;
      lfoGain.gain.value = 600;
      lfo.connect(lfoGain);
      lfoGain.connect(lp.frequency);
      lfo.start(at);
      lfo.stop(at + 2.4);

      envelope(lp, at, 0.16, 0.5, 1.6);
      for (const detune of [-7, 0, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midiToHz(note);
        osc.detune.value = detune;
        osc.connect(lp);
        osc.start(at);
        osc.stop(at + 2.2);
      }
    },

    // A broadband floor with a sweeping bandpass, so the mid bins are never
    // completely empty between hits.
    noise(at) {
      const src = noise();
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(400, at);
      band.frequency.exponentialRampToValueAtTime(3200, at + 1.6);
      band.Q.value = 0.7;
      src.connect(band);
      envelope(band, at, 0.09, 0.4, 1.4);
      src.start(at);
      src.stop(at + 2);
    },

    lead(at, note) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = midiToHz(note + 12);
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.19;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.3;
      const g = envelope(osc, at, 0.12, 0.006, 0.2);
      g.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(trackGain);
      osc.start(at);
      osc.stop(at + 0.3);
    },
  };

  function scheduleStep(at) {
    const beat = step % 16;
    const note = 57 + patch.key + SCALE[Math.floor(rand() * SCALE.length)];

    for (const voice of patch.voices) {
      switch (voice) {
        case "kick":
          if (beat % 4 === 0) VOICES.kick(at);
          break;
        case "snare":
          if (beat % 8 === 4) VOICES.snare(at);
          break;
        case "hat":
          if (beat % 2 === 0 || rand() > 0.75) VOICES.hat(at);
          break;
        case "bass":
          if (beat % 2 === 0) VOICES.bass(at, note);
          break;
        case "pad":
          if (beat % 16 === 0) VOICES.pad(at, note);
          break;
        case "noise":
          if (beat % 16 === 8) VOICES.noise(at);
          break;
        case "lead":
          if (beat % 4 === 2 && rand() > 0.35) VOICES.lead(at, note);
          break;
      }
    }
    step++;
  }

  function tick() {
    if (!playing || userBuffer) return;
    const secondsPerStep = 60 / patch.bpm / 4;
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(Math.max(nextNoteTime, ctx.currentTime));
      nextNoteTime += secondsPerStep;
    }
  }

  function startUserSource(offset) {
    stopUserSource();
    userSource = ctx.createBufferSource();
    userSource.buffer = userBuffer;
    userSource.loop = true;
    userSource.connect(trackGain);
    userSource.start(0, offset % userBuffer.duration);
  }

  function stopUserSource() {
    if (!userSource) return;
    try {
      userSource.stop();
    } catch {
      // Already stopped — nothing to undo.
    }
    userSource.disconnect();
    userSource = null;
  }

  return {
    ctx,
    analyser,
    spectrum,

    get playing() {
      return playing;
    },
    get position() {
      return positionAt(ctx.currentTime);
    },
    get contextState() {
      return ctx.state;
    },
    get usingUserAudio() {
      return userBuffer !== null;
    },

    /// The AudioContext starts suspended under every browser's autoplay policy.
    /// The harness resumes it on the first user gesture; until then the
    /// transport still runs and the SDK still reports playing: true, because
    /// the mock player genuinely *is* playing — there is simply no signal
    /// reaching the analyser yet, and the inspector says so rather than
    /// letting a silent spectrum look like a bug in the skin.
    resume() {
      return ctx.resume();
    },

    setTrack(track) {
      patch = PATCHES[track?.patch] ?? PATCHES.arcade;
      duration = track?.duration_seconds ?? null;
      rand = mulberry32(patch.bpm * 977 + (track?.title?.length ?? 0));
      step = 0;
      reanchor(0);
      if (userBuffer && playing) startUserSource(0);
    },

    play() {
      if (playing) return;
      playing = true;
      reanchor(anchorPosition);
      nextNoteTime = ctx.currentTime;
      if (userBuffer) startUserSource(anchorPosition);
      if (!scheduler) scheduler = setInterval(tick, SCHEDULE_INTERVAL_MS);
    },

    pause() {
      if (!playing) return;
      anchorPosition = positionAt(ctx.currentTime);
      playing = false;
      stopUserSource();
      if (scheduler) {
        clearInterval(scheduler);
        scheduler = null;
      }
    },

    seek(seconds) {
      reanchor(Math.max(0, duration != null ? Math.min(duration, seconds) : seconds));
      step = 0;
      if (playing) {
        nextNoteTime = ctx.currentTime;
        if (userBuffer) startUserSource(anchorPosition);
      }
    },

    /// Linear 0-1 in, perceptual curve out. The SDK reports the linear value
    /// back, because that is what the real one reports.
    setVolume(v) {
      volumeGain.gain.setTargetAtTime(v * v, ctx.currentTime, 0.01);
    },

    /// A separate node from volume, so a mute/unmute round trip preserves the
    /// volume value exactly the way the system does.
    setMuted(muted) {
      muteGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
    },

    /// Harness-only and clearly labelled as such in the inspector: silences the
    /// speakers while leaving the analyser fed, for anyone working without
    /// headphones. Production has no equivalent — muting there really does zero
    /// the tap.
    setSpeakers(on) {
      outputGain.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.01);
    },

    async loadAudioFile(arrayBuffer) {
      userBuffer = await ctx.decodeAudioData(arrayBuffer);
      if (playing) startUserSource(positionAt(ctx.currentTime));
      return userBuffer.duration;
    },

    clearAudioFile() {
      stopUserSource();
      userBuffer = null;
    },

    dispose() {
      spectrum.stop();
      stopUserSource();
      if (scheduler) clearInterval(scheduler);
      ctx.close();
    },
  };
}
