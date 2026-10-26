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
- **Linux.** The AppImage bundles GStreamer and its plugins (`bundleMediaFramework`), which WebKitGTK
  needs for sound and video: the host's plugins are built for another GStreamer and crash the page.
  It leaves out GStreamer's libsoup 2 HTTP source, which can't share a process with WebKit's
  libsoup 3. The `.deb` depends on the GStreamer plugins instead. With NVIDIA's proprietary driver
  the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` (unless it is already set), which that driver needs.
  - *Proxies*: libsoup 3.0 (Ubuntu 22.04's, and so the AppImage's) tunnels twice through an HTTPS
    proxy when WebKit leaves the proxy to the system, and its network process crashes. Where the
    webview runs on libsoup older than 3.2, the app looks up the system's proxy and hands it to
    WebKit itself (`src-tauri/src/proxy.rs`), so libsoup tunnels once.
  - *The app's own videos*: WebKitGTK before 2.52 plays media from `http(s)` and `blob:` URLs only,
    not `tauri://`, so the template previews are read into blobs on Linux (`src/lib/appvideo.ts`).
  - The app's interface font is bundled: it starts without the internet.
- **FFmpeg** is bundled next to the app as `moshpit-ffmpeg`. `MOSHPIT_FFMPEG=/path/to/ffmpeg`
  overrides it; if it's missing, the `ffmpeg` on PATH is used.

## Building

