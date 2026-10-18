# Changelog

## 1.13.0

- **Tracking that holds on**: Track an object follows things through zooms, moves, turns and
  stabilization, keeps going when the object is hidden for a moment, jitters less, and is several
  times faster. The tracked box shows on the player, and it never freezes the editor while it works.
- **Subject Guard on a tracked object**: the clean oval fits the box you tracked (Oval size makes it
  bigger or smaller), the guard always runs after the other effects, and it picks up your newest
  track by itself. Its settings can start a track straight away.
- **Track and Stabilize on phones**: both are in the bottom tools when a video clip is selected.
- **A smoother preview**: colour correction, green screen and LUTs are worked out on the graphics
  card, playback does less work every frame, and Stabilize and Pixel Sort are faster.

## 1.12.0

- **Your own layout**: drag the edge between a side panel and the player to make it wider or
  narrower, or fold it away with its arrow. **⋯ → Layout** switches between **Edit**, **Mosh** and
  **Big player**, and **+** saves the layout you have.
- **In your language**: the home screen, the top bar, its menu and the effect names in Spanish,
  Portuguese (Brazil), French, German and Japanese, picked from your browser's language or on the
  home screen. These are drafts: corrections are very welcome (see CONTRIBUTING.md).
- **Easier to read and to use with a keyboard**: dim text is brighter, dialogs keep the keyboard
  inside them and give it back when they close, every control shows where the focus is, and
  animations stop if your system asks for less motion.
- **An Android app (experimental)**: an APK is attached to each release. It hasn't been tried on
  many phones yet; the installable web app is still the safer choice on Android.

## 1.11.0

- **H.264 moshing (experimental)**: Encode → Mosh codec → H.264. The codec of most videos today,
  for smoother, finer smears with fewer blocks. Every effect works with it except Vector Edit
  (that one is Xvid only).
- **MIDI controllers**: right-click any effect setting and move a knob, fader or pad: it moves that
  setting from then on, in the editor and in Live mode. Right-click again to let go. Works in Chrome
  and Edge; the mappings are saved with the project.
- **OSC in the desktop app**: Help → MIDI and OSC controllers → Listen, then send numbers from
  TouchOSC, Max, Pure Data or a phone on the same network.
- **Script**: an effect you write in JavaScript. It gets the frames under its bar and returns them
  in any order, repeated, left out or damaged. It runs in a sandbox with no network and no access to
  your files, with a time limit. Code that comes with a recipe or project from someone else is shown
  and only runs once you allow it. Four examples to start from.

## 1.10.0

- **Mosh Maps**: Subject Guard can follow a map instead of a subject, and grey parts mosh half way:
  a **gradient** (linear or radial; automate its centre to sweep the mosh across), a map you
  **paint** on the player, a **picture or video** from the project (white stays clean, black
  moshes), or the **depth** of the scene (near stays clean), from a small model that runs on your
  device and is downloaded once.
- **Retro looks**: **VHS** (wobbling lines, a rolling tracking band, bleeding colour, tape noise),
  **CRT** (curved glass, scanlines, glowing stripes), **Film Grain** (with a faded-print look) and
  **Posterise** (a few colours with a retro dither, and chunky pixels).
- **Titles can come in animated**: typewriter, glitch in, slide up or pop (Clip tab → **Comes in**).
- **Recipe files**: **⋯ → Save recipe file** keeps a mosh (its effects and settings, no footage) as
  a `.moshrecipe` file to use on other videos or share. Open one, or drop it on the app, to put it on
  the open project.
- **Batch**: **⋯ → Batch** puts the same mosh on many videos at once and exports them all through
  the export queue, each fitted to its own length.

## 1.9.0

- **Faster exports in the browser.** MP4 and WebM are encoded with your device's own video encoder
  (WebCodecs) where the browser has one: several times faster than before, and WebM gets VP9.
  **Hardware encoding** in Export turns it off.
