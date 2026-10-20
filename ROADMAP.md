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
- [ ] **F4. Pins.** A layer can be pinned to: a tracked point (exists: `Clip.paths`,
  `TextClip.follow`), a planar/perspective track (P3), a face (P4), or a subject's matte (P2).
  The pin feeds position, scale, rotation and (for planar pins) a 4-corner warp.
- [ ] **F5. Mattes as a reusable asset.** A matte is a per-frame alpha attached to a clip, cached
  like preview proxies. Sources: subject segmentation (P2), painted (exists in `src/lib/maps.ts`),
  shape (P1), luma/threshold, depth (exists). Any layer can use a matte as **track matte**
  (inside/outside), and every layer gets a **Depth** setting: *Behind everything / Behind
  subject / In front*. Subject Guard becomes one consumer of mattes instead of owning segmentation.
- [ ] **F6. Beat timing everywhere.** *(M3 did the ½ and ¼ grid, snapping and auto-edit cuts; beat units for durations and animations come with M4.)* Durations and offsets accept beat units; "appear on next
  beat", "one per beat" for groups. Auto-edit (`src/engine/beatedit.ts`) gets subdivisions:
  `every` currently counts whole beats, add ½ and ¼.
- [x] **F7. Style Kits.** *(M3: title styles, `src/engine/styles.ts`: built-ins from the references, saved styles, apply to one or every title, new titles get the last. Kits widen to fonts, shapes and stickers as those arrive.)* A kit = fonts (display, body, accent), palette (3–5 colours),
  stroke/line weight, corner style, shadow, boil amount, default enter/exit animations and timing.
  Every new layer references the kit; a per-layer override is allowed. Built-in kits that match
  R1–R9; "Make kit from this layer".

## Phase 1: Type, shapes and collage (R2, R3, R4, R6 and the look of R7–R9)

### Type 2.0 (`src/lib/text.ts`, `TextClip` → text layers)
- [ ] Custom fonts: import .ttf/.otf/.woff2 into the media library (stored with the project),
  plus a curated Google Fonts picker. Today there are four built-in families.
- [ ] Stroke (outline-only too, R4), fill, gradient fill, letter spacing, line height, mixed sizes
  and colours per line or word ("What's On The Star? / YUNG FAZO", R4; white over red lines, R6).
- [ ] **Fit to width / fit to box** and **overflow** (R2 fills the width; R6 runs past the edges).
- [ ] Text on a path (curved text along a line, R9) and perspective/3D tilt (R7–R9).
- [ ] **Repeat**: tile the text across or down the frame, with an optional marquee scroll
  ("NUMB YOURSELF NUMB YOURSELF", R6).
- [ ] New animations: slam (scale-down snap), stamp, letter-by-letter **snap** reveal (R4),
  write-on stroke, **strobe/flicker** (R6), scramble (exists as Glitch), wiggle/boil, drop.
  Exit animations too (today: enter only, `animIn`).
- [ ] **Words → beats.** Paste a sentence or lyrics: each word (or line) becomes its own text
  layer on its own beat or cut, fitted to width (R2). With music that has vocals, use the Whisper
  word timings that auto captions already produce (`TextClip.words`).
- [ ] Text behind subject (needs F5 + P2).

### Shapes and annotations (new layer kinds)
- [ ] Shapes: rectangle, rounded rect, circle, triangle, polygon, star, line, arrow (styles:
  straight, curved, hand-drawn), leader line with end squares (R9), bracket, underline,
  highlighter, nested-repeat (the "tunnel" of boxes in R7), freehand pen.
- [ ] **Draw-on** (lines grow, boxes trace themselves) and **boil** (a slight per-frame wobble,
  2–3 variants cycling, R9).
- [ ] **Annotate tool.** Tap an object → a box snaps around it and tracks it (existing tracker) →
  drag out from the box to make an arrow → type a label. One gesture makes a box, an arrow and a label as a
  group.
- [ ] **Callout** = image/box + leader line + title + small print (product name and price in R4,
  annotation labels in R9). Same primitive, different kit.
- [ ] Glow, drop shadow and outer stroke as layer styles.

### Canvas, frames and collage (R3, R4, R8)
- [ ] **Canvas background**: colour, gradient, image or blurred copy of the video; the picture
  inset with padding, border and corner radius (R4 off-white, R8 blue border).
- [ ] **Card style** for clips and images: border, shadow, rounded corners, caption under it
  (polaroid).
- [ ] **Stamp trail.** On each beat, leave a copy of the card behind, offset in a chosen direction
  (R3); also "echo" copies that follow motion.
- [ ] **Pop-in on beat** for cards and stickers: snap, scale-pop, slide, no easing option.
- [ ] **Animated shape masks** on any clip or layer: circle, triangle, rectangle, star, text-as-mask;
  shape wipe transitions using the kit colour (R4).
- [ ] **Split/grid layouts**: 2-up, 3-up, 2×2, 3×3, filled by dropping clips; cells can swap on
  beats.
- [ ] **Device and window mockups**: phone, laptop, generic browser window, generic music player,
  desktop window with title bar, chat bubble. Drop a clip in and it plays on the "screen";
  **zoom into screen** transition (R4). Draw generic ones; don't copy real brands' interfaces.
- [ ] **Fake UI animation kit**: text-selection handles and menu, cursor moving and clicking, a
  loading bar, notification banners (R4 "ZO" selection).

