# Hello Skin

The starting point for a new Amee skin. Plain DOM JavaScript, no build step, no
dependencies — `main.js` is shipped to Amee exactly as it is written here.

## Use it as a template

```sh
cp -r examples/hello-skin registry/skins/my-skin
```

Then, in `registry/skins/my-skin/`:

1. **`manifest.json`** — set `id` to `my-skin` (it must equal the directory
   name), pick a `name`, `author`, `description`, and the `width`/`height` your
   layout wants. Leave `version` at `1.0.0`.
2. **`store.json`** — set `owner` to your GitHub login, pick a `license` and
   `tags`.
3. **`main.js` / `style.css`** — build your UI.
4. **`media/preview.png`** — a real screenshot of your skin, same aspect ratio
   as `width`/`height`, under 1 MB.

## Build and try it

```sh
node tools/validate.mjs registry/skins/my-skin
node tools/build.mjs    registry/skins/my-skin
```

That writes `dist/my-skin-1.0.0.ybskin`. Drag it onto Amee's **Settings →
Skins** tab to install, then click the card to activate it.

While iterating, re-run `build.mjs` and drag the new file in again — Amee
replaces an existing skin of the same id when it comes from the store, and
offers to replace it when you sideload.

## What this example demonstrates

| Thing | Where |
|---|---|
| The `mount(container, amee)` contract, and returning a cleanup function | `main.js` top and bottom |
| Loading a bundled asset (`style.css`) via `amee.getSkinAsset()` | `mount()`, first lines |
| Reading and subscribing to now-playing state | `amee.getNowPlaying()` / `amee.onNowPlaying()` |
| Transport controls | `amee.togglePlay()` / `next()` / `previous()` |
| Seeking from a click on the progress bar | the `bar` click handler |
| Recolouring with the user's active theme | `amee.getToken("--accent")` |
| Dragging the window by its background | `data-tauri-drag-region` + the `mousedown` stopPropagation on controls |

## Where to go next

- [`examples/react-skin`](../react-skin) — the same idea with a build step,
  React and TypeScript, plus a live spectrum visualiser.
- [`docs/SKINS.md`](https://github.com/thiennguyen93/ybar/blob/main/docs/SKINS.md)
  in the Amee repo — the full SDK reference, including resizable windows,
  graceful shutdown, per-skin storage, extra windows, and the hover/focus
  gotchas that only show up once your skin has a popover.
