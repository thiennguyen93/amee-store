// The fake library. Six tracks, chosen to break layouts rather than to look
// good in a screenshot.
//
// The in-app skin preview substitutes one tidy demo track — a short ASCII
// title, a short artist, a sane duration — and that is the single state every
// skin is already known to handle. Everything below is a state a real user
// reaches within a day and most skins have never been rendered in.
//
// `patch` picks the synth voices used while a track is playing (see audio.js),
// so switching tracks audibly and visibly changes the spectrum instead of
// looping one texture.

import { renderCover } from "./artwork.js";

/// Built lazily: rendering six 512x512 canvases costs a few hundred
/// milliseconds and a couple of megabytes of data URI, and the harness should
/// paint before paying for it.
let cache = null;

export function getPlaylist() {
  if (cache) return cache;

  cache = [
    {
      title: "Neon Arcade",
      artist: "Kite Machine",
      album: "Halfmoon",
      artwork: renderCover({
        seed: 11,
        gradient: ["#3a1c71", "#ff5f9e"],
        mark: "#ffe066",
        shape: "circle",
      }),
      duration_seconds: 214,
      source: "media_remote",
      bundle_identifier: "com.apple.Music",
      url: null,
      artwork_url: null,
      picture_in_picture: false,
      tab_id: null,
      seekable: true,
      patch: "arcade",
      /// What this track is here to test, shown next to it in the inspector so
      /// the list reads as a checklist rather than as decoration.
      stresses: "The happy path — everything populated, nothing extreme.",
    },
    {
      // Long, non-Latin, and full of the bracketed suffixes streaming services
      // actually ship. Exercises marquee/ellipsis logic, CJK line metrics
      // (which are taller than Latin at the same font-size), and any layout
      // that assumed a title fits.
      title:
        "月光ソナタ 第3楽章 — Presto agitato (Remastered 2024 · Deluxe Anniversary Edition) [feat. とても長いアーティスト名]",
      artist: "オーケストラ・ノクターン・アンサンブル・フィルハーモニー",
      album: null,
      artwork: renderCover({
        seed: 23,
        gradient: ["#0f2027", "#2c5364"],
        mark: "#8ec5fc",
        shape: "rings",
      }),
      duration_seconds: 428,
      source: "media_remote",
      bundle_identifier: "com.spotify.client",
      url: null,
      artwork_url: null,
      picture_in_picture: false,
      tab_id: null,
      seekable: true,
      patch: "nocturne",
      stresses: "Very long CJK title and artist, no album. Marquee, ellipsis, line metrics.",
    },
    {
      // The sparse case. Plenty of skins render an empty row, a stray
      // separator, or the literal string "null" here.
      title: "Untitled",
      artist: null,
      album: null,
      artwork: null,
      duration_seconds: 96,
      source: "media_remote",
      bundle_identifier: null,
      url: null,
      artwork_url: null,
      picture_in_picture: false,
      tab_id: null,
      seekable: true,
      patch: "sparse",
      stresses:
        "No artist, no album, no artwork, no bundle id. openNowPlayingApp() must reject.",
    },
    {
      // Ninety minutes. Time formatting has to grow a third part, and one
      // second of progress is a fraction of a pixel on a 320px-wide bar.
      title: "Bhairavi (Live at Sawai Gandharva)",
      artist: "Anjali Raut",
      album: "Morning Ragas",
      artwork: renderCover({
        seed: 37,
        gradient: ["#232526", "#414345"],
        mark: "#5b5f63",
        shape: "triangle",
        // Near-monochrome on purpose: getDominantColors() returns a set of
        // barely-distinguishable greys, which is exactly what it does on a real
        // muted cover. A skin that tints its whole UI from colour[0] should see
        // that here rather than after shipping.
        grain: 0.03,
      }),
      duration_seconds: 5412,
      source: "media_remote",
      bundle_identifier: "com.apple.Music",
      url: null,
      artwork_url: null,
      picture_in_picture: false,
      tab_id: null,
      seekable: true,
      patch: "raga",
      stresses: "1:30:12 — three-part time formatting, sub-pixel progress, monochrome artwork.",
    },
    {
      // A live stream, from the browser extension. No duration at all, elapsed
      // counts up forever, and the player refuses seeks — so a drag holds for
      // SEEK_HOLD_MS and then snaps back, which is the behaviour nothing else
      // can reproduce.
      title: "KEXP 90.3 FM — Live Stream",
      artist: "KEXP",
      album: null,
      artwork: renderCover({
        seed: 53,
        gradient: ["#141e30", "#243b55"],
        mark: "#ff8a5c",
        shape: "bars",
      }),
      duration_seconds: null,
      source: "extension",
      bundle_identifier: "com.google.Chrome",
      url: "https://kexp.org/listen/",
      artwork_url: "https://example.invalid/kexp.png",
      picture_in_picture: false,
      tab_id: 42,
      seekable: false,
      patch: "broadcast",
      stresses: "No duration, seeks refused, extension source. focusNowPlayingTab() works.",
    },
    {
      // The Picture-in-Picture surface: docking, exitPictureInPicture, and the
      // case where both artwork_url and artwork_data_uri are set.
      title: "Deep Focus",
      artist: "Låpsley",
      album: "Through Water",
      artwork: renderCover({
        seed: 71,
        gradient: ["#1f4037", "#99f2c8"],
        mark: "#0b2b23",
        shape: "circle",
      }),
      duration_seconds: 268,
      source: "extension",
      bundle_identifier: "com.google.Chrome",
      url: "https://www.youtube.com/watch?v=example",
      artwork_url: "https://example.invalid/deep-focus.jpg",
      picture_in_picture: true,
      tab_id: 7,
      seekable: true,
      patch: "focus",
      stresses: "Picture-in-Picture open — docking, exitPictureInPicture(), both artwork fields.",
    },
  ];

  return cache;
}

/// Turns a playlist entry into the exact NowPlaying shape the SDK reports.
/// `elapsed` comes from the transport clock, not from the track.
export function toNowPlaying(track, { elapsed, playing }) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork_data_uri: track.artwork,
    playing,
    elapsed_seconds: elapsed,
    duration_seconds: track.duration_seconds,
    bundle_identifier: track.bundle_identifier,
    source: track.source,
    url: track.url,
    artwork_url: track.artwork_url,
    picture_in_picture: track.picture_in_picture,
    tab_id: track.tab_id,
  };
}
