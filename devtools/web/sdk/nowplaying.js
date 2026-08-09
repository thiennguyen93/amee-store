// The now-playing store: interpolated elapsed time and the seek hold.
//
// Ported verbatim from Amee's src/sdk/ameeSdk.ts, lines 795-878 — `pendingSeek`
// / `heldPosition` / `liveNowPlaying` / `setNowPlaying` / `holdSeek` and the
// 500 ms re-notify interval below them.
//
// This is copied rather than re-derived because it is the part of the SDK a
// skin is most exposed to and least able to reason about. Two behaviours in
// particular are load-bearing:
//
//   * getNowPlaying() returns an *interpolated* elapsed_seconds, so a progress
//     bar moves smoothly between backend updates. A harness that returned the
//     raw value would make every skin look like it stutters.
//   * seek() holds the requested position until the backend agrees, so the bar
//     doesn't snap back for one frame on every drag. Reimplementing that from
//     the description would drift; drift here is invisible until a user drags.

/** How close an incoming position has to be before the seek counts as landed. */
const SEEK_SETTLED_WITHIN_SECONDS = 2;
/** Give up holding after this: the player may have refused the seek outright
 *  (an ad is playing, a live stream has no seekable range), and showing the real
 *  position again is better than holding a fiction indefinitely. */
const SEEK_HOLD_MS = 3000;

/** How often listeners are re-notified while playing, so an interpolated
 *  elapsed_seconds visibly ticks. ~2 Hz, matching the app. */
const RENOTIFY_MS = 500;

export function createNowPlayingStore() {
  let nowPlayingRaw = null;
  let nowPlayingUpdatedAtMs = Date.now();
  /** @type {{target: number, at: number} | null} */
  let pendingSeek = null;
  const listeners = new Set();

  /// Harness-only: lets the inspector show whether the 2 Hz tick is what is
  /// driving a skin's re-renders, and lets it be turned off to find out.
  let renotify = true;

  /** Where a held seek should read *now* — the target, plus however long playback
   *  has been running since, so the bar keeps ticking instead of freezing. */
  function heldPosition() {
    if (pendingSeek === null) return null;
    if (Date.now() - pendingSeek.at > SEEK_HOLD_MS) {
      pendingSeek = null;
      return null;
    }
    if (!nowPlayingRaw?.playing) return pendingSeek.target;
    return pendingSeek.target + (Date.now() - pendingSeek.at) / 1000;
  }

  function liveNowPlaying() {
    if (!nowPlayingRaw) return nowPlayingRaw;

    const held = heldPosition();
    if (!nowPlayingRaw.playing || nowPlayingRaw.elapsed_seconds == null) {
      // Still honour a held seek while paused — scrubbing a paused track is
      // exactly when the snap-back is most obvious.
      return held === null ? nowPlayingRaw : { ...nowPlayingRaw, elapsed_seconds: held };
    }

    const elapsed =
      held ?? nowPlayingRaw.elapsed_seconds + (Date.now() - nowPlayingUpdatedAtMs) / 1000;
    const duration = nowPlayingRaw.duration_seconds;
    return {
      ...nowPlayingRaw,
      elapsed_seconds:
        duration != null && duration > 0
          ? Math.min(duration, Math.max(0, elapsed))
          : Math.max(0, elapsed),
    };
  }

  function setNowPlaying(next) {
    // Retire a held seek once the backend reports a position consistent with it,
    // or when the track changed underneath it — otherwise the hold would keep
    // overriding legitimate positions for the rest of its window.
    if (pendingSeek !== null) {
      const trackChanged = next?.title !== nowPlayingRaw?.title;
      const expected = heldPosition();
      const agrees =
        next?.elapsed_seconds != null &&
        expected !== null &&
        Math.abs(next.elapsed_seconds - expected) <= SEEK_SETTLED_WITHIN_SECONDS;
      if (trackChanged || agrees) pendingSeek = null;
    }

    nowPlayingRaw = next;
    nowPlayingUpdatedAtMs = Date.now();
    for (const cb of listeners) cb(liveNowPlaying());
  }

  /** Called by `seek()` so the displayed position moves on the same frame the user
   *  released, rather than a round trip later. */
  function holdSeek(seconds) {
    pendingSeek = { target: seconds, at: Date.now() };
    for (const cb of listeners) cb(liveNowPlaying());
  }

  // Re-notifies listeners with a freshly-interpolated `elapsed_seconds`
  // while something is actually playing, so a theme's time label/seek bar
  // visibly ticks between real backend events instead of sitting frozen.
  const timer = setInterval(() => {
    if (!renotify) return;
    if (nowPlayingRaw?.playing) {
      const live = liveNowPlaying();
      for (const cb of listeners) cb(live);
    }
  }, RENOTIFY_MS);

  return {
    get raw() {
      return nowPlayingRaw;
    },
    get seekHeld() {
      return pendingSeek !== null;
    },
    get listenerCount() {
      return listeners.size;
    },
    setRenotify(on) {
      renotify = !!on;
    },
    live: liveNowPlaying,
    set: setNowPlaying,
    holdSeek,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      clearInterval(timer);
      listeners.clear();
    },
  };
}

export { SEEK_HOLD_MS, SEEK_SETTLED_WITHIN_SECONDS, RENOTIFY_MS };
