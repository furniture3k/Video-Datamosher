# moshpit roadmap: from datamosher to the edit styles people actually post

This list comes from a frame-by-frame study of nine short-form edits (Instagram Reels, Oct 2026)
that moshpit should be able to make easily. Each item says what to build, which reference it
unlocks, where it goes in the code, and when it counts as done.

**References** (numbers are used throughout):

| # | Style | What makes it |
|---|---|---|
| R1 | Fox in snow, calligraphy | Subject cut out; ornaments and words sit *between* background and fox; a new ornament every ~0.33 s; one clip in 1-bit halftone; a scribble glued to the fox's head |
| R2 | "EVERYTHING WORKS IN MY FAVOR…" | A cut every ~0.25 s, one word per cut, huge pink type filling the frame width; white line-art keyed over everything; subjects filled solid white |
| R3 | Y2K pop-up collage | Photo cards pop in on the beat (129 BPM) and leave stepped copies offset down-left; web-page screenshots as backgrounds; a star sticker following faces; cut-out cat sticker |
| R4 | Tour visuals (motion design) | Magazine layouts with product callouts and prices; triangle/circle wipes in a brand colour; letter-by-letter type ("Z" → "ZO"); outline-only type behind photos; framed photos on an off-white canvas; fake text-selection UI; phone mockup that zooms into its screen; runs at ~16 fps |
| R5 | Cinematic nature | Teal and orange film grade, halation, whip-pan blur transitions, dips to black |
| R6 | Degraded film (VHS/DV) | **Step-printed at ~12 fps**; crushed blacks, blown reds; long-exposure light trails; lyrics that strobe on and off every 0.1–0.2 s and overflow the frame; floating reaction emojis; heavy vignette |
| R7–R9 | Red annotation edits | Boxes, nested boxes, circles, arrows and leader lines pinned to the scene in perspective; text lying flat on the road; a car recoloured solid red; lines that draw themselves on; marks that wobble slightly every frame (hand-drawn "boil"); elements arriving one per beat; blue inset border |

**What the study found beyond the obvious**

- **Rhythm is the backbone.** Cuts, pops and reveals land on the music, usually on **half or
  quarter beats**, not just whole beats or bars. Things *snap*; almost nothing eases.
- **Frame rate is a look.** R6 runs at ~12 fps and R4 at ~16 fps on purpose, within a 30/60 fps
  video. That is different from the project frame rate.
- **The same few building blocks keep returning:** a cut-out subject, a matte, a pinned or tracked
  point, a line + box + label (an annotation and a product callout are the same thing), and a
  style (font, colour, stroke, timing) shared by everything on screen.
- **moshpit has none of the direct-manipulation basics:** nothing can be dragged, pinched or
  rotated on the player (position is set with sliders in the Inspector).
- **Melted titles are static.** A title that melts with the video is one full-frame PNG overlaid
  in FFmpeg before the mosh (`src/engine/args.ts`, "titles that melt"). Clean titles are drawn
  per frame on a canvas (`src/lib/post.ts`, `src/lib/preview.ts`). So anything animated or
  tracked can't currently melt. Fixing this is the first foundation.

## Principles for every item

1. **Tap the thing, not a panel.** Anything you can see on the player can be selected, dragged,
   pinched, rotated, and has a tap menu. Panels are for fine-tuning.
2. **Beat-aware by default.** Every time-based setting (duration, appear, swap, cut) can be set in
   beats (1, ½, ¼) and snaps to the grid moshpit already detects.
3. **One style, inherited.** New text, shapes and stickers take the current Style Kit; changing
   the kit restyles the whole video.
4. **It can all melt.** Every new layer has the existing "melt with the video" switch.
5. **Phones first-class.** Every feature works with touch in `src/mobile/MobileEditor.svelte`,
   not only on desktop.

---

## Phase 0: Foundations (everything else stands on these)

- [x] **F1. Unified graphics layer renderer.** *(M1: one Canvas 2D renderer, `src/lib/layers.ts`; moving layers that melt are drawn per frame. The WebGL compositor comes with mattes and perspective.)* One canvas renderer that draws all overlay
  graphics (titles, shapes, annotations, stickers, flipbooks) for time *t*. It's used by the edit
  preview, the clean post pass and, rendered to an RGBA frame sequence, as an FFmpeg input before
  the mosh. Today: `drawTexts` in `src/lib/text.ts`, called from `src/lib/preview.ts` and
  `src/lib/post.ts`; melted titles are static PNGs in `src/engine/args.ts`.
  *Done when* an animated, tracked title can melt and looks the same in the preview and the export.
