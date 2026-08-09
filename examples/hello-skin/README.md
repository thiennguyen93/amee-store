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

## Preview it

```sh
node devtools/dev.mjs examples/hello-skin
```

Opens a local harness that mounts the skin the way Amee does, with working
transport, volume, a real spectrum and a six-track playlist chosen to break
layouts. Save `main.js` or `style.css` and it remounts. Point it at your own
directory once you have copied this one. See
[`devtools/README.md`](../../devtools/README.md).

## Build and try it in Amee

```sh
node tools/validate.mjs registry/skins/my-skin
node tools/build.mjs    registry/skins/my-skin
```

That writes `dist/my-skin-1.0.0.ybskin`. Drag it onto Amee's **Settings →
Skins** tab to install, then click the card to activate it.

While iterating, prefer the harness above — this loop exists for confirming the
real thing, not for every edit. When you do use it, re-run `build.mjs` and drag
the new file in again: Amee replaces an existing skin of the same id when it
comes from the store, and offers to replace it when you sideload.

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
- [the skin documentation](https://docs.amee.thiennguyen.dev/customization/skins)
  — the full SDK reference, including resizable windows, graceful shutdown,
  per-skin storage, extra windows, and the hover/focus gotchas that only show
  up once your skin has a popover.
