// The theme tokens a skin reads through getToken().
//
// Amee ships three themes and all three are dark, so a skin that hard-codes
// white text, a dark drop shadow or a translucent black surface looks correct
// against every one of them — and then a user imports a light theme and it
// becomes unreadable. The Light preset here is not a theme Amee ships; it
// exists so that failure is one click away rather than a support ticket.

const PRESETS = ["default", "ocean", "sunset", "light"];

/// The full token list from the app's theming docs. Everything a skin can read.
const TOKENS = [
  "--font",
  "--text",
  "--text-muted",
  "--accent",
  "--accent-text",
  "--danger",
  "--warning",
  "--surface",
  "--surface-hover",
  "--surface-active",
  "--border",
  "--blur",
  "--radius",
  "--radius-pill",
  "--shadow",
  "--bg",
];

const STORAGE_KEY = "amee.dev.theme";

export function createThemePanel(ctx) {
  const el = document.createElement("div");
  let tokens = {};

  async function loadPreset(id) {
    const theme = await fetch(`/web/themes/${id}.json`).then((r) => r.json());
    tokens = { ...theme.tokens };
    ctx.applyTheme(tokens);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, tokens }));
    render(theme);
  }

  function render(theme) {
    el.innerHTML = `
      <h2>Preset</h2>
      <div class="amee-dev__grid" id="presets"></div>
      ${theme?.description ? `<p>${escape(theme.description)}</p>` : ""}
      <h2>Tokens</h2>
      <div id="tokens"></div>
      <p>Written as inline custom properties on the stage document's root element — the same
      thing Amee's own applyTheme() does. Always read them with a fallback:
      <code>amee.getToken("--accent") || "#8b7cff"</code>. A theme only has to define the tokens
      it cares about, so any of these can come back empty.</p>
    `;

    const presets = el.querySelector("#presets");
    for (const id of PRESETS) {
      const button = document.createElement("button");
      button.textContent = id;
      button.addEventListener("click", () => loadPreset(id));
      presets.appendChild(button);
    }

    const list = el.querySelector("#tokens");
    for (const name of TOKENS) {
      const row = document.createElement("div");
      row.className = "amee-dev__token";
      row.innerHTML = `<span>${name}</span>`;
      const input = document.createElement("input");
      input.type = "text";
      input.value = tokens[name] ?? "";
      input.addEventListener("input", () => {
        tokens[name] = input.value;
        ctx.applyTheme(tokens);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: "custom", tokens }));
      });
      row.appendChild(input);
      list.appendChild(row);
    }
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      tokens = JSON.parse(saved).tokens ?? {};
      ctx.applyTheme(tokens);
      render();
    } catch {
      loadPreset("default");
    }
  } else {
    loadPreset("default");
  }

  return {
    title: "Theme",
    el,
    // Re-applied after every remount: the stage document is thrown away and
    // rebuilt, so the inline properties go with it.
    update: () => ctx.applyTheme(tokens),
  };
}

function escape(text) {
  return String(text).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}
