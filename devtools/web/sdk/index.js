// createDevSdk() — the object handed to a skin as `amee`.
//
// Every member of AmeeSdk is here. Where the real implementation is Tauri-free
// (interpolation, seek holding, onResize, trackHover, dominant colours) the
// logic is ported rather than reinvented, because that logic is what skins
// actually depend on and drift in it is invisible until it ships. Where it is
// IPC, the call goes to the mock backend, through the same latency a real
// round trip has.
//
// The bar for a stand-in is not "does something plausible" but "fails and
// succeeds under the same conditions as production". So setOutputDevice
// rejects for an unknown id, openNowPlayingApp rejects when there is no bundle
// identifier, dockToPip rejects unless the dock is genuinely available, and
// reportContentExtent is a no-op for a manifest that declares no
// content_height — each because the real one does.

import { extractDominantColors } from "./colors.js";

export function createDevSdk({ backend, frameWin, manifest, pkg, host }) {
  const doc = frameWin.document;
  const { state, listeners, nowPlaying } = backend;

  /// Subscriptions the SDK opened on the skin's behalf. A well-behaved skin
  /// calls every unsubscribe it was handed, but the harness cannot depend on
  /// that — and not depending on it is how the leak report at remount knows
  /// what was left behind.
  const owned = [];
  const track = (set, cb) => {
    set.add(cb);
    const unsub = () => set.delete(cb);
    owned.push(unsub);
    return unsub;
  };

  // --- onResize -------------------------------------------------------------
  //
  // Ported from ameeSdk.ts:1012-1035. Backed by a ResizeObserver on
  // documentElement rather than an event, because `.mini-player-host {
  // display: contents }` makes the skin's own root a direct child of #root,
  // which fills the undecorated window 1:1 — so documentElement's box already
  // *is* the live content size, in the CSS px a skin styles in. Note it fires
  // once, synchronously, on subscribe.

  const resizeListeners = new Set();
  let resizeObserver = null;
  function currentWindowSize() {
    const rect = doc.documentElement.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function onResize(callback) {
    if (!resizeObserver) {
      resizeObserver = new frameWin.ResizeObserver(() => {
        const size = currentWindowSize();
        for (const cb of resizeListeners) cb(size);
      });
      resizeObserver.observe(doc.documentElement);
    }
    resizeListeners.add(callback);
    callback(currentWindowSize());
    const unsub = () => resizeListeners.delete(callback);
    owned.push(unsub);
    return unsub;
  }

  // --- pointer / hover ------------------------------------------------------

  function onPointerMove(callback) {
    return track(listeners.pointer, callback);
  }

  // Ported from ameeSdk.ts:1232-1249. A rectangular hit test against the
  // element's own box, with no ancestor bubbling and no compositing awareness:
  // an element covered by something else still "hovers". That is what the real
  // one does, and a skin that tracks a static ancestor instead of the element
  // that actually grows will misbehave here exactly as it does in the app.
  function trackHover(element, options = {}) {
    const className = options.className ?? "amee-hover";
    let hovering = false;
    return onPointerMove((position) => {
      const rect = element.getBoundingClientRect();
      const inside =
        position != null &&
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom;
      if (inside === hovering) return;
      hovering = inside;
      element.classList.toggle(className, hovering);
      if (hovering) options.onEnter?.();
      else options.onLeave?.();
    });
  }

  // --- AirPlay --------------------------------------------------------------
  //
  // The app puts a real AVRoutePickerView over the window at the element's
  // rect. There is one such slot per window, and the element a skin passes is
  // expected to be *empty* because the native view draws the glyph itself.
  // Both facts are invisible until they bite. Rendering a visible stand-in that
  // tracks the same rect, using the same sync/ResizeObserver/resize structure
  // as ameeSdk.ts:1089-1114, makes them observable: draw your own icon and you
  // see a double; call it twice and the single overlay simply moves.

  const AIRPLAY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><path d="M12 15l5 6H7l5-6z" fill="currentColor"/></svg>`;
  let airplayEl = null;

  function attachAirPlayButton(element) {
    let active = true;
    if (!airplayEl) {
      airplayEl = doc.createElement("div");
      airplayEl.className = "amee-airplay";
      airplayEl.innerHTML = AIRPLAY_SVG;
      airplayEl.addEventListener("click", () => host.openRoutePicker?.());
      doc.body.appendChild(airplayEl);
    } else {
      host.warn?.(
        "attachAirPlayButton() was called more than once. There is one native route-picker " +
          "slot per window, so the second call moves the first button rather than adding one.",
      );
    }

    const sync = () => {
      if (!active || !airplayEl) return;
      const rect = element.getBoundingClientRect();
      airplayEl.style.left = `${rect.left}px`;
      airplayEl.style.top = `${rect.top}px`;
      airplayEl.style.width = `${rect.width}px`;
      airplayEl.style.height = `${rect.height}px`;
      if (rect.width === 0 || rect.height === 0) {
        host.warn?.("attachAirPlayButton() was given an element with a zero-sized box.");
      }
    };
    sync();
    const observer = new frameWin.ResizeObserver(sync);
    observer.observe(element);
    // Catches the window itself resizing — a ResizeObserver on `element` alone
    // won't fire for a pure position shift with no size change of its own box.
    frameWin.addEventListener("resize", sync);

    const detach = () => {
      active = false;
      observer.disconnect();
      frameWin.removeEventListener("resize", sync);
      airplayEl?.remove();
      airplayEl = null;
    };
    owned.push(detach);
    return detach;
  }

  // --- flyout / content extent ---------------------------------------------

  /// window.rs's MIN_FLYOUT_EXTRA / MAX_FLYOUT_EXTRA.
  const MIN_FLYOUT_EXTRA = 16;
  const MAX_FLYOUT_EXTRA = 400;
  let flyoutState = null;

  // --- SDK ------------------------------------------------------------------

  const sdk = {
    version: "1",

    // -- now playing
    getNowPlaying: () => nowPlaying.live(),
    onNowPlaying: (callback) => {
      const unsub = nowPlaying.subscribe(callback);
      owned.push(unsub);
      callback(nowPlaying.live());
      return unsub;
    },

    // -- transport
    play: () => backend.afterLatency(() => backend.play()),
    pause: () => backend.afterLatency(() => backend.pause()),
    togglePlay: () => backend.afterLatency(() => backend.togglePlay()),
    next: () => backend.afterLatency(() => backend.next()),
    previous: () => backend.afterLatency(() => backend.previous()),

    // holdSeek() runs *before* the round trip, exactly as ameeSdk.ts does it,
    // so the displayed position moves on the frame the user released rather
    // than one round trip later. If the transport then refuses the seek (an ad,
    // a live stream), the hold expires after SEEK_HOLD_MS and the bar snaps
    // back — which is the behaviour the "refuse seeks" toggle exists to show.
    seek: (seconds) => {
      nowPlaying.holdSeek(seconds);
      return backend.afterLatency(() => backend.seek(seconds));
    },

    openNowPlayingApp: () => {
      const bundle = nowPlaying.raw?.bundle_identifier;
      if (!bundle) return Promise.reject(new Error("nothing is playing"));
      host.chip?.(`would foreground ${bundle}`);
      return Promise.resolve();
    },
    toggleNowPlayingApp: () => {
      const bundle = nowPlaying.raw?.bundle_identifier;
      if (!bundle) return Promise.reject(new Error("nothing is playing"));
      host.chip?.(`would foreground or hide ${bundle}`);
      return Promise.resolve();
    },
    focusNowPlayingTab: () => {
      // Only the browser-extension path can name a tab. A skin that gates a
      // "jump to tab" affordance on `source === "extension"` renders correctly
      // here because this genuinely rejects otherwise.
      if (nowPlaying.raw?.source !== "extension") {
        return Promise.reject(new Error("no browser tab is playing"));
      }
      host.chip?.(`would focus tab ${nowPlaying.raw.tab_id}`);
      return Promise.resolve();
    },
    exitPictureInPicture: () => {
      const np = nowPlaying.raw;
      if (np?.source !== "extension" || !np.picture_in_picture) {
        return Promise.reject(new Error("no picture-in-picture window is open"));
      }
      return backend.afterLatency(() => {
        const current = backend.currentTrack();
        if (current) current.picture_in_picture = false;
        backend.state.pip.pipOpen = false;
        backend.state.pip.docked = false;
        backend.emitPipDock();
        backend.push();
      });
    },
    isBrowserMediaAvailable: () => Promise.resolve(state.browserExtensionConnected),

    // -- volume
    getVolume: () => Promise.resolve(state.volume),
    setVolume: (volume) =>
      backend.afterLatency(() => backend.setVolume(Math.max(0, Math.min(1, volume)))),
    getMuted: () => Promise.resolve(state.muted),
    setMuted: (muted) => backend.afterLatency(() => backend.setMuted(muted)),
    onVolumeChange: (callback) => track(listeners.volume, callback),

    // -- output devices
    getOutputDevices: () => Promise.resolve(state.devices.map((d) => ({ ...d }))),
    setOutputDevice: (id) =>
      backend.afterLatency().then(() => {
        // The real command rejects for a device that has been unplugged since
        // the list was fetched. A skin that assumes success and updates its own
        // UI optimistically is wrong, and this is where it finds out.
        if (!backend.setOutputDevice(id)) {
          throw new Error(`output device '${id}' is no longer available`);
        }
      }),
    onOutputDevicesChange: (callback) => track(listeners.devices, callback),
    attachAirPlayButton,

    // -- layout
    onResize,
    getToken: (name) => {
      // Resolved against the stage document, which carries the theme's custom
      // properties — reading the harness page's root would be a different
      // document than the one the skin paints into.
      const value = frameWin
        .getComputedStyle(doc.documentElement)
        .getPropertyValue(name)
        .trim();
      if (value === "") host.tokenMiss?.(name);
      return value;
    },

    // -- spectrum
    onSpectrum: (callback) => track(listeners.spectrum, callback),
    startVisualizer: async () => {
      // Gated the way the real one is: system-audio capture needs a permission
      // the user can refuse, and nothing is emitted until it resolves. A skin
      // that subscribes to onSpectrum and never calls this draws nothing, in
      // the harness and in the app alike.
      const granted = await host.requestAudioPermission();
      if (!granted) throw new Error("system audio recording permission denied");
      state.visualizerRunning = true;
      backend.audio.spectrum.start();
    },
    stopVisualizer: () => {
      state.visualizerRunning = false;
      backend.audio.spectrum.stop();
      return Promise.resolve();
    },

    // -- window
    startWindowDrag: () => host.startWindowDrag(),
    activateWindow: () =>
      backend.afterLatency(() => {
        backend.setFocused(true);
        host.focusStage?.();
      }),
    onWindowFocusChange: (callback) => track(listeners.focus, callback),
    openSettings: () => backend.afterLatency(() => host.chip?.("would open Amee's settings")),
    checkForUpdate: () =>
      backend.afterLatency().then(() => {
        if (state.updateShouldReject) throw new Error("could not reach the update server");
        return { ...state.updateResult };
      }),
    quit: () => host.quit(),
    hide: () => host.hide(),

    isFnKeyHeld: () => Promise.resolve(state.fnHeld),
    onFnKeyChange: (callback) => track(listeners.fnKey, callback),
    // Returns void — there is no unsubscribe in the real SDK either. Registering
    // one without `graceful_shutdown: true` in the manifest is a silent no-op in
    // production; the inspector reports it rather than letting it pass.
    onShutdown: (callback) => {
      listeners.shutdown.add(callback);
      owned.push(() => listeners.shutdown.delete(callback));
      if (manifest.graceful_shutdown !== true) {
        host.warn?.(
          "onShutdown() was registered but manifest.json doesn't set `graceful_shutdown: true` " +
            "— in the real app this callback is never called.",
        );
      }
    },
    onShow: (callback) => track(listeners.show, callback),
    onHide: (callback) => track(listeners.hide, callback),

    // -- package
    getSkinAsset: async (assetPath) => {
      // Rejected locally first, in the same order as resolve_skin_path, so the
      // error a skin catches is identical whether the check happens here or on
      // the server.
      if (typeof assetPath !== "string" || assetPath === "") throw new Error("invalid path");
      const parts = assetPath.split(/[\\/]/);
      if (assetPath.startsWith("/") || parts.includes("..")) throw new Error("invalid path");

      const response = await fetch(
        `/__amee/asset?pkg=${encodeURIComponent(pkg)}&path=${encodeURIComponent(assetPath)}`,
      );
      const body = await response.json();
      if (body.error) throw new Error(body.error);
      host.assetRead?.(assetPath, body);
      return body.dataUri;
    },

    openSkinWindow: (entry, options) => host.openSkinWindow(entry, options ?? {}),

    storage: {
      get: (key) => Promise.resolve(backend.storageGet(key)),
      set: (key, value) =>
        backend.afterLatency(() => backend.storageSet(key, value)),
      onChange: (callback) => track(listeners.storage, callback),
    },

    // -- flyout geometry
    expandWindowFlyout: (extraLogicalPx) => {
      const extra = Math.max(MIN_FLYOUT_EXTRA, Math.min(MAX_FLYOUT_EXTRA, extraLogicalPx));
      // Idempotent while expanded: a second call re-reports the first geometry
      // rather than stacking, matching the real command.
      if (flyoutState) return Promise.resolve({ ...flyoutState });
      return backend.afterLatency().then(() => {
        flyoutState = host.expandFlyout(extra);
        return { ...flyoutState };
      });
    },
    collapseWindowFlyout: () =>
      backend.afterLatency(() => {
        flyoutState = null;
        host.collapseFlyout();
      }),

    reportContentExtent: (extraAbove, extraBelow) => {
      // A no-op for a manifest with no content_height, exactly as in the app:
      // there is no reserved band to reclaim, so there is nothing to report.
      if (manifest.content_height == null || manifest.content_height >= (manifest.height ?? 84)) {
        return Promise.resolve();
      }
      host.reportContentExtent(Math.max(0, extraAbove), Math.max(0, extraBelow));
      return Promise.resolve();
    },

    // -- picture in picture
    getPipDock: () => Promise.resolve(backend.pipStatus()),
    setPipDock: (dock) =>
      backend.afterLatency().then(() => {
        if (dock == null) {
          state.pip.edge = manifest.pip_dock_edge ?? "bottom";
          state.pip.align = manifest.pip_dock_align ?? "center";
          state.pip.gap = manifest.pip_dock_gap ?? 8;
          backend.emitPipDock();
          return;
        }
        const EDGES = ["top", "bottom", "left", "right", "none"];
        const ALIGNS = ["start", "center", "end"];
        if (dock.edge != null && !EDGES.includes(dock.edge)) {
          throw new Error(`invalid pip dock edge '${dock.edge}'`);
        }
        if (dock.align != null && !ALIGNS.includes(dock.align)) {
          throw new Error(`invalid pip dock align '${dock.align}'`);
        }
        if (dock.edge != null) state.pip.edge = dock.edge;
        if (dock.align != null) state.pip.align = dock.align;
        if (dock.gap != null) state.pip.gap = Math.max(0, Math.min(200, dock.gap));
        if (state.pip.edge === "none") state.pip.docked = false;
        backend.emitPipDock();
      }),
    dockToPip: () =>
      backend.afterLatency().then(() => {
        const status = backend.pipStatus();
        if (status.edge === "none") throw new Error("this skin opted out of picture-in-picture docking");
        if (status.availability !== "ok") throw new Error("picture-in-picture docking is unavailable");
        state.pip.docked = true;
        backend.emitPipDock();
        host.dockToPip?.();
      }),
    onPipDockChange: (callback) => {
      const unsub = track(listeners.pipDock, callback);
      // Fires once with the current value shortly after subscribe, matching
      // ameeSdk.ts:1214-1223. Without it a skin only learns the state at the
      // next *change*, so a remount leaves it rendering from whatever its
      // markup defaulted to. (Amee's own in-app preview gets this wrong — its
      // onPipDockChange is a bare no-op — so a skin that gates a button's
      // existence on `availability` renders wrong in the preview grid.)
      Promise.resolve().then(() => {
        if (listeners.pipDock.has(callback)) callback(backend.pipStatus());
      });
      return unsub;
    },

    // -- hover
    onPointerMove,
    trackHover,

    // -- artwork
    getDominantColors: (count = 1) => {
      const artwork = nowPlaying.raw?.artwork_data_uri;
      if (!artwork) {
        return Promise.reject(new Error("getDominantColors: no artwork is currently available"));
      }
      return extractDominantColors(artwork, Math.max(1, Math.floor(count)));
    },
  };

  /// Listener-set sizes, so the harness can snapshot before and after a skin's
  /// cleanup and name whatever was left behind.
  function listenerSnapshot() {
    return {
      onNowPlaying: nowPlaying.listenerCount,
      onVolumeChange: listeners.volume.size,
      onOutputDevicesChange: listeners.devices.size,
      onSpectrum: listeners.spectrum.size,
      onWindowFocusChange: listeners.focus.size,
      onFnKeyChange: listeners.fnKey.size,
      onPipDockChange: listeners.pipDock.size,
      onShow: listeners.show.size,
      onHide: listeners.hide.size,
      onShutdown: listeners.shutdown.size,
      onPointerMove: listeners.pointer.size,
      "storage.onChange": listeners.storage.size,
      onResize: resizeListeners.size,
    };
  }

  function dispose() {
    for (const unsub of owned.splice(0)) {
      try {
        unsub();
      } catch {
        // A detach that throws must not stop the rest from running.
      }
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    resizeListeners.clear();
    airplayEl?.remove();
    airplayEl = null;
    flyoutState = null;
  }

  return { sdk, listenerSnapshot, dispose };
}
