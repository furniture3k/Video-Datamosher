# moshpit edit-styles: implementation plan

## Context

The user wants moshpit to make nine short-form edit styles easily: subject cut-outs with graphics
behind the subject, word-per-beat kinetic type, Y2K collage, motion-design tour visuals, a
cinematic film look, degraded 12 fps film, and red scene-pinned annotations. A frame-by-frame study
of the references is in `ROADMAP.md` (pushed on branch `roadmap/edit-styles`), with references
R1–R9 and feature ids F1–F7 used below.

Exploring the code showed what limits all of it today:

- **Two compositors that must match.** The edit preview draws with Canvas 2D
  (`src/lib/preview.ts` `EditPreview.draw`). The mosh render builds the picture in an FFmpeg
  filter graph (`src/engine/args.ts` `segmentGraph`). Exports then run pixel effects and *clean*
  titles per frame (`src/lib/post.ts` `PostRunner.run`, which calls `drawTexts`).
- **Melted titles are one still PNG** (`src/lib/renderer.ts` `textOverlays` → `renderTextPng`,
  overlaid with `-loop 1` in `segmentGraph`). Anything animated or tracked can't melt.
- **Overlays are text only** (`Project.texts: TextClip[]`, 4 fonts, 5 enter animations). There
  are no shapes, stickers, mattes, perspective or style system.
- **Nothing can be moved on the player.** `Player.svelte` has split-compare, paint and track-box
  modes only; position is set with sliders in `ClipEditor.svelte`.
- **Segmentation is person-only** (`src/lib/segment.ts`, MediaPipe selfie segmenter), used only by
  Subject Guard. **Tracking is box position only** (`src/engine/track.ts` `trackBox`).
- **Unit tests run in Node** (vitest, native FFmpeg, no canvas). Browser behaviour is covered by
  Playwright scripts (`scripts/e2e*.mjs`).

**Decisions made with the user:** one PR per milestone, each a working, tested release; every
milestone ships on the phone editor (`src/mobile/`) and desktop together.

---

## Core architecture (built in M1–M3, used by everything after)

### 1. Layers replace titles (project format v3)
New `src/engine/layers.ts` (types + pure evaluation, unit-testable):

```ts
type LayerKind = 'text' | 'shape' | 'annotation' | 'sticker' | 'flipbook' | 'mockup' | 'group';
interface LayerBase {
  id; kind; row: string;            // graphics row on the timeline ('g1', 'g2', …), top = front
  start: number; duration: number; // seconds stay canonical
  beat?: { start: number; len: number };      // beat-locked timing (F6), re-resolved when the grid changes
  x; y; scale; rotate; opacity; anchor?: [number, number];
  keys?: Keys;                      // reuse src/engine/keys.ts (KEY_PROPS gets 'scale')
  blend?: BlendMode; moshed: boolean; enabled?: boolean; locked?: boolean;
  depth?: 'front' | 'behind';       // behind = under the subject matte (F5)
  matte?: { mediaId: string; matteId: string; invert?: boolean; mode: 'occlude' | 'inside' | 'outside' };
  pin?: Pin;                        // F4
  enter?: Anim; exit?: Anim;        // {type, dur, unit: 's' | 'beat'}
  style?: string;                   // kit id override; colours may be 'kit:0'…'kit:4'
}
```

- `TextLayer` carries every current `TextClip` field (`words`, `highlight`, `follow` → `pin`,
  `anim` → `enter`).
- `migrate.ts` turns `version: 2` + `texts` into `version: 3` + `layers` (also inside compound
  `Sequence`s) and still reads v1/v2.
- Consumers of `texts` all move to `layers`: `Timeline`, `ClipEditor`, `Player`, `TopBar`,
  `Mobile*`, `motion`, `bake`, `projectindex`, `starters`, `commands`, `captions`, `edit`, `store`,
  `renderer`, `post`, `preview`, `report`.
- `evalLayer(layer, t, env)` returns `{ visible, opacity, M: Mat3, reveal, letters, strobeOn,
  boilSeed, frameIndex }`. `env` = beat grid (from `src/engine/beats.ts`), pins, kit. It is pure,
  so it gets vitest coverage.

### 2. One graphics renderer for preview, clean post and pre-mosh (F1)
New `src/lib/layers/`:
- **`raster.ts`**: draws one layer's content into an offscreen 2D canvas, with one file per kind
  (`text.ts` grows out of `src/lib/text.ts`, then `shape.ts`, `sticker.ts`…). Rasters are cached by
  a content hash, so a layer that only moves isn't redrawn.
