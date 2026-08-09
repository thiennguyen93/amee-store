import type React from "react";
import { useRef, useState } from "react";
import type { AmeeSdk } from "amee-sdk";
import { useNowPlaying, useSpectrum, useVolume } from "./hooks";
import "./App.css";

const SPECTRUM_BARS = 24;

// `onSpectrum` hands you 512 raw FFT magnitudes, and turning those into bars
// that look like music takes three steps. Skipping any of them is the usual
// reason a visualiser looks broken.
//
// 1. **Normalise yourself.** The values are linear and *unbounded* — their
//    ceiling depends on how loud the machine happens to be. `Math.min(1, bin)`
//    therefore pins every bar to full height the moment anything plays. Track
//    a peak and decay it, so the display adapts to a quiet passage instead.
//
// 2. **Space the buckets logarithmically.** Bin *n* covers a fixed slice of Hz,
//    so with 512 bins across ~24 kHz the bottom two octaves — where nearly all
//    the audible energy is — land in the first handful of bins. Map them
//    linearly onto bars and 20 of your 24 bars sit at zero forever.
//
// 3. **Curve the magnitude.** Loudness is perceived roughly logarithmically;
//    a square root is the cheap approximation and is enough to stop quiet
//    detail from vanishing.
function foldSpectrum(bins: number[], bars: number, peak: number): number[] {
  if (bins.length === 0) return new Array(bars).fill(0);

  // Skip bin 0 (DC) and start an octave or so up, where content actually is.
  const lowest = 2;
  const ratio = Math.log(bins.length / lowest);

  return Array.from({ length: bars }, (_, i) => {
    const start = Math.floor(lowest * Math.exp((i / bars) * ratio));
    const end = Math.max(start + 1, Math.floor(lowest * Math.exp(((i + 1) / bars) * ratio)));
    let sum = 0;
    for (let j = start; j < end && j < bins.length; j++) sum += bins[j];
    const mean = sum / (end - start);
    return Math.min(1, Math.sqrt(mean / peak));
  });
}

/// Never let the divisor reach zero during silence.
const MIN_PEAK = 0.001;
/// How fast the tracked peak falls back toward the current level.
const PEAK_DECAY = 0.995;

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

export function App({ amee }: { amee: AmeeSdk }) {
  const nowPlaying = useNowPlaying(amee);
  const volumeState = useVolume(amee);
  const spectrum = useSpectrum(amee);
  const accent = useRef(amee.getToken("--accent") || "#8b7cff").current;

  // Local seek position while the user is actively dragging the bar, so a
  // periodic now-playing tick can't fight the drag and snap it back.
  const [seekPreview, setSeekPreview] = useState<number | null>(null);

  // A ref rather than state: this is updated on every spectrum frame (~30/s)
  // and must not cause a render of its own.
  const peak = useRef(MIN_PEAK);
  peak.current = Math.max(MIN_PEAK, peak.current * PEAK_DECAY, ...spectrum);
  const bars = foldSpectrum(spectrum, SPECTRUM_BARS, peak.current);

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
        {bars.map((value, i) => (
          <div
            key={i}
            className="ybv3__spectrum-bar"
            style={{ height: `${value * 100}%` }}
          />
        ))}
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
