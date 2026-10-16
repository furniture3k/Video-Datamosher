# Changelog

## 1.4.0

- **New look and logo.** A new mark (a frame melting into blocks, with a play button cut out of it),
  new app icons for the web app and the desktop installers, and a refreshed graphite interface with
  softer corners, rounder controls and an acid-lime accent.
- **A phone editor built for phones**: a big preview, a timeline with the playhead fixed in the
  middle (swipe to scrub, pinch to zoom, handles to trim, hold to move), tools along the bottom that
  change with the selection, and sheets that slide over the timeline. Dialogs are bottom sheets.
- **Sharper preview.** The mosh preview follows the mosh resolution (it used to be a fixed 480 px):
  a Full / 1/2 / 1/4 button under the player, Full in the desktop app and 1/2 in the browser; the edit preview draws the original files
  at screen resolution and only uses the preview copies while scrubbing. Preview copies are sharper.
- **Clearer effect picker**: effects grouped by what you'll see (Melts, Smears, Rhythm, Damage, Colour
  & pixels, Protect), plain-language descriptions, a frame diagram per effect, search, and the nine
  most distinct effects first in Simple mode.
- **Easier start**: a first-run screen with three steps, Import media and Load example. Simple mode
  hides Nudge and the seed; the player's extra controls live under one menu.
- **Feels like an app on desktop**: no accidental text highlighting (the timeline especially), no
  browser right-click menu, and in the desktop app no page zoom, reload or print shortcuts.

## 1.3.0

- **Subject Guard**: keep people (on-device segmentation), a tracked object, bright/dark parts or
  a colour clean while the rest moshes, or the other way round. Presets: Melt the World, Ghost Walker.
- **Flow Paint**: paint push / swirl / pinch / bulge strokes on the player; the picture flows along them.
- **Vector Edit**: rewrites the real motion vectors inside the Xvid frames (amplify, turn, swap,
  drift, jitter, quantise, paint). See `docs/mv-spike.md`.

- **Object tracking** (titles and clips can follow), **stabilization**.
- **Auto captions** with Whisper on the device; clean, bold, karaoke and melting styles; .srt / .vtt.
- **Auto-reframe** on export (the crop follows the action) and **seamless loops** (crossfade or melt).

- **Keyframes** for position, zoom, rotation and opacity, rendered with FFmpeg expressions.
- **Speed ramps** (speed up, slow down, slow-mo, rush, montage), with the sound following.
- **Chroma key** with an eyedropper, softness and spill removal.
- **LUT import** (.cube) with an amount per clip; **adjustment layers**.
- **Compound clips**: fold clips into one, edit inside, mosh inside.
- **Scopes**: waveform, RGB parade, vectorscope, histogram (<kbd>Shift S</kbd>).

- **Frame Sequencer**: a step pattern of Bloom, Echo, Reverse, Melt and Glitch moves (<kbd>G</kbd>).
- **Databend** (compressed bytes) and **Raw Bend** (pixels): echo, reverb, phaser, bitcrush,
  reverse and amplify, the Audacity trick built in.
- **Generations**: mosh the mosh again, up to 8 times, with loss per generation.
- **Bake the mosh into a clip**, to add to the library or replace the timeline with.
- **Motion packs** for Motion Transfer: Drift, Fall, Vortex, Tunnel, Implode, Shake, Ripple, Life.

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
