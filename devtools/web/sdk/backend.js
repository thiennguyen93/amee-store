// The mock backend — everything that is Rust in the real app.
//
// Split out from the SDK object deliberately, mirroring the real split. The
// inspector panels drive *this*, never the SDK, so a change made from a panel
// arrives at the skin through exactly the same path a real external change
// would: a "volume changed" event that originated in the system mixer is
// indistinguishable, to the skin, from one the panel produced. Wiring panels
// straight to the SDK object would produce a harness where a skin appeared to
// handle external state changes that it had in fact never seen.

import { createAudioEngine } from "./audio.js";
import { createNowPlayingStore } from "./nowplaying.js";
import { getPlaylist, toNowPlaying } from "./playlist.js";

/// How often the mock backend pushes a fresh now-playing snapshot, standing in
/// for the app's MediaRemote / extension stream. The SDK interpolates between
/// these, so this is about the *stream*, not about smoothness.
const BACKEND_PUSH_MS = 1000;

/// Default round-trip for a write. Every transport, volume and routing call in
/// the real app is IPC plus a system API — a skin that assumes an instant state
/// flip is broken, and a zero-latency harness would never show it.
const DEFAULT_LATENCY_MS = 120;

const DEFAULT_DEVICES = [
  { id: "builtin", name: "MacBook Pro Speakers", kind: "builtin", is_default: true },
  { id: "scarlett", name: "Scarlett 2i2 USB", kind: "usb", is_default: false },
  { id: "airpods", name: "AirPods Pro", kind: "bluetooth", is_default: false },
  { id: "ultrafine", name: "LG UltraFine Display Audio", kind: "hdmi", is_default: false },
  { id: "livingroom", name: "Living Room", kind: "airplay", is_default: false },
];

