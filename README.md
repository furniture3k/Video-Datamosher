# MOSHPIT: datamosh studio

A creative datamoshing app that runs **entirely in your browser**. Drop in videos, melt them into each other, bloom pixels, transfer motion, corrupt bytes and bend motion vectors, then export MP4, WebM, GIF, PNG frames or the raw broken AVI.

Nothing is uploaded. All processing happens locally with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) and WebGL.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static files in `dist/`, can be hosted anywhere):

```bash
npm run build
npm run preview
```

**GitHub Pages:** `.github/workflows/pages.yml` deploys `main` automatically. Enable it once in the repo's
*Settings → Pages → Source: GitHub Actions*.

## How it works

Video codecs store a full picture occasionally (**I-frames**) and in between only **P-frames**: motion vectors plus small corrections. MOSHPIT:

1. Re-encodes your clips (trimmed, scaled, concatenated) into **MPEG-4 Part 2 / Xvid in AVI**, the classic moshing format, or MPEG-1/2. You control GOP length, quality, motion search and more.
2. Parses the AVI in TypeScript, detects each frame's type from its VOP/picture header, and runs your **effect stack** on the list of compressed frames.
3. Writes a new AVI and decodes it with FFmpeg's error-tolerant decoder into frames for frame-accurate preview.
4. Optionally runs **pixel effects** (GPU flow engine, chroma split, pixel sort), then encodes the export.

## Features

**Bitstream effects** (real datamoshing):

| Effect | What it does |
|---|---|
| ✂ Keyframe Killer | Removes I-frames: all, at clip cuts, random, or every Nth. Gaps can be dropped or filled. |
| ✿ Bloom | Repeats P-frames: the first, the strongest, every Nth, or random, with jitter. |
| ⇢ Motion Transfer | Borrows motion from any part of the timeline and applies it to another (replace or insert, loops, speed). |
| ↻ Stutter Loop | Rhythmic loops of motion groups, with optional ping-pong. |
| ⤨ Shuffle / ⇆ Reverse | Reorders motion frames in windows. |
| ◎ Echo | Re-inserts delayed motion (multi-tap). |
| ⌫ Frame Drop | Every Nth or random. |
| ▦ Byte Glitch | 11 corruption modes (bit flip, random/zero/max runs, copy, swap, bit-shift, insert, delete…), with frame-type targeting, region limits and header protection. |

**Pixel / flow effects:** ➶ Vector Warp (GPU block-matching motion estimation; amplify, rotate, swap, drift, turbulence, quantise, residual, refresh), ◐ Chroma Drift, ≣ Pixel Sort.

**Creative control:**
- Every effect has a draggable, resizable timeline range (snaps to cuts, the playhead and other effects; hold Shift to disable snapping), enable, solo, reorder and duplicate.
- Every numeric or toggle setting can be **automated** with a drawable curve (linear/smooth/steps) or an LFO (sine, triangle, square, saw, random, noise).
- 🎲 **Chaos** rolls random stacks (with an intensity knob). 🧬 **Mutate** nudges settings. 🔒 lock individual settings and 📌 pin whole effects to protect them.
- ▦ **Variations** renders a grid of mutations or random rolls to pick from.
- Seeds everywhere: the same seed always gives the same mosh.
- 16 built-in presets, plus your own saved presets.
- **Mosh codes**: share a recipe as a short string that works on any footage.
- Encoder controls: codec, quality, GOP, scene-cut, forced keyframes (press `K`), motion search, B-frames, macroblock decision, compare function, 4MV, qpel, trellis. Decoder error concealment is also configurable.
- Audio that **follows the mosh** (blooms stutter the sound), plus bitcrush, sample-rate crush, byte glitch, and reversed slices.
- A/B compare (split wipe, side-by-side, hold original), undo/redo, autosave (including media) in IndexedDB, and project files.
- ◉ **Live Mode**: real-time flow mosh of your webcam, screen or a video, with quick looks, mouse "push", image injection and recording straight back into the project.
- Clip import from files, webcam/screen recording, or procedural generators.
- Simple / Advanced modes, tooltips on every setting, keyboard shortcuts (`?`), light/dark theme, and a phone layout.

## Tests

```bash
npm test                         # unit + engine integration tests (uses native ffmpeg if installed)
npm run build && npm run test:e2e   # drives the real app in Chromium (Playwright)
npm run check                    # TypeScript / Svelte checks
```

## Notes and limits

- ffmpeg.wasm is slower than native FFmpeg. Keep the *preview width* low while experimenting; long clips are trimmed to 30 s by default (adjustable).
- Two ffmpeg.wasm encoder issues are worked around: MJPEG uses `-huffman 0`, and WebM uses VP8 + Vorbis because the wasm VP9/Opus encoders crash. The engine wrapper also recycles FFmpeg instances and retries automatically after a crash or stall.
- Moshed AVIs play differently in different players, so the app always shows and exports FFmpeg's decode.

## Project layout

```
src/engine/   pure TypeScript: AVI reader/writer, frame analysis, effects, automation, presets, audio, ffmpeg args
src/lib/      browser side: ffmpeg service, renderer, WebGL flow engine, storage, store
src/components, src/dialogs   Svelte 5 UI
tests/        vitest (engine + native-ffmpeg integration)
scripts/e2e.mjs  browser end-to-end test
```
