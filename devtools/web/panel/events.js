// Firing the events a skin can only otherwise wait for.
//
// Several of these have never been testable outside the running app at all:
// graceful shutdown only happens when you quit Amee, the hide sequence only
// when the pill auto-hides, and "another app became frontmost" only when you
// click away at the right moment. A skin that mishandles any of them looks
// perfect until a user hits it.

export function createEventsPanel(ctx) {
  const el = document.createElement("div");
  const { backend } = ctx;

  const GROUPS = [
    {
      title: "Window lifecycle",
      note:
        "quit() runs the real fan-out: every onShutdown callback wrapped so one throwing can't " +
        "skip the rest, raced against the manifest's graceful_shutdown_timeout_ms. hide() runs " +
        "the onHide callbacks and then the two requestAnimationFrames the app waits for, so " +
        "whatever you changed has genuinely painted before the window would go.",
      buttons: [
        ["Show", () => backend.emitShow()],
        ["Hide (real sequence)", () => ctx.host.hide()],
        ["Quit (real sequence)", () => ctx.host.quit()],
      ],
    },
    {
      title: "Focus",
      note:
        "Amee reports focus false from three places: another app became frontmost, a press " +
        "landed outside the pill, and the window itself blurred. Popovers that never close are " +
        "almost always a skin handling one of the three and not the others. (Clicking anywhere " +
        "in this harness outside the stage already fires the press-outside path.)",
      buttons: [
        ["focused", () => backend.setFocused(true)],
        ["another app frontmost", () => backend.setFocused(false)],
        ["press outside", () => backend.setFocused(false)],
      ],
    },
    {
      title: "Fn key",
      note:
        "macOS-only, and it simply never fires elsewhere. A browser can't see the real Fn key, " +
        "so these stand in for it.",
      buttons: [
        ["Fn down", () => backend.setFnHeld(true)],
        ["Fn up", () => backend.setFnHeld(false)],
      ],
    },
    {
      title: "Output devices",
      note:
        "onOutputDevicesChange fires whenever something is plugged, unplugged or made default. " +
        "Unplugging the current default is the interesting one: a skin showing a device name has " +
        "to notice.",
      buttons: [
        [
          "unplug AirPods",
          () => {
            backend.state.devices = backend.state.devices.filter((d) => d.id !== "airpods");
            backend.emitDevices();
          },
        ],
        [
          "plug in AirPods",
          () => {
            if (!backend.state.devices.some((d) => d.id === "airpods")) {
              backend.state.devices.push({
                id: "airpods",
                name: "AirPods Pro",
                kind: "bluetooth",
                is_default: false,
              });
            }
            backend.emitDevices();
          },
        ],
        [
          "make AirPlay default",
          () => backend.setOutputDevice("livingroom"),
        ],
      ],
    },
    {
      title: "Picture-in-Picture",
      note:
        "availability reports your docking switch ahead of a missing prerequisite, which is why " +
        "browser_signal exists separately and is never \"disabled\". onPipDockChange also fires " +
        "once on subscribe — Amee's own in-app preview gets that wrong, so a skin gating a " +
        "button's existence on availability renders differently there.",
      buttons: [
        [
          "toggle docking switch",
          () => {
            backend.state.pip.enabled = !backend.state.pip.enabled;
            backend.emitPipDock();
          },
        ],
        [
          "PiP opened",
          () => {
            backend.state.pip.pipOpen = true;
            backend.emitPipDock();
            ctx.applyStageGeometry();
          },
        ],
        [
          "PiP closed",
          () => {
            backend.state.pip.pipOpen = false;
            backend.state.pip.docked = false;
            backend.emitPipDock();
            ctx.applyStageGeometry();
          },
        ],
        [
          "snapping",
          () => {
            backend.state.pip.snapping = !backend.state.pip.snapping;
            backend.emitPipDock();
          },
        ],
      ],
    },
    {
      title: "Update check",
      note: "checkForUpdate() has a rejection path most skins never render.",
      buttons: [
        [
          "no update",
          () => {
            backend.state.updateShouldReject = false;
            backend.state.updateResult = {
              available: false,
              currentVersion: "1.17.0",
              latestVersion: null,
              notes: null,
            };
          },
        ],
        [
          "update available",
          () => {
            backend.state.updateShouldReject = false;
            backend.state.updateResult = {
              available: true,
              currentVersion: "1.17.0",
              latestVersion: "1.18.0",
              notes: "Bug fixes and a new visualizer mode.",
            };
          },
        ],
        [
          "offline (rejects)",
          () => {
            backend.state.updateShouldReject = true;
          },
        ],
      ],
    },
    {
      title: "External writes",
      note:
        "Changes that did not come from the skin. A skin that only updates its own UI in " +
        "response to its own calls is broken here and in the app.",
      buttons: [
        ["volume → 20%", () => backend.setVolume(0.2)],
        ["volume → 90%", () => backend.setVolume(0.9)],
        ["toggle mute", () => backend.setMuted(!backend.state.muted)],
        [
          "external storage write",
          () => backend.storageSet("externalPing", Date.now()),
        ],
      ],
    },
  ];

  for (const group of GROUPS) {
    const heading = document.createElement("h2");
    heading.textContent = group.title;
    el.appendChild(heading);

    const row = document.createElement("div");
    row.className = "amee-dev__grid";
    for (const [label, action] of group.buttons) {
      const button = document.createElement("button");
      button.textContent = label;
      button.addEventListener("click", () => {
        action();
        ctx.refresh();
      });
      row.appendChild(button);
    }
    el.appendChild(row);

    const note = document.createElement("p");
    note.textContent = group.note;
    el.appendChild(note);
  }

  return { title: "Events", el };
}
