# MOSHPIT: a creative datamoshing studio (plan)

## 1. Background: what datamoshing is and how it works

Modern video codecs don't store every frame as a full picture. They store:

| Frame type | What it holds | What happens if you mess with it |
|---|---|---|
| **I-frame** (keyframe) | A complete picture | Removing it means the decoder keeps "painting" new motion onto the *old* picture |
| **P-frame** (predicted) | Motion vectors ("this block moved 4px left") plus small corrections, relative to the previous frame | Duplicating it makes the same motion repeat over and over, so pixels smear and bloom |
| **B-frame** (bi-directional) | Prediction from past *and* future frames | Usually disabled for moshing because it makes results unpredictable |

The classic artistic techniques:

1. **I-frame removal (the transition mosh).** Delete the keyframe at a cut. Clip B's motion then drags clip A's pixels around, so one scene "melts" into the next.
2. **P-frame duplication (the bloom or smear).** Repeat one P-frame N times. Whatever motion it contains keeps applying, so pixels stretch, swirl and bloom.
3. **Motion transfer.** Show clip A's still image, then append only the P-frames of clip B. The texture of A moves with the motion of B (a face moving with a dancer's motion, for example).
4. **Bitstream corruption (glitching).** Flip, replace or shift bytes inside frame data to get blocky tears, colour shifts and macroblock rain.
5. **Motion-vector editing (advanced).** Change the vectors directly (amplify, invert, rotate, swap). This is what tools like FFglitch do.

**Why the old tools use Xvid/AVI.** MPEG-4 Part 2 (Xvid/DivX) inside an AVI container is the "classic" moshing format. Every frame is a separate, easy-to-find chunk in the file, frames can be detected as I or P from a few header bits, and decoders tolerate broken streams gracefully instead of refusing to play them. H.264 and newer codecs fight back: they have stricter references and error concealment, and they tend to refuse broken streams. So the engine will:

> **convert any input → MPEG-4 Part 2 in AVI (controlled settings) → edit the frame chunks → decode → re-encode to MP4/WebM/GIF for export**

Prior art I'll learn from (not copy): Avidemux-era manual moshing, `aviglitch` (Ruby), `tomato.py`, FFglitch (motion-vector scripting), Supermosh and similar web tools. Most of these are either command-line only or have only a couple of knobs. The gap this app fills is **full control, live preview and good UX**.

---

## 2. Product shape (recommended)

**A browser web app that runs 100% locally in the browser.** Videos never leave the user's computer. It can be hosted free (GitHub Pages) *and* run offline from the repo with one command.

- Video processing: **ffmpeg.wasm** (FFmpeg compiled to WebAssembly) for converting and decoding.
- Mosh engine: my own **TypeScript AVI/MPEG-4 frame editor** running in a Web Worker, so the UI never freezes.
- UI: **Vite + TypeScript + Svelte** (fast and light, good for a tool-heavy interface).
- Optional later: a tiny desktop wrapper (Tauri) or a "turbo mode" that uses a natively installed FFmpeg for big 4K files, since wasm is slower than native.

---

## 3. Feature list

### 3.1 Import and prep
- Drag & drop **multiple clips** (mp4, mov, webm, mkv, avi, gif, and still images as frozen "clips").
- **Webcam / screen recording** straight into the project.
- Clip bin with thumbnails; trim in/out; reorder on the timeline; per-clip speed.
- **Encoder settings** (these hugely change the look of a mosh, so all of them are exposed):
  - Resolution, frame rate, quality (qscale 1–31)
  - Keyframe interval (GOP length), with scene-cut detection on/off
  - B-frames off/on (off by default)
  - Motion-estimation method and search range (changes how vectors "flow")
  - Macroblock decision mode, 4MV, quarter-pixel, and similar codec flags
  - "Proxy" low-res mode for fast previewing

### 3.2 Mosh effects (stackable, placed on a timeline)
Each effect is a block you drop onto a time range. Blocks stack and can be reordered, muted, soloed and duplicated.

