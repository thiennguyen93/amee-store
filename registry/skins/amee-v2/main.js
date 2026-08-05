// amee v2 — an example third-party skin (not one of Amee's built-ins).
// Same window.amee SDK as `classic` (see docs/SKINS.md), but shows two
// things classic doesn't need to: loading a bundled stylesheet via
// amee.getSkinAsset() instead of relying on the host app's CSS, and a
// circular playback-progress ring (SVG) instead of a bar.
//
// Layout: an artwork circle wrapped in a progress ring on the left, title +
// artist + transport/volume on the right. 320x96, set in manifest.json.

const RING_RADIUS = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Speaker glyph for the mute button — plain SVG (currentColor) instead of
// the platform's emoji font, which renders inconsistently against the rest
// of this monochrome icon set.
function speakerIcon(state) {
  const body = '<path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor"/>';
  const wave = (d) => `<path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  if (state === "muted") {
    return `<svg viewBox="0 0 24 24" width="16" height="16">${body}${wave("M16 9l6 6M22 9l-6 6")}</svg>`;
  }
  if (state === "low") {
    return `<svg viewBox="0 0 24 24" width="16" height="16">${body}${wave("M16.5 9a4.5 4.5 0 0 1 0 6")}</svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="16" height="16">${body}${wave("M15.5 8a6 6 0 0 1 0 8")}${wave("M19 5a10.5 10.5 0 0 1 0 14")}</svg>`;
}

// Shown in the artwork ring in place of a missing/not-yet-loaded cover,
// instead of leaving the circle blank.
const ARTWORK_PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

export async function mount(container, amee) {
  // Own stylesheet, kept out of the host app's CSS entirely — a `<link>`
  // to the data: URI amee.getSkinAsset() resolves works the same as a
  // normal stylesheet.
  const styleHref = await amee.getSkinAsset("style.css");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = styleHref;
  document.head.appendChild(link);

  const root = document.createElement("div");
  root.className = "amv2";
  root.style.setProperty("--accent", amee.getToken("--accent") || "#8b7cff");
  root.setAttribute("data-tauri-drag-region", "true");
  root.addEventListener("mousedown", (e) => {
    if (e.buttons === 1) amee.startWindowDrag();
  });
  container.appendChild(root);

  function stopDrag(el) {
    el.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  function iconButton(className, label, ariaLabel, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.setAttribute("aria-label", ariaLabel);
    btn.textContent = label;
    stopDrag(btn);
    btn.addEventListener("click", onClick);
    return btn;
  }

  // --- artwork + progress ring, built once and updated in place ---
  const art = document.createElement("div");
  art.className = "amv2__art";

  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("class", "amv2__ring");
  ring.setAttribute("viewBox", "0 0 64 64");
  const ringTrack = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringTrack.setAttribute("class", "amv2__ring-track");
  ringTrack.setAttribute("cx", "32");
  ringTrack.setAttribute("cy", "32");
  ringTrack.setAttribute("r", String(RING_RADIUS));
  const ringProgress = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringProgress.setAttribute("class", "amv2__ring-progress");
  ringProgress.setAttribute("cx", "32");
  ringProgress.setAttribute("cy", "32");
  ringProgress.setAttribute("r", String(RING_RADIUS));
  ringProgress.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
  ring.append(ringTrack, ringProgress);
  art.appendChild(ring);

  // Drag handle on the ring — hidden until hover/drag (see style.css), same
  // reasoning as the seek bar's knob in the `classic` skin: a bare ring is
  // too thin/ambiguous to grab reliably.
  const ringKnob = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ringKnob.setAttribute("class", "amv2__ring-knob");
  ringKnob.setAttribute("r", "4");
  ring.appendChild(ringKnob);

  const artworkImg = document.createElement("img");
  artworkImg.className = "amv2__artwork";
  artworkImg.alt = "";
  art.appendChild(artworkImg);

  // Shown instead of `artworkImg` when there's no cover to display — see
  // `renderNowPlaying`'s `amv2--no-artwork` toggle below.
  const artworkPlaceholder = document.createElement("div");
  artworkPlaceholder.className = "amv2__artwork-placeholder";
  artworkPlaceholder.innerHTML = ARTWORK_PLACEHOLDER_ICON;
  art.appendChild(artworkPlaceholder);

  // Smaller than `art` itself — this leaves the outer band (where the ring
  // is drawn) free to grab-seek instead of being swallowed by the play/pause
  // hit area (see also `stopDrag`, which is what keeps this button's own
  // clicks from reaching `art`'s seek-drag listener below).
  const playBtn = iconButton("amv2__play", "▶", "Play/Pause", () => amee.togglePlay());
  art.appendChild(playBtn);

  // --- ring seek: click-or-drag anywhere on the ring band to scrub, same
  // click-y drag/knob/document-listener pattern as classic's seek bar. ---
  let duration = 0;
  let isDraggingRing = false;

  function ringRatioFromEvent(e) {
    const rect = art.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // atan2 is 0 at 3 o'clock, increasing clockwise on screen; shift by a
    // quarter turn so ratio 0 lands at 12 o'clock, matching the ring's own
    // -90deg CSS rotation (see style.css).
    let ratio = (Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI);
    if (ratio < 0) ratio += 1;
    return ratio;
  }

  function setRingRatio(ratio) {
    ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - ratio));
    const theta = ratio * 2 * Math.PI - Math.PI / 2;
    ringKnob.setAttribute("cx", String(32 + RING_RADIUS * Math.cos(theta)));
    ringKnob.setAttribute("cy", String(32 + RING_RADIUS * Math.sin(theta)));
  }

  function seekRingTo(ratio) {
    if (!duration || duration <= 0) return;
    setRingRatio(ratio);
    amee.seek(ratio * duration);
  }

  function onRingMouseMove(e) {
    seekRingTo(ringRatioFromEvent(e));
  }
  function onRingMouseUp(e) {
    isDraggingRing = false;
    art.classList.remove("amv2__art--dragging");
    seekRingTo(ringRatioFromEvent(e));
    document.removeEventListener("mousemove", onRingMouseMove);
    document.removeEventListener("mouseup", onRingMouseUp);
  }
  art.addEventListener("mousedown", (e) => {
    // Stops this from bubbling to `root`'s mousedown (window drag) — see
    // docs/SKINS.md's note on interactive controls inside a drag
    // region. `playBtn`'s own `stopDrag` already keeps clicks on it from
    // reaching this listener at all.
    e.stopPropagation();
    if (!duration || duration <= 0) return;
    isDraggingRing = true;
    art.classList.add("amv2__art--dragging");
    seekRingTo(ringRatioFromEvent(e));
    document.addEventListener("mousemove", onRingMouseMove);
    document.addEventListener("mouseup", onRingMouseUp);
  });

  // --- title / artist / transport, rebuilt whenever now-playing changes ---
  const body = document.createElement("div");
  body.className = "amv2__body";

  const title = document.createElement("div");
  title.className = "amv2__title";
  const artist = document.createElement("div");
  artist.className = "amv2__artist";

  const row = document.createElement("div");
  row.className = "amv2__row";
  row.appendChild(iconButton("amv2__icon-btn", "⏮", "Previous", () => amee.previous()));
  const muteBtn = iconButton("amv2__icon-btn", "", "Mute", () => {
    amee.setMuted(!volumeState.muted);
  });
  muteBtn.innerHTML = speakerIcon("high");
  row.appendChild(muteBtn);
  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.step = "1";
  volumeSlider.className = "amv2__volume";
  stopDrag(volumeSlider);
  volumeSlider.addEventListener("input", () => {
    const volume = Number(volumeSlider.value) / 100;
    volumeState = { ...volumeState, volume };
    amee.setVolume(volume);
  });
  row.appendChild(volumeSlider);
  row.appendChild(iconButton("amv2__icon-btn", "⏭", "Next", () => amee.next()));

  body.append(title, artist, row);
  root.append(art, body);

  let volumeState = { volume: 0, muted: false };
  function renderVolume() {
    volumeSlider.value = String(Math.round(volumeState.volume * 100));
    volumeSlider.disabled = volumeState.muted;
    muteBtn.innerHTML = speakerIcon(volumeState.muted || volumeState.volume === 0 ? "muted" : "high");
  }

  function renderNowPlaying(nowPlaying) {
    root.classList.toggle("amv2--empty", !nowPlaying);
    if (!nowPlaying) {
      title.textContent = "Not Playing";
      artist.textContent = "";
      artworkImg.removeAttribute("src");
      art.classList.add("amv2__art--no-artwork");
      playBtn.textContent = "▶";
      duration = 0;
      if (!isDraggingRing) setRingRatio(0);
      return;
    }
    title.textContent = nowPlaying.title ?? "Unknown title";
    artist.textContent = nowPlaying.artist ?? "Unknown artist";
    if (nowPlaying.artwork_data_uri) {
      artworkImg.src = nowPlaying.artwork_data_uri;
      art.classList.remove("amv2__art--no-artwork");
    } else {
      artworkImg.removeAttribute("src");
      art.classList.add("amv2__art--no-artwork");
    }
    playBtn.textContent = nowPlaying.playing ? "⏸" : "▶";

    duration = nowPlaying.duration_seconds;
    // Don't let a periodic now-playing tick fight an in-progress drag by
    // snapping the ring back to the actual (pre-seek) position mid-gesture.
    if (!isDraggingRing) {
      const ratio = duration && duration > 0 ? Math.min(1, Math.max(0, (nowPlaying.elapsed_seconds ?? 0) / duration)) : 0;
      setRingRatio(ratio);
    }
  }

  // Opts into graceful shutdown (see manifest.json's `graceful_shutdown` +
  // `graceful_shutdown_timeout_ms`, and docs/SKINS.md) — a brief fade-out
  // instead of just vanishing when the user quits Amee. This is
  // best-effort: Amee force-quits once graceful_shutdown_timeout_ms
  // elapses regardless of whether this promise has resolved.
  amee.onShutdown(async () => {
    root.classList.add("amv2--fading-out");
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  const unsubscribers = [];

  renderNowPlaying(amee.getNowPlaying());
  unsubscribers.push(amee.onNowPlaying(renderNowPlaying));

  Promise.all([amee.getVolume(), amee.getMuted()]).then(([volume, muted]) => {
    volumeState = { volume, muted };
    renderVolume();
  });
  unsubscribers.push(
    amee.onVolumeChange((next) => {
      volumeState = next;
      renderVolume();
    }),
  );

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    // In case the skin is switched away mid-drag — otherwise only removed
    // by `onRingMouseUp`.
    document.removeEventListener("mousemove", onRingMouseMove);
    document.removeEventListener("mouseup", onRingMouseUp);
    container.innerHTML = "";
    link.remove();
  };
}
