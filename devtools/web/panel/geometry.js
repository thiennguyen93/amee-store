// Size, bounds, the reserved band, the flyout and the PiP dock.
//
// The reserved-band readout is the one worth reading twice. A manifest that
// declares content_height gets a window taller than its painted content, and
// the leftover band is click-through — the OS hands clicks straight to whatever
// is behind Amee. A skin reclaims part of it with reportContentExtent(). Forget
// to, and a popover drawn into that space renders perfectly and cannot be
// clicked. That bug is invisible in every other tool.

export function createGeometryPanel(ctx) {
  const el = document.createElement("div");
  const { view, backend } = ctx;

  function render() {
    const m = view.manifest ?? {};
    const reserved =
      m.content_height != null && m.content_height < (m.height ?? 84)
        ? ((m.height ?? 84) - m.content_height) / 2
        : 0;

    el.innerHTML = `
      <h2>Stage size</h2>
      <div class="amee-dev__row">
        <label>width</label>
        <input type="number" id="w" value="${Math.round(view.size.width)}" style="width:80px" />
        <label>height</label>
        <input type="number" id="h" value="${Math.round(view.size.height)}" style="width:80px" />
      </div>
      <div class="amee-dev__row">
        <label>lock to manifest</label>
        <input type="checkbox" id="lock" ${view.lockToManifest ? "checked" : ""} />
      </div>
      ${
        view.lockToManifest
          ? `<p>${
              m.resizable
                ? `Clamped to ${m.min_width ?? 80}–${m.max_width ?? 2000} × ${m.min_height ?? 80}–${m.max_height ?? 2000}, as declared.`
                : "This manifest sets <code>resizable: false</code>, so the window can never change size — onResize fires exactly once, on subscribe, and never again."
            }</p>`
          : `<p class="amee-dev__note amee-dev__note--danger">Unlocked. Amee would never produce
             these sizes for this manifest — useful for finding out what your layout does under
             pressure, misleading as a statement about how it will ship.</p>`
      }

      <h2>Reserved band</h2>
      ${
        reserved > 0
          ? `<p>${reserved}px above and below is reserved and not painted into. It is
             <strong>click-through</strong> until you reclaim it with
             <code>reportContentExtent(above, below)</code>.</p>
             <div class="amee-dev__counts">
               <span>reported above</span><span>${view.extent.above}px of ${reserved}px</span>
               <span>reported below</span><span>${view.extent.below}px of ${reserved}px</span>
             </div>
             <div class="amee-dev__row"><label>show the band</label><input type="checkbox" id="showdead" ${view.showDeadzone ? "checked" : ""} /></div>`
          : `<p>This manifest declares no <code>content_height</code> smaller than its height, so
             there is no reserved band and <code>reportContentExtent()</code> is a no-op — exactly
             as in the app.</p>`
      }

      <h2>Flyout</h2>
      <div class="amee-dev__row">
        <label>direction</label>
        <select id="dir">
          <option value="auto">auto (from real space)</option>
          <option value="up">force up</option>
          <option value="down">force down</option>
        </select>
      </div>
      <p>expandWindowFlyout() clamps to 16–400px and picks a direction from the space actually
      available. Growing <em>up</em> moves the window's top edge, so content that isn't
      compensating for that visibly jumps — force it here rather than waiting to land near a
      screen edge.</p>
      <div class="amee-dev__row">
        <span class="amee-dev__chip">${
          view.flyout ? `expanded ${view.flyout.direction} +${view.flyout.extra}px` : "collapsed"
        }</span>
      </div>

      <h2>Hover</h2>
      <div class="amee-dev__row">
        <label>simulate unfocused</label>
        <input type="checkbox" id="unfocused" ${view.simulateUnfocused ? "checked" : ""} />
      </div>
      <p>Kills pointer-events inside the stage while still feeding onPointerMove. Every native
      <code>:hover</code> in the skin goes dead and only <code>trackHover()</code> keeps working —
      which is what happens whenever Amee isn't the focused app, and the reason trackHover exists.</p>

      <h2>Picture-in-Picture dock</h2>
      <div class="amee-dev__row">
        <label>edge</label>
        <select id="edge">
          ${["top", "bottom", "left", "right", "none"]
            .map((e) => `<option value="${e}">${e}</option>`)
            .join("")}
        </select>
      </div>
      <div class="amee-dev__row">
        <label>align</label>
        <select id="align">
          ${["start", "center", "end"].map((a) => `<option value="${a}">${a}</option>`).join("")}
        </select>
      </div>
      <div class="amee-dev__row">
        <label>gap</label>
        <input type="number" id="gap" value="${backend.state.pip.gap}" style="width:70px" />
      </div>
      <button id="dock" style="width:100%">dockToPip()</button>
      <p>The gap is measured to your <em>visible content</em>, not to the window edge — the
      reserved band above doesn't count toward it.</p>
    `;

    el.querySelector("#w").addEventListener("change", (e) => resize("width", Number(e.target.value)));
    el.querySelector("#h").addEventListener("change", (e) => resize("height", Number(e.target.value)));
    el.querySelector("#lock").addEventListener("change", (e) => {
      view.lockToManifest = e.target.checked;
      render();
    });
    el.querySelector("#showdead")?.addEventListener("change", (e) => {
      view.showDeadzone = e.target.checked;
      ctx.applyStageGeometry();
    });

    const dir = el.querySelector("#dir");
    dir.value = view.flyoutDirection;
    dir.addEventListener("change", () => {
      view.flyoutDirection = dir.value;
    });

    el.querySelector("#unfocused").addEventListener("change", (e) => {
      view.simulateUnfocused = e.target.checked;
      ctx.applyUnfocusedSimulation();
    });

    const edge = el.querySelector("#edge");
    const align = el.querySelector("#align");
    const gap = el.querySelector("#gap");
    edge.value = backend.state.pip.edge;
    align.value = backend.state.pip.align;
    for (const [node, key] of [
      [edge, "edge"],
      [align, "align"],
      [gap, "gap"],
    ]) {
      node.addEventListener("change", () => {
        backend.state.pip[key] = key === "gap" ? Number(node.value) : node.value;
        backend.emitPipDock();
        ctx.applyStageGeometry();
      });
    }
    el.querySelector("#dock").addEventListener("click", () => {
      backend.state.pip.docked = !backend.state.pip.docked;
      backend.emitPipDock();
      ctx.applyStageGeometry();
    });
  }

  function resize(axis, value) {
    const m = view.manifest ?? {};
    let next = value;
    if (view.lockToManifest) {
      if (!m.resizable) {
        // The app cannot produce a different size for a fixed-size manifest, so
        // neither does the harness.
        next = axis === "width" ? (m.width ?? 420) : (m.height ?? 84);
      } else {
        const min = axis === "width" ? (m.min_width ?? 80) : (m.min_height ?? 80);
        const max = axis === "width" ? (m.max_width ?? 2000) : (m.max_height ?? 2000);
        next = Math.max(min, Math.min(max, value));
      }
    }
    view.size[axis] = next;
    ctx.applyStageGeometry();
    render();
  }

  render();

  return { title: "Geometry", el, update: render };
}
