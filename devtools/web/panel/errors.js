// Errors thrown inside the stage, with the three classic failures decoded.
//
// Those three are the entire reason this panel exists. Each one is a bare
// runtime error in a frame nobody thinks to select, and each one currently
// first appears at install time — build, package, drag into Settings,
// activate, blank pill. Naming them here turns "it doesn't work" into a
// one-line fix.

const HINTS = [
  {
    match: /resolve module specifier|Failed to fetch dynamically imported|Importing a module script failed/i,
    title: "A bare import can't resolve from a blob: URL.",
    body:
      "Amee loads your entry file as a dynamically-constructed blob-URL ES module. A blob URL " +
      "has no import map and no base path, so `import \"react\"` (or any bare specifier, or a " +
      "relative `./util.js`) cannot resolve at runtime. Bundle everything into one " +
      "self-contained file: Vite library mode with formats: [\"es\"], " +
      "rollupOptions.output.inlineDynamicImports: true, and nothing marked external. See " +
      "examples/react-skin/vite.config.ts.",
  },
  {
    match: /Can't find variable: process|process is not defined/i,
    title: "`process` doesn't exist in a WKWebView.",
    body:
      "Library-mode builds leave `process.env.NODE_ENV` alone, assuming a downstream bundler " +
      "will replace it. There is no downstream bundler here. Add " +
      "define: { \"process.env.NODE_ENV\": JSON.stringify(\"production\") } to your Vite config.",
  },
  {
    match: /mount is not a function|doesn't export a mount/i,
    title: "The entry file exports no mount().",
    body:
      "A skin's entry must `export function mount(container, amee)` as a named export — not a " +
      "default export, and not renamed by your bundler. Check that your build emits an ES " +
      "module and that the export survives it.",
  },
  {
    match: /getDominantColors: no artwork/i,
    title: "getDominantColors() with no artwork.",
    body:
      "It rejects whenever artwork_data_uri is null, which is a normal state — try the " +
      "'Untitled' track in the Now playing tab. Guard the call or catch the rejection.",
  },
];

export function createErrorsPanel(ctx) {
  const el = document.createElement("div");
  const errors = [];

  function render() {
    el.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Stage errors";
    el.appendChild(heading);

    if (errors.length === 0) {
      const p = document.createElement("p");
      p.textContent =
        "Nothing thrown inside the skin yet. Errors from module evaluation, from mount(), " +
        "and from any listener firing later all land here.";
      el.appendChild(p);
    }

    for (const error of errors.slice().reverse()) {
      const note = document.createElement("div");
      note.className = "amee-dev__note amee-dev__note--danger";
      const hint = HINTS.find((h) => h.match.test(error.message));
      note.innerHTML = hint
        ? `<strong>${hint.title}</strong><br><code>${escape(error.message)}</code><br><br>${escape(hint.body)}`
        : `<code>${escape(error.message)}</code>${error.source ? `<br><small>${escape(error.source)}:${error.line}</small>` : ""}`;
      el.appendChild(note);
    }

    const warnHeading = document.createElement("h2");
    warnHeading.textContent = "Findings";
    el.appendChild(warnHeading);

    if (ctx.log.warnings.length === 0) {
      const p = document.createElement("p");
      p.textContent =
        "Nothing to flag. These are mistakes that are silent in the real app — an unawaited " +
        "cleanup, a subscription that outlives the skin, a token that doesn't exist.";
      el.appendChild(p);
    }

    for (const warning of ctx.log.warnings) {
      const note = document.createElement("div");
      note.className = "amee-dev__note";
      note.innerHTML = `<strong>${escape(warning.message)}</strong>${
        warning.detail ? `<br><br>${escape(String(warning.detail))}` : ""
      }`;
      el.appendChild(note);
    }
  }

  render();

  return {
    title: "Errors",
    el,
    update: render,
    badge: () => errors.length + ctx.log.warnings.length || null,
    pushError(payload) {
      errors.push(payload);
      render();
    },
  };
}

function escape(text) {
  return String(text).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}
