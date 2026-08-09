# `types/`

One file: [`amee-sdk.d.ts`](./amee-sdk.d.ts) — the type declarations for
`window.amee`, the object Amee hands every skin.

Every package in this repository that is written in TypeScript compiles against
this copy. Before it existed each example carried its own hand-maintained
declaration, and they drifted: the one bundled with `examples/react-skin` was
missing `storage`, `openSkinWindow`, `quit`, `onShow`, `onShutdown`,
`startVisualizer`/`stopVisualizer`, `onResize`, `onWindowFocusChange`, the whole
Picture-in-Picture group, and five `NowPlaying` fields. A skin author reading it
had no way to know those existed.

## Where it comes from

It is a verbatim copy of lines 23–702 of `src/sdk/ameeSdk.ts` in the Amee
application repository — the entire type block, which happens to be
import-free, so it copies whole including every doc comment. Those comments are
the best SDK reference that exists; do not trim them.

The copy is manual. The app and this registry are separate repositories, and
this repository deliberately has no root `package.json`, no dependencies and no
npm workspace to share a package through.

## Re-syncing

```sh
sed -n '23,702p' path/to/amee/src/sdk/ameeSdk.ts
```

Paste the result between this file's header comment and its trailing
`AmeeSDK` alias. Then check, in order:

1. **The line range still bounds the type block.** It starts at
   `export type WindowSize` and ends at the closing `}` of
   `declare global { interface Window { amee: AmeeSdk } }`. If the app grew an
   import or a helper inside that span, narrow the range — never copy runtime
   code in here.
2. **`AmeeSdk["version"]`.** That string is the SDK's own version marker and the
   drift tripwire. If it changed, `store.json`'s `sdkVersion` enum in
   [`schema/package.schema.json`](../schema/package.schema.json) needs the new
   value too, and every published package declares the old one.
3. **`npm run build` in `examples/react-skin`.** It runs `tsc` before Vite, so a
   malformed copy fails there rather than silently at install time. CI runs the
   same build, which is why `types/**` is one of the paths that re-validates
   every package.

## Using it from a package

`tsconfig.json`:

```jsonc
"baseUrl": ".",
"paths": {
  // Two candidates, because a package sits at examples/<id>/ or at
  // registry/<kind>/<id>/ — TypeScript tries each until one resolves, so this
  // survives `cp -r examples/react-skin registry/skins/my-skin` unedited.
  "amee-sdk": ["../../types/amee-sdk.d.ts", "../../../types/amee-sdk.d.ts"]
}
```

```ts
import type { AmeeSdk, NowPlaying } from "amee-sdk";
```

This is types-only under `noEmit`, so nothing from here reaches your bundle —
`amee-sdk` is never a runtime import and must never appear in a `dependencies`
block.
