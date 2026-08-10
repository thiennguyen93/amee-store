// Amee Nano — the mini player reduced to what is playing.
//
// Cover art on the left, title and artist stacked on the right, and nothing
// else: no panel, no transport row, no volume, no seek bar taking up a line.
// The window is fully transparent, so what sits on the desktop is the artwork
// and two lines of type and nothing around them. Everything that would
// normally be done with a background — separating the content from what's
// behind it, giving it somewhere to sit — is done with shadow instead, in
// style.css.
//
// The two controls that exist (play/pause, and playback progress) live on top
// of the artwork and only appear while the cursor is over it, so the resting
// state is exactly the three things the skin is for.

const ARTWORK_PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/></svg>',
};

// How long Amee is asked to wait for the leave animation. Must stay in step
// with the `.nano--leave` transition in style.css — a value shorter than the
// CSS duration cuts the animation off mid-flight. The enter needs no such
// constant: nothing waits on it. Out is quicker than in on purpose — a slow
// dismissal reads as lag, where a slow arrival reads as polish.
const LEAVE_MS = 190;

// Deliberately not `async`. Amee calls mount() without awaiting it and then
// checks `typeof cleanup === "function"` — an async mount returns a Promise, so
// that check fails and the cleanup at the bottom of this file never runs,
// leaking every subscription and this stylesheet on each skin switch. The
// stylesheet is therefore requested here and attached when it arrives.
export function mount(container, amee) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  amee.getSkinAsset("style.css").then((href) => {
    link.href = href;
  });
  document.head.appendChild(link);

  const root = document.createElement("div");
  // Starts in the pre-enter state so the very first paint is already the
  // beginning of the animation — appending it "visible" and animating after
  // shows one frame of the finished layout first, which reads as a flash.
  root.className = "nano nano--enter";
  // With no panel behind it this element is entirely transparent, which does
  // not stop it being the drag region — it still hit-tests.
  root.setAttribute("data-tauri-drag-region", "true");
  root.addEventListener("mousedown", (e) => {
    if (e.buttons === 1) amee.startWindowDrag();
  });
  container.appendChild(root);

  // --- artwork, with the two hidden controls stacked on top of it ---
  const art = document.createElement("div");
  art.className = "nano__art";
  // Keeps a click on the cover from also starting a window drag on `root`.
  art.addEventListener("mousedown", (e) => e.stopPropagation());

  const artworkImg = document.createElement("img");
  artworkImg.className = "nano__artwork";
  artworkImg.alt = "";

  const artworkPlaceholder = document.createElement("div");
  artworkPlaceholder.className = "nano__artwork-placeholder";
  artworkPlaceholder.innerHTML = ARTWORK_PLACEHOLDER_ICON;

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "nano__play";
  playBtn.setAttribute("aria-label", "Play");
  playBtn.innerHTML = ICONS.play;
  playBtn.addEventListener("click", () => amee.togglePlay());

  // Display only — the brief for this skin is three things on screen, and a
  // seekable bar this small is a worse target than it looks.
  const progress = document.createElement("div");
  progress.className = "nano__progress";
  const progressFill = document.createElement("div");
  progressFill.className = "nano__progress-fill";
  progress.appendChild(progressFill);

  art.append(artworkImg, artworkPlaceholder, playBtn, progress);

  // --- title / artist ---
  const body = document.createElement("div");
  body.className = "nano__body";
  const title = document.createElement("div");
  title.className = "nano__title";
  const artist = document.createElement("div");
  artist.className = "nano__artist";
  body.append(title, artist);

  root.append(art, body);

  // CSS `:hover` is unreliable in this window — it doesn't update while Amee
  // is unfocused (the normal state for a mini player) and freezes instead of
  // clearing when the cursor crosses the click-through band around the
  // content. style.css keys the reveal off `.amee-hover` alone, never `:hover`.
  const untrackHover = amee.trackHover(art);

  function renderNowPlaying(nowPlaying) {
    root.classList.toggle("nano--empty", !nowPlaying);

    if (!nowPlaying) {
      title.textContent = "Not Playing";
      artist.textContent = "";
      artworkImg.removeAttribute("src");
      art.classList.add("nano__art--no-artwork");
      playBtn.innerHTML = ICONS.play;
      playBtn.setAttribute("aria-label", "Play");
      progressFill.style.width = "0%";
      return;
    }

    title.textContent = nowPlaying.title ?? "Unknown title";
    artist.textContent = nowPlaying.artist ?? "Unknown artist";

    if (nowPlaying.artwork_data_uri) {
      // Guarded because an OS cover is a couple of hundred KB of base64 and
      // now-playing re-notifies about twice a second while playing; reassigning
      // `src` unconditionally would re-decode all of it on every tick.
      if (artworkImg.src !== nowPlaying.artwork_data_uri) {
        artworkImg.src = nowPlaying.artwork_data_uri;
      }
      art.classList.remove("nano__art--no-artwork");
    } else {
      artworkImg.removeAttribute("src");
      art.classList.add("nano__art--no-artwork");
    }

    playBtn.innerHTML = nowPlaying.playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-label", nowPlaying.playing ? "Pause" : "Play");

    // elapsed_seconds is interpolated by the SDK and re-notified about twice a
    // second while playing, so the bar can bind straight to it. A live stream
    // reports no duration at all, which has to read as 0% rather than NaN%.
    const duration = nowPlaying.duration_seconds;
    const ratio =
      duration && duration > 0
        ? Math.min(1, Math.max(0, (nowPlaying.elapsed_seconds ?? 0) / duration))
        : 0;
    progressFill.style.width = `${ratio * 100}%`;
  }

  // --- show / hide animation ---
  //
  // Amee hides and re-shows this window rather than tearing the skin down and
  // remounting it, so both directions have to be driven from these events;
  // there is no second mount() to lean on. The window itself is what actually
  // disappears, so the animation can only ever be the content moving inside
  // it — which is why the leave is a small settle-and-fade rather than
  // anything that travels.
  const timers = new Set();
  const frames = new Set();

  function sleep(ms) {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        timers.delete(id);
        resolve();
      }, ms);
      timers.add(id);
    });
  }

  function playEnter() {
    root.classList.remove("nano--leave");
    root.classList.add("nano--enter");
    // Two frames, not one: the first commits the pre-enter styles as the
    // element's actual starting point, the second starts the transition from
    // it. Removing the class inside a single rAF can be coalesced into the
    // same style recalculation, and the transition never runs at all.
    const outer = requestAnimationFrame(() => {
      frames.delete(outer);
      const inner = requestAnimationFrame(() => {
        frames.delete(inner);
        root.classList.remove("nano--enter");
      });
      frames.add(inner);
    });
    frames.add(outer);
  }

  const unsubscribers = [untrackHover];

  playEnter();
  unsubscribers.push(amee.onShow(playEnter));

  // onHide awaits whatever this returns before the window actually goes, so
  // the animation gets to finish instead of being cut off by the hide.
  unsubscribers.push(
    amee.onHide(async () => {
      root.classList.remove("nano--enter");
      root.classList.add("nano--leave");
      await sleep(LEAVE_MS);
    }),
  );

  // Opts into graceful shutdown (see manifest.json's `graceful_shutdown` +
  // `graceful_shutdown_timeout_ms`) — the same leave animation, given a little
  // longer to breathe, instead of vanishing when the user quits Amee.
  // Best-effort: Amee force-quits at 400ms regardless of this promise.
  amee.onShutdown(async () => {
    root.classList.remove("nano--enter");
    root.classList.add("nano--leave");
    await sleep(300);
  });

  renderNowPlaying(amee.getNowPlaying());
  unsubscribers.push(amee.onNowPlaying(renderNowPlaying));

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    // Otherwise a skin switch mid-animation leaves a timer and a frame
    // callback holding this closure alive to touch a detached element.
    for (const id of timers) clearTimeout(id);
    for (const id of frames) cancelAnimationFrame(id);
    timers.clear();
    frames.clear();
    container.innerHTML = "";
    link.remove();
  };
}
