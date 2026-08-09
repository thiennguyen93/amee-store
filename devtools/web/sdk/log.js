// Every SDK call a skin makes, recorded.
//
// This is the part of the harness that tells you things you cannot learn any
// other way. A skin is a black box that talks to the SDK; watching that
// conversation answers "is my subscription firing?", "why is this re-rendering
// twice a second?", "did that promise reject?" and "which of my lines called
// this?" without a single console.log in the skin.
//
// The wrapper is a Proxy rather than a hand-written set of shims so a member
// added to the SDK is logged the moment it exists, instead of quietly not
// being.

/// Arguments are stringified for display only. Truncated hard, because a skin
/// can and does pass 200 KB artwork data URIs and 512-element spectrum arrays
/// through here, and a log that keeps them all is a memory leak with a UI.
const MAX_ARG_CHARS = 120;

function preview(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "ƒ";
  if (typeof value === "string") {
    return value.length > MAX_ARG_CHARS
      ? JSON.stringify(value.slice(0, MAX_ARG_CHARS)) + `…(${value.length})`
      : JSON.stringify(value);
  }
  if (value instanceof Element) {
    return `<${value.tagName.toLowerCase()}${value.className ? `.${String(value.className).split(" ").join(".")}` : ""}>`;
  }
  if (Array.isArray(value)) {
    return value.length > 6 ? `[${value.length} items]` : `[${value.map(preview).join(", ")}]`;
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return String(value);
    return json.length > MAX_ARG_CHARS ? json.slice(0, MAX_ARG_CHARS) + "…" : json;
  } catch {
    return String(value);
  }
}

/// The caller's own line, with the harness's frames stripped. This is what
/// makes an entry clickable through to the skin's source in DevTools.
function callerFrame() {
  const stack = new Error().stack ?? "";
  const lines = stack.split("\n").slice(1);
  for (const line of lines) {
    // Everything in the harness is served from /web/; the skin runs from a
    // blob: URL. Anything blob:-shaped is the skin.
    if (line.includes("blob:")) return line.trim();
  }
  return lines[lines.length - 1]?.trim() ?? "";
}

export function createCallLog({ limit = 2000 } = {}) {
  /** @type {Array<object>} */
  const entries = [];
  const counts = new Map();
  const warnings = [];
  const subscribers = new Set();
  let paused = false;
  let seq = 0;

  function emit() {
    for (const cb of subscribers) cb();
  }

  function record(entry) {
    counts.set(entry.member, (counts.get(entry.member) ?? 0) + 1);
    if (paused) return entry;
    entries.push(entry);
    // A ring buffer, so a skin polling getNowPlaying() in a rAF loop degrades
    // the log's history rather than the browser tab.
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    emit();
    return entry;
  }

  const log = {
    get entries() {
      return entries;
    },
    get counts() {
      return counts;
    },
    get warnings() {
      return warnings;
    },
    get paused() {
      return paused;
    },
    setPaused(value) {
      paused = !!value;
      emit();
    },
    clear() {
      entries.length = 0;
      counts.clear();
      emit();
    },
    reset() {
      log.clear();
      warnings.length = 0;
      emit();
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    /// A finding about how the skin uses the SDK, as opposed to a call it made.
    /// Deduplicated by message so a warning raised in a 2 Hz callback doesn't
    /// drown the list.
    warn(message, detail) {
      if (warnings.some((w) => w.message === message)) return;
      warnings.push({ message, detail: detail ?? null, at: Date.now() });
      emit();
    },

    note(member, message) {
      record({ id: ++seq, at: Date.now(), member, args: [], note: message, kind: "note" });
    },

    /// Wraps an SDK so every member call is recorded. Returns a new object; the
    /// original is untouched.
    wrap(sdk) {
      const cache = new Map();
      return new Proxy(sdk, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;
          if (cache.has(prop)) return cache.get(prop);

          const wrapped = (...args) => {
            const started = performance.now();
            const entry = record({
              id: ++seq,
              at: Date.now(),
              member: String(prop),
              args: args.map(preview),
              caller: callerFrame(),
              kind: "call",
              status: "returned",
              result: null,
              ms: 0,
            });

            let result;
            try {
              result = value.apply(target, args);
            } catch (err) {
              entry.status = "threw";
              entry.result = err.message;
              entry.ms = performance.now() - started;
              emit();
              throw err;
            }

            entry.ms = performance.now() - started;

            if (result && typeof result.then === "function") {
              entry.status = "pending";
              emit();
              return result.then(
                (value) => {
                  entry.status = "resolved";
                  entry.result = preview(value);
                  entry.ms = performance.now() - started;
                  emit();
                  return value;
                },
                (err) => {
                  entry.status = "rejected";
                  entry.result = err?.message ?? String(err);
                  entry.ms = performance.now() - started;
                  emit();
                  throw err;
                },
              );
            }

            entry.result = preview(result);
            emit();
            return result;
          };

          cache.set(prop, wrapped);
          return wrapped;
        },
      });
    },

    /// Checks that can only be made once the skin has settled — each one a
    /// mistake that is silent in production.
    lint({ listenerSnapshot }) {
      const called = (member) => (counts.get(member) ?? 0) > 0;

      if (called("onSpectrum") && !called("startVisualizer")) {
        log.warn(
          "onSpectrum() is subscribed but startVisualizer() was never called — no bins are emitted.",
          "The system-audio tap needs a permission prompt, so Amee only starts it on request. " +
            "Call startVisualizer() (and stopVisualizer() in your cleanup).",
        );
      }

      const expands = counts.get("expandWindowFlyout") ?? 0;
      const collapses = counts.get("collapseWindowFlyout") ?? 0;
      if (expands > 0 && collapses === 0) {
        log.warn(
          "expandWindowFlyout() was called but collapseWindowFlyout() never was — the window " +
            "stays enlarged.",
        );
      }

      const snapshot = listenerSnapshot();
      const leaked = Object.entries(snapshot).filter(([, n]) => n > 0);
      return { snapshot, leaked };
    },
  };

  return log;
}
