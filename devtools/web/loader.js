// Loading a skin exactly the way Amee loads one.
//
// This is the single most important file in the harness, and the reason it is
// a dumb static server rather than a bundler dev server. Amee reads a skin's
// entry file as a *string*, wraps it in a Blob, and imports the resulting blob:
// URL (SkinContext.tsx). A blob URL has no base and no import map, which has
// three consequences a skin author must be able to hit locally:
//
//   * `import "react"` cannot resolve. Vite's dev server would rewrite it and
//     the skin would work here and fail after install.
//   * `import "./util.js"` cannot resolve either — there is nothing to resolve
//     it against.
//   * `process.env.NODE_ENV` throws, because a WKWebView has no `process` and
//     neither does this harness.
//
// That last one is why the harness must never define `window.process`. It
// would look like a kindness and would destroy the check.

const MOUNT_ERROR_HINT =
  "A skin's entry file must `export function mount(container, amee)`. Check " +
  "that your bundler is emitting an ES module and that the export isn't being " +
  "renamed or wrapped in a default export.";

/**
 * @typedef {object} MountedSkin
 * @property {() => void} cleanup   Runs the skin's own cleanup, if it gave a usable one.
 * @property {boolean} asyncMount   Whether mount() returned a thenable (a real bug — see below).
 */

/**
 * Fetches, blobs, imports and mounts a skin into an already-loaded stage frame.
 *
 * @param {object} args
 * @param {Window} args.frameWin   The stage frame's window.
 * @param {string} args.pkg        Repo-relative package directory.
 * @param {string} args.entry      Entry filename, for error messages.
 * @param {object} args.sdk        The mock SDK to hand the skin.
 * @param {(msg: string, detail?: unknown) => void} [args.warn]
 * @returns {Promise<MountedSkin>}
 */
export async function mountSkin({ frameWin, pkg, entry, sdk, warn = () => {} }) {
  const response = await fetch(`/__amee/entry?pkg=${encodeURIComponent(pkg)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body.error ?? `could not read ${entry}`);
    err.hint = body.hint ?? null;
    throw err;
  }
  const source = await response.text();

  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

  // Installed as a page global *before* the import, because that is when Amee
  // installs it: initAmeeSdk() runs before anything mounts, and a skin's
  // module-level code is allowed to read window.amee at evaluation time. Skins
  // that use the global rather than the `amee` parameter are common enough
  // that only passing the argument would be a false pass here.
  frameWin.amee = sdk;

  let module;
  try {
    module = await frameWin.__ameeStageImport(blobUrl);
  } finally {
    // Amee revokes as soon as the import settles. Keeping it alive would let a
    // skin re-import its own module by URL, which it cannot do in production.
    URL.revokeObjectURL(blobUrl);
  }

  if (typeof module.mount !== "function") {
    const err = new Error(`${entry} doesn't export a mount() function`);
    err.hint = MOUNT_ERROR_HINT;
    throw err;
  }

  const container = frameWin.document.querySelector(".mini-player-host");
  container.innerHTML = "";

  // Deliberately not awaited, because MiniPlayer.tsx doesn't await it either.
  //
  // That is not an oversight to paper over: the host assigns the return value
  // and later checks `typeof cleanup === "function"`. An `async function
  // mount()` returns a Promise, the check fails, and the skin's cleanup never
  // runs — leaking listeners, roots and appended stylesheets on every skin
  // switch. Awaiting here would hide a real bug that only shows up in the app.
  const returned = module.mount(container, sdk);

  const asyncMount = typeof returned?.then === "function";
  if (asyncMount) {
    warn(
      "mount() returned a Promise — Amee does not await it, so your cleanup will never run.",
      "Drop `async` from mount(). Start anything that needs awaiting inside it and let it " +
        "settle into the already-rendered tree; see examples/hello-skin.",
    );
  }

  return {
    asyncMount,
    cleanup: () => {
      if (typeof returned !== "function") return;
      try {
        returned();
      } catch (err) {
        warn(`the skin's cleanup function threw: ${err.message}`, err.stack);
      }
    },
  };
}
