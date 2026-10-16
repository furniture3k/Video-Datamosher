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

## Translations

The app's text is in English in the code, wrapped in `t('…')` (`src/lib/i18n.svelte.ts`). Each
language has a file in `src/locales/` that maps the English text to its translation, for example
`src/locales/fr.json`. Text with no translation shows in English, so a language can be added a
piece at a time.

- **Improving a translation:** edit its file and open a pull request. The Spanish, Portuguese
  (Brazil), French, German and Japanese files started as drafts made by a machine, so a native
  speaker's eye is very welcome.
- **Adding a language:** copy one of the files, translate the right-hand sides, and add the language
  to `LOCALES` in `src/lib/i18n.ts`.
- **Adding text to the app:** wrap it in `t('…')` and add it to every file in `src/locales/`
  (`npm test` checks that each language has every text, with the same `{placeholders}`).

So far the home screen, the top bar and its menu, and the effect names are translated.

## Releases

Bump `version` in `package.json` (and `src-tauri/Cargo.toml`), add an entry to `CHANGELOG.md`,
then push a tag like `v1.2.0`, or run the **Desktop app** workflow from the Actions tab with
**release** ticked (it tags `v<version>` itself). It builds the installers, attaches them to a
release and publishes it once every build succeeded. The website deploys from `main`.

The newest `CHANGELOG.md` entry is shown in the app's **What's new** dialog after an update, so
write it for people using the app: what they can do now, in plain words. The top entry must match
the version in `package.json` (a test checks this).

## Bug reports and error reporting

**⋯ → Report a problem** opens the bug form (`.github/ISSUE_TEMPLATE/bug_report.yml`) with the
`diagnostics` field filled in by `src/lib/report.ts`. Nothing is sent until the person submits the
issue, and file names and file metadata are removed. If the project later wants automatic crash
reports (Sentry's free tier, for example), make them opt-in, send no media or file names, and say
so in the app and the README.

## License

By contributing you agree that your contributions are licensed under the
[GPL-3.0-or-later](LICENSE), like the rest of the project.
