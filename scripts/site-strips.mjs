// Cuts the frame strips for the website's "how a mosh works" diagram (public/site/strip-*.jpg)
// out of the comparison videos: the same eight moments around the first cut, clean and moshed.
// Usage: node scripts/site-strips.mjs   (needs ffmpeg; run it again after example-thumbs.mjs --site)
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// seconds; the cut (and the keyframe that gets removed) is at 2.5
export const TIMES = [1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5, 4.25];
const dir = path.resolve('public/site');
for (const name of ['before', 'after']) {
  // one frame per time, 240×135 each, side by side
  const select = TIMES.map((t) => `eq(n\\,${Math.round(t * 24)})`).join('+');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, `${name}.webm`), '-vf', `select='${select}',scale=240:135,tile=${TIMES.length}x1`, '-frames:v', '1', '-q:v', '4', path.join(dir, `strip-${name}.jpg`)]);
}
console.log('wrote public/site/strip-before.jpg and strip-after.jpg');
