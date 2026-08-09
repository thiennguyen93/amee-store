// The harness page: toolbar, stage, inspector, and the wiring between them.
//
// ─── DO NOT DEFINE window.process HERE ────────────────────────────────────────
// A library-mode Vite build leaves `process.env.NODE_ENV` in the bundle, and a
// WKWebView has no `process`, so React throws at mount in the real app. The
// harness reproduces that only because it, too, has no `process`. Adding a
// polyfill would look like a kindness and would silently destroy the single
// most valuable check this tool performs. The same goes for import maps, and
// for anything else that would make a bare specifier resolve.
// ─────────────────────────────────────────────────────────────────────────────

import { mountSkin } from "./loader.js";
import { createBackend } from "./sdk/backend.js";
import { createDevSdk } from "./sdk/index.js";
import { createCallLog } from "./sdk/log.js";
import { createNowPlayingPanel } from "./panel/nowplaying.js";
import { createThemePanel } from "./panel/theme.js";
import { createGeometryPanel } from "./panel/geometry.js";
import { createEventsPanel } from "./panel/events.js";
import { createCallLogPanel } from "./panel/calllog.js";
import { createStoragePanel } from "./panel/storage.js";
import { createErrorsPanel } from "./panel/errors.js";

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);

/// Everything the harness owns about how the stage is presented. The skin
/// never sees any of it directly — it only sees the consequences, through
/// onResize, click-through and the geometry the SDK reports.
const view = {
  pkg: null,
  manifest: null,
  resolution: null,
  zoom: 1,
  /// Extra height granted by expandWindowFlyout(), and which way it grew.
  flyout: null,
  /// What the skin has reclaimed from the reserved band.
  extent: { above: 0, below: 0 },
  /// Forces expandWindowFlyout()'s direction, so both branches are reachable
  /// on demand rather than only when the stage happens to sit near an edge.
  flyoutDirection: "auto",
  /// Honours the manifest's resizable/min/max. Off is a real state the app
  /// never produces, and the geometry panel says so in red.
  lockToManifest: true,
  size: { width: 420, height: 84 },
  /// Kills pointer-events inside the stage while still feeding onPointerMove,
  /// reproducing what happens to native :hover when Amee isn't focused.
  simulateUnfocused: false,
  showDeadzone: true,
  drag: null,
};

let backend = null;
let sdkBundle = null;
let mounted = null;
let frameWin = null;
let log = createCallLog();
let panels = [];
let activePanel = 0;
let mountToken = 0;
const skinWindows = new Map();

// ---------------------------------------------------------------------------
// Chips and banner
// ---------------------------------------------------------------------------