- **`compositor.ts`**: WebGL2 on the existing `GL` class (`src/lib/gl.ts`). Add a textured-quad
  program with a `mat3` (affine or homography) to `GL`. It handles opacity, the 5 existing blend
  modes (more in M7), and matte sampling: `alpha *= 1 - matte` for `depth: 'behind'`, and
  inside/outside for track mattes.
- **`renderer.ts`**: `GraphicsRenderer.draw(target, project, t, which: 'clean' | 'moshed' |
  'all')` plus `bounds(layer, t)` (a quad in frame coordinates, for the gizmo and hit-testing).
- It's wired into three places:
  1. `EditPreview.draw` replaces `drawTexts` (preview.ts:300).
  2. `PostRunner.run` replaces `drawTexts` (post.ts:435).
  3. **Pre-mosh plates**: `textOverlays` in `src/lib/renderer.ts` becomes `graphicsPlates`.

**Pre-mosh plates.** Per segment, the moshed layers are flattened into one RGBA plate:
- If every moshed layer is static in the segment, it's a single PNG and `-loop 1` (today's cheap
  path).
- Otherwise it's a PNG sequence covering only the frames where something is visible, mounted as
  `gfx_<seg>_%05d.png` and given to FFmpeg as
  `-framerate fps -start_number n -i … overlay=enable='between(t,a,b)'`.
- `TextOverlay` in `args.ts` becomes `GraphicsPlate { path, still, from, count }`.
- `segmentKey` includes the moshed layers' JSON, the beat grid hash and matte versions.
- Plates are cached in an LRU next to `pngCache`.

**Behind-subject comes free.** The plate's alpha already has the subject cut out, so FFmpeg only
ever overlays one image per segment.

### 3. Direct manipulation on the player (F3)
New `src/components/Gizmo.svelte`, an SVG overlay in `Player.svelte`:
- **Handles**: hit-test the topmost layer quad (`GraphicsRenderer.bounds`) or upper-track clip
  (`pictureMatrix` in `src/engine/placement.ts`). Drag moves, corners scale, the top handle rotates,
  double-click/double-tap edits text in place, and arrow keys nudge.
- **Touch**: one finger drags, two fingers pinch and twist.
- **Snapping guides**: centre, thirds, other layers' edges, and the safe zones from
  `src/engine/social.ts`.
- **Keyframes**: if a property has keys, the drag writes a key at the playhead, as ◆ does today.
  If the layer is pinned, the drag edits its offset from the pin.
- **History**: one `store.edit(fn, 'gizmo'+id)` per gesture, so one undo step.

### 4. Pins, mattes, beats, kits
- **Pins (F4)**: `{ kind: 'path', clipId, pathId }` (existing `Clip.paths`), `{ kind: 'plane',
  clipId, planeId, quad }` (M10) or `{ kind: 'face', clipId, faceId }` (M13). The compositor
  turns a pin into `M`.
- **Mattes (F5)**: `MediaItem.mattes?: MatteRef[]` stores `{ id, name, fileId, w, h, fps, from,
  to, prompts, version }` in source time, like `paths`.
  - Storage is a binary blob under `matte:<id>` (`putFile`/`getFile` in `src/lib/storage.ts`),
    with per-frame grey bytes compressed with `CompressionStream('deflate')`, plus
    `src/engine/matte.ts` to pack and unpack them.
  - Add the blobs to `keepFiles` (`src/lib/projectindex.ts`) and the project-file packer.
- **Beats (F6)**: `src/engine/beattime.ts` resolves beat-locked starts and durations, and beat
  units in animations. Timeline snapping gains ½ and ¼ subdivisions, and `BeatEditOptions.every`
  (`src/engine/beatedit.ts`) accepts 0.25 and 0.5.
- **Style kits (F7)**: `Project.kits`, `Project.kit` and built-ins in `src/engine/kits.ts`. A kit
  holds `fonts {display, body, accent}`, `palette[5]`, `stroke`, `line`, `glow`, `shadow`,
  `boil`, `enter`/`exit` and `timing`. Colours stored as `kit:n` resolve at draw time, so swapping
  the kit restyles everything.

---

## Milestones (one PR each; phone and desktop in every one)

