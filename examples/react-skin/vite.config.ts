import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

// A skin's entry file is loaded as a dynamically-constructed blob-URL
// ES module (see docs/SKINS.md) — there's no import map, so a bare
// `import "react"` inside it would fail to resolve at runtime. This config
// bundles React/ReactDOM straight into main.js (nothing external, no
// code-splitting) and inlines the component's CSS as a runtime-injected
// <style> tag instead of a separate .css asset, so the whole skin is one
// self-contained file — same "no build step to install" contract the app
// expects from a skin, it just happens to have a build step to *produce*.
export default defineConfig({
  plugins: [react(), cssInjectedByJsPlugin()],
  // Library-mode builds leave `process.env.NODE_ENV` unreplaced (Vite assumes
  // a downstream bundler will do it) — but this bundle's only "downstream" is
  // a blob-URL ES module loaded straight into Amee's WKWebView, which has no
  // `process` global at all. Replace it ourselves or React throws
  // `ReferenceError: Can't find variable: process` at mount.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: "src/mount.tsx",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
