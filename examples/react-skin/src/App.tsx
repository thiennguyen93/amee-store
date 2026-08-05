import type React from "react";
import { useRef, useState } from "react";
import type { AmeeSDK } from "./amee-sdk";
import { useNowPlaying, useSpectrum, useVolume } from "./hooks";
import "./App.css";

const SPECTRUM_BARS = 24;

function speakerLabel(muted: boolean, volume: number): string {
  if (muted || volume === 0) return "🔇";
  if (volume < 0.5) return "🔉";
  return "🔊";
}

// Stops a click/drag on an interactive control from also triggering the
// window drag wired to the container's own mousedown (see docs/SKINS.md
// — "interactive controls inside a drag region").
function stopDrag(e: React.MouseEvent) {
  e.stopPropagation();
}

export function App({ amee }: { amee: AmeeSDK }) {
  const nowPlaying = useNowPlaying(amee);
  const volumeState = useVolume(amee);
  const spectrum = useSpectrum(amee);
  const accent = useRef(amee.getToken("--accent") || "#8b7cff").current;

  // Local seek position while the user is actively dragging the bar, so a
  // periodic now-playing tick can't fight the drag and snap it back.
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  const duration = nowPlaying?.duration_seconds ?? 0;
  const elapsed = seekPreview ?? nowPlaying?.elapsed_seconds ?? 0;

  return (
    <div
      className={`ybv3${nowPlaying ? "" : " ybv3--empty"}`}
      style={{ "--accent": accent } as React.CSSProperties}
      data-tauri-drag-region="true"
      onMouseDown={(e) => {
        if (e.buttons === 1) amee.startWindowDrag();
      }}
    >
      <div className="ybv3__spectrum">
        {Array.from({ length: SPECTRUM_BARS }, (_, i) => {
          const bin =
            spectrum[Math.floor((i / SPECTRUM_BARS) * spectrum.length)] ?? 0;
          return (
            <div
              key={i}
              className="ybv3__spectrum-bar"
              style={{ height: `${Math.min(1, bin) * 100}%` }}
            />
          );
        })}
      </div>

      <div className="ybv3__art">
        {nowPlaying?.artwork_data_uri ? (
          <img
            className="ybv3__artwork"
            src={nowPlaying.artwork_data_uri}
            alt=""
          />
        ) : (
          <div className="ybv3__artwork-placeholder" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
        <button
          type="button"
          className="ybv3__play"
          aria-label="Play/Pause"
          onMouseDown={stopDrag}
          onClick={() => amee.togglePlay()}
        >
          {nowPlaying?.playing ? "⏸" : "▶"}
        </button>
      </div>

      <div className="ybv3__body">
        <div className="ybv3__title">
          {nowPlaying
            ? (nowPlaying.title ?? "Unknown title")
            : "Not Playing"}
        </div>
        <div className="ybv3__artist">{nowPlaying?.artist ?? ""}</div>

        <input
          type="range"
          className="ybv3__seek"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(elapsed, duration || 1)}
          disabled={!duration}
          onMouseDown={stopDrag}
          onChange={(e) => setSeekPreview(Number(e.target.value))}
          onPointerUp={(e) => {
            const value = Number((e.target as HTMLInputElement).value);
            amee.seek(value);
            setSeekPreview(null);
          }}
        />

        <div className="ybv3__row" onMouseDown={stopDrag}>
          <button
            type="button"
            className="ybv3__icon-btn"
            aria-label="Previous"
            onClick={() => amee.previous()}
          >
            ⏮
          </button>
          <button
            type="button"
            className="ybv3__icon-btn"
            aria-label="Mute"
            onClick={() => amee.setMuted(!volumeState.muted)}
          >
            {speakerLabel(volumeState.muted, volumeState.volume)}
          </button>
          <input
            type="range"
            className="ybv3__volume"
            min={0}
            max={100}
            step={1}
            value={Math.round(volumeState.volume * 100)}
            disabled={volumeState.muted}
            onChange={(e) => amee.setVolume(Number(e.target.value) / 100)}
          />
          <button
            type="button"
            className="ybv3__icon-btn"
            aria-label="Next"
            onClick={() => amee.next()}
          >
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}
