# Changelog

## 1.16.4

- **Linux behind a proxy**: with an HTTPS proxy set (common at work and school), downloads in the
  app (fonts, the cut-out and caption models) crashed its network process in the AppImage and on
  Ubuntu 22.04. The app now hands the proxy to the webview itself, which avoids it.
- **Template previews on Linux** play again on Ubuntu 22.04, Debian 12 and other systems with an
  older WebKitGTK (they showed still pictures, or nothing in the template and look dialogs).
- **The AppImage** leaves out a GStreamer plugin that could stop the page when loaded next to
  WebKit's own network library.
- **Starts without the internet**: the interface font is part of the app instead of being
  downloaded from Google Fonts at every start.
- **Every installer is tested before a release**: the release workflow installs each one on Windows,
  macOS (Apple Silicon and Intel) and seven Linux systems and checks the editor, sound, video,
  FFmpeg and downloads work, and only publishes the release when all of them pass.

## 1.16.3

- **Linux AppImage no longer crashes**: it shipped GStreamer without its plugins, so on most
  distributions (anything but Ubuntu 22.04) it picked up the system's plugins, built for another
  GStreamer, and the editor crashed as soon as it set up sound. The AppImage now carries its own
  plugins. The `.deb` also asks for the GStreamer plugins it needs.