- **The video engine uses several threads** in Chrome, Edge and Firefox (up to 4 of your
  processor's cores), so renders and the built-in encoders run about twice as fast. It turns
  itself back to one thread if it ever crashes; **Encode → Use 4 threads** turns it off.
- **Export queue**: **Add to queue** in Export renders in the background while you keep editing,
  one export after another, and tells you when each is ready (with a notification if the tab is in
  the background).
- **Preview copies of big videos are made with the browser's own decoders and encoders** where it
  can, so large clips are ready to scrub much sooner. Clips with one show a **proxy** tag.
- **Media is kept in the browser's file system** (where it has one) instead of its database: big
  imports save faster and are read straight from disk. Files from older versions move over by
  themselves.
- The desktop app's installer is ~60 MB smaller: it no longer carries the browser's video engines.

## 1.8.0

- **Find a command** (Ctrl P, ⌘ P on a Mac, or ⋯ → Find a command): type a few letters of anything
  the editor can do, any effect or any preset, and press Enter. What you used lately comes first.
- **Your own shortcuts.** Help lists every command with its keys. Click one and press new keys to
  change it (it moves off any command that had them). **Print** makes a cheat sheet, and
  **Defaults** puts everything back.
- **History** (⋯ → History, or Ctrl Alt Z): every step undo can take you back through, with a name
  for what changed ("Add Bloom", "Trim beach", "Melt on a cut"). Click one to jump there.
- **Favourite effects**: star an effect in the picker and it's always at the top.
- **Saved settings per effect**: **Saved…** on an effect keeps its settings under a name, for any
  effect of that kind later.
- **See an effect on your own footage before adding it**: with **Preview on my footage** on, rest the
  pointer on an effect in the picker (timelines up to 30 s).
- **Render progress on the timeline**, with how long is left, there and under the player.
- **Simple mode is simpler**: automation, the Trim and Blade tool buttons, scopes and compound clips
  are in Advanced (their keys still work).

## 1.7.0

- **A website.** The site's address now opens a landing page: what moshpit does, a before/after
  slider of the same clips moshed and not, a gallery, downloads and questions. The editor moved to
  `/app/`. Installed apps and old links keep opening the editor, and your projects are still there.
- **The right download for your computer.** The landing page offers the installer for your system
  (Apple Silicon or Intel on a Mac), with every file listed per system.
- **Docs**: getting started, what datamoshing is, every effect and its settings, transitions,
  exporting and sharing, keyboard shortcuts, the desktop app and questions. The effects,
  transitions and shortcuts pages are made from the app itself, so they're always current.
- **Gallery**: moshes made with moshpit, each with an **Open this recipe** link that opens the same
  mosh in the editor. **Share it in the gallery** after an export starts a post with your recipe
  filled in.

## 1.6.0

- **A home screen.** moshpit opens on your projects, templates and examples instead of dropping you
  into the editor. The logo (or ☰ → All projects on a phone) takes you back. Prefer the old way?
  Tick **Open my last project on start** at the bottom of the home screen.
- **As many projects as you like.** Each one is saved on its own with a picture of where you left
  off. Rename, duplicate or delete them from the home screen. **New project** no longer clears
  anything: the one you had stays in the list. Your existing project and its snapshots move over
  by themselves. Snapshots now belong to their project.
- **Templates**: Melt transitions, Beat-synced melt, Vertical loop (9:16), Bloom drop, Glitch intro,
  Motion swap, VHS memory and Vortex. Pick your clips (and a song for the beat one) and the mosh is
  set up for you, or try one with sample footage first.
- **Examples** made from generated footage, so there's nothing to import: open one and take it apart.
- **Your first mosh happens by itself.** Clips imported into an empty project get melts on the cuts
  (a single clip gets a Bloom), so there's something to see straight away. One Undo takes it off,
  and it can be turned off on the home screen.
- **A quick tour** of the editor the first time you open it (Help → Take the tour again).

## 1.5.0

- **Loading screen.** The logo melts while moshpit starts, and the video engine shows how much of
  it has downloaded (Loading video engine 12 / 31 MB) instead of just "loading".
- **Open with moshpit.** Installed as a web app (Chrome, Edge), moshpit appears in the system's
  Open with menu for videos, GIFs and sound. The desktop app opens files it's given, and a second
  launch hands its files to the window that's already open.
- **Share to moshpit** from the gallery or another app on Android, and **Share…** an export straight
  from the export dialog on phones and tablets.
- **Save dialog in the browser** (Chrome, Edge): Save project asks where to put the file, and Ctrl S
  saves to the same file again. **Save project as…** and **Save as…** for exports.
- **What's new** after an update (this list), and in the menu.
- **Report a problem** in the menu (and on render or export errors) opens a GitHub bug report with
  the app version, browser and the engine's last messages filled in. No media or file names.
- **Storage**: see how much space your media, preview copies and snapshots take, protect your files
  from the browser's automatic clean-up, and delete automatic snapshots or unused media.
- **Crash recovery.** If moshpit closes in the middle of a render or export (usually out of memory),
  it starts with auto-render paused and says so, instead of crashing again on the same mosh.
- **Vibration** on Android phones when you pick up, trim or split a clip (Settings → Vibration).
- Shared links show a preview card with the logo and a melting frame.
- Fixed: the mosh preview could throw an error when switching between the phone and desktop layouts.

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