function chip(text, ms = 2600) {
  const el = document.createElement("div");
  el.textContent = text;
  $("chips").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function banner(text) {
  const el = $("banner");
  el.hidden = !text;
  el.textContent = text ?? "";
}

/// An in-page stand-in for the macOS recording-permission dialog. A real modal
/// rather than `confirm()` because `confirm()` blocks the whole page — including
/// the audio graph and the skin's own timers — which is the one thing the real
/// prompt does not do.
function askPermission() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "amee-dev amee-dev__modal";
    overlay.innerHTML = `
      <div class="amee-dev__dialog">
        <strong>“Amee” would like to record this computer’s audio.</strong>
        <p>Stand-in for the macOS prompt <code>startVisualizer()</code> triggers.
        Deny it to see what your skin does when the user says no — nothing is
        emitted from <code>onSpectrum</code> in that case.</p>
        <div class="amee-dev__row">
          <button data-answer="deny">Don't Allow</button>
          <button data-answer="allow" class="amee-dev__cta">Allow</button>
        </div>
      </div>`;
    overlay.addEventListener("click", (event) => {
      const answer = event.target.closest("[data-answer]")?.dataset.answer;
      if (!answer) return;
      overlay.remove();
      resolve(answer === "allow");
    });
    document.body.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// Host — what the SDK reaches back into
// ---------------------------------------------------------------------------

const host = {
  chip,

  warn(message, detail) {
    log.warn(message, detail);
    refreshPanels();
  },

  tokenMiss(name) {
    log.warn(
      `getToken("${name}") returned an empty string — that token isn't in the active theme.`,
      "Either it's a typo, or it's a token Amee doesn't define. Always pass a fallback: " +
        `amee.getToken("${name}") || "#8b7cff".`,
    );
  },

  assetRead(path, body) {
    if (body.bytes > 1024 * 1024) {
      log.warn(
        `getSkinAsset("${path}") returned ${(body.bytes / 1024 / 1024).toFixed(1)} MB as a data: URI.`,
        "Base64 inflates by a third and the whole string is decoded on every assignment. " +
          "Consider a smaller asset, or reading it once and caching the URI.",
      );
    }
  },

  focusStage() {
    document.getElementById("frame")?.focus();
  },

  async requestAudioPermission() {
    const mode = backend.state.audioPermission;
    if (mode === "denied") return false;
    if (mode === "granted") return true;
    // startVisualizer() triggers a real macOS recording-permission prompt that
    // the user can refuse, and nothing is emitted until it resolves. Anything
    // that auto-granted would let a skin which never handles the rejection
    // path — or which draws nothing until the first bin arrives — look fine.
    const ok = await askPermission();
    backend.state.audioPermission = ok ? "granted" : "denied";
    refreshPanels();
    return ok;
  },

  startWindowDrag() {
    // The real call hands the drag to the window server. Here it drags the
    // stage inside the viewport, which answers the question an author is
    // actually asking: did I wire a drag handle, and did I forget
    // stopPropagation() on the buttons sitting on top of it?
    view.drag = { active: true };
    chip("window drag started");
  },

  expandFlyout(extra) {
    const rect = $("stage").getBoundingClientRect();
    const viewport = $("viewport").getBoundingClientRect();
    const direction =
      view.flyoutDirection !== "auto"
        ? view.flyoutDirection
        : rect.top - viewport.top > viewport.bottom - rect.bottom
          ? "up"
          : "down";
    view.flyout = { direction, extra };
    applyStageGeometry();
    return { direction, extra };
  },

  collapseFlyout() {
    view.flyout = null;
    applyStageGeometry();
  },

  reportContentExtent(above, below) {
    view.extent = { above, below };
    applyStageGeometry();
    refreshPanels();
  },

  dockToPip() {
    applyStageGeometry();
  },

  openRoutePicker() {
    chip("AirPlay route picker (native in the app)");
  },

  async openSkinWindow(entry, options) {
    // A real second window against the same backend, because that is the only
    // way storage.onChange crossing windows — the entire point of the API —
    // gets exercised at all.
    const existing = skinWindows.get(entry);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const url = `/stage.html?pkg=${encodeURIComponent(view.pkg)}&entry=${encodeURIComponent(entry)}`;
    const features = `width=${options.width ?? 420},height=${options.height ?? 320}`;
    const win = window.open(url, `amee-skin-${entry}`, features);
    if (!win) {
      throw new Error(
        `openSkinWindow("${entry}") was blocked by the browser's popup blocker. ` +
          "Allow popups for this origin to preview extra windows.",
      );
    }
    skinWindows.set(entry, win);
    win.addEventListener("load", () => {
      mountExtraWindow(win, entry).catch((err) => {
        win.document.body.textContent = `${entry}: ${err.message}`;
      });
    });
  },

  async quit() {
    const result = await backend.runShutdown();
    chip(
      result.graceful
        ? result.timedOut
          ? `graceful shutdown timed out after ${result.timeoutMs}ms`
          : `graceful shutdown: ${result.listeners} callback(s) finished`
        : "quit — manifest doesn't opt into graceful shutdown",
    );
    teardown();
    banner("Amee quit. Press Reload to relaunch the skin.");
  },

  async hide() {
    await backend.runHide();
    $("stage").style.visibility = "hidden";
    chip("hidden — the onHide sequence ran, including the two rAFs");
  },
};

// ---------------------------------------------------------------------------
// Stage geometry
// ---------------------------------------------------------------------------

function applyStageGeometry() {
  const m = view.manifest ?? {};
  const width = view.size.width;
  const baseHeight = view.size.height;
  const extra = view.flyout?.extra ?? 0;
  const height = baseHeight + extra;

  const stage = $("stage");
  const frame = $("frame");
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  $("stage-wrap").style.transform = `scale(${view.zoom})`;

  // Growing upward must move the top edge up rather than pushing the content
  // down, or the skin's own compensation for it would look unnecessary here
  // and be needed in the app.
  stage.style.marginTop = view.flyout?.direction === "up" ? `${-extra}px` : "0";

  drawGuides(width, height, m);
  applyDeadzone(m, height);
  applyPip();

  const label = [`${Math.round(width)}×${Math.round(height)}`];
  if (m.content_height != null) label.push(`content_height ${m.content_height}`);
  if (extra) label.push(`flyout ${view.flyout.direction} +${extra}`);
  if (view.zoom !== 1) label.push(`${view.zoom}×`);
  $("stage-label").textContent = label.join("  ·  ");
}

/// The reserved band a `content_height` manifest doesn't paint into, split
/// evenly above and below by the app's own `#root { justify-content: center }`.
function reservedBand(manifest, height) {
  const content = manifest.content_height;
  if (content == null || content >= height) return 0;
  return (height - content) / 2;
}

function drawGuides(width, height, manifest) {
  const guides = $("guides");
  guides.innerHTML = "";
  if (!view.showDeadzone) return;

  const reserved = reservedBand(manifest, view.size.height);
  if (reserved <= 0) return;

  const bands = [
    { top: 0, size: reserved, claimed: Math.min(reserved, view.extent.above) },
    { top: height - reserved, size: reserved, claimed: Math.min(reserved, view.extent.below) },
  ];

  for (const [i, band] of bands.entries()) {
    const dead = document.createElement("div");
    dead.className = "amee-dev__guide amee-dev__guide--dead";
    dead.style.top = `${band.top}px`;
    dead.style.height = `${band.size}px`;
    guides.appendChild(dead);

    if (band.claimed > 0) {
      const claimed = document.createElement("div");
      claimed.className = "amee-dev__guide amee-dev__guide--claimed";
      // The top band is reclaimed from its bottom edge inwards; the bottom
      // band from its top edge — the reclaimed strip always touches the
      // painted content.
      claimed.style.top = i === 0 ? `${band.top + band.size - band.claimed}px` : `${band.top}px`;
      claimed.style.height = `${band.claimed}px`;
      guides.appendChild(claimed);
    }
  }
}

/// Reproduces the click-through band inside the stage document.
function applyDeadzone(manifest, height) {
  if (!frameWin) return;
  const doc = frameWin.document;
  doc.documentElement.dataset.ameeShowDeadzone = String(view.showDeadzone);

  for (const el of doc.querySelectorAll(".amee-deadzone")) el.remove();

  const reserved = reservedBand(manifest, view.size.height);
  if (reserved <= 0) return;

  const bands = [
    { top: 0, size: Math.max(0, reserved - view.extent.above) },
    {
      top: height - reserved + Math.min(reserved, view.extent.below),
      size: Math.max(0, reserved - view.extent.below),
    },
  ];
  for (const band of bands) {
    if (band.size <= 0) continue;
    const el = doc.createElement("div");
    el.className = "amee-deadzone";
    el.style.top = `${band.top}px`;
    el.style.height = `${band.size}px`;
    doc.body.appendChild(el);
  }
}

function applyPip() {
  const rect = $("pip-rect");
  const status = backend?.pipStatus();
  if (!status?.pip_open) {
    rect.hidden = true;
    return;
  }
  rect.hidden = false;
  if (!status.docked) return;

  // The gap is measured to the *visible content*, not to the window's edge —
  // the reserved content_height band doesn't count, which is exactly the
  // subtlety a skin author has to get right when choosing a gap.
  const reserved = reservedBand(view.manifest ?? {}, view.size.height);
  const stage = $("stage");
  const pipRect = rect.getBoundingClientRect();
  const gap = status.gap;

  const offsets = {
    top: { x: 0, y: -(pipRect.height + gap) + reserved },
    bottom: { x: 0, y: pipRect.height + gap - reserved },
    left: { x: -(pipRect.width + gap), y: 0 },
    right: { x: pipRect.width + gap, y: 0 },
    none: { x: 0, y: 0 },
  };
  const offset = offsets[status.edge] ?? offsets.bottom;
  stage.style.translate = `${offset.x}px ${offset.y}px`;
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

function teardown() {
  if (mounted) {
    mounted.cleanup();
    // Whatever is still subscribed *after* the skin's own cleanup ran is
    // something it forgot to unsubscribe. In the app that keeps firing at a
    // torn-down DOM for the rest of the session.
    const after = sdkBundle?.listenerSnapshot();
    if (after) reportLeaks(after);
    mounted = null;
  }
  sdkBundle?.dispose();
  sdkBundle = null;
}

function reportLeaks(after) {
  const leaked = Object.entries(after).filter(([, n]) => n > 0);
  if (leaked.length === 0) return;
  log.warn(
    `The skin's cleanup left ${leaked.length} subscription group(s) behind: ` +
      leaked.map(([k, n]) => `${k}×${n}`).join(", "),
    "Every on*() returns an unsubscribe function. Call all of them from the function you " +
      "return out of mount(), or they keep firing at a torn-down DOM for the rest of the session.",
  );
}

async function remount(reason) {
  const token = ++mountToken;
  banner(null);
  // Reset before tearing down, not after: teardown() is what discovers a
  // leaked subscription, and clearing the log afterwards would erase the one
  // finding a reload exists to produce.
  log.reset();
  teardown();

  const frame = $("frame");
  $("stage").style.visibility = "visible";
  $("stage").style.translate = "0 0";
  view.flyout = null;
  view.extent = { above: 0, below: 0 };

  // A fresh document every time. A skin appends stylesheets to document.head,
  // mutates documentElement.style and claims generic class names; undoing that
  // by hand is guesswork, and "works on first load, broken after reload" is a
  // whole class of ambiguity a ~10ms reload removes.
  frameWin = await new Promise((resolve) => {
    frame.addEventListener(
      "load",
      () => resolve(frame.contentWindow),
      { once: true },
    );
    frame.src = `/stage.html?nonce=${Date.now()}`;
  });
  if (token !== mountToken) return;

  applyTheme(currentTheme);
  wireStagePointer();

  sdkBundle = createDevSdk({
    backend,
    frameWin,
    manifest: view.manifest,
    pkg: view.pkg,
    host,
  });

  applyStageGeometry();

  try {
    mounted = await mountSkin({
      frameWin,
      pkg: view.pkg,
      entry: view.resolution.entry,
      sdk: log.wrap(sdkBundle.sdk),
      warn: host.warn,
    });
    if (reason) chip(`reloaded (${reason})`);
    // Give the skin a moment to finish its first render before judging it.
    setTimeout(() => {
      log.lint({ listenerSnapshot: sdkBundle.listenerSnapshot });
      refreshPanels();
    }, 400);
  } catch (err) {
    // Through the same path as an error thrown inside the frame, so a failure
    // at import time gets the same decoding as one at run time. These are the
    // same three failures either way — a bare specifier, a missing `process`,
    // a missing mount() — and which side of the import they surface on is an
    // implementation detail the author shouldn't have to care about.
    pushStageError({
      kind: "mount",
      message: err.message,
      source: null,
      line: null,
      stack: err.hint ?? null,
    });
    banner(`${err.message}${err.hint ? `\n\n${err.hint}` : ""}`);
  }
  refreshPanels();
}

/// The extra windows openSkinWindow() opens. Same blob-import pipeline, same
/// backend, so storage really is shared.
async function mountExtraWindow(win, entry) {
  const response = await fetch(
    `/__amee/asset?pkg=${encodeURIComponent(view.pkg)}&path=${encodeURIComponent(entry)}`,
  );
  const body = await response.json();
  if (body.error) throw new Error(body.error);

  const source = atob(body.dataUri.split(",")[1]);
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const bundle = createDevSdk({
    backend,
    frameWin: win,
    manifest: view.manifest,
    pkg: view.pkg,
    host,
  });
  win.amee = bundle.sdk;
  const module = await win.__ameeStageImport(blobUrl);
  URL.revokeObjectURL(blobUrl);
  if (typeof module.mount !== "function") {
    throw new Error(`${entry} doesn't export a mount() function`);
  }
  module.mount(win.document.querySelector(".mini-player-host"), bundle.sdk);
}

// ---------------------------------------------------------------------------
// Pointer feed
// ---------------------------------------------------------------------------

/// onPointerMove is driven by an OS-level cursor watcher aimed at the
/// mini-player window, and reports coordinates in the window's own space
/// whether or not Amee is focused. That last part is the whole reason it
/// exists — native :hover stops updating when the app is unfocused — so the
/// feed here has to survive the stage's pointer-events being switched off.
function wireStagePointer() {
  const doc = frameWin.document;

  doc.addEventListener("pointermove", (event) => {
    backend.emitPointer({ x: event.clientX, y: event.clientY });
  });
  doc.addEventListener("pointerleave", () => backend.emitPointer(null));

  // Pressing anywhere in the harness chrome is the equivalent of clicking
  // another window: Amee emits `mini-player-press-outside` and skins use it to
  // dismiss popovers. A skin that never handles it has a popover that won't
  // close, which is only findable if the harness reproduces it.
  document.addEventListener("pointerdown", (event) => {
    if ($("stage").contains(event.target)) return;
    backend.setFocused(false);
  });

  doc.addEventListener("pointerdown", () => backend.setFocused(true));
  applyUnfocusedSimulation();
}

function applyUnfocusedSimulation() {
  if (!frameWin) return;
  const doc = frameWin.document;
  let style = doc.getElementById("amee-dev-unfocused");
  if (!style) {
    style = doc.createElement("style");
    style.id = "amee-dev-unfocused";
    doc.head.appendChild(style);
  }
  style.textContent = view.simulateUnfocused ? "#root { pointer-events: none; }" : "";
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

let currentTheme = {};

function applyTheme(tokens) {
  currentTheme = tokens;
  if (!frameWin) return;
  // Identical to the app's applyTheme(): inline custom properties on the
  // document element of the document the skin paints into.
  const root = frameWin.document.documentElement.style;
  for (const [key, value] of Object.entries(tokens)) root.setProperty(key, value);
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function buildPanels() {
  const ctx = {
    backend,
    log,
    view,
    host,
    chip,
    refresh: refreshPanels,
    remount,
    applyStageGeometry,
    applyUnfocusedSimulation,
    applyTheme,
    getTheme: () => currentTheme,
    getSdkBundle: () => sdkBundle,
  };

  panels = [
    createErrorsPanel(ctx),
    createCallLogPanel(ctx),
    createNowPlayingPanel(ctx),
    createEventsPanel(ctx),
    createGeometryPanel(ctx),
    createThemePanel(ctx),
    createStoragePanel(ctx),
  ];

  const tabs = $("tabs");
  tabs.innerHTML = "";
  panels.forEach((panel, i) => {
    const button = document.createElement("button");
    button.textContent = panel.title;
    button.addEventListener("click", () => {
      activePanel = i;
      renderPanel();
    });
    tabs.appendChild(button);
  });
  renderPanel();
}

function renderPanel() {
  const tabs = [...$("tabs").children];
  tabs.forEach((tab, i) => tab.classList.toggle("is-active", i === activePanel));
  const panel = $("panel");
  panel.innerHTML = "";
  panel.appendChild(panels[activePanel].el);
  panels[activePanel].update?.();
}

function refreshPanels() {
  const tabs = [...$("tabs").children];
  panels.forEach((panel, i) => {
    const badge = panel.badge?.();
    if (badge) tabs[i]?.setAttribute("data-badge", String(badge));
    else tabs[i]?.removeAttribute("data-badge");
  });
  panels[activePanel]?.update?.();
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function wireToolbar() {
  $("transport").addEventListener("click", (event) => {
    const action = event.target.closest("[data-transport]")?.dataset.transport;
    if (!action) return;
    if (action === "toggle") backend.togglePlay();
    if (action === "next") backend.next();
    if (action === "previous") backend.previous();
    refreshPanels();
  });

  $("mirror-seek").addEventListener("input", (event) => {
    const np = backend.nowPlaying.raw;
    if (!np?.duration_seconds) return;
    backend.seek((Number(event.target.value) / 1000) * np.duration_seconds);
  });

  $("mirror-volume").addEventListener("input", (event) => {
    backend.setVolume(Number(event.target.value) / 100);
  });

  $("enable-audio").addEventListener("click", async () => {
    await backend.audio.resume();
    updateToolbar();
  });

  $("reload").addEventListener("click", () => remount("manual"));

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (event.key === "r") remount("keyboard");
    if (event.key === " ") {
      event.preventDefault();
      backend.togglePlay();
    }
  });

  for (const button of document.querySelectorAll("[data-zoom]")) {
    button.addEventListener("click", () => {
      view.zoom = Number(button.dataset.zoom);
      for (const other of document.querySelectorAll("[data-zoom]")) {
        other.classList.toggle("is-active", other === button);
      }
      applyStageGeometry();
    });
  }

  for (const button of document.querySelectorAll("[data-backdrop]")) {
    button.addEventListener("click", () => {
      $("viewport").dataset.backdrop = button.dataset.backdrop;
      for (const other of document.querySelectorAll("[data-backdrop]")) {
        other.classList.toggle("is-active", other === button);
      }
    });
  }

  // Stage dragging, driven by the skin calling startWindowDrag().
  let dragOrigin = null;
  document.addEventListener("pointermove", (event) => {
    if (!view.drag?.active) return;
    if (!dragOrigin) {
      dragOrigin = { x: event.clientX, y: event.clientY, dx: view.dragOffsetX ?? 0 };
    }
    const wrap = $("stage-wrap");
    wrap.style.marginLeft = `${(view.dragOffsetX ?? 0) + event.clientX - dragOrigin.x}px`;
  });
  document.addEventListener("pointerup", () => {
    if (!view.drag?.active) return;
    view.dragOffsetX = parseFloat($("stage-wrap").style.marginLeft || "0");
    view.drag = null;
    dragOrigin = null;
  });

  setInterval(updateToolbar, 250);
}

function updateToolbar() {
  const np = backend.nowPlaying.live();
  const duration = np?.duration_seconds ?? null;
  const elapsed = np?.elapsed_seconds ?? 0;

  $("mirror-time").textContent = `${formatTime(elapsed)} / ${formatTime(duration)}`;
  const seek = $("mirror-seek");
  if (document.activeElement !== seek) {
    seek.value = duration ? String(Math.round((elapsed / duration) * 1000)) : "0";
  }
  const toggle = document.querySelector('[data-transport="toggle"]');
  if (toggle) toggle.textContent = backend.audio.playing ? "⏸" : "▶";

  const enable = $("enable-audio");
  enable.hidden = backend.audio.contextState === "running";
  $("mirror-volume").value = String(Math.round(backend.state.volume * 100));
}

function updateManifestChip() {
  const m = view.manifest;
  const parts = [`${m.width ?? 420}×${m.height ?? 84}`];
  if (m.content_height != null) parts.push(`content ${m.content_height}`);
  parts.push(m.resizable ? "resizable" : "fixed");
  if (m.graceful_shutdown) parts.push(`graceful ${m.graceful_shutdown_timeout_ms ?? 1500}ms`);
  if (m.pip_dock_edge) parts.push(`pip ${m.pip_dock_edge}`);
  $("manifest-chip").textContent = parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadPackage(rel) {
  // Re-point the server's watcher first. Without this, switching package in the
  // page would leave live reload watching whichever directory was named on the
  // command line — the page would show one skin and reload on edits to another.
  await fetch(`/__amee/select?pkg=${encodeURIComponent(rel)}`).catch(() => {});
  const info = await fetch(`/__amee/manifest?pkg=${encodeURIComponent(rel)}`).then((r) => r.json());
  view.pkg = rel;
  view.manifest = info.manifest;
  view.resolution = info.resolution;
  view.size = { width: info.manifest.width ?? 420, height: info.manifest.height ?? 84 };
  view.dragOffsetX = 0;

  backend?.dispose();
  backend = createBackend({ skinId: info.manifest.id ?? rel, manifest: info.manifest });

  updateManifestChip();
  buildPanels();
  await remount(null);
  if (info.resolution.hint) banner(info.resolution.hint);
}

async function boot() {
  const list = await fetch("/__amee/packages").then((r) => r.json());
  const requested = params.get("pkg") ?? list.selected;

  const select = $("package-select");
  for (const item of list.packages) {
    const option = document.createElement("option");
    option.value = item.rel;
    option.textContent = `${item.name} — ${item.rel}`;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    history.replaceState(null, "", `?pkg=${encodeURIComponent(select.value)}`);
    loadPackage(select.value).then(() => connectEvents(select.value));
  });

  if (!requested) {
    $("app").hidden = true;
    const picker = $("picker");
    picker.hidden = false;
    const ul = $("picker-list");
    for (const item of list.packages) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${item.name}</strong> <small>${item.rel} · ${item.width}×${item.height}${item.buildDeclared ? " · needs a build" : ""}</small>`;
      li.addEventListener("click", () => {
        location.search = `?pkg=${encodeURIComponent(item.rel)}`;
      });
      ul.appendChild(li);
    }
    return;
  }

  select.value = requested;
  wireToolbar();
  await loadPackage(requested);
  connectEvents(requested);

  // The stage frame reports errors here rather than into a console nobody
  // thinks to select — a blob-module failure otherwise reads as "the harness
  // is broken".
  window.__ameeStageError = pushStageError;
}

function pushStageError(payload) {
  panels.find((p) => p.pushError)?.pushError(payload);
  refreshPanels();
}

let eventSource = null;

function connectEvents(rel) {
  eventSource?.close();
  const source = new EventSource(`/__amee/events?pkg=${encodeURIComponent(rel)}`);
  eventSource = source;
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    switch (payload.type) {
      case "manifest":
        view.manifest = payload.resolution.manifest;
        view.resolution = payload.resolution;
        view.size = {
          width: view.manifest.width ?? 420,
          height: view.manifest.height ?? 84,
        };
        updateManifestChip();
        break;
      case "reload":
        remount(payload.reason);
        break;
      case "build-log":
        if (payload.level === "error") chip(`build: ${payload.line}`, 5000);
        break;
      case "error":
        banner(payload.message);
        break;
    }
  };
}

boot().catch((err) => {
  document.body.textContent = `harness failed to start: ${err.message}`;
});
