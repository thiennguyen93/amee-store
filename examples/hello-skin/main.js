// Hello Skin — the smallest skin that still feels like a real mini player.
//
// A skin is an ES module exporting `mount(container, amee)`. Amee hands you an
// empty <div> filling the whole window and the window.amee SDK, and whatever
// you build inside it *is* the mini player. There is no framework here and no
// build step: this file is shipped verbatim.
//
// Full SDK reference: https://docs.amee.thiennguyen.dev — or docs/SKINS.md in
// the Amee repo, which is the source of truth.

const ARTWORK_PLACEHOLDER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M7 6v12h2V6zm11 0l-9 6 9 6z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M17 6v12h-2V6zM6 6l9 6-9 6z" fill="currentColor"/></svg>',
};

// Deliberately not `async`. Amee calls `mount()` without awaiting it and then
// checks `typeof cleanup === "function"` — an async mount returns a Promise, so
// that check fails and the cleanup below never runs, leaking this skin's
// listener and <link> on every skin switch. Anything that needs awaiting is
// started here and settled later, as the stylesheet is.
export function mount(container, amee) {
  // Bundled assets are read through the SDK, not a relative URL — a skin runs
  // from a blob: module, so it has no meaningful base path of its own.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  amee.getSkinAsset("style.css").then((href) => {
    link.href = href;
  });
  document.head.appendChild(link);

  container.innerHTML = `
    <div class="hello" data-tauri-drag-region>
      <div class="hello__art"><span class="hello__art-fallback">${ARTWORK_PLACEHOLDER}</span></div>
      <div class="hello__body">
        <div class="hello__title">Nothing playing</div>
        <div class="hello__artist"></div>
        <div class="hello__bar"><div class="hello__fill"></div></div>
      </div>
      <div class="hello__controls">
        <button class="hello__btn" data-action="previous" aria-label="Previous">${ICONS.prev}</button>
        <button class="hello__btn hello__btn--primary" data-action="toggle" aria-label="Play">${ICONS.play}</button>
        <button class="hello__btn" data-action="next" aria-label="Next">${ICONS.next}</button>
      </div>
    </div>
  `;

  const root = container.querySelector(".hello");
  const art = container.querySelector(".hello__art");
  const title = container.querySelector(".hello__title");
  const artist = container.querySelector(".hello__artist");
  const bar = container.querySelector(".hello__bar");
  const fill = container.querySelector(".hello__fill");
  const toggle = container.querySelector('[data-action="toggle"]');

  // The accent colour follows Amee's active colour theme, so a skin that reads
  // it recolours along with the rest of the app instead of hard-coding a hue.
  root.style.setProperty("--accent", amee.getToken("--accent") || "#8b7cff");

  let duration = 0;

  function render(np) {
    if (!np) {
      title.textContent = "Nothing playing";
      artist.textContent = "";
      fill.style.width = "0%";
      toggle.innerHTML = ICONS.play;
      toggle.setAttribute("aria-label", "Play");
      art.querySelector("img")?.remove();
      return;
    }

    title.textContent = np.title || "Unknown title";
    artist.textContent = np.artist || "";
    duration = np.duration_seconds || 0;

    const pct = duration > 0 ? Math.min(100, ((np.elapsed_seconds || 0) / duration) * 100) : 0;
    fill.style.width = `${pct}%`;

    toggle.innerHTML = np.playing ? ICONS.pause : ICONS.play;
    toggle.setAttribute("aria-label", np.playing ? "Pause" : "Play");

    let img = art.querySelector("img");
    if (np.artwork_data_uri) {
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        art.appendChild(img);
      }
      if (img.src !== np.artwork_data_uri) img.src = np.artwork_data_uri;
    } else {
      img?.remove();
    }
  }

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle") amee.togglePlay();
    else if (action === "next") amee.next();
    else if (action === "previous") amee.previous();
  });

  bar.addEventListener("click", (event) => {
    if (duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    amee.seek(ratio * duration);
  });

  // data-tauri-drag-region handles dragging by the background, but the buttons
  // and the seek bar sit on top of it and must not start a window drag.
  root.querySelectorAll(".hello__btn, .hello__bar").forEach((el) => {
    el.addEventListener("mousedown", (event) => event.stopPropagation());
  });

  render(amee.getNowPlaying());
  const unsubscribe = amee.onNowPlaying(render);

  // Returning a cleanup function is optional but good manners: Amee calls it
  // when the user switches to another skin.
  return () => {
    unsubscribe();
    link.remove();
  };
}
