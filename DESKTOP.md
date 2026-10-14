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
- **Saving.** The webview can't download files, so `download()` (`src/lib/storage.ts`) opens the
  native Save dialog instead.
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

Releases: pushing a tag like `v1.1.0` runs `.github/workflows/desktop.yml`, which builds Windows
(x64 `.msi` + `-setup.exe`), macOS (Apple Silicon and Intel `.dmg`) and Linux (`.AppImage`,
`.deb`, `.rpm`) and attaches them to a draft GitHub Release. Running the workflow by hand
builds the same files as workflow artifacts. Bump `version` in `package.json` first; the app
takes its version from there.

Tests: `ci.yml` builds the app on Linux and drives it through WebDriver
(`scripts/e2e-desktop.mjs`: load the example, render, export MP4 and WebM, cancel, import).
Locally: `npm run build`, `cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol`,
then `xvfb-run node scripts/e2e-desktop.mjs` (needs `cargo install tauri-driver` and `webkit2gtk-driver`).

## FFmpeg builds and licensing

The release builds bundle GPL builds of FFmpeg (with libx264): BtbN/FFmpeg-Builds for Windows and
Linux, ffmpeg.martin-riedl.de for macOS. FFmpeg runs as a separate program, but distributing it
means meeting the GPL for that binary: say which build is included and where its source is.
The release notes and this file do that; keep the links current if the sources change.
Alternatively, point `MOSHPIT_FFMPEG_URL` at an LGPL build and use hardware H.264 encoders.

## Signing (not set up yet)

- **macOS:** builds are ad-hoc signed, so people have to right-click → Open the first time.
  An Apple Developer ID ($99/year) plus notarisation removes that: set `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and
  `APPLE_TEAM_ID` as repository secrets and pass them to `tauri-action`.
- **Windows:** a code-signing certificate avoids SmartScreen's "unknown publisher" warning.

## Next steps

- Raise `MAX_OUTPUT_FRAMES` (10 minutes at 24 fps) on desktop and keep preview frames in a disk
  cache instead of RAM for long projects.
- Hardware export: `h264_videotoolbox` / `hevc_videotoolbox` and ProRes on Mac; `h264_nvenc`,
  `h264_qsv`, `h264_amf` on Windows. Detect with `ffmpeg -encoders` at startup.
- Open media by path instead of copying it into the app's storage, and save projects as files next
  to the media.
- In-app updates with Tauri's updater plugin (needs a signing key for update bundles).
- Phone apps from the same code (Tauri 2 also targets iOS and Android, using ffmpeg.wasm there).
  Until then the installable web app covers phones.
