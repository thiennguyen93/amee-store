# React Skin

The same idea as [`hello-skin`](../hello-skin), but written in React and
TypeScript and bundled by Vite — plus a live spectrum visualiser driven by
`amee.onSpectrum()`.

Use this as your starting point if you want a framework. Use `hello-skin` if
you don't; a skin genuinely does not need one.

## The one constraint that shapes the whole config

Amee loads a skin's entry file as a **dynamically-constructed blob-URL ES
module**. A blob URL has no import map and no base path, so a bare
`import "react"` inside it cannot resolve at runtime. Whatever `manifest.entry`
points at has to be one self-contained file.

`vite.config.ts` is set up for exactly that, and the reasoning is written out in
comments there:

- **Library mode**, single ES output, `inlineDynamicImports` — React and
  ReactDOM are bundled in rather than left external, and nothing is split.
- **`vite-plugin-css-injected-by-js`** — the CSS becomes a runtime-injected
  `<style>` tag instead of a separate asset, because a separate asset would need
  a URL the blob module can't construct.
- **`define: { "process.env.NODE_ENV": '"production"' }`** — library builds
  leave that identifier alone on the assumption a downstream bundler handles it.
  There is no downstream bundler here, and a WKWebView has no `process` global,
  so React throws `ReferenceError: Can't find variable: process` at mount
  without this.

## Layout

| File | What it's for |
|---|---|
| `src/mount.tsx` | The `mount(container, amee)` export Amee calls — creates a React root and renders `<App>`. Returns a cleanup that unmounts. |
| `src/App.tsx` | The UI: artwork, title, transport, volume, spectrum bars. |
| `src/hooks.ts` | Thin React wrappers over the SDK's subscribe-and-unsubscribe pattern. |
| `src/amee-sdk.d.ts` | Types for `window.amee`. Hand-maintained against `docs/SKINS.md`. |
| `src/App.css` | Inlined into `main.js` at build time. |

## Develop

```sh
npm install
npm run dev          # vite build --watch, writes dist/main.js on every save
```

Then from the repository root:

```sh
node tools/build.mjs examples/react-skin
```

and drag `dist/react-skin-1.0.0.ybskin` onto Amee's **Settings → Skins** tab.

There is no browser-based dev loop: a skin needs the real `window.amee` global,
which only exists inside Amee's webview. Build, drag, look.

## Copying it

```sh
cp -r examples/react-skin registry/skins/my-skin
```

Then update `manifest.json` (`id` must equal the directory name), `store.json`
(`owner`, `license`, `tags`), `package.json`'s `name`, and replace
`media/preview.png` with a real screenshot.

Keep the `build` block in `store.json` — that's what tells CI to run
`npm ci && npm run build` and package `dist/` instead of expecting a committed
`main.js`. Commit `package-lock.json`; CI installs with a frozen lockfile so the
bundle a reviewer approves is the bundle that gets published.