Prerequisites: Node 22, [Rust](https://rustup.rs), and on Linux the
[WebKitGTK packages](https://tauri.app/start/prerequisites/#linux)
(`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`), plus the GStreamer plugins the AppImage bundles
(`gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav`).

```bash
npm install
npm run desktop          # development window with hot reload
npm run desktop:build    # installers in src-tauri/target/release/bundle/
```

`npm run desktop` copies the `ffmpeg` on your PATH into `src-tauri/binaries/` (or builds one if
there is none). `npm run desktop:build` builds FFmpeg from source for the current platform
(`scripts/fetch-ffmpeg.mjs`, which runs `scripts/build-ffmpeg.sh`; `--target <triple>` for another
one). Building needs macOS or Linux with a C compiler, `make`, `nasm`, `pkg-config`, `git`, `curl`
and `gpg` (and `mingw-w64` for a Windows build); it takes a few minutes and is kept once made. To use
an archive of your own instead, set `MOSHPIT_FFMPEG_URL` and `MOSHPIT_FFMPEG_SHA256`.

Releases: pushing a tag like `v1.1.0` (or running the workflow by hand with **release** ticked,
which tags `v<version>` from `package.json`) runs `.github/workflows/desktop.yml`, which builds Windows
(x64 `.msi` + `-setup.exe`), macOS (Apple Silicon and Intel `.dmg`) and Linux (`.AppImage`,
`.deb`, `.rpm`), attaches them to a draft GitHub Release and publishes it once every build
succeeded. Running the workflow by hand without **release** only builds them as workflow artifacts. Bump `version` in `package.json` first; the app
takes its version from there.

Smoke test: every installer the release workflow builds is installed (or opened) and checked
before the release is published (the `smoke` job in `desktop.yml`): Windows Server 2022 and 2025 (the
`.msi` and the `-setup.exe`), macOS 14 and 15 on Apple Silicon and Intel (and the Intel build under
Rosetta), and Linux in fresh containers of Ubuntu 22.04 and 24.04, Debian 12 and 13, Fedora, Arch and
openSUSE (the AppImage, and the `.deb` or `.rpm`). `MOSHPIT_SMOKE_TEST=1` makes the app check, once the
page has loaded, that the editor comes up, sound decodes and plays, the template previews and an
imported clip play, and the bundled FFmpeg runs; `MOSHPIT_SMOKE_TEST=network` also downloads a file
through the webview. It prints a report and exits 0 when all passed (`src-tauri/src/smoke.rs` and
`smoke.js`; `scripts/smoke-linux.sh`, `smoke-windows.ps1`, `smoke-macos.sh` set up each system).
For example: `MOSHPIT_SMOKE_TEST=1 ./moshpit_1.16.4_amd64.AppImage`.

Tests: `ci.yml` builds the app on Linux and drives it through WebDriver
(`scripts/e2e-desktop.mjs`: load the example, render, export MP4 and WebM, cancel, import).
Locally: `npm run build`, `cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol`,
then `xvfb-run node scripts/e2e-desktop.mjs` (needs `cargo install tauri-driver` and `webkit2gtk-driver`).

## FFmpeg builds and licensing

moshpit is GPL-3.0-or-later. The release builds bundle a GPL build of FFmpeg (with libx264) that
this project makes itself: nothing prebuilt is downloaded. `.github/workflows/ffmpeg.yml` runs
`scripts/build-ffmpeg.sh` for each platform (macOS on Apple Silicon, the Intel one under Rosetta;
Linux; Windows cross-compiled on Linux with mingw-w64 and then run on Windows to check it). Every
source is checked before it is built: FFmpeg's release tarball against the FFmpeg release signing
key and a pinned SHA-256, x264 and libvpx against pinned git commits, libvorbis, libogg and zlib
against pinned SHA-256s, all in `scripts/ffmpeg-sources.sh`. A source that changes upstream stops
the build. The build takes nothing from the build machine but its compiler (`--disable-autodetect`),
and the result is checked to need only the operating system's own libraries and to have every
encoder and filter the app uses (`scripts/check-ffmpeg.sh`). Builds are cached until the script or
the pins change.

To update a source: change its version in `scripts/ffmpeg-sources.sh` and empty its hash; the next
build stops and prints the hash of what it downloaded. Check it against the project's published
value, then pin it.

FFmpeg runs as a separate program. To meet the GPL for it, the build writes `FFMPEG-NOTICE.txt`
(the exact sources, license, where the source is), and every installer ships it next to
`LICENSE.txt` and `THIRD-PARTY-NOTICES.md`.

## Signing (not set up yet)

The installers aren't signed, so macOS and Windows warn the first time they're opened. Signing costs
money or needs an application, so it's left for later; everything is ready to switch on. The
commented-out lines in `.github/workflows/desktop.yml` (the `tauri-action` step) are where the
secrets go.

### macOS: Developer ID and notarisation

Needs an Apple Developer account ($99/year).

1. In Xcode or the developer site, create a **Developer ID Application** certificate and export it
   (with its private key) as a `.p12` file with a password.
2. Make an app-specific password for your Apple ID at appleid.apple.com.
3. Add these repository secrets (Settings → Secrets and variables → Actions):
   - `APPLE_CERTIFICATE`: the `.p12` file, base64-encoded (`base64 -i cert.p12 | pbcopy`)
   - `APPLE_CERTIFICATE_PASSWORD`: the `.p12` password
   - `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Your Name (TEAMID)`
   - `APPLE_ID`, `APPLE_PASSWORD` (the app-specific one) and `APPLE_TEAM_ID`
4. Uncomment the `APPLE_*` lines in `desktop.yml` and remove `"signingIdentity": "-"` from the
   `macOS` section of `src-tauri/tauri.conf.json`. Tauri signs and notarises during the build.

### Windows: code signing

Options, cheapest first:

- **SignPath Foundation**: free code signing for open-source projects. Apply at signpath.org; once
  accepted, their GitHub Action signs the installers from CI.
- **Azure Trusted Signing**: about $10/month; works with a `signCommand` in `tauri.conf.json`
  (see Tauri's Windows signing guide).
- A **certificate** from a certificate authority (about $200+/year), as a `.pfx`:
  `WINDOWS_CERTIFICATE` (base64) and `WINDOWS_CERTIFICATE_PASSWORD` secrets, imported in the
  workflow before `tauri-action`, with `certificateThumbprint` set under `bundle.windows`.

SmartScreen still warns about a new certificate until enough people have installed the app.

### Store releases (later)

The App Store and Microsoft Store need the same certificates plus their own developer accounts
(Apple $99/year; Microsoft has a one-off fee). Google Play (for an Android build) is a one-off $25.

## Android (experimental)

The same Tauri project builds an Android app: the editor in the system webview, with the browser's
video engine (ffmpeg.wasm) instead of a native FFmpeg. `src-tauri/src/lib.rs` has a separate
`run()` for mobile: no native engine, no file opening and no single-window handling; exports are
saved to Downloads by the `save_download` command (`src-tauri/src/mobile.rs`).
`src-tauri/tauri.android.conf.json` leaves out the desktop's FFmpeg and builds the web app with its
video engines (`npm run build`, not `build:desktop`). In the page, `isDesktop` is false on Android
(`isAndroidApp` is true), so everything else behaves as in a browser.

The **Android app** workflow (`.github/workflows/android.yml`) builds it on GitHub's runners (they
have the Android SDK and NDK): `tauri android init`, then an arm64 release APK, signed. It runs on
pull requests that touch the native side and by hand, and the Desktop app workflow attaches the APK
to each release. To build it yourself: install Android Studio (SDK and NDK), set `ANDROID_HOME`
and `NDK_HOME`, add the Rust target (`rustup target add aarch64-linux-android`), then
`npx tauri android init` and `npx tauri android build --apk --target aarch64`.

Signing: without the `ANDROID_KEYSTORE` (base64 of a `.jks`) and `ANDROID_KEYSTORE_PASSWORD`
secrets, each build gets a new self-signed key, so a new APK only installs after uninstalling the
old one (projects are kept in the app's storage, which uninstalling clears). Make one key once
(`keytool -genkeypair -keystore moshpit.jks -alias moshpit -keyalg RSA -keysize 2048 -validity
10000`) and add it as the secrets to keep updates in place.

Not tested on a phone yet. Until it is, the installable web app (open the site in Chrome, then
*Install app*) is the safer way to use moshpit on Android; it shares and opens files the same way.

Paid, for later: Google Play needs a developer account (a one-off $25) and the APK as an app bundle
(`tauri android build --aab`). iOS needs an Apple developer account ($99 a year) and a Mac to build
(`tauri ios init` / `tauri ios build`); the same mobile `run()` applies.

## Next steps

- Longer projects (over 30 minutes): keep preview frames in a disk cache and read them as the
  playhead moves, stream the soundtrack instead of holding whole-timeline buffers, then raise
  `MAX_OUTPUT_FRAMES_DESKTOP`. Exports are already disk-backed.
- Hardware export: `h264_videotoolbox` / `hevc_videotoolbox` and ProRes on Mac; `h264_nvenc`,
  `h264_qsv`, `h264_amf` on Windows. Detect with `ffmpeg -encoders` at startup.
- Open media by path instead of copying it into the app's storage, and save projects as files next
  to the media.
- In-app updates with Tauri's updater plugin (needs a signing key for update bundles).
- Test the Android build on phones, then iOS (see Android above).
