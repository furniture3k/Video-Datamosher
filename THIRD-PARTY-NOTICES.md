# Third-party notices

moshpit is licensed under the [GNU General Public License v3.0 or later](LICENSE). It includes
or uses the following third-party software. Each keeps its own license; all are compatible with
the GPL-3.0-or-later.

## Video engine

| Component | Where | License | Source |
|---|---|---|---|
| FFmpeg (WebAssembly builds, `@ffmpeg/core` and `@ffmpeg/core-mt` 0.12) | website and installable web app | GPL-2.0-or-later (includes libx264 and other GPL libraries) | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@ffmpeg/ffmpeg`, `@ffmpeg/util` | website and installable web app | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| FFmpeg (native build, run as the separate program `moshpit-ffmpeg`) | desktop app | GPL (v2 or later, or v3 or later depending on the build) | https://ffmpeg.org/download.html |

The desktop app's FFmpeg is built by this project from source (`scripts/build-ffmpeg.sh`, run in
`.github/workflows/ffmpeg.yml`): FFmpeg's signed release, with x264 (GPL-2.0-or-later), libvpx
(BSD-3-Clause), libvorbis and libogg (BSD-3-Clause) and zlib (zlib license), each pinned by its
hash or commit in `scripts/ffmpeg-sources.sh`. Every installer contains `FFMPEG-NOTICE.txt` naming
the exact sources it was built from, and `moshpit-ffmpeg -version` prints the build configuration. FFmpeg's
source for any version is at https://git.ffmpeg.org/ffmpeg.git. FFmpeg's licensing details:
https://ffmpeg.org/legal.html.

## Application

| Component | License | Source |
|---|---|---|
| Svelte (compiled into the app) | MIT | https://github.com/sveltejs/svelte |
| mediabunny (MP4 / WebM files for the browser's own encoders and decoders) | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| Tauri, `@tauri-apps/api`, Tauri plugins (desktop app) | MIT or Apache-2.0 | https://github.com/tauri-apps/tauri |
| Rust crates used by the desktop app (see `src-tauri/Cargo.lock`) | mostly MIT and/or Apache-2.0; a few BSD-3-Clause, ISC, Zlib, MPL-2.0, Unicode-3.0 | https://crates.io |
| IBM Plex Mono font (loaded from Google Fonts when online) | SIL Open Font License 1.1 | https://github.com/IBM/plex |

Development-only tools (Vite, TypeScript, Vitest, Playwright, svelte-check) are not shipped in the app.

## Earlier work

The moshing approach was informed by [aviglitch](https://github.com/ucnv/aviglitch),
[tomato](https://github.com/itsKaspar/tomato) and [FFglitch](https://ffglitch.org/). No code from
these projects is included.

## FFmpeg VLC tables

`src/engine/mpeg4mv.ts` contains variable-length code tables (MCBPC, CBPY, motion vectors, DC
sizes and the inter/intra coefficient tables) copied from FFmpeg's `libavcodec/h263data.c` and
`libavcodec/mpeg4data.h`, which are licensed under the GNU Lesser General Public License,
version 2.1 or later. Copyright the FFmpeg developers.

## Downloaded on first use

These are not bundled. The app downloads them from a CDN the first time the feature is used, and
the browser caches them:

| Component | Used for | License | Source |
|---|---|---|---|
| transformers.js (`@huggingface/transformers` 3.8.1) and Whisper models (`Xenova/whisper-*`) | Auto captions | Apache-2.0 (library); MIT (Whisper weights) | https://github.com/huggingface/transformers.js |
| MediaPipe Tasks Vision 0.10.21 and the selfie segmentation model | Subject Guard (people) | Apache-2.0 | https://github.com/google-ai-edge/mediapipe |
| Depth Anything V2 Small (`onnx-community/depth-anything-v2-small`), through transformers.js | Subject Guard (depth map) | Apache-2.0 | https://github.com/DepthAnything/Depth-Anything-V2 |