export function createBackend({ skinId, manifest }) {
  const nowPlaying = createNowPlayingStore();
  const playlist = getPlaylist();

  const listeners = {
    volume: new Set(),
    devices: new Set(),
    spectrum: new Set(),
    focus: new Set(),
    fnKey: new Set(),
    pipDock: new Set(),
    show: new Set(),
    hide: new Set(),
    shutdown: new Set(),
    pointer: new Set(),
    storage: new Set(),
  };

  const audio = createAudioEngine({
    onSpectrum: (bins) => {
      for (const cb of listeners.spectrum) cb(bins);
    },
  });

  const state = {
    trackIndex: 0,
    /// A distinct state, not a track: getNowPlaying() returns null. This is
    /// where most skins draw their least-tested UI.
    nothingPlaying: false,
    volume: 0.6,
    muted: false,
    devices: DEFAULT_DEVICES.map((d) => ({ ...d })),
    focused: true,
    fnHeld: false,
    latencyMs: DEFAULT_LATENCY_MS,
    /// Makes the transport ignore seeks, so a drag holds for SEEK_HOLD_MS and
    /// then snaps back — an ad, or a live stream with no seekable range.
    refuseSeeks: false,
    /// "ask" shows a one-time prompt, matching the real permission flow;
    /// "denied" makes startVisualizer() reject.
    audioPermission: "ask",
    visualizerRunning: false,
    browserExtensionConnected: false,
    updateResult: {
      available: false,
      currentVersion: "1.17.0",
      latestVersion: null,
      notes: null,
    },
    updateShouldReject: false,
    pip: {
      /// The user-facing docking switch. Reported ahead of any missing
      /// prerequisite, which is why browser_signal exists separately.
      enabled: true,
      pipOpen: false,
      docked: false,
      edge: manifest.pip_dock_edge ?? "bottom",
      align: manifest.pip_dock_align ?? "center",
      gap: manifest.pip_dock_gap ?? 8,
      snapping: false,
    },
  };

  // --- now playing ----------------------------------------------------------

  function currentTrack() {
    return state.nothingPlaying ? null : playlist[state.trackIndex];
  }

  /// One backend push. Shaped exactly like a `now-playing` event: the raw
  /// snapshot, with elapsed straight off the transport clock and no
  /// interpolation — that is the SDK's job.
  function push() {
    const track = currentTrack();
    if (!track) {
      nowPlaying.set(null);
      return;
    }
    nowPlaying.set(toNowPlaying(track, { elapsed: audio.position, playing: audio.playing }));
  }

  const pushTimer = setInterval(() => {
    if (audio.playing) push();
  }, BACKEND_PUSH_MS);

  function selectTrack(index) {
    state.nothingPlaying = false;
    state.trackIndex = ((index % playlist.length) + playlist.length) % playlist.length;
    audio.setTrack(playlist[state.trackIndex]);
    syncPipFromTrack();
    push();
  }

  function syncPipFromTrack() {
    const track = currentTrack();
    const open = !!track?.picture_in_picture;
    if (open === state.pip.pipOpen) return;
    state.pip.pipOpen = open;
    if (!open) {
      state.pip.docked = false;
      state.pip.snapping = false;
    }
    emitPipDock();
  }

  // --- latency --------------------------------------------------------------

  const afterLatency = (fn) =>
    new Promise((resolve) => {
      setTimeout(() => {
        fn?.();
        resolve();
      }, state.latencyMs);
    });

  // --- pip ------------------------------------------------------------------

  function pipStatus() {
    // Mirrors the real derivation: `availability` reports the user's docking
    // switch *ahead* of a missing prerequisite, so a skin can tell "you turned
    // this off" from "your browser isn't reporting one" — and browser_signal
    // is therefore never "disabled".
    const browser_signal = !state.browserExtensionConnected
      ? "no_extension"
      : state.pip.pipOpen
        ? "ok"
        : "integration_off";
    const availability = !state.pip.enabled ? "disabled" : browser_signal;
    return {
      availability,
      browser_signal,
      pip_open: state.pip.pipOpen,
      docked: state.pip.docked,
      edge: state.pip.edge,
      align: state.pip.align,
      gap: state.pip.gap,
      snapping: state.pip.snapping,
    };
  }

  function emitPipDock() {
    const status = pipStatus();
    for (const cb of listeners.pipDock) cb(status);
  }

  // --- storage --------------------------------------------------------------

  const storageKey = `amee.dev.storage.${skinId}`;
  // Real storage changes are broadcast to every window, including the one that
  // wrote — and openSkinWindow() genuinely opens another window here, so this
  // has to cross windows or the API's whole point goes untested.
  const channel =
    typeof BroadcastChannel === "function" ? new BroadcastChannel(`amee-dev-storage:${skinId}`) : null;
  if (channel) {
    channel.onmessage = (event) => {
      for (const cb of listeners.storage) cb(event.data);
    };
  }

  function readStorage() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {
      return {};
    }
  }

  function writeStorage(all) {
    localStorage.setItem(storageKey, JSON.stringify(all));
  }

  // --- api ------------------------------------------------------------------

  const backend = {
    state,
    audio,
    nowPlaying,
    playlist,
    listeners,

    currentTrack,
    push,
    pipStatus,
    emitPipDock,
    afterLatency,

    // -- transport
    play() {
      if (state.nothingPlaying) return;
      audio.play();
      push();
    },
    pause() {
      audio.pause();
      push();
    },
    togglePlay() {
      if (audio.playing) backend.pause();
      else backend.play();
    },
    next() {
      selectTrack(state.trackIndex + 1);
    },
    previous() {
      // Plain index -1, with no "restart the track if we're more than 3s in".
      // The real previous() is a raw MediaRemote command and has no such
      // behaviour; adding it here would teach an author the wrong model.
      selectTrack(state.trackIndex - 1);
    },
    selectTrack,
    setNothingPlaying(on) {
      state.nothingPlaying = !!on;
      if (on) audio.pause();
      syncPipFromTrack();
      push();
    },
    seek(seconds) {
      const track = currentTrack();
      if (!track || state.refuseSeeks || track.seekable === false) return false;
      audio.seek(seconds);
      push();
      return true;
    },

    // -- volume
    setVolume(v) {
      state.volume = Math.max(0, Math.min(1, v));
      audio.setVolume(state.volume);
      backend.emitVolume();
    },
    setMuted(muted) {
      state.muted = !!muted;
      audio.setMuted(state.muted);
      backend.emitVolume();
    },
    emitVolume() {
      const payload = { volume: state.volume, muted: state.muted };
      for (const cb of listeners.volume) cb(payload);
    },

    // -- devices
    emitDevices() {
      const payload = state.devices.map((d) => ({ ...d }));
      for (const cb of listeners.devices) cb(payload);
    },
    setOutputDevice(id) {
      const target = state.devices.find((d) => d.id === id);
      if (!target) return false;
      for (const d of state.devices) d.is_default = d === target;
      backend.emitDevices();
      return true;
    },

    // -- window
    setFocused(focused) {
      if (state.focused === focused) return;
      state.focused = focused;
      for (const cb of listeners.focus) cb(focused);
    },
    setFnHeld(held) {
      if (state.fnHeld === held) return;
      state.fnHeld = held;
      for (const cb of listeners.fnKey) cb(held);
    },
    emitPointer(position) {
      for (const cb of listeners.pointer) cb(position);
    },
    emitShow() {
      for (const cb of listeners.show) cb();
    },

    /// The real hide sequence, including the two rAFs.
    ///
    /// Wrapping each callback in `Promise.resolve().then(...)` rather than
    /// calling it straight from `.map()` matters: a callback that throws
    /// synchronously would otherwise throw out of `.map()` itself, skipping
    /// every later callback — the exact hazard the app's comment describes, and
    /// one an author should be able to hit here.
    ///
    /// Two rAFs, not zero: one guarantees "before the next paint", the second
    /// runs after it, so whatever the callbacks changed has genuinely painted
    /// before the window would actually hide.
    async runHide() {
      const settled = await Promise.allSettled(
        [...listeners.hide].map((cb) => Promise.resolve().then(() => cb())),
      );
      for (const result of settled) {
        if (result.status === "rejected") {
          console.error("amee.onHide callback failed:", result.reason);
        }
      }
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return settled;
    },

    /// The real shutdown sequence, bounded by the manifest's graceful-shutdown
    /// settings. Returns how it ended so the inspector can say whether the
    /// timeout was hit — the first time that has been observable outside an
    /// actual quit.
    async runShutdown() {
      const graceful = manifest.graceful_shutdown === true;
      const timeoutMs = graceful
        ? Math.max(100, Math.min(10000, manifest.graceful_shutdown_timeout_ms ?? 1500))
        : 0;

      const all = Promise.allSettled(
        [...listeners.shutdown].map((cb) => Promise.resolve().then(() => cb())),
      );
      if (!graceful) return { graceful, timedOut: false, listeners: listeners.shutdown.size };

      let timedOut = false;
      await Promise.race([
        all,
        new Promise((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs),
        ),
      ]);
      return { graceful, timedOut, timeoutMs, listeners: listeners.shutdown.size };
    },

    // -- storage
    storageGet(key) {
      return readStorage()[key];
    },
    storageSet(key, value) {
      const all = readStorage();
      all[key] = value;
      writeStorage(all);
      for (const cb of listeners.storage) cb(key);
      channel?.postMessage(key);
    },
    storageDelete(key) {
      const all = readStorage();
      delete all[key];
      writeStorage(all);
      for (const cb of listeners.storage) cb(key);
      channel?.postMessage(key);
    },
    storageAll: readStorage,
    storageReset() {
      localStorage.removeItem(storageKey);
      for (const cb of listeners.storage) cb("*");
      channel?.postMessage("*");
    },

    dispose() {
      clearInterval(pushTimer);
      nowPlaying.dispose();
      audio.dispose();
      channel?.close();
      for (const set of Object.values(listeners)) set.clear();
    },
  };

  audio.setTrack(playlist[0]);
  audio.setVolume(state.volume);
  push();

  return backend;
}
