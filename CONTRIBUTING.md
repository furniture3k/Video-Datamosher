# Contributing

Thanks for helping out. Bug reports, presets, effect ideas and pull requests are all welcome.

## Reporting a bug

Open an [issue](https://github.com/furniture3k/Video-Datamosher/issues/new/choose) and say which
version you used (website, installed web app, or desktop app with its version and OS), what you
did, and what happened. A share code (**⋯ → Share code**) or a small project file makes moshes
easy to reproduce.

## Working on the code

```bash
npm install
npm run dev              # website at http://localhost:5173
npm run desktop          # desktop app (needs Rust; see DESKTOP.md)
```

Before opening a pull request:

```bash
npm run check            # type check
npm test                 # engine and pipeline tests (uses native ffmpeg if installed)
npm run build && npm run test:e2e   # drives the built app in Chromium (slow)
```

CI runs the same checks plus the desktop app's WebDriver test on Linux.

- `src/engine/` is framework-free TypeScript and is where most logic lives; add a test in `tests/` for engine changes.
- Every FFmpeg job goes through `ffmpeg.run()` (`src/lib/ffmpeg.ts`) so it works on both the browser and native engines. Don't call ffmpeg.wasm directly.
- Keep the web app working without the desktop shell: desktop-only code checks `isDesktop` (`src/lib/platform.ts`).

## Releases

Bump `version` in `package.json` (and `src-tauri/Cargo.toml`), add an entry to `CHANGELOG.md`,
then push a tag like `v1.2.0`. The **Desktop app** workflow builds the installers and attaches
them to a draft release; publish it once the files are there. The website deploys from `main`.

## License

By contributing you agree that your contributions are licensed under the
[GPL-3.0-or-later](LICENSE), like the rest of the project.
