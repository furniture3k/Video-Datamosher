# Finish moshpit: every remaining milestone, built and tested on this laptop

You're working on **moshpit**, a browser datamosh video editor (Svelte 5 + TypeScript + Vite, FFmpeg in the
browser via ffmpeg.wasm, plus a Tauri desktop build). The repo is `furniture3k/Video-Datamosher`. A plan to
make it able to recreate nine reference edit styles (R1–R9) lives in `ROADMAP.md` (the study and the
feature list) and `ROADMAP-PLAN.md` (15 milestones, each with a "Done" note once built). Read both fully
before you start, then read this whole prompt again. Work autonomously until everything below is done.
Don't stop to ask unless a decision genuinely can't be made from the code, these instructions or common
sense. When you finish one milestone, start the next one straight away.

## Where things stand

- Milestones M1–M7 and M11–M14 (partly) are built. They sit in **stacked pull requests #34 → #45**
  (each based on the one before; the top branch is `feat/m14-effortless`). Check with
  `gh pr list --state open`.
- **Step 0:** if those PRs are still open, ask me once whether to merge them in order (#34 first, each
  only once CI is green) or to build on top of `feat/m14-effortless`. If I don't answer, build on top of
  `feat/m14-effortless` and keep stacking (new branch per milestone, PR based on the previous one).
- **Not done**: M8, M9, M10, M15, the rest of M14, and the "Still to do" gaps listed in every milestone's
  Done note in `ROADMAP-PLAN.md` plus every unticked `- [ ]` in `ROADMAP.md`. All of it is listed below.

## Set up the laptop first (and fix the scripts so they work here)

1. `npm ci`. Install native FFmpeg (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux): the
   unit tests (vitest) run real FFmpeg graphs.
2. Browser for the e2e scripts: `scripts/e2e.mjs`, `scripts/e2e-ui.mjs` and `scripts/e2e-a11y.mjs` look
   for Chromium at a cloud-container path (`/opt/pw-browsers/...`) unless the `CHROMIUM` env var is set.
   Run `npx playwright-core install chromium`, then make all three scripts fall back to Playwright's own
   Chromium (`chromium.executablePath()`) when neither `CHROMIUM` nor the old path exists. Commit that fix
   first, on its own.
3. The fonts step in `e2e-ui.mjs` needs a font file: it reads `FONT_FILE`, else a container path. Point
   `FONT_FILE` at any `.ttf` on the laptop, or make the step fall back to a font file you add under
   `tests/fixtures/`. It must be an open-licence font (OFL), e.g. one downloaded from Google Fonts.
4. Prove the baseline is green before changing anything. Run, in this order:
   - `npm run check`
   - `npm test`
   - `npm run build`
   - `node scripts/e2e.mjs`
   - `node scripts/e2e-ui.mjs`
   - `node scripts/e2e-a11y.mjs`

   The UI suite takes a long time. Run it in the background and don't run other heavy work at the same
   time: some steps have short timing windows and fail when the machine is overloaded. `ONLY=<regex>`
   runs just the matching UI steps; many steps need the earlier `demo` step to have loaded clips, so use
   `ONLY='^demo$|your step'`.

## How this codebase works (follow it exactly)

- `src/engine/` is pure TypeScript (no DOM, no canvas): models, geometry, FFmpeg argument building
  (`args.ts`, `segmentGraph`). Everything in it gets vitest tests. `src/lib/` is browser code. Components
  are in `src/components/`, the phone editor is in `src/mobile/` and dialogs are in `src/dialogs/`.
- **Two compositors must agree**: the edit preview (Canvas 2D, `src/lib/preview.ts` `EditPreview.draw`) and
  the pre-mosh FFmpeg filter graph (`src/engine/args.ts` `segmentGraph`). Anything that changes the picture
  goes into both. Pictures the page draws (layers, canvas plates) are passed to FFmpeg as PNGs (see
  `layerOverlays` and `canvasPlates` in `src/lib/renderer.ts`, and `CanvasPlates` in `args.ts`). Moving
  layers are passed as a PNG sequence in one `.pngs` file read with `-f image2pipe`.
- Layers (`src/engine/layers.ts`): `TextLayer | ShapeLayer` on graphics rows, drawn by `src/lib/layers.ts`
  everywhere: preview, clean post-mosh, and burned-in "melting" plates.
- Clip tracking already exists (`src/engine/track.ts`, `src/lib/motion.svelte.ts`: `trackClip`,
  `Clip.paths`, `pathOnTimeline`, `pathSize`). Analysis frames come from `src/lib/analysis.ts`
  `clipFrames` (grey frames via FFmpeg). Heavy maths runs in `src/lib/track.worker.ts`.
