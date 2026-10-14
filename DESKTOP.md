# Desktop app

The desktop app is the web app in a native window ([Tauri 2](https://tauri.app)), with one
change: video jobs run on a native FFmpeg instead of ffmpeg.wasm. Native FFmpeg uses every core
and has no wasm memory limit, so preparing clips and exporting are several times faster and
1440p, 4K and long videos are practical. Everything else (editor, effects, engine) is the same code.

## How it fits together

```
src-tauri/                  the native shell (Rust)
  src/main.rs               window + command registration
  src/engine.rs             native engine: work folder, run FFmpeg, stream logs, cancel, Save dialog
  tauri.conf.json           window, bundle targets, bundled FFmpeg (externalBin)
  binaries/                 moshpit-ffmpeg-<target triple>, downloaded at build time (not committed)
src/lib/platform.ts         isDesktop
src/lib/ffmpeg.ts           Engine interface; picks ffmpeg.wasm or native at startup
src/lib/ffmpeg-native.ts    native Engine: same run(args, { inputs, mounts, outputs }) contract
```

- **One engine boundary.** Every FFmpeg job in the app goes through `ffmpeg.run(args, { mounts, inputs, outputs })`.
  `ffmpeg-native.ts` implements the same interface: inputs are written into a per-engine work
  folder in the system temp directory, mounted media are written there once per file and passed
  to FFmpeg by path, log lines stream back (for progress bars), and outputs are read back.
  The temp folder is deleted when the app quits.
- **Cancel** kills the FFmpeg process.
- **Longer output.** The output cap is 43,200 frames, 30 minutes at 24 fps (`MAX_OUTPUT_FRAMES_DESKTOP`),
  instead of the browser's 10 minutes. Exports no longer hold the video in memory (below), but the
  preview still does: its decoded frames, the soundtrack (two mix buses plus the playback buffer)
  and the waveform audio come to roughly 4–5 GB per hour of timeline. Going past 30 minutes means
  moving those to disk too (see Next steps).
- **Dialogs, links and camera.** macOS's webview has no `confirm()`/`prompt()`, so questions use an
  in-app dialog on desktop (`src/lib/ask.ts`). Links to other sites open in the system browser.
  Camera, microphone and screen capture are allowed for Record and Live mode (with the usage
  strings macOS needs in `src-tauri/Info.plist`).
- **Long exports don't load the video into memory.** The prepared stream stays on disk: the
  frontend gets each frame's position and first bytes (`avi_scan`, `framesFromDisk`), runs the
  effect stack on that (only Byte Glitch loads the frames it edits), and the moshed AVI is
  assembled on the native side from file ranges (`aviPlan` + `engine_assemble`). The result is
  byte-identical to the in-memory path (`tests/disk.test.ts`, and checked in the desktop e2e).
- **Exports stay on disk.** The finished video (and the pieces of a chunked export) are left in
  the work folder (`leave` in `RunOptions`) and moved to the place picked in the native Save
  dialog (`save_path`), so a multi-gigabyte export never passes through the webview. Other saves
  (`download()` in `src/lib/storage.ts`) are copied to disk in chunks and go through the same dialog.
- **FFmpeg** is bundled next to the app as `moshpit-ffmpeg`. `MOSHPIT_FFMPEG=/path/to/ffmpeg`
  overrides it; if it's missing, the `ffmpeg` on PATH is used.

## Building

Prerequisites: Node 22, [Rust](https://rustup.rs), and on Linux the
[WebKitGTK packages](https://tauri.app/start/prerequisites/#linux)
(`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`).

```bash
npm install
npm run desktop          # development window with hot reload
npm run desktop:build    # installers in src-tauri/target/release/bundle/
```

`npm run desktop` copies the `ffmpeg` on your PATH into `src-tauri/binaries/` (or downloads one if
there is none). `npm run desktop:build` always downloads a static build for the current platform
(`scripts/fetch-ffmpeg.mjs`; `--target <triple>` for another one, `MOSHPIT_FFMPEG_URL` for your own archive).

Releases: pushing a tag like `v1.1.0` (or running the workflow by hand with **release** ticked,
which tags `v<version>` from `package.json`) runs `.github/workflows/desktop.yml`, which builds Windows
(x64 `.msi` + `-setup.exe`), macOS (Apple Silicon and Intel `.dmg`) and Linux (`.AppImage`,
`.deb`, `.rpm`), attaches them to a draft GitHub Release and publishes it once every build
succeeded. Running the workflow by hand without **release** only builds them as workflow artifacts. Bump `version` in `package.json` first; the app
takes its version from there.

Tests: `ci.yml` builds the app on Linux and drives it through WebDriver
(`scripts/e2e-desktop.mjs`: load the example, render, export MP4 and WebM, cancel, import).
Locally: `npm run build`, `cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol`,
then `xvfb-run node scripts/e2e-desktop.mjs` (needs `cargo install tauri-driver` and `webkit2gtk-driver`).

## FFmpeg builds and licensing

moshpit is GPL-3.0-or-later. The release builds bundle GPL builds of FFmpeg (with libx264):
BtbN/FFmpeg-Builds for Windows and Linux, ffmpeg.martin-riedl.de for macOS. FFmpeg runs as a
separate program. To meet the GPL for it, `scripts/fetch-ffmpeg.mjs` writes `FFMPEG-NOTICE.txt`
(exact version, origin, license, where the source is), and every installer ships it next to
`LICENSE.txt` and `THIRD-PARTY-NOTICES.md`. The release notes link the sources too.

## Signing (not set up yet)

- **macOS:** builds are ad-hoc signed, so people have to right-click → Open the first time.
  An Apple Developer ID ($99/year) plus notarisation removes that: set `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and
  `APPLE_TEAM_ID` as repository secrets and pass them to `tauri-action`.
- **Windows:** a code-signing certificate avoids SmartScreen's "unknown publisher" warning.

## Next steps

- Longer projects (over 30 minutes): keep preview frames in a disk cache and read them as the
  playhead moves, stream the soundtrack instead of holding whole-timeline buffers, then raise
  `MAX_OUTPUT_FRAMES_DESKTOP`. Exports are already disk-backed.
- Hardware export: `h264_videotoolbox` / `hevc_videotoolbox` and ProRes on Mac; `h264_nvenc`,
  `h264_qsv`, `h264_amf` on Windows. Detect with `ffmpeg -encoders` at startup.
- Open media by path instead of copying it into the app's storage, and save projects as files next
  to the media.
- In-app updates with Tauri's updater plugin (needs a signing key for update bundles).
- Phone apps from the same code (Tauri 2 also targets iOS and Android, using ffmpeg.wasm there).
  Until then the installable web app covers phones.
