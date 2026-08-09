// The Amee skin SDK — the canonical type declarations for `window.amee`.
//
// This file is a VERBATIM COPY of the type block in Amee's own source:
//
//     <amee repo>/src/sdk/ameeSdk.ts, lines 23-702
//
// The copy is manual because the app and this registry are separate
// repositories with no shared package between them. See types/README.md for
// how to re-sync it and what to check when you do.
//
// Nothing here is executable — `.d.ts` only. Amee installs the object itself
// as a page global before any skin is loaded; a skin never imports it at
// runtime, only its types at build time.

export type WindowSize = { width: number; height: number };

export type NowPlaying = {
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork_data_uri: string | null;
  playing: boolean;
  /**
   * Seconds into the current track. The OS only reports a fresh value on a
   * real change (play/pause/track/seek), not on a steady heartbeat — the SDK
   * interpolates this field locally between those events (and re-notifies
   * `onNowPlaying` listeners roughly twice a second while `playing` is true),
   * so a theme can bind this directly to a time label or seek bar without
   * running its own clock.
   */
  elapsed_seconds: number | null;
  duration_seconds: number | null;
  bundle_identifier: string | null;
  /**
   * Which source produced this. `"media_remote"` is the OS now-playing session,
   * covering every app (Spotify, Music, VLC, and browsers most of the time).
   * `"extension"` is the Amee browser extension, which is the only source that
   * can see browser media once a video is popped out into Picture-in-Picture —
   * entering PiP makes the browser drop its OS session entirely.
   *
   * Skins should capability-check off this rather than assume: the fields below
   * are only ever populated on the `"extension"` path, which requires the user
   * to have installed the extension.
   */
  source: "media_remote" | "extension";
  /** URL of the browser tab producing the audio. `null` unless `source` is
   *  `"extension"` — the OS session carries no URL at all. */
  url: string | null;
  /** Remote artwork URL, as the page declared it to `mediaSession`. Distinct from
   *  `artwork_data_uri`, which is bytes the OS session handed over. */
  artwork_url: string | null;
  /** True while the video renders in a native Picture-in-Picture window. */
  picture_in_picture: boolean;
  /** Browser tab identifier. Only meaningful to `amee.focusNowPlayingTab()`. */
  tab_id: number | null;
};

export type VolumeState = {
  volume: number;
  muted: boolean;
};

export type OutputDeviceKind = "builtin" | "usb" | "bluetooth" | "bluetoothLE" | "airplay" | "hdmi" | "other";

/** Options for `amee.openSkinWindow()` — see its doc comment below. */
export type SkinWindowOptions = {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
};

export type UpdateCheckResult = {
  /** Whether a newer release than the running build is currently published. */
  available: boolean;
  /** The running build's own version, e.g. `"0.3.10"`. */
  currentVersion: string;
  /** The newer release's version, or `null` when `available` is `false`. */
  latestVersion: string | null;
  /** That release's notes/changelog body, or `null` when unavailable. */
  notes: string | null;
};

export type OutputDevice = {
  /** Stable Core Audio device UID — pass back to `setOutputDevice`. Not a raw device index; don't assume it's numeric or stable across a full OS reinstall. */
  id: string;
  name: string;
  kind: OutputDeviceKind;
  is_default: boolean;
};

/** Which edge of the Picture-in-Picture window the mini player attaches to. */
export type PipDockEdge = "top" | "bottom" | "left" | "right" | "none";
/** Where along that edge, for the axis the edge doesn't pin. */
export type PipDockAlign = "start" | "center" | "end";

/**
 * Whether Picture-in-Picture docking is *configured* to work — independent of
 * whether a video happens to be open right now.
 *
 * Treat an unrecognised value as "not usable" rather than assuming this list
 * is closed; a future Amee may add a reason your skin has never heard of.
 */
export type PipDockAvailability =
  /** Usable. Render your dock affordance. */
  | "ok"
  /** The user switched docking off in Settings. */
  | "disabled"
  /** The user switched browser media off in Settings. */
  | "integration_off"
  /** The Amee browser extension has never been connected. */
  | "no_extension";

