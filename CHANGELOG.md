# Changelog

## Unreleased

- **Audio-reactive automation**: any setting can follow the bass, mids, highs, loudness, hits or
  beats of the music, with attack, release and threshold.
- **Beat triggers**: Bloom, Stutter Loop, Frame Drop and Byte Glitch can fire on beats, bars or hits.
- **Beat detection** (tempo, beats, downbeats, onsets) runs locally; BPM readout, beat grid on the
  ruler and snapping to beats.
- **Auto-edit to the beat**: cuts clips to the music with melts on bars and blooms on drops.

- **Chaos dial**: one knob that pushes every effect calmer or wilder (<kbd>Q</kbd> / <kbd>Shift Q</kbd>).
- **Breed variations**: pick favourites in Variations and breed them, generation after generation.
- **Snapshots**: named versions you can restore or A/B against the current mosh; automatic ones
  before anything replaces your stack.
- **Recipes inside exports**: videos, GIFs and PNG zips carry their mosh recipe, and dropping
  one into moshpit offers to apply it.
- **Made for** export presets (TikTok / Reels / Shorts, Instagram, YouTube, X, Discord, GIF) with
  size targets, length and shape warnings, and safe-zone guides.

## 1.2.0

- **Timeline and playhead in sync.** Effects keep their length by default, so output frame N is
  timeline frame N: scrubbing, playback, the sound and the orange playhead always match. Live
  scrubbing uses the fast preview copies.
- **Bloom fills its bar.** Drag a Bloom longer and it blooms for longer (or pick fixed repeats).
  Stutter can loop all the way through its bar. Every repeating effect has a Timing setting
  (Keep length / Stretch).
- **Mosh transitions fixed.** They now last exactly their Length and resolve cleanly into the
  next shot; two new ones (Ghost melt, Rewind melt).
- **Descriptions under every setting**, including what each option of a menu does.
- **Editing like an NLE:** video tracks above the main one with opacity and blend modes;
  transform, crop, colour and picture fades per clip; freeze frames; Select / Trim (roll, slip) /
  Blade tools; box select; ripple delete; clips on/off; colour labels; locked and hidden tracks;
  markers; In / Out marks (loop and export range); Insert / Overwrite / Place on top / Append;
  J/K/L shuttle; typed timecode; Resolve-style shortcuts.
- Projects from earlier versions open with their effects looking exactly as before.

## 1.1.0

- **Desktop app** for Windows, macOS (Apple Silicon and Intel) and Linux, with native FFmpeg:
  much faster preparing and exporting, practical 1440p/4K, output up to 30 minutes (the
  browser stays at 10 minutes), native Save dialog.
- **Installable web app**: add moshpit to your home screen or install it from Chrome/Edge; it
  works offline.
- Licensed under GPL-3.0-or-later; third-party notices added.

## 1.0.0

- Video editor with a built-in datamosher: multi-track timeline, mosh and classic transitions,
  titles, audio tracks, bitstream and picture effects, presets, exports up to 4K.
