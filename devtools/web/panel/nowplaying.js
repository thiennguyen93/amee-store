// The track picker and the per-field overrides.
//
// The point of the list is the `stresses` line under each track: it is a
// checklist of states a skin will meet in the wild, not a demo reel. The
// overrides underneath let you build a state the list doesn't cover — null the
// artist on a track that has one, force `source: "extension"`, and so on.

export function createNowPlayingPanel(ctx) {
  const el = document.createElement("div");

  function render() {
    const { backend } = ctx;
    const state = backend.state;

    el.innerHTML = `
      <h2>Track</h2>
      <ul class="amee-dev__list" id="tracks"></ul>
      <button id="nothing" style="width:100%">${
        state.nothingPlaying ? "← back to the playlist" : "Nothing playing (getNowPlaying() → null)"
      }</button>

      <h2>Overrides</h2>
      <div class="amee-dev__row"><label>no artist</label><input type="checkbox" id="ov-artist" /></div>
      <div class="amee-dev__row"><label>no artwork</label><input type="checkbox" id="ov-artwork" /></div>
      <div class="amee-dev__row"><label>no bundle id</label><input type="checkbox" id="ov-bundle" /></div>
      <div class="amee-dev__row"><label>browser extension connected</label><input type="checkbox" id="ov-ext" /></div>
      <div class="amee-dev__row"><label>picture-in-picture open</label><input type="checkbox" id="ov-pip" /></div>

      <h2>Behaviour</h2>
      <div class="amee-dev__row">
        <label>IPC latency</label>
        <input type="range" id="latency" min="0" max="1000" step="10" value="${state.latencyMs}" />
        <span class="amee-dev__chip">${state.latencyMs}ms</span>
      </div>
      <p>Every transport, volume and routing write in the real app is IPC plus a system API. A
      skin that flips its own UI optimistically and assumes the state follows is broken; at 0ms
      you would never see it.</p>

      <div class="amee-dev__row"><label>refuse seeks</label><input type="checkbox" id="refuse" ${state.refuseSeeks ? "checked" : ""} /></div>
      <p>What an ad or a live stream does. seek() still holds the requested position for 3s so the
      bar doesn't snap on every drag — then the hold expires and it jumps back once.</p>

      <div class="amee-dev__row"><label>2 Hz re-notify</label><input type="checkbox" id="renotify" checked /></div>
      <p>The SDK re-notifies onNowPlaying roughly twice a second while playing, purely so an
      interpolated elapsed_seconds ticks. Turn it off to see how much of your re-rendering it is
      driving — getNowPlaying() stays interpolated either way.</p>

      <h2>Spectrum</h2>
      <div class="amee-dev__row">
        <label>system audio permission</label>
        <select id="permission">
          <option value="ask">ask</option>
          <option value="granted">granted</option>
          <option value="denied">denied</option>
        </select>
      </div>
      <div class="amee-dev__row"><label>silence speakers, keep the spectrum</label><input type="checkbox" id="speakers" /></div>
      <p class="amee-dev__note">Harness-only, and not faithful: in the app, muting really does
      zero the tap. This exists for working without headphones.</p>
      <div id="peak" class="amee-dev__chip"></div>

      <h2>Your own audio</h2>
      <input type="file" id="audio-file" accept="audio/*" />
      <p>Routed through the same transport and the same analyser as the synth. Nothing is
      uploaded — the file is decoded in the page.</p>
    `;

    const list = el.querySelector("#tracks");
    backend.playlist.forEach((track, i) => {
      const li = document.createElement("li");
      li.className = !state.nothingPlaying && state.trackIndex === i ? "is-active" : "";
      li.innerHTML = `<strong>${escape(track.title)}</strong><small>${escape(track.stresses)}</small>`;
      li.addEventListener("click", () => {
        backend.selectTrack(i);
        ctx.refresh();
      });
      list.appendChild(li);
    });

    el.querySelector("#nothing").addEventListener("click", () => {
      backend.setNothingPlaying(!state.nothingPlaying);
      render();
    });

    const track = backend.currentTrack();
    bindOverride("#ov-artist", () => track && track.artist === null, (on) => {
      if (!track) return;
      track.artist = on ? null : (track.originalArtist ?? "Kite Machine");
      if (on && track.originalArtist === undefined) track.originalArtist = track.artist;
    });
    bindOverride("#ov-artwork", () => track && track.artwork === null, (on) => {
      if (!track) return;
      if (on) {
        track.savedArtwork = track.artwork;
        track.artwork = null;
      } else {
        track.artwork = track.savedArtwork ?? track.artwork;
      }
    });
    bindOverride("#ov-bundle", () => track && track.bundle_identifier === null, (on) => {
      if (!track) return;
      if (on) {
        track.savedBundle = track.bundle_identifier;
        track.bundle_identifier = null;
      } else {
        track.bundle_identifier = track.savedBundle ?? "com.apple.Music";
      }
    });

    const ext = el.querySelector("#ov-ext");
    ext.checked = state.browserExtensionConnected;
    ext.addEventListener("change", () => {
      state.browserExtensionConnected = ext.checked;
      backend.emitPipDock();
    });

    const pip = el.querySelector("#ov-pip");
    pip.checked = state.pip.pipOpen;
    pip.addEventListener("change", () => {
      state.pip.pipOpen = pip.checked;
      if (track) track.picture_in_picture = pip.checked;
      if (!pip.checked) state.pip.docked = false;
      backend.emitPipDock();
      backend.push();
      ctx.applyStageGeometry();
    });

    const latency = el.querySelector("#latency");
    latency.addEventListener("input", () => {
      state.latencyMs = Number(latency.value);
      render();
    });

    el.querySelector("#refuse").addEventListener("change", (event) => {
      state.refuseSeeks = event.target.checked;
    });

    el.querySelector("#renotify").addEventListener("change", (event) => {
      backend.nowPlaying.setRenotify(event.target.checked);
    });

    const permission = el.querySelector("#permission");
    permission.value = state.audioPermission;
    permission.addEventListener("change", () => {
      state.audioPermission = permission.value;
    });

    el.querySelector("#speakers").addEventListener("change", (event) => {
      backend.audio.setSpeakers(!event.target.checked);
    });

    el.querySelector("#audio-file").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const seconds = await backend.audio.loadAudioFile(await file.arrayBuffer());
      ctx.chip(`loaded ${file.name} (${Math.round(seconds)}s)`);
    });
  }

  function bindOverride(selector, isOn, apply) {
    const input = el.querySelector(selector);
    if (!input) return;
    input.checked = !!isOn();
    input.addEventListener("change", () => {
      apply(input.checked);
      ctx.backend.push();
    });
  }

  render();

  // The peak-bin readout is the fastest way to see that spectrum values are
  // unbounded — a skin that divides by 1 and clamps is about to look flat.
  setInterval(() => {
    const peak = ctx.backend.audio.spectrum.peak;
    const node = el.querySelector("#peak");
    if (node) {
      node.textContent = ctx.backend.audio.spectrum.running
        ? `512 bins · peak ${peak.toFixed(2)} — unbounded, normalise for yourself`
        : "visualizer not started (startVisualizer())";
    }
  }, 200);

  return { title: "Now playing", el, update: () => {} };
}

function escape(text) {
  return String(text).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}