- On-device models follow one pattern: `src/lib/segment.ts` (MediaPipe person segmenter, loaded from
  jsDelivr on first use) with an override setter `setPersonSegmenter`. The same pattern is used by
  `setDepthModel` in `maps.ts` and `setFaceDetector` in `faces.ts`. **Tests and e2e always use fake models
  through these setters** so CI never downloads anything; the real model is exercised by hand (below).
- The canvas (`src/engine/canvas.ts`) sets the picture into a card. Handles, tracking and follow paths
  map through `onCard`/`offCard`/`cardScale`, and any new picture-space feature must do the same.
- `window.__moshpit` exposes modules for e2e (see `src/main.ts`); add new modules there when a test
  needs them.
- Every milestone ships on **desktop and the phone layout together** (390×844 viewport in e2e).
- UI copy is plain, friendly British English ("colour", "picture", "melt"), and every control has a help
  line. Match the surrounding code's comment style (short comments that say why, in plain words).
- Don't bump the version or edit `CHANGELOG.md` (releases are separate). Do update `README.md`, tick
  `ROADMAP.md` boxes with a short italic note saying what was built, and add a "Done" note under the
  milestone in `ROADMAP-PLAN.md`.

## The routine for every milestone (non-negotiable)

1. Make a new branch from the previous milestone's branch.
2. Build the pure parts first, with vitest tests: geometry, maths, codecs, linking, timing. Add
   native-FFmpeg tests (see `tests/pipeline.test.ts`, `tests/compose.test.ts` and `tests/nle.test.ts`) for
   anything that changes the FFmpeg graph, and check real pixels.
3. Build the UI on desktop and phone, plus palette commands (`src/lib/commandlist.ts` and
   `commands.svelte.ts`).
4. Add steps to `scripts/e2e-ui.mjs` that drive the real UI. A step should make itself a clip if the
   timeline is empty, so it works with `ONLY`. It should check stored values and preview pixels, render
   the mosh, and tidy up after itself.
5. Run `npm run check` (0 errors, 0 warnings), `npm test` and `npm run build`, then all three e2e scripts
   in full. If a step fails, find the cause. Only blame load after rerunning that step alone on an idle
   machine and seeing it pass. Never skip, weaken or delete a test to get green.
6. Look at it yourself: take screenshots with Playwright (preview and rendered mosh, desktop and phone)
   and read them. Fix anything that looks wrong.
7. Write the docs, then commit with a clear message.
8. Push, then open a PR using `.github/pull_request_template.md` ("What changed", "How it was tested"
   with the boxes ticked honestly). Watch CI (`gh pr checks`) and fix anything red before moving on.

## Real-hardware testing (the reason this runs on the laptop)

The cloud environment couldn't download models or use a real GPU or phone. Here you can, so do this for
M8, M9, M10 and M13's face detection:

- Run `npm run dev -- --host`, open the app in desktop Chrome (and Safari if on a Mac), load real footage
  (a person, a pet or animal, a car, a phone or laptop screen, a road or wall), and use the real models.
  Record the timings: model download, first mask, frames a second for "cut out through clip", and
  memory. Write them into the milestone's Done note.
- Add a script `scripts/models-check.mjs` that runs headed Chromium against the dev server with the
  **real** models. It should cut out a known object in a generated or committed test clip, find a face in
  a committed photo (an openly licensed image, e.g. from Wikimedia Commons, credited in
  `tests/fixtures/README.md`), and report pass/fail with timings. This is the one script allowed to use
  the network. It is run by hand and isn't part of CI.
- Phone: open `http://<laptop-ip>:5173` on my phone on the same Wi-Fi, ask me to try the listed things,
  and give me a short checklist. If I can't, at least run the phone viewport in Chromium with CPU
  throttling (`Emulation.setCPUThrottlingRate` 4×) and report the timings.

## The work, in this order

### M10: Pin to the scene (pure maths, do it first)
Read "M10" in `ROADMAP-PLAN.md`, then build:
- **`src/engine/planar.ts`**, run in `track.worker.ts`:
  1. Shi-Tomasi corners inside a user-drawn quad.
  2. Pyramidal Lucas-Kanade. Reuse/export `blur3`, `level` and `half` from `track.ts`.
  3. RANSAC with a normalised 4-point DLT homography, then a least-squares refine.
  4. Re-match against the reference frame every N frames so it doesn't drift.
  5. Track forwards and backwards from the picked frame.
  6. Store the result as `Clip.planes: { id, name, quads: [srcTime, 8 numbers][] }` in picture space.
- **Tests**: synthetic noise textures warped by known homographies over 60 frames. Corner error must be
  under 1 px, including with 30% of the plane briefly covered (occlusion) and recovering afterwards.