- **NVIDIA on Linux**: with NVIDIA's own driver the window no longer comes up blank or crashes
  (the app turns off WebKitGTK's DMA-BUF renderer there).

## 1.16.2

- **Closing the desktop app saves your last edit**: an edit made just before closing the window was
  lost; the app now saves before it closes.
- **Desktop exports**: queued and batch exports no longer overwrite each other, cancelling a job just
  before it starts stops it, and quitting stops FFmpeg instead of leaving it running.
- **Exporting part of the timeline** keeps the sound in sync with the picture.
- **Songs with album art** (MP3, M4A) are treated as sound, not as a video.
- **Newly imported media** is no longer deleted by the clean-up that runs when the app starts.
- **Files opened from your computer or shared to the app** are recognised even when they arrive
  without a file type.
- **Beat tools** used before the beat was found now find it first instead of doing nothing.
- **Titles** go on a free row, **paste** brings back a deleted track, and the **phone timeline**
  respects locked tracks.
- **Smaller fixes**: Enter on a focused Cancel no longer confirms, effects can be dragged into a new
  order in Firefox, adding from the right-click menu is one undo step, and shortcut hints match your
  computer.
- **Faster start**: about a third less JavaScript to load when the editor opens.

## 1.16.1

- **Drawn sample footage on older iPhones and Macs**: the city lights, sunset, night drive and dancer
  are drawn on an ordinary canvas, so templates, examples and **Generate** work on Safari before 16.4
  too (it has no OffscreenCanvas).
- **Load example** in an empty project uses the drawn footage instead of the test pattern.
- **The player's frame label** (frame number, type and what happened to it) no longer runs under the
  play buttons when the player is narrow; the description is left out when there's no room for it.
- **The website and docs** describe sizes for Reels, TikTok and Shorts, 4K vertical, 60 fps, colours,
  HDR and the beat tools, with new screenshots, demo and videos.

## 1.16.0

- **Hits on the beat**: **Zoom punch** (Z) and **Shake** (H) (Clip tab › On the
  beat, the phone's clip tools, or the palette) jump the picture in, or knock it sideways, on every
  beat or every bar of the music and ease it back before the next one, on the selected clips of the
  main track or all of them. **Hit strength** sets how hard. They are keyframes, so they can be
  changed after, and they melt with the mosh like any other move.
- **Motion blur**: clips with keyframed moves (punches, shakes, slides, zooms) can blur along them
  like a camera's shutter (Clip tab › Motion blur), and whip transitions now smear sideways through
  their middle.
- **Velocity edits**: Speed ramp › **On the beat** (or Shift V) slows a clip on
  each beat and rushes it between, keeping its length on the timeline.
- **Colours come out as they went in**: footage, titles, pictures and canvases kept their colours
  only roughly before (a strong red was 11–16 levels off in the preview and in exports). Every step
  now names its colour matrix, each clip is read the way it was recorded, and MP4 and WebM files say
  they are BT.709, so phones and Instagram show them as you saw them.
- **HDR footage looks right**: iPhone HDR (HLG) and HDR10 clips are tone-mapped to normal range in the
  render, the preview copies and the thumbnails, instead of looking grey and washed out.
- **60 fps exports**: Export › **Frame rate** makes 30, 50 or 60 fps from a 24 fps project, the frames
  in between blended from their neighbours.
- **Full quality 4K**: Export › **Full quality: mosh at this size** moshes at the size that's saved
  instead of scaling a smaller mosh up.
- **Draft preview on phones**: the phone player has the preview-quality button, and phones start on
  **Draft** (a quarter of the resolution: much faster; exports are still full quality).
- **4K for vertical video**: export sizes are named by what they make in the project's shape, so on
  a 9:16 project **4K UHD** is 2160×3840 and **1080p** is 1080×1920 (they used to be widths: "4K"
  made a 3840×6826 file). **Made for** has **TikTok · Shorts 4K**. The export dialog shows the real
  size when the video is reframed to another shape. The mosh resolution is named the same way.
- **Vertical projects render faster**: a tall or square project keeps the mosh resolution's class
  when its shape is set (a 9:16 project moshes at 720×1280, not 1280×2276: three times the pixels),
  from the first clip, the Aspect ratio setting, **Make it 9:16** and the templates.
- **Titles stay in the frame**: a title whose line would run off the sides is made smaller to fit,
  which mattered most on narrow 9:16 frames (the Degraded film template's lyric ran off both edges).
  **Width** in the title's settings has **Fit to the frame width** as before and **Let it run off the
  edges** for the old behaviour. Tickers and repeated copies are left as they are.
- **Keyframes on the desktop**: clips with many zoom or position keyframes no longer fail to render in
  the desktop app (their filter graphs were longer than a command line may be, 32 767 characters on
  Windows); long graphs are now handed to FFmpeg in a file.
- **Better-looking templates**: the sample footage is drawn like camera footage (city lights, a sunset
  over water, a night drive, a dancer; also in **Generate**) instead of test patterns, **Scrapbook** has a handwritten caption above the card (your own words) instead of copies of
  a serif word piling onto each other, and **Glitch intro** has its own preview.

## 1.15.0

- **Make a video like this**: five templates made from edits people post, at the top of the home
  screen with previews of what you get. **Behind the subject** cuts the subject out of each clip by
  itself and puts handwritten words and drawn rings between it and the background. **Kinetic
  lyrics** slams your words in one per beat. **Pop-up collage** pops your clips up on the beat as
  white-bordered cards that leave stepped copies behind. **Tour poster** frames them on off-white
  paper with blue type that types itself in. **Red notes** finds things in your footage, follows
  them, and boxes, arrows and labels them, one more on every beat.
- **Your words, first**: templates with titles ask for your words before they are made.
- **Templates in the editor**: the new **Templates** button (and the phone's tool row) puts any of them
  on the clips already on your timeline. The whole template is one undo step, in the editor and from
  the home screen.
- **Sample footage, then yours**: after trying a template with sample footage, **Use my clips** on
  the note makes it again with your own (it used to say to drop them in, which only added them).
- **Easier to find**: a tip on the player says it has a right-click (or hold) menu for titles, boxes,
  arrows and cut-outs, with an **Add…** button; the first-run tour shows Templates and that menu, and
  the empty editor mentions Templates. The add-here menu no longer runs off the bottom of a short player.
- **Bold titles on phones**: titles in the Impact style fall back to a condensed black typeface on
  iPhones and Android phones (which have no Impact) instead of a thin one.
- **Your projects are safer**: if the browser fails to read the project list, saving no longer
  writes a list with only the open project in it, and the start-up clean-up no longer takes such a
  failure as "nothing to keep" (which could have deleted other projects' media). Snapshots that
  can't be read are no longer written over. Changes are saved straight away when you switch apps
  or close the tab, not a second later.
- **Less memory over a long session**: the decoded sound, cut-outs, tracking frames, preview videos
  and pictures of projects you have left are let go; preview copies and cut-outs no longer stay in
  memory once they are saved; the undo history keeps to a memory budget; phones and tablets keep
  smaller caches of decoded frames.
- **Smoother playback**: the live preview draws from a plain copy of the project that is made
  again only when something changes (several times less work every frame), and the project's
  picture on the home screen is only saved when it has changed.

## 1.14.1

- **Smoother playback with lots of titles**: titles and shapes that aren't on screen no longer cost
  anything while the video plays, and each title is laid out once instead of on every frame, so
  caption-heavy edits and tilted or pinned titles play and export faster.
- **Faster exports with titles**: frames without a title on them are passed straight through instead
  of being decoded and encoded again.
- **The canvas updates the mosh**: changing only the backdrop, card or border now renders the mosh
  again (before, the mosh view kept showing the old canvas), and Compare shows the new canvas too.
- **Long sessions stay smooth**: the live preview lets go of videos it hasn't shown for a while, so
  cutting and copying many clips on the upper tracks no longer runs into the browser's limit on
  playing videos.
- **Small laptop screens**: on a screen smaller than the desktop app's smallest window (a 1366×768
  laptop at 150% scaling, say), the window now shrinks to fit, so nothing hides behind the taskbar.

## 1.14.0

- **Titles and type**: titles live on their own rows above the video. Pick a whole style in one
  click, use any Google Font or a font file of your own, curve or tilt them, and drop words or lines
  onto the beat with **Words on the beat**.
- **Shapes, stickers and marks**: boxes, circles, arrows, a pen, callouts, emoji, particles and
  stickers that follow faces or a tracked object. Group them so they move together.
- **Handles on the player**: drag, scale and turn titles, shapes and clips right on the picture, or
  right-click it (long-press on a phone) to add something exactly there.
- **Cut out any subject**: tap it on the player and it is followed through the clip, so titles, shapes
  and other clips can go behind it.
- **Pin to a surface**: track a screen, a sign or a wall and put a title or a whole clip onto it.
- **Collage and canvas**: split screens, cards with borders and captions, shaped masks, device
  mockups, blurred or image backdrops, and clips that pop in or swap places on the beat.
- **Looks, blends and transitions**: film and print looks, step print, blend modes, a luma key, whip
  pans, zooms, wipes, flashes on the beat and flipbooks.
- **Steal this edit**: give it a video you like and your clips are cut with the same rhythm, frame
  rate and colour.
- **Fixes and polish**: the live preview draws only as many pixels as the player shows, so tall and
  square projects play more smoothly. The desktop app fills the screen when it is smaller than the
  window, the player keeps a usable size in a small window, and menus and notes on the player and
  timeline stay inside it. Handles on the player stay on the picture when a render finishes, and a
  font or cut-out that can't load no longer slows playback.

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