### Keys and blends
- [ ] **Luma key**: drop the white or the black (with threshold and softness) so line art and
  scans layer straight over footage (R2). Today chroma key only.
- [ ] More blend modes: overlay, soft light, hard light, lighten, darken, colour, hue,
  colour-dodge, exclusion. Today: normal, screen, add, multiply, difference.

## Phase 2: Cut out any subject (R1, R2, R9's car, R3's stickers)

- [ ] **Click-to-segment any object** and carry the selection through the clip (a small on-device
  video segmentation model run in a worker; today `src/lib/segment.ts` only has the MediaPipe
  selfie/person model). Add points to include or exclude. Result: a cached matte (F5).
- [ ] **Behind-subject layering** with a single Depth control per layer (F5). The fox-behind-
  ornament shot (R1) should take: tap the fox, add a layer, set Depth to "Behind subject".
- [ ] **Subject effects**: recolour solid (R9 red car), fill white or colour (R2), outline, glow,
  duplicate offset (echo of the subject), subject-only grade, background-only grade or blur.
- [ ] **Make sticker**: freeze the cut-out at a frame into a transparent PNG in the media library
  (R3's cat).
- [ ] Subject Guard reads these mattes, so a fox or a car can stay clean while the rest moshes.

## Phase 3: Pin to the scene (R7–R9)

- [ ] **Planar (4-corner) tracking.** Select a flat surface (road, wall, window, screen); track it
  with feature points and a homography solved per frame in a worker (extends `src/engine/track.ts`,
  which follows a box's position today).
- [ ] **Pin to surface**: any layer pinned to a planar track takes its perspective (text lying on
  the road in R9, boxes on windows).
- [ ] **Screen replacement**: put a clip onto a tracked screen or poster.
- [ ] **Multi-pin from one solve**: track once, pin many labels to different points that all move
  with the camera.
- [ ] Stretch goal: **camera solve** (3D) for handheld walk-throughs (R8's room).

## Phase 4: Looks, motion and stickers (R1, R5, R6, R2)

### New picture effects (WebGL, alongside `src/lib/post.ts` effects)
- [ ] **Threshold / 1-bit** with dither choice; **halftone** (dots, lines, size, angle, two-colour
  print) (R1, R2).
- [ ] **Line art / edges** (ink outline of the picture), which pairs with luma key (R2).
- [ ] **Light trails / long exposure** (frame blending with decay) (R6).
- [ ] **Halation, bloom glow, vignette, light leaks, gate weave** (R5, R6).
- [ ] **DV / camcorder crush**: crushed blacks, clipped highlights, oversaturated reds, low-res
  softness, interlace (R6). The existing VHS effect is a different texture.
- [ ] **Frame-rate look (step print)**: hold frames to 8 / 12 / 15 / 18 fps per clip, track or
  adjustment layer, optionally on twos with jitter (R6 ~12 fps, R4 ~16 fps).

### Transitions
- [ ] **Whip pan** (directional motion blur and slide, auto-direction from the clips' motion) (R5).
- [ ] **Flash frame** (white/colour frame on the beat), **dip with hold**, **shape wipe** (from P1),
  **zoom-through** (into a mockup screen or a subject).

### Flipbook clip (R1 ornaments, R2 b-roll)
- [ ] Drop a folder or selection of images/clips into one slot; it cycles every N frames or every
  beat / ½ / ¼ beat, in order, random or ping-pong. Works as a layer (behind subject too) or on
  the main track.

### Stickers
- [ ] Built-in sticker library: emoji, reactions (generic hearts, thumbs, faces), stars, sparkles,
  ornaments/mandalas, line-art drawings, scribbles, arrows, tape, paper scraps.
- [ ] **Face pin**: detect faces on device and pin a sticker or blur to each face automatically
  (R3's censor star).
- [ ] **Floating particles**: emojis/stickers that rise, fall or burst on beats (R6 reactions).

### Built-in looks
- [ ] One-click film looks built from R5 and R6 (grade + halation + grain + vignette + frame rate),
  each as an adjustment layer you can tweak. Looks combine with LUTs (exist).

## Phase 5: Make it effortless

- [ ] **Tap menu on the player.** Tap anything → Cut out · Track · Pin here · Box it · Recolour ·
  Text behind · Sticker on it · Make sticker. This is the main way into Phases 2–4.
- [ ] **Starter templates for each reference style**, using the existing template system
  (`src/home/TemplateDialog.svelte`): Red Annotations, Word-per-Beat, Y2K Collage, Behind the
  Subject, Degraded Film, Cinematic Nature, Tour Visuals. Pick clips (and a song), get the edit.
- [ ] **Steal this edit.** Import a reference video (like a screen recording of a Reel): moshpit
  measures cut rhythm (against its beat), shot length, effective frame rate, palette and grade
  (built as a LUT by colour transfer), canvas/inset, text density and position. It turns these into a
  template + kit to apply to your clips. Uses existing beat detection, scene cuts and LUTs.
- [ ] **Depth stack view.** A small side view above the player showing layers behind or in front
  of the subject; drag layers between them.
- [ ] **Randomise and Variations for graphics.** The existing Randomize / Variations / Breed
  (mosh only today) also vary layout, kit, timing and annotation placement.
- [ ] **Build-up on beats.** Select a group of layers → "reveal one per beat" (R9's marks
  arriving one by one) or "swap per beat".
- [ ] **Text-first editing.** A script panel: write lines, and they become timed layers; edit the
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