| Effect | Key settings |
|---|---|
| **Keyframe Killer** (I-frame removal) | all / only at clip cuts / within range / random probability; keep first frame on/off |
| **Bloom** (P-frame duplication) | source frame, repeat count, repeat every N frames, ramp up/down, random jitter |
| **Motion Transfer** | image source clip/frame, motion source clip, blend start |
| **Freeze & Flow** | hold one picture while motion keeps applying from a chosen range |
| **Stutter / Shuffle / Reverse** | shuffle P-frames in a window, reverse runs, drop every Nth frame, ping-pong |
| **Echo** | re-insert past P-frames later (delayed motion "ghosts") |
| **Byte Glitch** | mode (bit-flip / random-replace / zero-out / shift / repeat-chunk), intensity, probability, region of each frame (protect the header so it doesn't crash), per-frame or burst |
| **Vector Warp** *(advanced, phase 3)* | amplify, invert, rotate, quantize, swap X/Y, noise on motion vectors |
| **Re-key** | insert a fresh keyframe to "reset" the image to clean |

Every numeric setting can be:
- **Keyframed / automated** over time (curve editor: linear, ease, step, random).
- **Randomised** with a **seed**, so random results can be reproduced and shared.

### 3.3 Creativity and autonomy tools
- **Presets gallery**: Classic Melt, Bloom Explosion, Pixel Rain, Liquid Face, Datastorm, Ghost Echo, VHS Death and others. Each is a starting point, fully editable.
- **🎲 Chaos button**: generate a random effect stack. **Mutate** gives small random variations of the current settings. **Lock** individual settings so the dice don't touch them.
- **Variation grid**: render 4–9 small variations side by side and click the one you like.
- Save, load and share **project files** (JSON) and **preset codes** (short strings you can paste to a friend).
- **Undo/redo** for everything, plus history snapshots.

### 3.4 Preview and workflow
- Live **preview player** with scrubbing, a frame-by-frame step and a loop region.
- **Frame strip** showing each frame's type (I / P / dup / glitched) colour-coded, so you can see exactly what the mosh is doing. Click a frame to target effects there.
- **A/B compare**: original vs moshed, with a split-screen slider.
- Auto-re-render on change (debounced) with low-res proxies, then a full-quality final render.
- **Simple mode** (big friendly controls and presets) vs **Advanced mode** (every knob). Each setting has a hover tooltip explaining what it does visually.
- Keyboard shortcuts for everything (space = play, I/O = in/out, R = randomise, and so on).

### 3.5 Export
- MP4 (H.264), WebM (VP9), **GIF** (with palette options), PNG sequence, and the **raw moshed AVI** (for people who want the "real" broken file).
- Output resolution, frame rate, quality, and "bake" scaling (pixel-art nearest-neighbour upscaling).
- **Audio**: keep the original, mute, take audio from any clip, or "audio mosh" (apply the same byte glitch to audio).

### 3.6 Bonus: Live Mode (phase 4)
A real-time **WebGL "fake mosh"** that computes motion between webcam (or video) frames on the GPU and uses it to drag a frozen image around. This is instant and interactive, good for live visuals/VJing, and can be recorded into the project.

---

## 4. Architecture

```
src/
  ui/                 Svelte components (timeline, inspector, player, bin, presets)
  state/              project model, undo/redo, persistence (IndexedDB autosave)
  engine/
    ffmpeg.ts         ffmpeg.wasm wrapper: transcode → AVI/MPEG-4, decode, export
    avi/              RIFF/AVI parser + writer (chunks, idx1 index rebuild)
    mpeg4/            VOP header parsing (I/P/B detection), later: MV bitstream
    effects/          one module per effect: pure fn (frames, params, rng) → frames
    pipeline.ts       clips → prep → apply effect stack → AVI → decode → preview
    rng.ts            seeded PRNG
  workers/            engine runs in a Web Worker
  live/               WebGL optical-flow live mode
tests/                unit tests (parser, effects) + Playwright end-to-end
```

**Core data model:** a project is `clips[]` + `encoderSettings` + `effects[]` (each with `range`, `params`, `automation`, `seed`, `enabled`). The pipeline is deterministic: the same project always gives the same output. That is what makes presets, sharing and undo reliable.

**Why effects work at the frame-chunk level:** after conversion, the AVI is just a list of frame chunks tagged I or P. Every effect is a transformation of that list (remove, duplicate, reorder, corrupt bytes). That keeps effects simple, composable and fast. Only the final decode step needs FFmpeg.

---

## 5. Build phases

| Phase | Deliverable |
|---|---|
| **1. Engine core** | ffmpeg.wasm setup, AVI parser/writer, I/P detection, Keyframe Killer + Bloom, CLI test harness, unit tests on real sample videos |
| **2. Usable app (MVP)** | Clip import, timeline, effect stack with inspector, preview player, frame strip, presets, export MP4/GIF/AVI |
| **3. Creative depth** | All remaining effects, automation curves, seeds, Chaos/Mutate/Lock, variation grid, A/B compare, project save/share, audio options, Simple/Advanced modes |
| **4. Advanced & live** | Motion-vector warp (MPEG-4 MV bitstream editing), WebGL Live Mode, webcam capture, optional native-FFmpeg turbo mode |
| **5. Polish** | Onboarding tour, tooltips, keyboard shortcuts, mobile/tablet layout, performance tuning, GitHub Pages deploy |

Each phase ends with a working, tested, committed app.

## 6. Known limits and risks
- **Speed:** ffmpeg.wasm is about 3–10× slower than native FFmpeg. Mitigations: proxy previews, worker threads, a native turbo mode later.
- **Memory:** browsers cap wasm memory, so very long or 4K clips will need proxies or chunked processing.
- **Motion-vector editing** requires parsing the MPEG-4 bitstream at macroblock level. This is the hardest part, so it is scheduled last and isolated.
- Moshed AVIs play differently in different players. That is why the app always shows (and exports) the FFmpeg-decoded result, which looks the same everywhere.

---

## 7. Build status (all phases done)

Everything above has been built, with these deliberate changes from the plan:

- **Motion-vector editing** is done with a GPU **flow engine** (Vector Warp) instead of rewriting MPEG-4 macroblock syntax. It gives the same controls (amplify, rotate, swap, quantise, noise) on any footage, runs in real time, and also powers Live Mode. Rewriting the real bitstream vectors stays a possible future addition.
- **WebM export uses VP8 + Vorbis**, because the VP9 and Opus encoders in ffmpeg.wasm crash.
- **Native "turbo mode"** (desktop FFmpeg) was not built yet; it's planned in [DESKTOP.md](DESKTOP.md).
- Extra additions: procedural clip generators, webcam/screen recording, mosh share codes, and audio that follows the mosh.

---

## 8. Video editor (second round)

The app is now a video editor first, with the datamosher working on the edit:

- **Model.** A project holds a media library, a magnetic video track, any number of audio tracks,
  transitions and titles (format version 2; older projects convert automatically).
- **Rendering.** The timeline is cut into pieces at hard cuts; each piece is encoded on its own and
  cached, and the pieces' frame lists are joined before the effect stack runs. Frames before the
  first change are reused when decoding. Blend transitions use `xfade`; mosh transitions expand
  into Keyframe Killer / Bloom / Glitch / Stutter / Vector Warp effects at their cut.
- **Sound.** Clips are mixed into two buses: tracks that follow the mosh, and clean tracks.
- **Preview.** An instant edit preview plays the source files (or background proxies) with Web
  Audio; the rendered mosh replaces it when it's up to date.
- **Export.** Media and the moshed stream are read in place (WORKERFS). Pixel effects and titles
  run in bounded chunks that are joined without re-encoding, so 1080p (and short 4K) exports fit
  in browser memory. The 30-second import limit is gone; the output cap is 10 minutes at 24 fps.
- **Next:** a desktop build with native FFmpeg. See [DESKTOP.md](DESKTOP.md).
