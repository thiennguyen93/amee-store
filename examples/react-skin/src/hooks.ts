import { useEffect, useState } from "react";
import type { NowPlaying, VolumeState, AmeeSdk } from "amee-sdk";

export function useNowPlaying(amee: AmeeSdk): NowPlaying | null {
  const [nowPlaying, setNowPlaying] = useState(() => amee.getNowPlaying());
  useEffect(() => amee.onNowPlaying(setNowPlaying), [amee]);
  return nowPlaying;
}

export function useVolume(amee: AmeeSdk): VolumeState {
  const [state, setState] = useState<VolumeState>({ volume: 0, muted: false });
  useEffect(() => {
    let cancelled = false;
    Promise.all([amee.getVolume(), amee.getMuted()]).then(([volume, muted]) => {
      if (!cancelled) setState({ volume, muted });
    });
    return () => {
      cancelled = true;
    };
  }, [amee]);
  useEffect(() => amee.onVolumeChange(setState), [amee]);
  return state;
}

export function useSpectrum(amee: AmeeSdk): number[] {
  const [bins, setBins] = useState<number[]>([]);

  useEffect(() => amee.onSpectrum(setBins), [amee]);

  // Subscribing is not enough. The system-audio tap needs a recording
  // permission, so Amee only starts it when a skin asks — until then
  // `onSpectrum` is subscribed and silent. Stop it on unmount so the tap isn't
  // left running for a skin that is no longer on screen.
  useEffect(() => {
    amee.startVisualizer().catch(() => {
      // Refused, or unavailable. The bars simply stay flat; nothing else in
      // the skin depends on it.
    });
    return () => {
      amee.stopVisualizer().catch(() => {});
    };
  }, [amee]);

  return bins;
}
