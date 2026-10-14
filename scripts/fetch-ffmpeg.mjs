// Puts the FFmpeg the desktop app bundles at src-tauri/binaries/moshpit-ffmpeg-<target triple>[.exe].
//
//   node scripts/fetch-ffmpeg.mjs                 download a static build for this machine
//   node scripts/fetch-ffmpeg.mjs --target <triple>
//   node scripts/fetch-ffmpeg.mjs --dev           development: reuse the ffmpeg on PATH if there is one
//
// Builds: BtbN/FFmpeg-Builds (Windows, Linux) and ffmpeg.martin-riedl.de (macOS), all GPL static
// builds. Set MOSHPIT_FFMPEG_URL to use another archive (zip, tar.xz or a bare binary).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/';
const RIEDL = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/';
const URLS = {
  'x86_64-pc-windows-msvc': BTBN + 'ffmpeg-master-latest-win64-gpl.zip',
  'aarch64-pc-windows-msvc': BTBN + 'ffmpeg-master-latest-winarm64-gpl.zip',
  'x86_64-unknown-linux-gnu': BTBN + 'ffmpeg-master-latest-linux64-gpl.tar.xz',
  'aarch64-unknown-linux-gnu': BTBN + 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz',
  'aarch64-apple-darwin': RIEDL + 'arm64/release/ffmpeg.zip',
  'x86_64-apple-darwin': RIEDL + 'amd64/release/ffmpeg.zip',
};

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
    if (!recent) console.log(`the ffmpeg on PATH is ${v[1]}.${v[2]}; moshpit needs 5.1 or newer, downloading one`);
    if (which && recent) {
      fs.copyFileSync(which, dest);
      fs.chmodSync(dest, 0o755);
      writeNotice(`the ffmpeg installed on the build machine (${which})`);
      console.log('using the ffmpeg on PATH:', which);
      process.exit(0);
    }
  } catch {
    /* not installed: download one */
  }
}

const url = process.env.MOSHPIT_FFMPEG_URL || URLS[target];
if (!url) throw new Error(`no FFmpeg download for ${target}; set MOSHPIT_FFMPEG_URL`);
console.log('downloading', url);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moshpit-ffmpeg-'));
// name from the requested URL: redirects (GitHub release assets) end in opaque names
const file = path.join(tmp, path.basename(new URL(url).pathname) || 'ffmpeg');
fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));

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
writeNotice(url);
console.log('ffmpeg ready:', path.relative('.', dest));
