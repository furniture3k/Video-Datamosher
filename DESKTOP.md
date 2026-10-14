# Desktop app plan (for later)

The web version does everything the desktop app would, but the browser's copy of FFmpeg
(ffmpeg.wasm) is single-threaded, roughly 3–10× slower than a native install, and has limited
memory. 1080p works on the web; 1440p and 4K work for short pieces but are slow. A desktop app
removes those limits without rewriting the editor.

## Goal

- Windows (`.exe`/`.msi` installer) and macOS (`.dmg`, Apple Silicon and Intel).
- Same interface and engine as the website, with one codebase for both.
- Native FFmpeg for preparing, decoding and exporting: fast 1080p/4K, long videos, hardware
  encoders (VideoToolbox on Mac, NVENC / Quick Sync / AMF on Windows).
- Media opened from disk by path (no copies into browser storage).

## Recommended stack: Tauri 2 (Rust)

Tauri wraps the existing web app in a small native shell written in Rust and builds a `.dmg`
for Mac and `.msi`/`.exe` for Windows from the same project.

|  | Tauri 2 (recommended) | Electron (alternative) |
|---|---|---|
| Language of the shell | Rust | JavaScript (Node) |
| Installer size | ~15 MB + FFmpeg (~60–80 MB) | ~150 MB + FFmpeg |
| Web engine | System WebView (WKWebView on Mac, WebView2 on Windows) | Bundled Chromium |
| Risk | Small rendering differences between Safari-based WKWebView and Chromium-based WebView2 | Same engine everywhere; bigger download |

The app already runs in Safari and Chrome, uses WebGL (supported in both WebViews) and doesn't
depend on WebCodecs, so Tauri's system WebViews are fine. If something WebKit-specific turns up,
the same frontend can go into Electron instead; only the small native layer changes.

## What is already prepared in the web code

These were built into the web version so the desktop step stays small:

- **One engine boundary.** Every FFmpeg job goes through `ffmpeg.run(args, { mounts, inputs, outputs })`
  in `src/lib/ffmpeg.ts`. A desktop build swaps in a second implementation of that one function.
- **Media by reference.** Inputs are passed as `mounts` (read in place, never copied). On desktop
  these become real file paths.
- **Segmented, cached preparation.** Only the clips you change are re-prepared
  (`segments()` / `segmentArgs()` in `src/engine/`).
- **Bounded-memory export.** Pixel effects and titles run in chunks and the pieces are joined
  without re-encoding (`exportVideo()` in `src/lib/renderer.ts`).
- **Mosh resolution separate from output resolution**, so 4K output can come from a 1080p mosh.
- **Pure argument builders** (`src/engine/args.ts`) that are already tested against native FFmpeg in CI.

## Steps

1. **Scaffold.** `npm create tauri-app` style setup in `src-tauri/`, pointing at the Vite build.
   Keep the website build unchanged (`npm run build`); add `npm run desktop` and `npm run desktop:build`.
2. **Ship FFmpeg as a sidecar.** Bundle a static FFmpeg per platform (macOS arm64 + x64, Windows x64)
   with Tauri's `externalBin`. Licensing: builds with libx264 are GPL, so the app's distribution must
   meet GPL terms (publish source, which this repo already does), or use an LGPL build with hardware
   encoders only.
3. **Native engine adapter.** A Rust command `ffmpeg_run(args, mounts, outputs)` that maps mount names
   to file paths, spawns the sidecar, streams `-progress` lines back as events (for progress bars),
   supports cancel (kill the process) and returns output files by path. In the frontend, pick the
   adapter at startup (`'__TAURI_INTERNALS__' in window`).
4. **Files on disk.** Use the dialog/fs plugins: importing stores the file path in the project
   instead of copying into IndexedDB; previews load via Tauri's asset protocol. Projects save as
   `.mosh` files next to the media, with relink-on-open if files move.
5. **Bigger limits.** Raise `MAX_OUTPUT_FRAMES`; keep preview frames in a disk cache instead of RAM;
   write exports straight to the chosen file instead of building a Blob.
6. **Hardware export.** Add encoder choices in the Export dialog when available:
   `h264_videotoolbox` / `hevc_videotoolbox` (Mac), `h264_nvenc` / `hevc_nvenc`, `h264_qsv`,
   `h264_amf` (Windows), plus ProRes on Mac. Detect with `ffmpeg -encoders` at startup.
7. **Builds and releases.** GitHub Actions matrix using `tauri-action` builds the `.dmg` and
   `.msi`/`.exe` on tag pushes and attaches them to a GitHub Release. Add Tauri's updater for
   in-app updates.
8. **Signing (optional but recommended before sharing widely).**
   - macOS: Apple Developer Program ($99/year) for a Developer ID certificate and notarisation;
     without it, people have to right-click → Open the first time.
   - Windows: a code-signing certificate avoids the SmartScreen "unknown publisher" warning.

## Rough effort

Steps 1–4 give a working, faster desktop app; 5–6 make it a proper 4K tool; 7–8 are packaging.
The editor, effects and engine logic don't change.

## Things to check when starting

- WebGL flow engine performance inside WKWebView at 4K (fall back to lower-resolution flow if needed).
- Audio preview (Web Audio) behaves the same in both WebViews.
- Very large projects: memory use of the segment cache (make it disk-backed on desktop).
