// Copies the ffmpeg.wasm core into public/ so the app works fully offline (no CDN).
import fs from 'node:fs';
import path from 'node:path';
const src = path.resolve('node_modules/@ffmpeg/core/dist/esm');
const dst = path.resolve('public/ffmpeg');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const a = path.join(src, f);
  const b = path.join(dst, f);
  if (!fs.existsSync(b) || fs.statSync(a).size !== fs.statSync(b).size) fs.copyFileSync(a, b);
}
console.log('ffmpeg core ready in public/ffmpeg');