- **Pin to surface**: any layer (title, shape, sticker) can be pinned to a plane and is drawn through the
  homography.
  - Preview: draw the layer into an offscreen canvas, then warp it. Use WebGL via the existing
    `src/lib/gl.ts` `GL` class with a textured-quad program and a `mat3`, or triangle-subdivided Canvas 2D
    if GL isn't available.
  - Burned-in and clean exports: do the same, producing PNG frames.
- **Screen replacement**: an upper-track clip pinned to a plane. Decode its frames (mediabunny is already a
  dependency, or FFmpeg frames) and warp each one into the plate sequence.
- **Multi-pin**: track once, then pin many labels to points on the same plane.
- **Text on a surface / perspective tilt** for titles (`ROADMAP.md` "Text on a path … and perspective/3D
  tilt"). Also do **text on a path** (a curved baseline: a quadratic like the shapes' `bow`, letters placed
  along it).
- **UI**:
  - "Track a surface": drag four corners on the player, then it tracks.
  - "Pin to surface" on a layer.
  - "Put a clip on this screen".
  - Phone: the same tools in the clip and layer toolbars.
  - Add "Pin here" to the right-click/long-press menu (`src/components/QuickMenu.svelte`).
- **e2e**: a generated clip of a textured square moving in perspective; track it; pin a title; check
  pixels inside the moving quad in the preview and the render.
- Stretch (only after everything else is done): a 3D camera solve.

### M8: Cut out any subject
Read "M8" in `ROADMAP-PLAN.md`, then build:
- **Benchmark gate first** (on the laptop, real models): SlimSAM through transformers.js (load it the
  same way as `depthMap` in `src/lib/maps.ts`) against MediaPipe's InteractiveSegmenter (same library as
  `segment.ts`). Measure quality on 3 clips and the speed per frame on desktop and phone. Pick one, write
  the numbers into the Done note, and keep the other behind the same interface if it's cheap.
  - Interface: `setObjectSegmenter`, plus `segmentAt(img, points+labels or box) → mask`.
- **Mattes as an asset** (`src/engine/matte.ts`):
  - `MediaItem.mattes?: { id, name, fileId, w, h, fps, from, to, prompts, version }[]` in source time.
  - Per-frame grey bytes, compressed with `CompressionStream('deflate')`, stored under `matte:<id>` with
    `putFile`/`getFile`.
  - Include the blobs in `keepFiles` (`src/lib/projectindex.ts`), in snapshots and in the project-file
    packer (find how fonts and LUT files are kept and do the same).
  - Interpolate between analysed frames.
  - Unit tests: codec round-trip and interpolation.
- **Cut-out mode** on the player:
  - Tap to include, long-press or ⌥-click to exclude.
  - A live mask preview on the current frame.
  - "Cut out through clip" runs as a background job with progress (the `motionJob` pattern), and can
    be cancelled.
- **Propagation**: the prompt for each frame is the previous mask's box plus its centroid. Use the box
  tracker to recover when the mask is lost. People can use the faster person model.
