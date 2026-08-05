<!--
Thanks for submitting to the Amee store.

Skins run unsandboxed — with the same access to the user's machine as Amee
itself. That's why every package is read by a maintainer before it merges, and
why the questions below are the ones review actually turns on. Answering them
honestly and specifically is the fastest path to a merge.

See CONTRIBUTING.md and SECURITY.md.
-->

## What is it

<!-- One or two sentences. What does the skin look like, what's the idea? -->

**Package:** `registry/skins/<id>`
**New submission / update:** <!-- delete one -->

## Screenshot

<!-- Drop an image in. media/preview.png is required in the package, but paste
     one here too so reviewers see it without checking out the branch. -->

## Network access

<!-- Does the skin make ANY network request (fetch, XHR, WebSocket, a remote
     font, a remote image)? If yes: which endpoint, and why does a mini player
     need it? If no, say "None." -->

## Tauri commands

<!-- Does the skin call invoke() directly, rather than going through the
     documented window.amee SDK? If yes: which commands, and why? If no, say
     "None — SDK only." -->

## Third-party code

<!-- Any dependency, vendored library, or code you didn't write. Where is it
     from? If your package declares a build, is the lockfile committed?
     If none, say "None." -->

## Checklist

- [ ] `node tools/validate.mjs registry/skins/<id>` passes
- [ ] `node tools/build.mjs registry/skins/<id>` produces a `.ybskin`
- [ ] I installed that `.ybskin` in Amee and it works
- [ ] `media/preview.png` is a real screenshot at the skin's aspect ratio
- [ ] `store.json` `owner` is my GitHub login
- [ ] For an update: `version` is bumped in `manifest.json`
- [ ] No obfuscated or minified code without matching source
- [ ] No `eval` / `new Function` over anything fetched at runtime
