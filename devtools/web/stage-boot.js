// Runs inside the stage frame. Its only job is to perform the dynamic import
// *from this document's realm* and hand the module object back out.
//
// Why it can't just be `parent.import(blobUrl)`: a dynamic import is evaluated
// in the realm of the script that issued it. Import from the harness page and
// the skin's module closes over the harness's `document` and `window` — so
// `document.head.appendChild(link)` puts the skin's stylesheet in the harness's
// head, `document.documentElement` is the harness's root, and getToken() reads
// the wrong document. Everything appears to work until it doesn't.
//
// Amee's in-app skin preview solves it the same way (SkinPreview.tsx injects a
// module script into the frame whose body calls back out). This is the same
// handoff, just permanent instead of injected.

window.__ameeStageReady = false;

/**
 * @param {string} blobUrl
 * @returns {Promise<Record<string, unknown>>}
 */
window.__ameeStageImport = (blobUrl) => import(/* @vite-ignore */ blobUrl);

// Errors thrown by the skin — at module evaluation, inside mount(), or from a
// listener firing long after — surface here and nowhere else. Without this
// they only appear in the DevTools console of a frame nobody thinks to select,
// and the harness looks broken instead of the skin.
window.addEventListener("error", (event) => {
  window.parent.__ameeStageError?.({
    kind: "error",
    message: event.message,
    source: event.filename,
    line: event.lineno,
    stack: event.error?.stack ?? null,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  window.parent.__ameeStageError?.({
    kind: "unhandledrejection",
    message: reason instanceof Error ? reason.message : String(reason),
    source: null,
    line: null,
    stack: reason instanceof Error ? reason.stack : null,
  });
});

window.__ameeStageReady = true;
window.parent.__ameeStageLoaded?.(window);
