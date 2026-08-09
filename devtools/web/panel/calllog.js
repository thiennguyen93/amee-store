// Every SDK call the skin makes, live.
//
// The per-member counters are usually the more useful half. A skin that
// rebuilds its whole DOM on every now-playing event looks fine until you see
// getToken() called 800 times in a minute, or getNowPlaying() called from a
// requestAnimationFrame loop.

export function createCallLogPanel(ctx) {
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="amee-dev__row">
      <input type="text" id="log-filter" placeholder="filter by member…" style="flex:1" />
      <button id="log-pause">Pause</button>
      <button id="log-clear">Clear</button>
    </div>
    <div class="amee-dev__row">
      <label><input type="checkbox" id="log-fails" /> rejections and throws only</label>
    </div>
    <h2>Calls</h2>
    <div class="amee-dev__log" id="log-body"></div>
    <h2>Counts</h2>
    <div class="amee-dev__counts" id="log-counts"></div>
  `;

  const filter = el.querySelector("#log-filter");
  const failsOnly = el.querySelector("#log-fails");
  const body = el.querySelector("#log-body");
  const counts = el.querySelector("#log-counts");
  const pause = el.querySelector("#log-pause");

  pause.addEventListener("click", () => {
    ctx.log.setPaused(!ctx.log.paused);
    pause.textContent = ctx.log.paused ? "Resume" : "Pause";
    render();
  });
  el.querySelector("#log-clear").addEventListener("click", () => ctx.log.clear());
  filter.addEventListener("input", render);
  failsOnly.addEventListener("change", render);

  function render() {
    const needle = filter.value.trim().toLowerCase();
    const rows = ctx.log.entries
      .filter((e) => !needle || e.member.toLowerCase().includes(needle))
      .filter((e) => !failsOnly.checked || e.status === "rejected" || e.status === "threw")
      // Newest first, and capped: the DOM is not the place to keep 2000 rows.
      .slice(-250)
      .reverse();

    body.innerHTML = rows
      .map((e) => {
        const time = new Date(e.at).toLocaleTimeString([], { hour12: false });
        const args = e.args.join(", ");
        const result =
          e.status === "returned" || e.status === "resolved"
            ? e.result && e.result !== "undefined"
              ? ` → ${escape(e.result)}`
              : ""
            : ` ${e.status}${e.result ? `: ${escape(e.result)}` : ""}`;
        const caller = e.caller ? `\n    ${escape(e.caller)}` : "";
        return `<div class="${e.status}"><span class="dim">${time}</span> <span class="m">${e.member}</span>(${escape(args)})${result}<span class="dim">${caller}</span></div>`;
      })
      .join("");

    const sorted = [...ctx.log.counts.entries()].sort((a, b) => b[1] - a[1]);
    counts.innerHTML = sorted
      .map(([member, n]) => `<span>${member}</span><span>${n}</span>`)
      .join("");
  }

  ctx.log.subscribe(() => {
    // The log fires far faster than a human reads. Coalescing to one paint
    // keeps a chatty skin from making the harness itself the bottleneck.
    if (render.queued) return;
    render.queued = true;
    requestAnimationFrame(() => {
      render.queued = false;
      render();
    });
  });

  render();

  return { title: "Calls", el, update: render };
}

function escape(text) {
  return String(text).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}
