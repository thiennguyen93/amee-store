// One recursive fs.watch per package, debounced and classified.

import fs from "node:fs";
import path from "node:path";

/// Deliberately NOT tools/lib.mjs's IGNORED_DIRS, which contains "dist".
/// dist/ is exactly what a build package's entry lives in — reusing that set
/// would make the flagship example the one thing that never live-reloads.
const WATCH_IGNORED = new Set(["node_modules", ".git", ".DS_Store"]);

/// fs.watch coalesces bursts unevenly across platforms, and a Vite rebuild
/// writes several files in quick succession. Trailing debounce so one rebuild
/// is one reload.
const DEBOUNCE_MS = 60;

function ignored(rel) {
  return rel.split(path.sep).some((p) => WATCH_IGNORED.has(p));
}

/**
 * Watches a package directory and calls `onChange({ kind, paths })` where
 * `kind` is "entry" | "manifest" | "asset".
 *
 * @returns {() => void} stop
 */
export function watchPackage(pkg, onChange) {
  let timer = null;
  let pending = new Set();

  const flush = () => {
    timer = null;
    const paths = [...pending];
    pending = new Set();
    if (paths.length === 0) return;

    // Most specific classification wins: a rebuild that rewrites both the
    // manifest and the bundle should be reported as a manifest change, since
    // that is the one that needs a server-side re-resolve.
    const kind = paths.some((p) => p === "manifest.json" || p === "store.json")
      ? "manifest"
      : paths.some((p) => path.join(pkg.dir, p) === pkg.entryPath)
        ? "entry"
        : "asset";

    onChange({ kind, paths });
  };

  let watcher;
  try {
    watcher = fs.watch(pkg.dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (ignored(rel)) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    });
  } catch (err) {
    // Recursive watching is unavailable on some platforms/filesystems. The
    // harness still works — there is a Reload button and an `r` shortcut —
    // so this is a warning, not a fatal error.
    console.warn(`! could not watch ${pkg.rel} for changes: ${err.message}`);
    console.warn("  Live reload is off; use the Reload button in the harness.");
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
