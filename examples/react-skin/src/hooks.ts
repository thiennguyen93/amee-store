import { useEffect, useState } from "react";
import type { NowPlaying, VolumeState, AmeeSDK } from "./amee-sdk";

export function useNowPlaying(amee: AmeeSDK): NowPlaying | null {
  const [nowPlaying, setNowPlaying] = useState(() => amee.getNowPlaying());
  useEffect(() => amee.onNowPlaying(setNowPlaying), [amee]);
  return nowPlaying;
}

export function useVolume(amee: AmeeSDK): VolumeState {
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

export function useSpectrum(amee: AmeeSDK): number[] {
  const [bins, setBins] = useState<number[]>([]);
  useEffect(() => amee.onSpectrum(setBins), [amee]);
  return bins;
}