/** What `getPipDock()` reports and `onPipDockChange` pushes. */
export interface PipDockStatus {
  /**
   * Whether the feature can work at all here. Gate rendering on this — a
   * button that always fails is worse than no button — and use the specific
   * value to say what would fix it, since each one points somewhere different.
   */
  availability: PipDockAvailability;
  /**
   * Whether browser-sourced Picture-in-Picture information can reach Amee at
   * all — `"ok"`, `"integration_off"` or `"no_extension"`, never `"disabled"`.
   *
   * `availability` reports the user's docking switch ahead of a missing
   * prerequisite, so with docking off it only ever says `"disabled"`. Read this
   * instead when you care about the plumbing rather than about docking — for
   * telling someone *why* nothing is reaching Amee even though docking is
   * something they switched off themselves.
   */
  browser_signal: PipDockAvailability;
  /**
   * Whether a Picture-in-Picture window is open and being tracked right now.
   * Distinct from `docked`: after the user drags the pill away this stays
   * true, which is exactly when a re-attach button is worth offering.
   */
  pip_open: boolean;
  /**
   * Whether the mini player is attached to a Picture-in-Picture window right
   * now. `false` when none is open, when the user turned docking off, when
   * this skin opted out with `"none"`, or when the user dragged the pill away.
   */
  docked: boolean;
  /** The dock in force, whether or not it is currently attached. */
  edge: PipDockEdge;
  align: PipDockAlign;
  gap: number;
  /**
   * True only while the user is dragging the mini player and letting go right
   * now would leave it attached to the video.
   *
   * Render something while this is on — an outline, a glow, anything. The
   * magnet is otherwise invisible: its only feedback arrives *after* the drag,
   * so without a cue the user has to guess correctly the first time or never
   * discover it exists.
   *
   * "Dragging" means the window has actually moved, not merely that a button
   * is held down. A click on one of your own controls leaves this `false`
   * throughout — you do not need to suppress it yourself.
   */
  snapping: boolean;
}

export interface PipDock {
  edge: PipDockEdge;
  /** Defaults to whatever the manifest says, then to `"center"`. */
  align?: PipDockAlign;
  /**
   * Distance in logical pixels between the video window and this skin's
   * *visible content* — not its window bounds, which may be taller if the
   * manifest declares `content_height`. Defaults to the manifest, then to 8.
   */
  gap?: number;
}