Each PR includes: the code, unit tests for the pure parts, Playwright coverage for the UI (desktop
and a phone viewport), README/CHANGELOG/`src/engine/changelog.ts` (What's new) entries, i18n
strings in `src/locales/*.json`, and the ROADMAP checkboxes ticked.

### M1: Layers and the unified renderer (F1, F2). Unlocks: animated or tracked titles that melt

> **Done (PR for `feat/m1-layers`).** Changes from this plan:
> - The renderer is Canvas 2D (`src/lib/layers.ts`). The WebGL compositor moves to M8/M10, the
>   first milestones that need mattes or perspective.
> - Moving layers that melt are one file of back-to-back PNGs read with `image2pipe`, not a
>   numbered sequence, because the desktop engine maps mounted files by exact name.
> - New rows come from dragging a title above the top lane; no separate drop strip, because a
>   strip that appears mid-drag shifts the lanes under the pointer.
- `layers.ts` types and `evalLayer`; v3 migration; move all `texts` consumers to `layers`.
- `src/lib/layers/{raster,compositor,renderer}.ts`; text raster ported from `src/lib/text.ts` with
  identical output.
- Graphics rows on the timeline (`Timeline.svelte`, `MobileTimeline.svelte`) replace the single
  text row; layers can be moved between rows.
- Pre-mosh plates in `renderer.ts` and `args.ts`. Remove the Inspector restriction "titles that
  melt stay still" (`ClipEditor.svelte`).
- Tests:
  - Migration round-trip (v1 → v3, v2 → v3).
  - `evalLayer` timing and animation progress.
  - `segmentGraph` with a still plate and a sequence plate (native FFmpeg in
    `tests/compose.test.ts` style, with PNGs generated by `ffmpeg -f lavfi`).
  - e2e: an old project opens unchanged, and a tracked melting title moves in the export.
- **Done when** existing projects look identical and an animated title melts.

### M2: On-player manipulation (F3)

> **Done (PR for `feat/m2-gizmo`).** Changes from this plan:
> - Geometry and poses live in `src/engine/gizmo.ts` (one pure, tested module); the overlay is
>   `src/components/Gizmo.svelte`.
> - A main-track clip gets handles only once it's selected on the timeline, so clicks on the
>   picture don't keep grabbing the background.
> - Arrow-key nudging is left out: the arrow keys already step frames.
> - Snapping covers the middle of the frame and the other things' anchors; safe-zone and edge
>   snapping are left for later.
- `Gizmo.svelte` as above, click-to-select on the picture, and in-place text editing. Also works
  for upper-track clips (writes `Clip.transform`/`keys`).
- Phone: drag, pinch and twist on the picture; a double tap edits text.
- Tests: pure geometry (hit-testing, snapping, handle maths) in `src/engine/gizmo.ts`; e2e drags
  check the stored values; undo is one step per gesture.

### M3: Beat time and style kits (F6, F7)

> **Done (PR for `feat/m3-beats-kits`).** Changes from this plan:
> - Beat-locked layers (re-timed when the music changes) are left out: a lot of machinery for
>   little gain in these edit styles. Beat *units* for durations and animations move to M4,
>   where the animations are reworked.
> - Kits are **title styles** for now (font, size, colour, highlight, shadow, box, entrance),
>   stamped onto titles rather than resolved at draw time, so exports and melting need nothing
>   new. Saved styles live on the device, like saved presets. They grow into fuller kits as
>   fonts (M4) and shapes (M5) arrive.
- `beattime.ts`; beat units in Field controls; ½ and ¼ snapping; beat-locked layers follow tempo
  changes; auto-edit subdivisions.
- `kits.ts` with built-in kits for R2 (pink condensed), R4 (navy/off-white), R6 (white/red
  condensed), R7–R9 (red/blue annotation) and R1 (script). There's a kit picker in the top bar or
  Media panel and a phone sheet, plus "Make kit from this layer".
- Tests: beat resolution against a known grid (`tests/beats.test.ts` fixtures); kit resolution and
  overrides.

### M4: Type 2.0. Unlocks R2, R4, R6 type

> **Split in two.** **M4a (PR for `feat/m4-type`)**: layout and animation in one pure module
> (`src/engine/textlayout.ts`, measuring through a passed-in function so it's tested without a
> browser); letter and line spacing, outline and hollow letters, fit to width, copies and
> ticker scroll, exits, strobe, boil, and the slam, stamp, drop and word-by-word entrances;
> lengths in beats (chips that set seconds from the tempo); styles carry all of it; Words on
> the beat. **M4b (PR for `feat/m4b-fonts`)**: fonts kept with the project like LUTs (`font:` files,
> `Project.fonts`), loaded with `FontFace` and awaited before exports and burned-in titles; a
> Google Fonts picker (Google families are remembered by name and fetched again where the file
> is missing) and font-file import. Gradient fills, mixed styles per line and text on a path
> are still to do. Perspective tilt waits for the GPU compositor (M10).
- **Fonts**: import .ttf/.otf/.woff2 as media items (`mime font/*`, kept like other media and
  loaded with the `FontFace` API), plus a Google Fonts picker (OFL) that downloads and stores the
  file with the project.
- **Styling**: stroke and outline-only, gradient fill, letter spacing, line height, mixed styles
  per line or word (rich runs), fit to width or box, overflow, repeat/tile with marquee, text on a
  path, and perspective tilt (via `M`).
- **Animations** (enter and exit): slam, stamp, snap letter-reveal, write-on, strobe, scramble
  (the existing glitch), boil, drop, all with beat units.
- **Words → beats** dialog: paste a sentence or lyrics, or take Whisper word timings from captions
  (`src/lib/captions.svelte.ts`). It creates one fitted text layer per word or line on each beat or
  cut.
- Tests: rich-run layout maths and the words → beats splitter (pure); e2e for font import and
  fit-to-width.

### M5: Shapes and annotations. Unlocks R7–R9 marks and R4 callouts

> **Done (PR for `feat/m5-shapes`).** `Layer` is now `TextLayer | ShapeLayer`. Every shape is
> polylines (`src/engine/shapes.ts`, pure), so draw-on (a share of the total length, line after
> line) and boil (three jittered drawings cycled at 8 a second) work for all of them; drawn by
> `src/lib/shapes.ts` through the same layer renderer, so shapes melt too. Box, rounded box,
> circle, triangle, star, line and arrow (bend), corner marks, underline, highlighter, tunnel,
> pen; line colour and width, fill, glow. The handles scale both sides together. Shape button
> on the timeline toolbar, a Shape sheet on the phone, palette commands. **Mark something
> moving** (`src/engine/annotate.ts`): track a box, then a box, an arrow from the side with more
> room and a typing label, all following the path ("Mark it" also on tracks made earlier, and
> on the phone's clip tools). New shapes take the last look used. Still to do: polygons, the
> leader line with end squares, the callout preset, and grouping the marks into one layer.
- **Shape layer**: rect, rounded rect, circle, triangle, polygon, star, line, arrow (straight,
  curved, hand-drawn), bracket, underline, highlighter, freehand pen, and nested repeat (the box
  "tunnel" in R7).
- **Styles and animation**: stroke, fill, glow, shadow; draw-on (path-length dash) and boil (2–3
  jittered variants cycling).
- **Annotate tool**:
  1. Tap an object: run the existing `trackClip` (`src/lib/motion.svelte.ts`) and create a box
     pinned to that path.
  2. Drag out from the box to create an arrow.
  3. Type the label.
  The box, arrow and label are made as one group layer.
- **Callout** preset (image or box + leader line + title + small print).
- Tests: shape path generation and draw-on lengths (pure); e2e for the annotate flow on desktop and
  phone.

### M6: Canvas and collage. Unlocks R3, R4, R8

> **Split.** **M6a (PR for `feat/m6-canvas`)**: `Project.canvas` (`src/engine/canvas.ts`): the
> picture (main and upper tracks) cropped to the card's shape and set in on a colour, a gradient
> or a blurred copy of itself, with round corners, a border, a shadow and an up/down shift;
> presets (Paper card, Polaroid, Blurred, Pastel, Night). The page draws the backdrop, the
> card's mask and the border (`src/lib/canvas.ts`); the preview composites with them and the
> prep graph overlays them (`alphamerge` for the corners), so the canvas melts with the mosh
> and graphics still use the whole frame. Handles, tracking and follow paths map between the
> picture and the card. In the Encode tab (the phone's Look sheet). Image backdrops, card style
> per clip, stamp trail, pop on beat, shape masks and grids are M6b.
>
> **M6b (PR for `feat/m6b-collage`)**: split screens (`src/engine/grid.ts`): side by side,
> stacked, three stacked, three across, one big and two small, 2×2 and 3×3, with a gap; each clip
> under the playhead (or each selected one) gets the transform that zooms, moves and crops it
> over its cell, so nothing new is needed in FFmpeg or the preview. A stamp trail on any title or
> shape (`Layer.trail`: steps on by an offset every beat or so many seconds, leaving copies). An
> image from the media as the canvas backdrop. Still to do: card style per clip, pop on beat,
> animated shape masks, cells swapping on beats.
- **Canvas**: `Project.canvas` (colour, gradient, image or blurred copy) with the picture inset by
  padding, border and corner radius. Drawn in both `segmentGraph` (pad/overlay) and `EditPreview`.
- **Card style** on clips and image stickers: border, shadow, radius, polaroid caption.
- **Stamp trail on beat**: offset copies of a layer.
- **Pop on beat**: snap, scale-pop or slide in, with a no-easing option.
- **Animated shape masks** on clips and layers (circle, triangle, rect, star, text-as-mask),
  rendered as a matte. For clips the FFmpeg graph uses `alphamerge` with a mask plate; the preview
  uses the compositor.
- **Grid layouts** (2-up, 3-up, 2×2, 3×3) whose cells can swap on beats.

### M7: Mockups, fake UI, keys and blends. Unlocks R4 mockups and R2 line art

> **Done (PR for `feat/m7-blends`).** Eight more blend modes on upper-track clips (FFmpeg `blend`
> over a neutral colour, Canvas composite operations in the preview). A luma key (darkness or
> lightness: `lumakey` in FFmpeg, the same test in the GPU and CPU preview keys). Mockups as a
> canvas option (`Canvas.device`: phone, browser window, app window, laptop, drawn on the
> border picture, with presets), so a clip plays on the screen through the same card path. A
> cursor shape and a loading bar that fills. Still to do: music player and chat bubble mockups,
> zoom into the screen, selection handles and menus, notifications.
- **Mockup layer**: phone, laptop, browser window, music player, desktop window, chat bubble, all
  drawn by us (no brand interfaces). A clip plays on the screen, plus a zoom-into-screen move.
- **Fake UI kit**: selection handles and menu, cursor and click, loading bar, notification banner.
- **Luma key** on upper-track clips (FFmpeg `lumakey` plus a preview shader).
- **More blend modes**: overlay, soft light, hard light, lighten, darken, colour, hue, colour dodge,
  exclusion. Added to `BlendMode`, `BLEND` in `args.ts` and `COMPOSITE` in `preview.ts`.
- Tests: compose tests for each blend and the luma key.

### M8: Cut out any subject (P2, part 1). Unlocks R1, R2 fills, R9 car

> **Done (PR for `feat/m8-cutout`).** Benchmark gate, measured on this laptop (an Apple Silicon Mac,
> 12 cores, Chrome 141, `scripts/models-check.mjs` with the real models, three public-domain photos:
> a dog, an astronaut, a portrait):
>
> | | MediaPipe interactive | SlimSAM (transformers.js) | People model |
> |---|---|---|---|
> | model load (first time, with download) | about 3 s | about 9 to 15 s | about 0.6 s |
> | one picture, one tap | 14 ms (about 70 a second) | 1.07 s | 11 ms |
> | through a 4 s clip at 12 frames a second | 49 frames in 1.7 s (28 a second) | 49 frames in 54 s (0.9 a second) | |
> | quality on the three subjects | clean masks, right every time | right with several taps; one tap can land on a part (the astronaut came out as 1% of the picture) | people only |
> | heap | about +60 MB | about +57 MB | about +37 MB |
> | 4× CPU throttle (a stand-in for a phone) | 17 to 22 ms | 1.5 s | |
>
> The 4× throttle only slows the CPU, not the GPU, so real phones may be slower still; it needs a
> real phone to say. **Decision:** MediaPipe's interactive segmenter is the default for taps and
> for following the subject through a clip; SlimSAM is used automatically as soon as a point says
> "leave this out" (the quick model has no such prompt), or by choice ("Precise"); the people
> model is a third choice. A box prompt does not work in transformers.js's SAM export (it came out
> wrong), so SAM is driven by points only, and the hint for each frame is the last mask's middle
> plus four more spots spread over it. Also changed from the plan:
> - MediaPipe uses one tap at a time: when a tap lands on something it calls empty, the next of the
>   spread-out points is tried (this took the dog from 42 of 49 frames found to all 49).
> - Frames are blended motion-aware (`blendMoving`): each is slid along the subject's movement
>   before blending, so a matte between two frames is the subject in between, not two half copies.
> - A subject effect is a `ShapeLayer` with `shape: 'subject'` and a `subject` object, which kept
>   the change small; it draws from the matte itself. Blur and grade change the picture under
>   them, so those are drawn on top of the mosh only.
> - "Track matte" is the third Depth value, "Only on the subject".
> - Not done here: the WebGL compositor for matte passes (the Canvas 2D one does it all at the
>   frame rates tested), Subject Guard and clip depth (M9).
- **Benchmark gate first**: try SlimSAM via transformers.js (same loader pattern as `depthMap` in
  `src/lib/maps.ts`) against MediaPipe InteractiveSegmenter (same library as `segment.ts`) on
  desktop Chrome and iPhone Safari. Pick the model and the analysis rate (e.g. 384 px at 12 fps,
  interpolated).
- **Cut-out mode** in the player: tap to add include points, long-press or ⌥-click to exclude, with
  a live mask preview on the current frame. "Cut out through clip" then runs as a background job
  with progress, using the `motionJob` pattern from `src/lib/motion.svelte.ts`.
- **Propagation**: the prompt for each frame is the previous mask's box plus its centroid point.
  `trackBox` re-acquires the object when the mask is lost. People can use the existing
  `personMask`, which is faster.
- **Uses of a cut-out**:
  - The layer **Depth** control (In front / Behind subject), defaulting to the subject matte of the
    clip underneath.
  - Track matte (inside/outside).
  - Subject effects: recolour solid, fill, outline, glow, offset echo, and subject-only or
    background-only grade and blur, done as compositor passes on a matte-derived layer.
- Tests: matte codec round-trip and interpolation (pure), with a fake segmenter injected through a
  `setObjectSegmenter`-style override, as `setPersonSegmenter` does today. e2e: a layer behind a
  synthetic subject is hidden where the matte is white.

### M9: Cut-outs, part 2

> **Done (with the rest of M14, in the PR for `feat/m9-depth`).** Changes from this plan:
> - **Clip depth** feeds the matte to FFmpeg as grey PNG pictures, one per timeline frame (made by
>   the page the same way moving layers' plates are), not as raw grey frames: the page already
>   knows how a clip's time maps to the source (speed, ramps, reverse), so the pictures line up
>   with the main track however it was cut. In the graph the main track is split, the subject is
>   rebuilt with `alphamerge` and overlaid back over the clip (`Clip.depth: 'behind'`). The preview
>   draws the main track again, cut by the matte, over the clip. Checked on real pixels with
>   generated mattes in native FFmpeg (`tests/clipdepth.test.ts`), whole and one segment at a time.
> - **Make sticker**, **Subject Guard** with "A cut-out subject" as its source, and **Blur / Pixelate
>   faces** (an oval over every face the clip's Find faces found, following each) are done, with
>   the menu's Cut out, Recolour, Text behind and Make sticker.
- **Clip depth**: upper-track clips can go behind the subject. In FFmpeg, the matte is fed as raw
  grey frames (`-f rawvideo -pix_fmt gray`), the base is split, the subject is rebuilt with
  `alphamerge` and overlaid back on top. The preview gets the same order.
- **Make sticker**: freeze the cut-out at one frame into a transparent PNG in the media library.
- Subject Guard gets a "Cut-out" source (`post.ts` `guard`) that reads mattes.

### M10: Pin to the scene (P3). Unlocks R7–R9 in full

> **Done (PR for `feat/m10-pin`).** Changes from this plan:
> - `src/engine/planar.ts` (pure, run in the track worker): Shi-Tomasi corners inside the quad,
>   pyramidal Lucas-Kanade (with robust weights, so a half-covered window still follows the half
>   that shows), RANSAC over four-point samples then a least-squares fit, and every frame the
>   surface is looked at again in the first frame's view of it, which stops drift and brings back
>   corners that were hidden. Synthetic noise textures warped by known homographies stay under
>   1 px for 60 frames, forwards and backwards, with 30% covered and after it clears; a surface
>   hidden for good ends the track cleanly.
> - The warp is Canvas 2D (a triangle grid, each triangle an affine transform), not WebGL: one
>   code path works in the preview, the clean export and the burned-in plates, so they agree.
>   Pinned layers are drawn flat first, then warped, at full strength, and faded as one.
> - A layer is pinned from where it is at the playhead (`Layer.surface`: the surface over the
>   timeline plus the moment it was pinned), so it looks the same at the moment of pinning.
> - Screen replacement (`Clip.screen`, `src/engine/screen.ts`) uses FFmpeg's `perspective`
>   filter in the graph (checked in the browser's FFmpeg) rather than decoding frames into a
>   plate sequence: the picture is carried to the surface's corners by expressions over time.
> - Text on a path is a circular arc (`curve`, −1 to 1); a hand-drawn baseline isn't built.
> - Still to do: the 3D camera solve (stretch goal).
- `src/engine/planar.ts`, pure TS run in `track.worker.ts`:
  1. Shi-Tomasi corners inside the chosen quad.
  2. Pyramidal Lucas-Kanade (reusing `blur3`/`level`/`half` from `track.ts`, now exported).
  3. RANSAC with a normalised 4-point DLT, then refinement.
  4. Every N frames, re-match to the reference so it doesn't drift; track forwards and backwards.
- Results stored as `Clip.planes`.
- **Pin to surface**: a layer's quad is mapped through the homography by the compositor.
- **Screen replacement**: an upper-track clip is pinned to a plane. The pre-mosh plate renders it
  through the compositor (frame-accurate decode via mediabunny, already a dependency).
- **Multi-pin**: many layers on one solve.
- Tests: synthetic noise textures warped by known homographies, with corner error < 1 px over 60
  frames, and occlusion recovery.
- Out of scope: full 3D camera solve (left on the roadmap as a stretch goal).

### M11: Looks pack (P4). Unlocks R5, R6, R1 halftone

> **Done (PR for `feat/m11-looks`, built after M7: M8–M10 need model and device work first).**
> Ten pixel effects in a new "Film and print" family (`src/lib/looks.ts` shaders, run by
> `PostProcessor`): 1-bit (six inks, optional dither), Halftone, Line Art (ink on paper, light
> on black, over the picture), Glow with halation, Vignette, Light Leak, Gate Weave (with
> flicker and dust), DV Tape, Light Trails and Step Print (both remember earlier frames, kept
> per effect and started afresh when the frames jump). Step print per clip (`Clip.stepFps`:
> `fps=N,fps=project` in the clip graph, the preview's time held to the same steps). Five film
> presets (Cinematic Film, Degraded 8 mm, Risograph, Neon Lines, 2000s Camcorder).
- **New pixel effects** registered like `RETRO` in `src/lib/retro.ts`/`post.ts` and listed in
  `src/engine/effects` and the Add-effect guide (`src/lib/effectguide.ts`): threshold/1-bit,
  halftone, line art, light trails (a feedback target kept between chunks in `PostRunner`, like
  `FlowEngine` state), halation, glow, vignette, light leaks, gate weave, DV crush.
- **Step print**:
  - `Clip.stepFps` in `clipGraph` (`fps=N,fps=project`) and in preview time quantising
    (`sourceTime`).
  - An adjustment-layer version.
  - A post-mosh "Hold frames" effect.
- **Film-look presets** built from R5 and R6, added to `src/engine/presets.ts`.

### M12: Transitions and flipbook. Unlocks R5 whips, R1 and R2 swaps

> **Done (PR for `feat/m12-transitions`).** Eight blend transitions on xfade transitions the
> browser's FFmpeg has (checked in it): whip left and right (`smoothleft`/`smoothright`), zoom
> through, blur dissolve, clock wipe, diagonal wipe, squeeze and circle close, each drawn to
> match in `EditPreview.blend`. Flipbook (`src/engine/flipbook.ts`, dialog in the Audio panel,
> a phone tool and the palette): the chosen media swapped on every beat (¼ to 2) or every few
> frames, in order, shuffled (never twice in a row) or back and forth, on a new track; videos
> carry on where they were left. Still to do: colour flash frames, dip with hold, custom shape
> wipes, whip direction from the motion, flipbooks behind the subject.
- **Transitions**: whip pan (xfade slide + directional `avgblur` ramp in the window; matching
  `EditPreview.blend`), flash frame, shape wipe (xfade `custom` expressions), and zoom-through.
  All added to `BLEND_TRANSITIONS`.
- **Flipbook layer**: images or GIF frames cycling every N frames or every beat (½, ¼), in order,
  random or ping-pong, behind the subject too.
- "Flipbook clips" command for video cells: lays clips on an upper track per beat, reusing
  `beatedit.ts`.

### M13: Stickers, faces and particles. Unlocks R3 star, R6 reactions

> **Done (PR for `feat/m13-stickers`).** Emoji stickers (titles of one emoji, popping in) and
> drawn hearts, sparkles and starbursts in the Shape picker. Particles on any title or shape
> (`src/engine/particles.ts`: rise, fall or burst, with count, speed and spread). Find faces:
> MediaPipe face detection on the clip's analysis frames (6 a second, `src/lib/faces.ts`, a
> fake detector in tests), linked into one track per face (`src/engine/faces.ts`), stored with
> the tracked objects, so Title follows, Mark it and a new Sticker menu work on faces; the phone's
> Faces tool puts a sticker on every face at once. Still to do: face blur, ornaments, tape and
> paper, particles on the beat.
- **Built-in sticker library** (our own SVGs): emoji, reactions, stars, sparkles, ornaments, line
  art, scribbles, tape.
- **Face pin**: MediaPipe FaceDetector produces face paths stored as `Clip.paths` (kind face). A
  sticker or blur auto-pins to every face.
- **Particle layer**: stickers that rise, fall or burst on beats.

### M14: Effortless layer

> **Done in full (the second part is in the PR for `feat/m9-depth`):** the depth stack view, graphics in Randomize, Variations and Breed, reveal one per beat, the script panel and groups (the box, arrow and label of a mark are one group: the handles move it, and copy and delete take it whole). Earlier note:
>
> **Partly done (PR for `feat/m14-effortless`).** Right-click (long-press on a phone) on the
> picture: Title here, Box it, Arrow to here, Mark what's here (tracks a box round the point,
> then box, arrow and label), Find faces, and emoji stickers, all placed where you pointed.
> Seven templates from the references (Kinetic lyrics, Scrapbook, Product demo, Red notes,
> Cinematic, Degraded film, Split screen), built from the new pieces. Still to do: the depth
> stack view, graphics in Randomize and Variations, reveal one per beat for groups, the script
> panel, and the cut-out items of the menu (after M8).
- **Tap menu** on the player: Cut out · Track · Pin here · Box it · Recolour · Text behind ·
  Sticker on it · Make sticker.
- **Starter templates** for each reference style through `src/home/TemplateDialog.svelte` and
  `src/lib/starters.svelte.ts`.
- **Depth stack view** above the player.
- **Graphics in Randomize/Variations/Breed** (`src/engine/chaos.ts`, `VariationsDialog.svelte`):
  layout, kit, timing.
- **Reveal one per beat** for groups.
- **Script panel**: lines of text become timed layers.

### M15: Steal this edit
- Import a reference video and measure, with pure analysis in `src/engine/steal.ts`:
  - cut times (scene score) against its beat (`beats.ts`);
  - shot lengths;
  - effective frame rate (duplicate-frame ratio);
  - palette and grade, built as a LUT by colour transfer (`src/engine/lut.ts`);
  - canvas/inset detection;
  - text density.
- Output: a template + kit applied to the user's clips.
- Tests: synthetic references with known cut rhythm, fps and colour cast.

---

## Verification (every milestone, before its PR)

1. `npm run check` (types), `npm test` (vitest, native FFmpeg), then
   `npm run build && npm run test:e2e`. Chromium is at `/opt/pw-browsers`; e2e covers desktop and a
   390×844 phone viewport.
2. Reproduce each referenced shot with the milestone's features in the built app. Export it, pull
   frames with ffmpeg and compare them to the reference contact sheets.
3. Parity check: preview frame vs. exported frame at the same time, for clean and melted layers.
   Pixel difference under a threshold, as a new e2e check.
4. Performance budget: graphics composite ≤ 4 ms per frame for 20 layers at 1080p in the preview,
   and plate memory reported in Storage.
5. Re-read the diff for anything CI would reject, then push. One PR per milestone on its own branch
   (`feat/m1-layers`, …), and drive CI green.

## Risks and how they're handled
- **Segmentation speed on phones**: the M8 benchmark gate picks the model and rate first. The
  fallback is the person model plus painted mattes.
- **Plate memory at 1080p and above**: sequences only span frames where layers are visible; static
  segments stay single PNGs; there's an LRU and a size cap with a warning.
- **v3 migration**: projects keep reading v1/v2. Saving writes v3, and older app versions refuse it
  with the existing "Unknown project version" message, which is noted in What's new.
- **Licensing**: Google Fonts (OFL) only, and every mockup and sticker drawn in-house.
