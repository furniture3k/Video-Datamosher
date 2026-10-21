// Puts the FFmpeg the desktop app bundles at src-tauri/binaries/moshpit-ffmpeg-<target triple>[.exe].
//
//   node scripts/fetch-ffmpeg.mjs                 build it from source for this machine (scripts/build-ffmpeg.sh)
//   node scripts/fetch-ffmpeg.mjs --target <triple>
//   node scripts/fetch-ffmpeg.mjs --dev           development: reuse the ffmpeg on PATH if there is one
//
// Nothing prebuilt is downloaded from anyone: the release builds make FFmpeg from checked source
// in .github/workflows/ffmpeg.yml, and so does this. To use an archive of your own instead, set
// MOSHPIT_FFMPEG_URL and MOSHPIT_FFMPEG_SHA256 (the file's SHA-256: it is checked before use).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const dev = argv.includes('--dev');
const ti = argv.indexOf('--target');
const host = () => {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (!arch) throw new Error('unsupported architecture ' + process.arch);
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  return `${arch}-unknown-linux-gnu`;
};
const target = ti >= 0 ? argv[ti + 1] : process.env.TAURI_TARGET_TRIPLE || host();
const win = target.includes('windows');
const dir = path.resolve('src-tauri/binaries');
const dest = path.join(dir, `moshpit-ffmpeg-${target}${win ? '.exe' : ''}`);

const NOTICE = path.join(dir, 'FFMPEG-NOTICE.txt');
/** Written next to the binary and bundled with the app: which FFmpeg this is and where its source is. */
function writeNotice(origin) {
  let version = '';
  try {
    version = execFileSync(dest, ['-version'], { encoding: 'utf8' }).split(/\r?\n/)[0];
  } catch {
    /* built for another architecture: can't run it here */
  }
  fs.writeFileSync(
    NOTICE,
    `moshpit bundles FFmpeg as a separate program (moshpit-ffmpeg).

${version || 'FFmpeg'}
Built for: ${target}
Obtained from: ${origin}

FFmpeg is free software. This build includes GPL components (such as libx264), so it is
licensed under the GNU General Public License (version 2 or later, or version 3 or later
when built with --enable-version3; \`moshpit-ffmpeg -version\` prints the configuration).
See https://ffmpeg.org/legal.html.
Source code: https://git.ffmpeg.org/ffmpeg.git (the version line above names the release or
commit) and https://ffmpeg.org/download.html. The build scripts are linked from the page above.
moshpit's own source: https://github.com/furniture3k/Video-Datamosher
`,
  );
}

fs.mkdirSync(dir, { recursive: true });
if (fs.existsSync(dest) && !argv.includes('--force')) {
  if (!fs.existsSync(NOTICE)) writeNotice('a local copy');
  console.log('ffmpeg ready:', path.relative('.', dest));
  process.exit(0);
}

if (dev) {
  try {
    const which = execFileSync(win ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    // the app needs FFmpeg 5.1 or newer (-fps_mode); development builds ("N-…") are recent
    const v = /ffmpeg version n?(\d+)\.(\d+)/.exec(execFileSync(which, ['-version'], { encoding: 'utf8' }));
    const recent = !v || +v[1] > 5 || (+v[1] === 5 && +v[2] >= 1);
    if (!recent) console.log(`the ffmpeg on PATH is ${v[1]}.${v[2]}; moshpit needs 5.1 or newer, building one`);
    if (which && recent) {
      fs.copyFileSync(which, dest);
      fs.chmodSync(dest, 0o755);
      writeNotice(`the ffmpeg installed on the build machine (${which})`);
      console.log('using the ffmpeg on PATH:', which);
      process.exit(0);
    }
  } catch {
    /* not installed: build one */
  }
}

/** The download, tried again a few times (waiting longer each time) when the server is down or busy or the connection drops. */
async function download(u) {
  const waits = [5, 15, 30, 60, 120];
  for (let i = 0; ; i++) {
    let why;
    try {
      const r = await fetch(u, { redirect: 'follow' });
      if (r.ok) return r;
      // a missing file won't appear by waiting; a server error or rate limit might pass
      if (r.status < 500 && r.status !== 429) throw new Error(`download failed: ${r.status} ${r.statusText}`);
      why = `${r.status} ${r.statusText}`;
    } catch (e) {
      if (String(e.message).startsWith('download failed')) throw e;
      why = e.message;
    }
    if (i >= waits.length) throw new Error(`download failed: ${why}`);
    console.log(`download failed (${why}), trying again in ${waits[i]} s`);
    await new Promise((r) => setTimeout(r, waits[i] * 1000));
  }
}

const url = process.env.MOSHPIT_FFMPEG_URL;
if (!url) {
  // built here, from the pinned sources (Windows builds are cross-compiled on Linux)
  if (process.platform === 'win32') throw new Error('Building FFmpeg needs macOS or Linux (WSL works). Or set MOSHPIT_FFMPEG_URL and MOSHPIT_FFMPEG_SHA256 to an archive you trust.');
  execFileSync('bash', [path.resolve('scripts/build-ffmpeg.sh'), target], { stdio: 'inherit' });
  process.exit(0);
}
const want = (process.env.MOSHPIT_FFMPEG_SHA256 || '').toLowerCase();
if (!/^[0-9a-f]{64}$/.test(want)) throw new Error('MOSHPIT_FFMPEG_URL needs MOSHPIT_FFMPEG_SHA256: the SHA-256 of that file, so what is downloaded is checked before it goes into the app.');
console.log('downloading', url);
const res = await download(url);
const data = Buffer.from(await res.arrayBuffer());
const got = createHash('sha256').update(data).digest('hex');
if (got !== want) throw new Error(`${url} is not the file expected: its SHA-256 is ${got}, not ${want}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moshpit-ffmpeg-'));
// name from the requested URL: redirects (GitHub release assets) end in opaque names
const file = path.join(tmp, path.basename(new URL(url).pathname) || 'ffmpeg');
fs.writeFileSync(file, data);

let bin = file;
if (/\.(zip|tar\.xz|tar\.gz|tgz)$/.test(file)) {
  const out = path.join(tmp, 'x');
  fs.mkdirSync(out);
  // bsdtar (Windows 10+, macOS) reads zip too; GNU tar on Linux gets xz/gz archives
  if (file.endsWith('.zip') && process.platform === 'linux') execFileSync('unzip', ['-q', file, '-d', out]);
  else execFileSync('tar', ['-xf', file, '-C', out]);
  const want = win ? 'ffmpeg.exe' : 'ffmpeg';
  const find = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        const r = find(p);
        if (r) return r;
      } else if (e.name === want) return p;
    }
  };
  bin = find(out);
  if (!bin) throw new Error(`no ${want} in ${url}`);
}
fs.copyFileSync(bin, dest);
fs.chmodSync(dest, 0o755);
fs.rmSync(tmp, { recursive: true, force: true });
writeNotice(`${url} (sha256 ${want})`);
console.log('ffmpeg ready:', path.relative('.', dest));
