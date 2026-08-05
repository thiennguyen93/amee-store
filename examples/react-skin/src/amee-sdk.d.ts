// Type definitions for the `window.amee` SDK a skin is handed at
// mount() time. Mirrors the table in docs/SKINS.md exactly — keep the
// two in sync if the SDK contract ever bumps its `version`.

export interface NowPlaying {
  title: string | null;
  artist: string | null;
  album: string | null;
  artwork_data_uri: string | null;
  playing: boolean;
  elapsed_seconds: number | null;
  duration_seconds: number | null;
  bundle_identifier: string | null;
}

export interface VolumeState {
  volume: number;
  muted: boolean;
}

export type OutputDeviceKind = "builtin" | "usb" | "bluetooth" | "bluetoothLE" | "airplay" | "hdmi" | "other";

export interface OutputDevice {
  id: string;
  name: string;
  kind: OutputDeviceKind;
  is_default: boolean;
}

export interface FlyoutResult {
  direction: "up" | "down";
  extra: number;
}

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
}

export interface AmeeSDK {
  version: string;
  getNowPlaying(): NowPlaying | null;
  onNowPlaying(cb: (np: NowPlaying | null) => void): () => void;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(seconds: number): Promise<void>;
  openNowPlayingApp(): Promise<void>;
  /**
   * Like `openNowPlayingApp()`, but toggles: if the now-playing app is
   * already frontmost, jumps back to whatever app the user was in right
   * before it was opened. Otherwise remembers the current frontmost app
   * and opens the now-playing app. If the user manually switches to some
   * other app in between, the next call just opens the now-playing app
   * again — the previously remembered app is forgotten.
   */
  toggleNowPlayingApp(): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(v: number): Promise<void>;
  getMuted(): Promise<boolean>;
  setMuted(v: boolean): Promise<void>;
  onVolumeChange(cb: (state: VolumeState) => void): () => void;
  getOutputDevices(): Promise<OutputDevice[]>;
  setOutputDevice(id: string): Promise<void>;
  onOutputDevicesChange(cb: (devices: OutputDevice[]) => void): () => void;
  attachAirPlayButton(element: Element): () => void;
  onSpectrum(cb: (bins: number[]) => void): () => void;
  getToken(name: string): string;
  startWindowDrag(): void;
  activateWindow(): Promise<void>;
  openSettings(): Promise<void>;
  checkForUpdate(): Promise<UpdateCheckResult>;
  hide(): Promise<void>;
  isFnKeyHeld(): Promise<boolean>;
  onFnKeyChange(cb: (held: boolean) => void): () => void;
  onHide(cb: () => void | Promise<void>): () => void;
  getSkinAsset(path: string): Promise<string>;
  expandWindowFlyout(extraLogicalPx: number): Promise<FlyoutResult>;
  collapseWindowFlyout(): Promise<void>;
  reportContentExtent(extraAbove: number, extraBelow: number): Promise<void>;
  onPointerMove(cb: (position: { x: number; y: number } | null) => void): () => void;
  trackHover(
    element: Element,
    options?: { className?: string; onEnter?: () => void; onLeave?: () => void },
  ): () => void;
  getDominantColors(count?: number): Promise<string[]>;
}

declare global {
  interface Window {
    amee: AmeeSDK;
  }
}