- **Uses**:
  - A **Depth** control on every layer ("In front" / "Behind subject"): the layer's alpha is multiplied
    by `1 − matte` in the preview and in the plates.
  - A track matte (inside / outside).
  - Subject effects as passes on a matte-derived layer:
    - recolour solid (R9's red car);
    - fill white or a colour (R2);
    - outline;
    - glow;
    - offset echo;
    - subject-only or background-only grade and blur.
- **Text behind subject** from the right-click menu.
- **Tests**: a fake segmenter in vitest and e2e. Done means a layer behind a synthetic subject is hidden
  exactly where the matte is white, in the preview and in the rendered mosh.

### M9: Cut-outs, part 2
- **Clip depth**: upper-track clips go behind the subject too. In FFmpeg, feed the matte as raw grey
  frames (`-f rawvideo -pix_fmt gray`), split the base, rebuild the subject with `alphamerge`, and overlay
  it back on top. The preview uses the same order.
- **Make sticker**: freeze the cut-out at the playhead into a transparent PNG in the media library.
- **Subject Guard** gets a "Cut-out" source that reads mattes (`src/lib/post.ts` `guard`).
- **Face blur** (from M13): blur or pixelate each face track (Subject Guard-style pass, oval from the
  track's box).
- Add "Cut out", "Recolour", "Text behind" and "Make sticker" to the right-click menu.
- Tests: native-FFmpeg graph tests with generated mattes, plus e2e on a fake segmenter.

### M14: the rest of "effortless"
- **Depth stack view**: a slim strip above the player listing what's behind and in front of the subject
  at the playhead. Drag to reorder rows; click to select.
- **Graphics in Randomize, Variations and Breed** (`src/engine/chaos.ts`, `VariationsDialog.svelte`):
  layout, style, timing and canvas, seeded and repeatable. Add tests.
- **Reveal one per beat**: select several layers, then "reveal one per beat" staggers their starts on the
  beat grid (`src/lib/beatinfo.svelte.ts`).
- **Script panel**: write lines, and they become timed titles one after another (or on the beats).
  Editing the text updates the titles. Do it on desktop (a panel) and phone (a sheet).
- **Group layers**: a `group` kind, or a `group` id shared by layers, so Mark's box, arrow and label move,
  copy and delete together. The handles move the group.

### M15: Steal this edit
Read "M15" in `ROADMAP-PLAN.md`, then build pure analysis in `src/engine/steal.ts` that measures:
- cut times (scene score);
- the beat (`beats.ts`) and cuts against the beat;
- shot lengths;
- the effective frame rate (duplicate-frame ratio, which reveals step print);
- the palette and grade as a LUT by colour transfer (`src/engine/lut.ts`);
- canvas/inset detection (borders);
- text density.

The output is a template plus look (canvas, effects, transitions, styles) applied to the user's own
clips, with a "what I found" summary they can tweak. Tests use synthetic references with a known cut
rhythm, step-print rate, colour cast and border. The e2e step imports a generated "reference" and checks
the result. UI: a "Steal this edit" entry on the home screen and in the palette, and on the phone.

### Every remaining gap (finish all of them)
Take them from each milestone's "Still to do" in `ROADMAP-PLAN.md` and every `- [ ]` in `ROADMAP.md`,
including at least:
- **Type**:
  - gradient fills;
  - mixed styles per word or line (rich runs: font, colour, size per run);
  - text on a path;
  - perspective tilt (via M10's warp).
- **Shapes**:
  - polygons (n sides);
  - leader line with end squares (R9);
  - **callout** preset (box or image + leader line + title + small print);
  - drop shadow and outer stroke as styles on any layer;
  - style kits extended to shapes and stickers (`src/engine/styles.ts` and `ROADMAP.md` F7).
- **Collage**:
  - card style per clip (border, round corners, shadow, polaroid caption) in both compositors;
  - **pop on beat** (snap, scale-pop, slide, no-easing option);
  - **animated shape masks** on clips and layers (circle, triangle, rect, star, text-as-mask), using a
    mask plate with `alphamerge` in FFmpeg;
  - split-screen cells that swap on beats.
- **Mockups and fake UI**:
  - music player and chat bubble mockups;
  - zoom into the screen;
  - text-selection handles and menu;
  - click ripple for the cursor;
  - notification banner.
- **Transitions**:
  - colour flash frames on the beat;
  - dip with hold;
  - shape wipes (xfade `custom` expressions, checked in ffmpeg.wasm; see how M12 checked which xfade
    names the wasm build has);
  - whip direction picked from the clips' motion.
- **Looks**:
  - two-colour halftone and line screens;
  - step print per track;
  - one-click film looks from R5/R6 if anything is still missing.
- **Stickers and particles**:
  - ornaments, tape and paper scraps (draw them in-house; no brand or copyrighted art);
  - particles triggered on beats.
- **Flipbook** behind the subject (needs M8).
- **Faces**: blur (in M9 above).
- **F4 Pins**: one pin model (path, plane, face) for every layer kind. **F6**: beat timing everywhere
  (durations and animations in beat units that follow tempo changes).

## Definition of done

- Every milestone has a PR with green CI, honest test notes, and README, ROADMAP and ROADMAP-PLAN
  updated. Every `- [ ]` in `ROADMAP.md` is ticked with a short note, or explicitly marked as a stretch
  goal with the reason.
- `npm run check`, `npm test`, `npm run build` and all three e2e scripts pass in full on the final branch,
  and `scripts/models-check.mjs` passes with real models on the laptop.
- You've recreated each of the nine reference styles (R1–R9 in `ROADMAP.md`) in the built app with the new
  features, exported each, pulled frames with FFmpeg, and looked at them. Save the exports and a contact
  sheet per style under a `demo-output/` folder (gitignored) and tell me where they are.
- A final summary for me: what was built per milestone, the PR list in merge order, the real-device
  timings, and anything that couldn't be done with the exact reason.

## Rules

- Never merge a PR without asking me first. Never force-push or rewrite history on a branch that has a
  PR, except to resolve conflicts in branches you created.
- No new paid services or API keys. Models come from public CDNs (jsDelivr, Hugging Face, Google's
  MediaPipe bucket) on first use and are cached by the browser. Pictures never leave the device.
- Keep commit messages and PR text free of model names. End commit messages with the usual
  `Co-Authored-By` trailer for Claude.
- If something truly can't be built (for example a model too slow on phones), build the best fallback
  (the person model plus painted mattes), document it, and move on. Don't stop.