- [x] **F2. Generic Layer model.** *(M1: `src/engine/layers.ts`, project format 3, text layers on graphics rows; the other kinds join in their milestones.)* Generalise `TextClip` into `Layer` with kinds: `text`, `shape`,
  `annotation`, `sticker`, `flipbook`, `mockup`, `group`. Shared fields: start/duration, transform
  + keys, opacity, blend, depth (F5), pin/follow (F4), style ref, `moshed`, enter/exit animation,
  beat timing. Migrate old projects (`src/engine/migrate.ts`).
- [x] **F3. On-player direct manipulation.** *(M2: `src/components/Gizmo.svelte`, geometry and poses in `src/engine/gizmo.ts`. Arrow-key nudging is left for later: the arrow keys step frames.)* Selection box with handles: drag to move, corner to
  scale, top handle to rotate; pinch/twist on touch; snapping guides (centre, thirds, safe zones,
  other layers); double-tap text to edit in place. Applies to layers *and* upper-track clips
  (`Clip.transform`). Lives in `src/components/Player.svelte` (which today only has split-compare,
  paint and track-box modes).
- [x] **F4. Pins.** *(One **Pin** control in a title's or shape's settings lists every tracked point, face and surface in the project; `Layer.pin` remembers which, so **Pin again here** re-pins from the playhead and **Unpin** lets go. A point or face drives position through `Layer.follow`, a surface adds the corner warp through `Layer.surface`.)* A layer can be pinned to: a tracked point (exists: `Clip.paths`,
  `TextClip.follow`), a planar/perspective track (P3), a face (P4), or a subject's matte (P2).
  The pin feeds position, scale, rotation and (for planar pins) a 4-corner warp.
- [x] **F5. Mattes as a reusable asset.** *(M8: `MediaItem.mattes`, kept like fonts and LUTs; Depth and subject effects are its consumers. Subject Guard reading mattes comes with M9.)* A matte is a per-frame alpha attached to a clip, cached
  like preview proxies. Sources: subject segmentation (P2), painted (exists in `src/lib/maps.ts`),
  shape (P1), luma/threshold, depth (exists). Any layer can use a matte as **track matte**
  (inside/outside), and every layer gets a **Depth** setting: *Behind everything / Behind
  subject / In front*. Subject Guard becomes one consumer of mattes instead of owning segmentation.
- [x] **F6. Beat timing everywhere.** *(Start and Duration of titles, shapes and subject effects can be shown and typed in beats (the unit button beside the number), by the real beats so a tempo change is followed; **Start on the beat**, Reveal one per beat, Burst on the beats, Flash on every beat; auto-edit has ½ and ¼.)* Durations and offsets accept beat units; "appear on next
  beat", "one per beat" for groups. Auto-edit (`src/engine/beatedit.ts`) gets subdivisions:
  `every` currently counts whole beats, add ½ and ¼.
- [x] **F7. Style Kits.** *(M3: title styles, `src/engine/styles.ts`: built-ins from the references, saved styles, apply to one or every title, new titles get the last. Kits widen to fonts, shapes and stickers as those arrive.)* A kit = fonts (display, body, accent), palette (3–5 colours),
  stroke/line weight, corner style, shadow, boil amount, default enter/exit animations and timing.
  Every new layer references the kit; a per-layer override is allowed. Built-in kits that match
  R1–R9; "Make kit from this layer".

## Phase 1: Type, shapes and collage (R2, R3, R4, R6 and the look of R7–R9)

### Type 2.0 (`src/lib/text.ts`, `TextClip` → text layers)
- [x] Custom fonts: import .ttf/.otf/.woff2 into the media library (stored with the project),
  plus a curated Google Fonts picker. Today there are four built-in families.
- [x] Stroke (outline-only too, R4), fill, gradient fill, letter spacing, line height, mixed sizes
  and colours per line or word ("What's On The Star? / YUNG FAZO", R4; white over red lines, R6).
  *(M4a: outline, hollow, spacing and line height done; gradient fill and mixed styles per line are still to do.)*
- [x] **Fit to width / fit to box** and **overflow** (R2 fills the width; R6 runs past the edges).
- [x] Text on a path (curved text along a line, R9) and perspective/3D tilt (R7–R9). *(M10: **Curve** bends a title's baseline into an arc (an arch or a smile) with the letters turned to follow it, `onCurve` in `src/engine/textlayout.ts`; **Perspective** leans any title or shape back or to the side (`tiltMatrix` in `src/engine/warp.ts`). A free-form baseline drawn by hand isn't built: the arc covers the edits studied.)*
- [x] **Repeat**: tile the text across or down the frame, with an optional marquee scroll
  ("NUMB YOURSELF NUMB YOURSELF", R6).
