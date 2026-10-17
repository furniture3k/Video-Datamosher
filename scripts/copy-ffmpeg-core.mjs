// Copies the ffmpeg.wasm cores into public/ so the app works fully offline (no CDN): the
// single-threaded one, and the multithreaded one for browsers that allow it (see src/lib/ffmpeg.ts).
import fs from 'node:fs';
import path from 'node:path';
const copy = (pkg, dir, names) => {
  const src = path.resolve(`node_modules/${pkg}/dist/esm`);
  const dst = path.resolve('public/app', dir);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of names) {
    const a = path.join(src, f);
    const b = path.join(dst, f);
    if (!fs.existsSync(b) || fs.statSync(a).size !== fs.statSync(b).size) fs.copyFileSync(a, b);
  }
};
copy('@ffmpeg/core', 'ffmpeg', ['ffmpeg-core.js', 'ffmpeg-core.wasm']);
copy('@ffmpeg/core-mt', 'ffmpeg-mt', ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']);
console.log('ffmpeg cores ready in public/app/ffmpeg and public/app/ffmpeg-mt');
