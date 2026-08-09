import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { AmeeSdk } from "amee-sdk";

// The contract a skin's entry file must export — see
// docs/SKINS.md. `container` is a plain empty <div>; `amee` is the SDK.
// Returning a cleanup function lets React unmount cleanly when the app
// switches to a different skin instead of leaving the root dangling.
//
// Deliberately not `async`. Amee calls `mount()` without awaiting it and then
// checks `typeof cleanup === "function"` — an async mount returns a Promise, so
// that check fails and this root is never unmounted, leaking it and every
// subscription under it on each skin switch. `createRoot` and `render` are
// synchronous anyway; if you do need to await something, start it here and let
// it settle into the already-rendered tree.
export function mount(container: HTMLElement, amee: AmeeSdk) {
  const root = createRoot(container);
  root.render(<App amee={amee} />);
  return () => root.unmount();
}