- [x] New animations: slam (scale-down snap), stamp, letter-by-letter **snap** reveal (R4),
  write-on stroke, **strobe/flicker** (R6), scramble (exists as Glitch), wiggle/boil, drop.
  Exit animations too (today: enter only, `animIn`).
- [x] **Words → beats.** Paste a sentence or lyrics: each word (or line) becomes its own text
  layer on its own beat or cut, fitted to width (R2). With music that has vocals, use the Whisper
  word timings that auto captions already produce (`TextClip.words`).
- [x] Text behind subject (needs F5 + P2). *(M8: **Title behind** on a cut-out, and **Text behind** in the picture's menu.)*

### Shapes and annotations (new layer kinds)
- [x] Shapes *(M5: `src/engine/shapes.ts`, a `shape` layer kind; polygons, the leader line with end squares and the callout are still to do)*: rectangle, rounded rect, circle, triangle, polygon, star, line, arrow (styles:
  straight, curved, hand-drawn), leader line with end squares (R9), bracket, underline,
  highlighter, nested-repeat (the "tunnel" of boxes in R7), freehand pen.
- [x] **Draw-on** (lines grow, boxes trace themselves) and **boil** (a slight per-frame wobble,
  2–3 variants cycling, R9).
- [x] **Annotate tool.** *(M5: "Mark something moving": drag a box round it, and a box, an arrow and a typing label follow it, as three layers on their own rows; they aren't a group yet.)* Tap an object → a box snaps around it and tracks it (existing tracker) →
  drag out from the box to make an arrow → type a label. One gesture makes a box, an arrow and a label as a
  group.
- [x] **Callout** *(G1: `calloutLayers`, a box, a leader line with an end square and a label as one group)* = image/box + leader line + title + small print (product name and price in R4,
  annotation labels in R9). Same primitive, different kit.
- [x] Glow, drop shadow and outer stroke as layer styles. *(G1: `Layer.fx`, on any title or shape, in the preview and the mosh.)*

### Canvas, frames and collage (R3, R4, R8)
- [x] **Canvas background** *(M6a: `src/engine/canvas.ts`; colour, gradient, an image or a blurred copy (M6b), round corners, border, shadow, moved up or down)*: colour, gradient, image or blurred copy of the video; the picture
  inset with padding, border and corner radius (R4 off-white, R8 blue border).
- [x] **Card style** *(G2: `Clip.card`: border, paper, shadow, round corners and a caption; polaroid, white card and tape-on looks)* for clips and images: border, shadow, rounded corners, caption under it
  (polaroid).
- [x] **Stamp trail.** *(M6b: on any title or shape, every beat or so many seconds; echo copies that follow motion are still to do)* On each beat, leave a copy of the card behind, offset in a chosen direction
  (R3); also "echo" copies that follow motion.
- [x] **Pop-in on beat** *(G2: `Clip.pop`, snap, scale-pop or slide, with no easing as an option, on the next beat)* for cards and stickers: snap, scale-pop, slide, no easing option.
- [x] **Animated shape masks** *(G2: `Clip.mask`, circle, rectangle, triangle, star, heart, growing over the clip; shape wipes between clips are Circle crop, Box crop and Doors open in the transitions)* on any clip or layer: circle, triangle, rectangle, star, text-as-mask;
  shape wipe transitions using the kit colour (R4).
- [x] **Split/grid layouts** *(M6b: `src/engine/grid.ts`, seven layouts with a gap, for the clips under the playhead or the selected ones; swapping cells **Burst on the beats** repeats the burst on every beat)*: 2-up, 3-up, 2×2, 3×3, filled by dropping clips; cells can swap on
  beats.
- [x] **Device and window mockups** *(M7: phone, browser window, app window and laptop drawn round the canvas card; the music player, chat bubble and zoom into the screen are still to do)*: phone, laptop, generic browser window, generic music player,
  desktop window with title bar, chat bubble. Drop a clip in and it plays on the "screen";
  **zoom into screen** transition (R4). Draw generic ones; don't copy real brands' interfaces.
- [x] **Fake UI animation kit** *(M7: a cursor shape and a loading bar that fills; selection handles, menus and notifications are still to do)*: text-selection handles and menu, cursor moving and clicking, a
  loading bar, notification banners (R4 "ZO" selection).

### Keys and blends
- [x] **Luma key** *(M7: Key by darkness or lightness, with threshold and softness, in FFmpeg and the preview)*: drop the white or the black (with threshold and softness) so line art and
  scans layer straight over footage (R2). Today chroma key only.
- [x] More blend modes *(M7: overlay, soft light, hard light, lighten, darken, colour dodge, colour burn, exclusion; colour and hue aren't in FFmpeg's blend filter)*: overlay, soft light, hard light, lighten, darken, colour, hue,
  colour-dodge, exclusion. Today: normal, screen, add, multiply, difference.

## Phase 2: Cut out any subject (R1, R2, R9's car, R3's stickers)

- [x] **Click-to-segment any object** *(M8: tap the subject on the player (a long-press or Alt-click leaves something out) and a live mask shows; **Cut out through clip** follows it at 12 frames a second, each frame hinted by the last mask's middle and spread-out points, with the box tracker standing in when it is lost. The quick model is MediaPipe's interactive segmenter (28 frames a second through a clip on the laptop); SlimSAM (through transformers.js) is used when something is left out, or by choice, and is far slower (about 1 frame a second); the people model is the quickest for people. Mattes are kept as deflated grey frames, `matte:<id>`, with the footage: `src/engine/matte.ts`, `src/engine/cutout.ts`, `src/lib/objectseg.ts`, `src/lib/cutout.svelte.ts`.)* and carry the selection through the clip (a small on-device
  video segmentation model run in a worker; today `src/lib/segment.ts` only has the MediaPipe
  selfie/person model). Add points to include or exclude. Result: a cached matte (F5).
- [x] **Behind-subject layering** *(M8: `Layer.depth` — In front, Behind the subject, Only on the subject (a track matte) — in the preview, the clean export and the burned-in plates)* with a single Depth control per layer (F5). The fox-behind-
  ornament shot (R1) should take: tap the fox, add a layer, set Depth to "Behind subject".
- [x] **Subject effects** *(M8: a subject effect is a shape layer made of the matte: Recolour, Outline, Glow, Echo, Blur and Darken (grade) the background or the subject; the last two change the picture under them, so they can't melt)*: recolour solid (R9 red car), fill white or colour (R2), outline, glow,
  duplicate offset (echo of the subject), subject-only grade, background-only grade or blur.
- [x] **Make sticker** *(M9: from the cut-out's row or the picture's menu: the subject at the playhead, cropped, as a PNG with see-through edges in the media)*: freeze the cut-out at a frame into a transparent PNG in the media library
  (R3's cat).
- [x] Subject Guard reads these mattes, *(M9: "A cut-out subject" is a Subject Guard source)* so a fox or a car can stay clean while the rest moshes.

## Phase 3: Pin to the scene (R7–R9)

- [x] **Planar (4-corner) tracking.** *(M10: `src/engine/planar.ts`, run in the track worker: Shi-Tomasi corners, pyramidal Lucas-Kanade with robust weights, RANSAC homography and a least-squares fit, every frame re-matched against the first so it doesn't drift and corners that were hidden come back; forwards and backwards from the playhead. Kept as `Clip.planes`. Four corners dragged onto the player, on the phone too.)* Select a flat surface (road, wall, window, screen); track it
  with feature points and a homography solved per frame in a worker (extends `src/engine/track.ts`,
  which follows a box's position today).
- [x] **Pin to surface**: any layer pinned to a planar track takes its perspective (text lying on
  the road in R9, boxes on windows). *(M10: `Layer.surface`; the layer is drawn flat where it was when pinned and carried onto the surface by a triangle grid in the preview, the clean export and the burned-in plates alike. Pin from the layer's settings, **Title on it** on a surface, or **Pin here** in the picture's menu.)*
- [x] **Screen replacement**: put a clip onto a tracked screen or poster. *(M10: `Clip.screen`; the whole picture is cropped, not squashed, to the surface's shape and carried to its corners every frame: FFmpeg's perspective filter in the render, the same triangle grid in the preview.)*
- [x] **Multi-pin from one solve**: track once, pin many labels to different points that all move
  with the camera. *(M10: select several layers and pin them together, or pin more later to the same surface.)*
- [ ] Stretch goal: **camera solve** (3D) for handheld walk-throughs (R8's room). *(Not built: it is a stretch goal, and the flat surfaces tracked now cover the screens, walls and signs in the nine references. A 3D solve would need structure from motion over a whole clip, which belongs in its own milestone.)*

## Phase 4: Looks, motion and stickers (R1, R5, R6, R2)

### New picture effects (WebGL, alongside `src/lib/post.ts` effects)
- [x] **Threshold / 1-bit** *(M11: 1-bit with six inks, Halftone in black or colour; Halftone has a Lines screen and a Two colours option (ink and paper) too)* with dither choice; **halftone** (dots, lines, size, angle, two-colour
  print) (R1, R2).
- [x] **Line art / edges** *(M11)* (ink outline of the picture), which pairs with luma key (R2).
- [x] **Light trails / long exposure** *(M11)* (frame blending with decay) (R6).
- [x] **Halation, bloom glow, vignette, light leaks, gate weave** *(M11: Glow with halation, Vignette, Light Leak, Gate Weave with flicker and dust)* (R5, R6).
- [x] **DV / camcorder crush** *(M11: DV Tape)*: crushed blacks, clipped highlights, oversaturated reds, low-res
  softness, interlace (R6). The existing VHS effect is a different texture.
- [x] **Frame-rate look (step print)** *(M11: per clip in FFmpeg and the preview, and a Step Print effect on the finished mosh; **Same for the whole track** gives a track's clips the same rate)*: hold frames to 8 / 12 / 15 / 18 fps per clip, track or
  adjustment layer, optionally on twos with jitter (R6 ~12 fps, R4 ~16 fps).

### Transitions
- [x] **Whip pan** *(M12: Whip left / right, a blended slide with blur in the preview; **Whip with the motion** picks the direction from a tracked object or a keyframed move)* (directional motion blur and slide, auto-direction from the clips' motion) (R5).
- [x] **Flash frame** *(M12: zoom through, blur dissolve, clock and diagonal wipes, squeeze, circle close; Dip to white is the flash; **Flash a colour on every beat** (palette) puts a few frames of colour on each beat; Dip to grey, Circle crop, Box crop, Doors open and Grainy dissolve are new. A dip that holds on black is not built: FFmpeg's xfade has no hold, and ffmpeg.wasm 5.1 lacks the `custom` transition that could do it, so a dip is as long as its overlap)* (white/colour frame on the beat), **dip with hold**, **shape wipe** (from P1),
  **zoom-through** (into a mockup screen or a subject).

### Flipbook clip (R1 ornaments, R2 b-roll)
- [x] *(M12: the Flipbook dialog lays the pictures on a new track, on the beat or every few frames, in order, shuffled or back and forth; **Behind the subject** once something is cut out)* Drop a folder or selection of images/clips into one slot; it cycles every N frames or every
  beat / ½ / ¼ beat, in order, random or ping-pong. Works as a layer (behind subject too) or on
  the main track.

### Stickers
- [x] *(M13: 18 emoji as titles, and drawn hearts, sparkles and starbursts next to the shapes; tape, torn paper scraps, a flower, an asterisk and a squiggle are drawn in-house as shapes with style kits)* Built-in sticker library: emoji, reactions (generic hearts, thumbs, faces), stars, sparkles,
  ornaments/mandalas, line-art drawings, scribbles, arrows, tape, paper scraps.
- [x] **Face pin** *(M13: Find faces (MediaPipe on the device) makes a track per face; a sticker, label or mark follows it. M9: **Blur faces** and **Pixelate faces** follow every face found, as ovals over the picture.)*: detect faces on device and pin a sticker or blur to each face automatically
  (R3's censor star).
- [x] **Floating particles** *(M13: on any title or shape: rise, fall or burst; on beats is still to do)*: emojis/stickers that rise, fall or burst on beats (R6 reactions).

### Built-in looks
- [x] *(the presets Cinematic Film (R5) and Degraded 8 mm (R6): glow with halation, vignette, grain, gate weave, step print and light leaks, each an effect you can tweak; not adjustment layers)* One-click film looks built from R5 and R6 (grade + halation + grain + vignette + frame rate),
  each as an adjustment layer you can tweak. Looks combine with LUTs (exist).

## Phase 5: Make it effortless

- [x] **Tap menu on the player.** *(M14: right-click or long-press: Title here, Box it, Arrow to here, Mark what's here, Find faces, Pin here, stickers; M8/M9: Cut out, Recolour, Text behind and Make sticker)* Tap anything → Cut out · Track · Pin here · Box it · Recolour ·
  Text behind · Sticker on it · Make sticker. This is the main way into Phases 2–4.
- [x] **Starter templates for each reference style** *(M14: Kinetic lyrics, Scrapbook, Product demo, Red notes, Cinematic, Degraded film, Split screen)*, using the existing template system
  (`src/home/TemplateDialog.svelte`): Red Annotations, Word-per-Beat, Y2K Collage, Behind the
  Subject, Degraded Film, Cinematic Nature, Tour Visuals. Pick clips (and a song), get the edit.
- [x] **Steal this edit** *(M15: `src/engine/steal.ts`, Home → Steal this edit)*. Import a reference video (like a screen recording of a Reel): moshpit
  measures cut rhythm (against its beat), shot length, effective frame rate, palette and grade
  (built as a LUT by colour transfer), canvas/inset, text density and position. It turns these into a
  template + kit to apply to your clips. Uses existing beat detection, scene cuts and LUTs.
- [x] **Depth stack view.** *(M14: a slim strip above the player, shown once something is cut out: what is behind the subject and what is in front at the playhead; click to pick, drag a chip onto another or use the arrows to change which is drawn over which, and the side button puts it behind or in front. `src/components/DepthStrip.svelte`.)* A small side view above the player showing layers behind or in front
  of the subject; drag layers between them.
- [x] **Randomise and Variations for graphics.** *(M14: `src/engine/graphicschaos.ts`. "Titles & graphics" in Variations, a preference that Randomize follows, and a command that rolls only the graphics: font, size, colour, outline, entrance, place, start on a beat and now and then a new canvas, seeded and repeatable; words, things that follow something, added fonts and subject effects are left alone. Variations and Breed cross the looks of the parents.)* The existing Randomize / Variations / Breed
  (mosh only today) also vary layout, kit, timing and annotation placement.
- [x] **Build-up on beats.** *(M14: select layers → **Reveal one per beat** (¼, ½, 1 or 2 beats apart), from the earliest start, all staying up to the latest end; "swap per beat" is the Flipbook.)* Select a group of layers → "reveal one per beat" (R9's marks
  arriving one by one) or "swap per beat".
- [x] **Text-first editing.** *(M14: **Script** in the palette and the phone's tools: write lines (or words), one after another or on the beats; the titles stay linked, so editing the words, adding or deleting a line updates them and keeps the looks you gave them. `src/engine/script.ts`, `src/dialogs/ScriptDialog.svelte`.)* A script panel: write lines, and they become timed layers; edit the
  words and the layers update.

---

## Coverage: what each reference needs

| Ref | Must have | Nice to have |
|---|---|---|
| R1 | P2 cut-out + depth, flipbook, Type 2.0 script fonts, halftone, pin to subject | Steal this edit |
| R2 | Words → beats, fit to width, ¼-beat cuts, luma key, subject fill | Line art effect |
| R3 | Canvas, card style, stamp trail, pop on beat, face pin, make sticker, mockup windows | Sticker library |
| R4 | Kits, mixed type, outline text, shape wipes, snap letter reveal, callouts, mockup zoom, step print | Fake UI kit |
| R5 | Film look, halation, whip pan, dips | Steal this edit (grade) |
| R6 | Step print 12 fps, DV crush, light trails, strobe text, repeat text, particles, vignette | |
| R7–R9 | Annotation tool, draw-on, boil, planar pin, subject recolour, beat build-up, inset border | Camera solve |

## Suggested order

1. **Phase 0** (F1–F3 first; F4–F7 can follow), then **Phase 1**. That's mostly 2D, so it's the quickest
   to build, and it covers most of R2, R3 and R4 and the look of R7–R9.
2. **Phase 2**: cut-outs and depth (R1, R9's car, R2's fills).
3. **Phase 3**: planar pins (completes R7–R9).
4. **Phase 4**: looks, flipbooks, transitions, stickers (R5, R6, rest of R1).
5. **Phase 5**: the tap menu and starter templates as soon as their pieces exist; Steal this edit
   last.

## Open questions

- **Segmentation model:** which model, how big, and does it run on mid-range phones? Benchmark
  before committing; fall back to the person model plus painted mattes.
- **Pre-mosh graphics:** an RGBA frame sequence as an FFmpeg input could be heavy at 1080p. Try
  rendering at mosh resolution only, or caching per layer, keyed by a hash of its settings.
- **Fonts:** bundling and licensing. Google Fonts (OFL) are fine to fetch on demand and store
  with the project.
- **Mockups and stickers:** draw everything ourselves. No real brands' interfaces or logos.