export type AmeeSdk = {
  /** SDK contract version — bump only on a breaking change to this object's shape. */
  readonly version: string;
  /** Current now-playing state, with `elapsed_seconds` interpolated to right now (see `NowPlaying`). */
  getNowPlaying(): NowPlaying | null;
  /** Fires on real now-playing changes, plus roughly twice a second while playing so `elapsed_seconds` visibly ticks. */
  onNowPlaying(callback: (nowPlaying: NowPlaying | null) => void): () => void;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  /** Seeks to an absolute position in the current track, in seconds. */
  seek(seconds: number): Promise<void>;
  /**
   * Brings the app that's actually playing the current track to the
   * foreground — Chrome, Music, Spotify, whatever `getNowPlaying()` reports
   * via `bundle_identifier`. Launches it if it isn't running. Rejects if
   * nothing is currently playing (no bundle identifier to open).
   */
  openNowPlayingApp(): Promise<void>;
  /**
   * Like `openNowPlayingApp()`, but toggles: if the now-playing app is
   * already frontmost, jumps back to whatever app the user was in right
   * before it was opened. Otherwise remembers the current frontmost app
   * and opens the now-playing app. If the user manually switches to some
   * other app in between (instead of toggling back), the next call just
   * opens the now-playing app again — the previously remembered app is
   * forgotten. Rejects if nothing is currently playing.
   */
  toggleNowPlayingApp(): Promise<void>;
  /**
   * Raises the exact browser tab producing the audio — the tab, not just the
   * browser. `openNowPlayingApp()` can only bring the browser forward on
   * whatever tab happened to be active, because the OS session identifies an
   * app, not a document.
   *
   * Requires the Amee browser extension; rejects when it isn't the current
   * source. Gate the affordance on `isBrowserMediaAvailable()` rather than
   * showing a button that usually fails.
   */
  focusNowPlayingTab(): Promise<void>;
  /**
   * Closes the browser's Picture-in-Picture window, returning the video to its
   * tab. The PiP window's own "Back to tab" button, minus the "go to the tab"
   * half — pair it with `focusNowPlayingTab()` to reproduce that button exactly,
   * or call it alone to dismiss the window without yanking the user into the
   * browser.
   *
   * Gate it on the now-playing payload, which already carries everything the
   * answer depends on:
   *
   * ```js
   * const canClose =
   *   nowPlaying.source === "extension" && nowPlaying.picture_in_picture;
   * ```
   *
   * `source === "extension"` subsumes the prerequisites — with the extension
   * unpaired or browser media switched off, the extension is never the source.
   *
   * Do **not** gate on `PipDockStatus`: `pip_open` means Amee located and pinned
   * the window for docking, and `availability` additionally requires the docking
   * setting to be on. Closing a PiP window needs neither, so a skin that checks
   * those hides a control that would have worked.
   *
   * Only ever acts on the window showing what the mini player is showing. A
   * muted background PiP while Spotify plays is not the now-playing source, so
   * `picture_in_picture` reads `false` and this rejects — deliberately: closing
   * a window the user isn't looking at is not this method's business.
   *
   * There is no matching "open Picture-in-Picture". That asymmetry belongs to
   * the web platform, not to Amee: entering PiP requires a real user gesture
   * inside the page, which nothing outside the browser can supply.
   *
   * Added after the initial SDK release: guard with
   * `amee.exitPictureInPicture?.()`.
   */
  exitPictureInPicture(): Promise<void>;
  /**
   * Whether a browser tab is currently the now-playing source *via the
   * extension* — i.e. whether `focusNowPlayingTab()` and `NowPlaying.url` have
   * anything to offer right now. `false` whenever the extension isn't installed,
   * which is the common case.
   */
  isBrowserMediaAvailable(): Promise<boolean>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  getMuted(): Promise<boolean>;
  setMuted(muted: boolean): Promise<void>;
  onVolumeChange(callback: (state: VolumeState) => void): () => void;
  /**
   * Lists output-capable Core Audio devices — built-in speakers, USB,
   * Bluetooth, AirPlay, HDMI. AirPlay/Bluetooth speakers show up here like
   * any other device once connected (paired, or selected in System
   * Settings/Control Center) — there's no separate API for them.
   */
  getOutputDevices(): Promise<OutputDevice[]>;
  /**
   * Switches the system default output device by `id` (an `OutputDevice.id`
   * from `getOutputDevices()`). Rejects if `id` no longer refers to a
   * connected device — e.g. it was unplugged since your last list refresh.
   */
  setOutputDevice(id: string): Promise<void>;
  /**
   * Fires whenever the output device list or the current default changes —
   * plugging/unplugging a device, a Bluetooth speaker connecting or
   * disconnecting, or the user switching outputs in System Settings/Control
   * Center (not just through your own `setOutputDevice` calls).
   */
  onOutputDevicesChange(callback: (devices: OutputDevice[]) => void): () => void;
  /**
   * Makes `element`'s current on-screen rect the hit-target for the system
   * AirPlay/output route picker — the same popover every native macOS media
   * app's AirPlay icon shows, listing every currently *discoverable* AirPlay
   * receiver (unlike `getOutputDevices()`, which can only see a device Core
   * Audio has already materialized — it doesn't do that for an AirPlay
   * speaker until it's been selected as the output at least once). There's
   * no way to query or filter that discovery data yourself; this button is
   * the only entry point Apple exposes to it.
   *
   * Renders Apple's own AirPlay glyph directly on top of `element` — it
   * already reflects active-route state on its own, so there's usually
   * nothing more to draw; size/position `element` as your AirPlay button
   * (an empty `<button>` is enough) and this fills it in. If you'd rather
   * draw your own icon instead, keep `element` visually empty and reflect
   * "currently AirPlaying" yourself using `getOutputDevices()`'s
   * `kind: "airplay"` / `is_default`, or `onOutputDevicesChange`.
   *
   * Re-syncs to `element`'s rect automatically on resize. There's only one
   * native hit-target slot per mini-player window (matching there only ever
   * being one mini-player) — calling this again for a different element
   * moves the same hit-target there rather than creating a second one. Call
   * the returned cleanup function when you no longer want it clickable
   * (e.g. on skin unmount).
   */
  attachAirPlayButton(element: Element): () => void;
  /**
   * Fires whenever this window's content area changes size, in CSS px
   * (`getBoundingClientRect()` units — the same units your skin already
   * styles in, not raw OS/physical pixels). Fires once immediately,
   * synchronously, with the current size when you subscribe (so you don't
   * need a separate initial read), then again on every subsequent resize.
   *
   * For a skin whose `manifest.json` doesn't declare `resizable: true` this
   * fires once and never again — the window's size never changes. Use
   * this to scale your own layout instead of leaving the extra room as
   * dead space around a fixed-size UI (see `docs/SKINS.md` and the
   * bundled `classic` skin's marquee-recompute for a worked example).
   */
  onResize(callback: (size: WindowSize) => void): () => void;
  onSpectrum(callback: (bins: number[]) => void): () => void;
  /**
   * Starts the system-audio spectrum tap that feeds `onSpectrum` — triggers
   * a macOS system-audio-recording permission prompt the first time it's
   * called. Rejects if the permission is denied or the tap otherwise fails
   * to start; no `onSpectrum` events fire until this resolves.
   */
  startVisualizer(): Promise<void>;
  /** Stops the tap started by `startVisualizer()`. Safe to call even if it's not running. */
  stopVisualizer(): Promise<void>;
  /** Reads a theme CSS custom property's current resolved value, e.g. `getToken("--accent")` -> `"#8b7cff"`. */
  getToken(name: string): string;
  /**
   * Starts an OS-level window drag from a mousedown handler — call this from
   * `element.addEventListener("mousedown", () => amee.startWindowDrag())`
   * on whichever part of your skin's markup should double as a drag
   * handle. Amee's own window chrome doesn't impose a fixed drag region on
   * skins; you decide what's draggable.
   */
  startWindowDrag(): void;
  /**
   * Requests real OS-level focus for the mini-player window — makes it the
   * actual key window, not just the topmost one on screen. The mini-player is
   * a non-activating panel, so this deliberately stops short of what focusing
   * an ordinary window does: Amee is *not* activated (no foreground/Dock
   * switch, and the app the user is working in stays the active one). What
   * does move is key-window status, and with it keyboard input aimed at Amee.
   *
   * Weigh this before calling it from hover: Amee is meant to stay out of
   * the way as a floating widget, and this is the one SDK method that can
   * pull the user's keyboard focus away from whatever they were doing just
   * because the cursor drifted over your UI, with no click involved. Most
   * hover effects don't need it at all — `onPointerMove`/`trackHover` below
   * already solve Amee's own hover-while-unfocused problem without
   * requesting focus, purely visually. Reach for `activateWindow()` on top
   * of that when a hovered control should also be *genuinely* interactive
   * while Amee is unfocused — e.g. so a slider that just popped open drags
   * like a normal, focused control instead of a background one — and
   * you're accepting the focus-steal as a deliberate trade-off for that
   * control, the way the bundled `classic` skin's volume flyout does (see
   * `main.js`). Prefer gating it behind a real interaction (a click, a
   * drag start) instead when you don't need that.
   */
  activateWindow(): Promise<void>;
  /**
   * Fires whenever the mini-player stops (or starts) being what the user is
   * interacting with — `true` right after it gains real key/frontmost focus
   * (e.g. via `activateWindow()`), `false` the moment focus moves to any
   * other window or app.
   *
   * A `false` does *not* require a preceding `true`, and usually won't have
   * one: the mini-player is a non-activating panel that declines key status
   * for plain clicks (see `panel.rs`), so clicking your popover open doesn't
   * focus the window. Two things still report `false` regardless: any other
   * app becoming frontmost, and any mouse press landing outside the
   * mini-player's currently-interactive content — the latter covering a click
   * on another window of the app that was already frontmost, which changes no
   * frontmost app at all.
   *
   * This is the generic fix for a problem every skin with its own popover
   * (a dropdown menu, an open panel) will otherwise hit: a floating,
   * always-on-top window has no built-in way to notice "the user clicked
   * into some other app" — nothing inside your own webview lost focus, so
   * plain DOM `blur`/`focus`/outside-click handling never fires for it,
   * and your popover is left open indefinitely over whatever the user
   * switched to. Close/dismiss it yourself in response to a `false` here
   * — see the bundled `classic` skin's "…" menu (`closeMenu()` in
   * `main.js`) for a worked example — the same way a native menu bar
   * dismisses its open menu the instant you click elsewhere.
   */
  onWindowFocusChange(callback: (focused: boolean) => void): () => void;
  /**
   * Opens Amee's settings/dashboard window — the same window the tray
   * menu's "Settings…" item shows — bringing it to front and focused. It
   * keeps running hidden in the background otherwise (see
   * `tauri.conf.json`), so this is the only way for a skin to reach it.
   */
  openSettings(): Promise<void>;
  /**
   * Checks whether a newer release of Amee itself is currently published —
   * the same check Amee's own Settings/About tab runs, but reported raw
   * here rather than through Settings' UI state: unlike the Settings
   * banner, this ignores any version the user clicked "Skip this version"
   * for there, so it can still report `available: true` for a release
   * Settings itself is currently suppressing. Rejects on a genuine
   * network/signature failure (offline, malformed manifest, wrong pubkey);
   * doesn't download or install anything — pair a "new version available"
   * result with `openSettings()` so the user can update from there.
   */
  checkForUpdate(): Promise<UpdateCheckResult>;
  /**
   * Quits Amee entirely — same effect as the tray menu's "Quit Amee" item.
   * There's no confirmation prompt; the app (and its mini-player window)
   * closes immediately once this resolves.
   */
  quit(): Promise<void>;
  /**
   * Hides the mini-player window without quitting Amee — same effect as the
   * tray icon's manual hide. The window (and Amee itself) stays alive; bring
   * it back via the tray icon, or by calling `amee.activateWindow()` once
   * some other code shows it again.
   */
  hide(): Promise<void>;
  /**
   * Resolves the current held/released state of the physical Fn key. Fn has
   * no web-platform representation (WKWebView never fires `keydown`/`keyup`
   * for it, and `getModifierState("Fn")` isn't implemented), so this — and
   * `onFnKeyChange` below — are backed by a native macOS monitor instead.
   * Not available outside macOS; the promise rejects there.
   */
  isFnKeyHeld(): Promise<boolean>;
  /**
   * Registers a callback that fires every time the physical Fn key is
   * pressed or released, with the new held state. Useful for a
   * modifier-held alternate action (e.g. this skin's own overflow menu:
   * "Hide" normally, "Quit" while Fn is held). Not available outside macOS;
   * the callback simply never fires there.
   */
  onFnKeyChange(callback: (held: boolean) => void): () => void;
  /**
   * Registers a callback to run when Amee is about to quit — cleanup, a
   * fade-out animation, whatever you need. Only fires if your
   * `manifest.json` declares `"graceful_shutdown": true`; otherwise quit
   * stays instant, same as if you never called this. You get at most
   * `graceful_shutdown_timeout_ms` (or a built-in default) to finish — Amee
   * force-quits regardless once that elapses, so treat this as
   * best-effort, not a guarantee. Every registered callback runs (one that
   * throws or hangs doesn't block the others); Amee waits for all of them
   * to settle before actually exiting. See `docs/SKINS.md`'s "Graceful
   * shutdown" section.
   */
  onShutdown(callback: () => void | Promise<void>): void;
  /**
   * Registers a callback to run whenever the mini-player transitions from
   * hidden to visible again — auto-hide un-hiding it after playback
   * resumes, or the user clicking the tray icon to bring it back. Doesn't
   * fire on a redundant "show" while it's already on screen, and unlike
   * `onShutdown`, there's no manifest opt-in or timeout: nothing is waiting
   * on this to finish, so use it for a re-entrance flourish (replaying your
   * opening animation, say) rather than anything that must complete.
   */
  onShow(callback: () => void): () => void;
  /**
   * Registers a callback to run right before the mini-player is actually
   * hidden — whether from `amee.hide()` or auto-hide. The window doesn't
   * actually hide until every registered callback here has settled (plus a
   * couple of frames, to let whatever they changed actually paint) — use
   * this to prime your own UI back to a "ready to reappear" state (see
   * `onShow`'s doc above), e.g. `classic`'s `main.js` makes its content
   * invisible here so a later reveal never flashes whatever was on screen
   * at this moment (a stale render, an open menu) before `onShow`'s reset
   * catches up. Bounded to a couple hundred ms on the Rust side, so a
   * callback that hangs — or never registering one at all — still hides
   * the window rather than blocking it forever; treat this the same as
   * `onShutdown`, best-effort, not a guarantee.
   */
  onHide(callback: () => void | Promise<void>): () => void;
  /**
   * Resolves a file bundled in this skin's own package (an image,
   * font, or stylesheet next to your `main.js`) to a ready-to-use `data:`
   * URI, e.g. `img.src = await amee.getSkinAsset("cover.png")`. `path` is
   * relative to your package's root; escaping it (e.g. `"../x"`) is
   * rejected.
   */
  getSkinAsset(path: string): Promise<string>;
  /**
   * Opens a window of your own — a generic primitive, not a fixed
   * "settings" or "about" API: `entry` is the path (relative to your
   * package's root, just like `getSkinAsset`) of *any* JS file you ship
   * that exports `mount(container, amee)`, exactly the same contract as
   * your main entry. Open as many distinct entries as you want — a
   * settings form, an about panel, anything — there's no fixed set of
   * window "kinds".
   *
   * Calling this again with the same `entry` focuses the existing window
   * instead of opening a second one, so it's safe to wire directly to a
   * button's click handler without tracking whether it's already open.
   */
  openSkinWindow(entry: string, options?: SkinWindowOptions): Promise<void>;
  /**
   * Free-form per-skin storage — one JSON value per `key`, scoped to your
   * skin and shared across every window it has open (your main mount and
   * anything opened via `openSkinWindow`). The schema is entirely up to
   * you; Amee just persists whatever you hand it.
   */
  storage: {
    /** Resolves to `undefined` if `key` has never been set. */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** Persists `value` (anything JSON-serializable) under `key`. */
    set(key: string, value: unknown): Promise<void>;
    /**
     * Fires whenever `set()` is called for this skin from *any* window
     * (including this one) — payload is the `key` that changed. Use it to
     * pick up a setting changed in a settings window from your mini-player
     * mount, or vice versa.
     */
    onChange(callback: (key: string) => void): () => void;
  };
  /**
   * Temporarily grows the mini-player window by `extraLogicalPx` so your
   * skin can pop *anything* out beyond its normal bounds instead of it
   * getting clipped — a volume slider, a settings popover, an expanded
   * queue, whatever your skin needs — this isn't tied to any one control.
   * This is an undecorated, fixed-size window (see `docs/SKINS.md`),
   * so unlike a normal web page, content positioned outside the window's own
   * rect doesn't float over the desktop, it just doesn't render at all.
   *
   * Returns which side actually got the room — `"up"` or `"down"` — since
   * there may not be space on whichever side you'd prefer (e.g. near a
   * screen edge), and the `extra` that was actually applied (clamped to a
   * sane range; normally just an echo of what you asked for). Position your
   * popover using `direction`, and if you need to keep something visually
   * anchored while the window grows *upward* specifically (the window's
   * on-screen top edge moves, so your existing content needs to shift down
   * within it by the same amount to stay put), shift it by `extra` — but only
   * *after* this promise resolves, never speculatively before (see
   * `docs/SKINS.md`'s gotcha on this). If you know upfront how much
   * room you'll ever need, prefer declaring `content_height` in your
   * manifest instead (see `docs/SKINS.md`) — no window move/resize, no
   * round trip, no gotcha.
   *
   * Call `collapseWindowFlyout()` to restore the window once your popover
   * closes. Idempotent while already expanded — a second call just
   * re-reports the first call's geometry rather than compounding the resize;
   * collapse first if you need to actually change the requested size.
   */
  expandWindowFlyout(extraLogicalPx: number): Promise<{ direction: "up" | "down"; extra: number }>;
  /** Restores the geometry `expandWindowFlyout()` changed. Safe to call even if nothing is currently expanded. */
  collapseWindowFlyout(): Promise<void>;
  /**
   * If your `manifest.json` declares `content_height` (see `docs/SKINS.md`),
   * tells Amee how much of the reserved dead-space band above/below your
   * content your UI is *currently* actually occupying, in logical px (0 when
   * idle). The window still swallows every click by default outside your
   * declared `content_height` — clicks there just pass through to whatever's
   * behind the floating window instead of hitting your (invisible) reserved
   * space. Report the real extent whenever it changes (e.g. on
   * hover/focus-in and hover/focus-out) or clicks on the part of your own
   * popover that's currently sitting in that band get swallowed as
   * click-through too, even though something's visibly there. No-op for a
   * skin that doesn't declare `content_height`.
   */
  reportContentExtent(extraAbove: number, extraBelow: number): Promise<void>;
  /**
   * Overrides which edge of the browser's Picture-in-Picture window this skin
   * docks to, for as long as it stays the active skin. Pass `null` to go back
   * to whatever `manifest.json` declares.
   *
   * **Declare your resting dock in the manifest, and call this only when you
   * change modes.** The manifest is on disk before the first frame, so the
   * mini player lands in the right place with no visible jump; this call is a
   * round trip late by construction. It exists for a skin that switches
   * between, say, a compact and an expanded layout and wants to re-dock as it
   * does.
   *
   * Merges field by field over the manifest, so `{ edge: "top" }` from a skin
   * whose manifest sets `pip_dock_gap: 2` keeps that 2px gap. Not persisted,
   * and dropped when the user switches skins.
   *
   * Rejects on an unknown `edge` or `align`; `gap` is clamped to 0-200. Does
   * nothing visible while no Picture-in-Picture window is open.
   *
   * Added after the initial SDK release: guard with `amee.setPipDock?.(...)`
   * if your skin also has to run on older Amee builds.
   */
  setPipDock(dock: PipDock | null): Promise<void>;
  /**
   * Whether the mini player is currently attached to a Picture-in-Picture
   * window, and to which edge.
   *
   * Worth reading if your skin grows anything past its own content — a
   * flyout, a popover, an expanding control. Docked below a video, the space
   * *above* your content is on top of the video; docked above one, the space
   * below is. Open away from the video instead of over it.
   */
  getPipDock(): Promise<PipDockStatus>;
  /**
   * Re-attaches the mini player to the Picture-in-Picture window and snaps it
   * flush — what a "dock" button in your skin should call.
   *
   * Rejects when `availability` isn't `"ok"`, when `pip_open` is false, or when
   * your own manifest opted out with `pip_dock_edge: "none"`. Gate the button
   * on the status rather than relying on the rejection; the rejection exists
   * so a mistake is visible, not as a control flow.
   *
   * There is no matching un-dock: dragging the pill away already does that,
   * and dragging it back within ~40pt re-attaches it.
   */
  dockToPip(): Promise<void>;
  /**
   * Fires whenever `getPipDock()` would return something different — a video
   * popped out or closed, the user dragged the pill away, the dock changed.
   * Returns a function that unsubscribes.
   */
  onPipDockChange(callback: (status: PipDockStatus) => void): () => void;
  /**
   * Cursor position in this window's own DOM coordinate space — same units
   * as `MouseEvent.clientX`/`clientY` — or `null` once it's left the
   * window. Fires continuously while the cursor is over the window,
   * regardless of whether Amee is the focused app.
   *
   * Native `:hover`/`mouseenter`/`mouseleave` only track the real cursor
   * while Amee is the *focused* app — macOS doesn't run hit-testing for a
   * background window, so a floating, always-on-top mini player (the whole
   * point of Amee) stops seeing real hover input the moment the user clicks
   * into some other app. This is driven instead from the same OS-level
   * cursor tracking Amee already needs for click-through (see
   * `click_through.rs`), so it keeps working no matter which app is
   * focused. Prefer `trackHover` below for the common "toggle a class on
   * hover" case — reach for this directly only if you need the raw
   * coordinates (e.g. positioning something at the cursor).
   */
  onPointerMove(callback: (position: { x: number; y: number } | null) => void): () => void;
  /**
   * The replacement for native CSS `:hover` in this window — see
   * `onPointerMove`'s doc for why `:hover` isn't reliable here. Adds
   * `className` (default `"amee-hover"`) to `element` while the cursor is over
   * its current `getBoundingClientRect()`, removes it otherwise, and calls
   * `onEnter`/`onLeave` at those same transitions. Swap a
   * `mouseenter`/`mouseleave` pair for those callbacks. Rectangular
   * hit-testing only (no clip-path/visibility awareness) — a deliberately
   * simple polyfill, not a full `:hover` reimplementation.
   *
   * Key your CSS off `.amee-hover` **instead of** `:hover`, not alongside it.
   * A paired `.thing:hover, .thing.amee-hover` selector still carries every
   * `:hover` failure mode into the rule: besides not updating while Amee is
   * unfocused, `:hover` *freezes* rather than clearing once the cursor crosses
   * into the click-through dead-space band around the content (the window
   * stops accepting mouse events there, so WebKit never sees the
   * `mouseExited`) — and leaving the window means crossing that band. The
   * stale state then survives until the next click anywhere. `.amee-hover`
   * alone is driven by native cursor tracking and reports the leave either
   * way.
   *
   * Pass whichever element's *own* `getBoundingClientRect()` actually
   * covers the area you want tracked right now — not a static ancestor
   * that a `position: absolute` child visually grows past. Native `:hover`
   * bubbles from a hovered descendant up to every ancestor regardless of
   * the ancestor's own box, but this rectangle test doesn't: if you track
   * an ancestor whose own box stays small while an absolutely-positioned
   * child expands past it (a common shape for a hover-to-reveal flyout),
   * you'll get a spurious `onLeave` — and whatever it clears (e.g.
   * `reportContentExtent`'s click-through-safe area) will be wrong right
   * as the user reaches into the expanded part. Track the element that
   * actually grows instead.
   *
   * Returns a cleanup function; call it when `element` is removed.
   */
  trackHover(
    element: Element,
    options?: { className?: string; onEnter?: () => void; onLeave?: () => void },
  ): () => void;
  /**
   * Analyzes the current track's album artwork (`getNowPlaying().artwork_data_uri`)
   * and returns its dominant color(s) as `"#rrggbb"` hex strings, most
   * dominant first. `count` defaults to `1`. Rejects if no artwork is
   * currently available.
   */
  getDominantColors(count?: number): Promise<string[]>;
};

declare global {
  interface Window {
    amee: AmeeSdk;
  }
}

/**
 * @deprecated Spelled `AmeeSdk` in Amee's own source, and that spelling is what
 * this file tracks. `AmeeSDK` is kept because the earlier hand-maintained copy
 * bundled with `examples/react-skin` used it, so a skin templated from it keeps
 * compiling. Prefer `AmeeSdk` in new code.
 */
export type AmeeSDK = AmeeSdk;
