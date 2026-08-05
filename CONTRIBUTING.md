# Contributing a skin

Everything here is a normal GitHub pull request. You commit **source**, CI
builds the `.ybskin`, a maintainer reads the code, and merging publishes it.

You need Node 20+ and `zip` (already on macOS and Linux). Nothing to install —
the tools have no dependencies.

## 1. Start from an example

```sh
git clone https://github.com/thiennguyen93/amee-store
cd amee-store
cp -r examples/hello-skin registry/skins/my-skin
```

- [`examples/hello-skin`](./examples/hello-skin) — plain DOM JavaScript, no
  build step. Start here unless you have a reason not to.
- [`examples/react-skin`](./examples/react-skin) — React + TypeScript bundled by
  Vite. Use this shape if you want a framework; see
  [declaring a build](#declaring-a-build) below.

## 2. Fill in the two manifests

**`manifest.json`** is what Amee reads. `id` must equal your directory name.

```json
{
  "id": "my-skin",
  "name": "My Skin",
  "author": "your-name",
  "description": "One or two sentences. This is the store card's blurb.",
  "version": "1.0.0",
  "entry": "main.js",
  "width": 420,
  "height": 84
}
```

Every field, and the optional ones (`resizable`, `content_height`,
`graceful_shutdown`, the min/max bounds), are documented in
[`docs/SKINS.md`](https://github.com/thiennguyen93/ybar/blob/main/docs/SKINS.md).
`tools/validate.mjs` enforces exactly the rules Amee itself enforces at import
time, so anything it accepts will install.

**`store.json`** is what the store needs and Amee doesn't. It is never shipped
inside the package.

```json
{
  "kind": "skin",
  "owner": "your-github-login",
  "license": "MIT",
  "tags": ["minimal", "dark"],
  "homepage": "https://github.com/you/my-skin",
  "sdkVersion": "1",
  "minAmeeVersion": "1.6.0",
  "preview": "media/preview.png"
}
```

`owner` is who may publish updates — CI checks it against the PR author. Name,
author, description, version and the window size are read from `manifest.json`
and must **not** be repeated here; one fact, one place.

## 3. Add a preview image

`media/preview.png` is required. It's the store card, so make it a real
screenshot of your skin running, not a mockup.

- PNG, under 1 MB.
- Same aspect ratio as your `width`/`height`, within 10%. Twice the window size
  is a good choice — a 420×84 skin wants an 840×168 image.

Extra `media/screenshot-*.png` files can be listed in `store.json` under
`screenshots`; they show in the detail panel.

## 4. Build it and actually run it

```sh
node tools/validate.mjs registry/skins/my-skin
node tools/build.mjs    registry/skins/my-skin
```

That writes `dist/my-skin-1.0.0.ybskin`. Drag it onto Amee's **Settings →
Skins** tab, then click the card to activate it. Do not skip this — CI checks
that a package is well-formed, not that it looks right or works.

Iterate by re-running `build.mjs` and dragging the new file in again.

## 5. Open a pull request

Fill in the template honestly — the questions about network access and
`invoke()` calls are the ones review actually turns on.

CI will:

- run `tools/validate.mjs` on the package,
- run `tools/build.mjs`, including your build command if you declared one,
- upload the resulting `.ybskin` as a workflow artifact and comment its
  SHA-256, so a reviewer can download and run your skin before approving.

Then a maintainer reads your source against the checklist in
[SECURITY.md](./SECURITY.md). This is a real read, not a formality — skins run
with Amee's full privileges, so a store listing is a statement that somebody
looked.

Once merged, CI publishes a `skins-my-skin-v1.0.0` release with the `.ybskin`
attached and regenerates `index.json`. Your skin appears on the store page.

## Updating a published skin

Same flow. Bump `version` in `manifest.json` — CI rejects a version that's
already been released, and requires the new one to be greater. The PR has to
come from the `owner` in `store.json`, or from a maintainer.

Amee upgrades a store-installed skin in place: the user keeps it selected,
keeps their window size, and keeps any data your skin saved through
`amee.storage`.

## Declaring a build

If your skin is compiled from source, don't commit the bundle — commit the
source and let CI build it. That is the whole point: a reviewer has to be able
to read what runs on someone's machine.

Add to `store.json`:

```json
"build": { "packageManager": "npm", "command": "build", "output": "dist" }
```

- `command` is a **script name** in your `package.json`, not a shell string.
- Commit your `package.json` and lockfile. CI installs with a frozen lockfile.
- Do **not** commit `output/`. `.gitignore` already covers `dist/`.
- Your build must emit the file named by `manifest.entry` (usually `main.js`)
  into `output/`. `manifest.json` is copied in afterwards by the build tool.

A skin is loaded as a blob-URL ES module with no import map, so the entry file
must be fully self-contained — bundle your framework in and inline your CSS.
`examples/react-skin/vite.config.ts` is a working configuration for exactly
that, with the reasoning written out in comments.

## What gets rejected

- Obfuscated or minified code with no matching source.
- `eval` / `new Function` over anything fetched at runtime.
- Network requests that aren't explained in the PR.
- Third-party code of unclear provenance.
- An `id` that collides with a built-in (`classic`).
- A missing or misleading preview image.

Details and reasoning: [SECURITY.md](./SECURITY.md).

## Licensing

Pick any OSI-approved license and put its SPDX id in `store.json`. Adding a
`LICENSE` file to your package directory is encouraged; it ships inside the
`.ybskin`. You keep the copyright to your skin.
