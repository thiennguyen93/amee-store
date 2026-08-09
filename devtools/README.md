# The skin preview harness

A local server that mounts your skin the way Amee mounts it, against a mock SDK
with real audio — so you can build one without building, packaging, installing
and activating it first.

```sh
node devtools/dev.mjs examples/hello-skin
```

Zero dependencies. Nothing to install, nothing to build, no `node_modules`.

## What it does

Amee reads your entry file as a string, wraps it in a `Blob`, and imports the
resulting `blob:` URL. The harness does exactly the same thing, into an iframe
shaped like the mini-player window, and hands the module a `window.amee` that
implements every member of the SDK.

That means:

- **transport, seek, volume, mute** all work, and all take a configurable
  round-trip time, because in the app they are IPC plus a system API;
- **`onSpectrum` emits 512 real FFT bins at ~30fps**, computed from a real
  `AnalyserNode` on real audio — matching Amee's `audio_tap.rs` bin for bin,
  including the fact that the values are **unbounded**;
- **`prev`/`next` move through six tracks** chosen to break layouts: a 100+
  character CJK title, a track with no artist and no artwork, a 90-minute live
  recording, a radio stream with no duration that refuses seeks, and one with a
  Picture-in-Picture window open;
- **`getDominantColors()` returns genuinely computed colours**, because the
  cover art is drawn pixel by pixel rather than served as a fixture;
- **`openSkinWindow()` opens a real second window** against the same backend, so
  `storage.onChange` really does cross windows.

And an inspector alongside it: every SDK call your skin makes, with the line it
came from; the events you otherwise have to wait for (quit, hide, focus loss,
device changes); the theme tokens; the geometry; and per-skin storage.

## Options

```
node devtools/dev.mjs [package-dir] [options]

  package-dir       examples/<id> or registry/<kind>/<id>.
                    Omitted: pick one in the browser.

  --port <n>        Default 4173, walking up to 4193 when busy. A pinned port
                    fails rather than drifting.
  --host            Bind 0.0.0.0 instead of 127.0.0.1. See the warning it prints.
  --no-open         Don't open a browser.
  --build-watch     Run the package's own `dev` script and stream its output
                    into the harness. For packages declaring `build` in
                    store.json.
  --audio <file>    Play your own audio instead of the built-in synth.
```

Press **r** to remount, **space** to play/pause.

## The two things that are deliberately unhelpful

**Bare imports fail here.** A blob URL has no import map and no base path, so
`import "react"` — or even `import "./util.js"` — cannot resolve at runtime.
That is exactly why the harness is a dumb static server and not a bundler dev
server: a framework dev server would rewrite the specifier and your skin would
work locally and fail after install. Bundle to one self-contained ES module; see
[`examples/react-skin/vite.config.ts`](../examples/react-skin/vite.config.ts).

**`process` does not exist here.** Library-mode builds leave
`process.env.NODE_ENV` alone, and a WKWebView has no `process`, so React throws
at mount in the real app. The harness has no `process` either, for that reason.
**Do not add a polyfill.** It would look like a kindness and would silently
destroy the most valuable check this tool performs.

Both failures are decoded for you in the **Errors** tab rather than left as a
bare stack trace in a frame nobody thinks to select.

## The spectrum is not normalised

`onSpectrum` hands you 512 raw linear FFT magnitudes whose ceiling depends on
how loud the machine is. There is no normalisation in the app and there is none
here — `Math.min(1, bin)` will pin every bar to full height. The Now-playing tab
shows a live peak readout so you can see what you are actually being handed;
[`examples/react-skin/src/App.tsx`](../examples/react-skin/src/App.tsx) shows the
three steps that turn those bins into bars that look like music.

The one number that is a judgement call is `SPECTRUM_SCALE` in
[`web/sdk/fft.js`](web/sdk/fft.js). Bin count, spacing, smoothing and emit rate
are exact; the absolute magnitude is scaled to land in the same order as the
real system tap.

## Audio

The default is a small synthesiser — kick, snare, hat, bass, a detuned pad with
a swept filter, a noise bed — built to be *broadband* rather than pleasant,
because a couple of sine waves produce a spectrum with nothing above the
midpoint and a visualiser tuned against that looks wrong on real music.

It is a synthesiser rather than a few committed tracks because this repository
has no dependencies, caps a published skin's preview image at 1 MB, and would
otherwise carry 15–30 MB of licensed audio forever in something CI clones on
every pull request. If you want real music, `--audio path/to/track.mp3` or the
drop zone in the Now-playing tab routes it through the same transport and the
same analyser. Anything you drop in `devtools/audio/` is gitignored.

The `AudioContext` starts suspended under every browser's autoplay policy. Until
you click **Enable audio** the transport still runs and the SDK still reports
`playing: true` — the mock player genuinely is playing — there is simply no
signal reaching the analyser, and the toolbar says so.

## Never put a harness file inside a package directory

`.html` is in `ALLOWED_EXTENSIONS`, and `STORE_ONLY` only hides `store.json`,
`media/` and `README.md`. A stray `examples/my-skin/dev.html` would therefore
pass validation and ship inside the published `.ybskin` to every user, silently.
Everything the harness needs lives under `devtools/`.

## Layout

| Path | What it is |
|---|---|
| `dev.mjs` | The CLI and the server. The only executable entry point. |
| `selftest.mjs` | Headless CI check that the resolver still mirrors `tools/build.mjs`. |
| `lib/resolve.mjs` | Which files a package's entry and assets resolve to. Mirrors the staging in `tools/build.mjs` — change them together. |
| `lib/mime.mjs` | Two MIME tables: one ported from Amee's `guess_mime`, one for the harness's own files. Do not merge them. |
| `web/loader.js` | fetch → Blob → import → mount. The fidelity path. |
| `web/stage.html` / `stage.css` | The replica of the mini-player window. Copied from the app's `App.css`. |
| `web/sdk/` | The mock SDK. Members that are Tauri-free in the app are ported verbatim, with the source line range in a header comment. |
| `web/panel/` | The inspector tabs. |

## Fidelity, and where it ends

Ported verbatim from the app, because drift in them is invisible until it ships:
elapsed-time interpolation and the seek hold, the ~2 Hz re-notify, `onResize`'s
`ResizeObserver`, `trackHover`'s rectangular hit test, `getDominantColors`, and
the `onShutdown`/`onHide` fan-out including its two `requestAnimationFrame`s.

Faithful but stood in for: the AirPlay button is a visible overlay rather than a
real `AVRoutePickerView` (it still enforces one slot per window); the recording
permission is an in-page dialog; `dockToPip` attaches to a fake PiP rectangle;
and `startWindowDrag` drags the stage inside the viewport.

Harness-only, and labelled as such in the UI: "silence the speakers, keep the
spectrum", and unlocking the stage size past what the manifest allows.
