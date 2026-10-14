# Third-party notices

moshpit is licensed under the [GNU General Public License v3.0 or later](LICENSE). It includes
or uses the following third-party software. Each keeps its own license; all are compatible with
the GPL-3.0-or-later.

## Video engine

| Component | Where | License | Source |
|---|---|---|---|
| FFmpeg (WebAssembly build, `@ffmpeg/core` 0.12) | website and installable web app | GPL-2.0-or-later (includes libx264 and other GPL libraries) | https://github.com/ffmpegwasm/ffmpeg.wasm |
| `@ffmpeg/ffmpeg`, `@ffmpeg/util` | website and installable web app | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| FFmpeg (native build, run as the separate program `moshpit-ffmpeg`) | desktop app | GPL (v2 or later, or v3 or later depending on the build) | https://ffmpeg.org/download.html |

The desktop app's FFmpeg comes from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)
(Windows, Linux) and [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de) (macOS); both publish
their build scripts. Every installer contains `FFMPEG-NOTICE.txt` naming the exact FFmpeg version
it bundles, and `moshpit-ffmpeg -version` prints it along with the build configuration. FFmpeg's
source for any version is at https://git.ffmpeg.org/ffmpeg.git. FFmpeg's licensing details:
https://ffmpeg.org/legal.html.

## Application

| Component | License | Source |
|---|---|---|
| Svelte (compiled into the app) | MIT | https://github.com/sveltejs/svelte |
| Tauri, `@tauri-apps/api`, Tauri plugins (desktop app) | MIT or Apache-2.0 | https://github.com/tauri-apps/tauri |
| Rust crates used by the desktop app (see `src-tauri/Cargo.lock`) | mostly MIT and/or Apache-2.0; a few BSD-3-Clause, ISC, Zlib, MPL-2.0, Unicode-3.0 | https://crates.io |
| IBM Plex Mono font (loaded from Google Fonts when online) | SIL Open Font License 1.1 | https://github.com/IBM/plex |

Development-only tools (Vite, TypeScript, Vitest, Playwright, svelte-check) are not shipped in the app.

## Earlier work

The moshing approach was informed by [aviglitch](https://github.com/ucnv/aviglitch),
[tomato](https://github.com/itsKaspar/tomato) and [FFglitch](https://ffglitch.org/). No code from
these projects is included.
