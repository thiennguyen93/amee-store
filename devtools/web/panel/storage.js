// amee.storage, inspectable.
//
// Per-skin key/value storage that survives restarts, which means a skin's
// second run is a different code path from its first — and the first is the one
// every user sees. "Reset skin" puts you back there.

export function createStoragePanel(ctx) {
  const el = document.createElement("div");
  const { backend } = ctx;

  function render() {
    const all = backend.storageAll();
    const keys = Object.keys(all).sort();

    el.innerHTML = `
      <h2>Stored values</h2>
      ${
        keys.length === 0
          ? "<p>Nothing stored. This is what a first run looks like — the state most skins are least tested in.</p>"
          : ""
      }
      <div id="rows"></div>
      <h2>Add</h2>
      <div class="amee-dev__row">
        <input type="text" id="new-key" placeholder="key" style="flex:1" />
        <input type="text" id="new-value" placeholder='JSON, e.g. true' style="flex:1" />
        <button id="add">set</button>
      </div>
      <p>Writes go through the backend, so the skin receives storage.onChange exactly as it
      would for a write from another window.</p>
      <button id="reset" style="width:100%">Reset skin (back to a first run)</button>
      <p>openSkinWindow() opens a genuine second window against this same storage, so
      onChange really does cross windows here — which is the whole point of the API and is not
      observable any other way.</p>
    `;

    const rows = el.querySelector("#rows");
    for (const key of keys) {
      const row = document.createElement("div");
      row.className = "amee-dev__row";
      row.innerHTML = `<label title="${escape(key)}">${escape(key)}</label>`;

      const input = document.createElement("input");
      input.type = "text";
      input.value = JSON.stringify(all[key]);
      input.style.flex = "1";
      input.addEventListener("change", () => {
        try {
          backend.storageSet(key, JSON.parse(input.value));
        } catch {
          // Not valid JSON — store it as the string it is, which is what a
          // skin passing a bare string would have produced anyway.
          backend.storageSet(key, input.value);
        }
        render();
      });
      row.appendChild(input);

      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        backend.storageDelete(key);
        render();
      });
      row.appendChild(remove);
      rows.appendChild(row);
    }

    el.querySelector("#add").addEventListener("click", () => {
      const key = el.querySelector("#new-key").value.trim();
      if (!key) return;
      const raw = el.querySelector("#new-value").value;
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      backend.storageSet(key, value);
      render();
    });

    el.querySelector("#reset").addEventListener("click", () => {
      backend.storageReset();
      ctx.remount("storage reset");
      render();
    });
  }

  render();

  return { title: "Storage", el, update: render };
}

function escape(text) {
  return String(text).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}
