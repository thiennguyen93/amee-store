import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { AmeeSDK } from "./amee-sdk";

// The contract a skin's entry file must export — see
// docs/SKINS.md. `container` is a plain empty <div>; `amee` is the SDK.
// Returning a cleanup function lets React unmount cleanly when the app
// switches to a different skin instead of leaving the root dangling.
export async function mount(container: HTMLElement, amee: AmeeSDK) {
  const root = createRoot(container);
  root.render(<App amee={amee} />);
  return () => root.unmount();
}
