The bundled FFmpeg goes here as `moshpit-ffmpeg-<target triple>` (`.exe` on Windows).
`npm run desktop:ffmpeg` downloads the right one; release builds in CI do this automatically.
For `npm run desktop` (development) it's optional: without it, the `ffmpeg` on your PATH is used.
