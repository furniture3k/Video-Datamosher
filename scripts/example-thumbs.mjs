// Renders the looping previews of the templates and examples on the home screen
// (public/examples/<thumb>.webm and a .jpg poster) with the app itself, from its sample footage.
// Usage: npm run build && node scripts/example-thumbs.mjs   (needs a fresh build of the app)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const out = path.resolve('public/examples');
fs.mkdirSync(out, { recursive: true });
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await ctx.addInitScript(() => {
  for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => window.__moshpit?.starters);

const only = process.argv.slice(2);
const thumbs = await page.evaluate(() => {
  const { TEMPLATES, EXAMPLES } = window.__moshpit.starters;
  const seen = new Map();
  // an example shows its own footage best; templates fill in the rest
  for (const s of [...EXAMPLES, ...TEMPLATES]) if (!seen.has(s.thumb)) seen.set(s.thumb, s.id);
  return [...seen.entries()];
});
for (const [thumb, id] of thumbs) {
  if (only.length && !only.includes(thumb)) continue;
  process.stdout.write(`• ${thumb} (${id})… `);
  const r = await page.evaluate(async (id) => {
    const m = window.__moshpit;
    const s = [...m.starters.EXAMPLES, ...m.starters.TEMPLATES].find((x) => x.id === id);
    await m.starters.openExample(s);
    const st = m.store;
    while (st.status.busy || st.status.pending || st.status.engine) await new Promise((r) => setTimeout(r, 200));
    const p = JSON.parse(JSON.stringify(st.project));
    const len = Math.min(4, st.totalFrames / p.encoder.fps);
    const ex = await m.renderer.exportVideo(p, { format: 'webm', width: 256, scaler: 'bicubic', crf: 42, preset: 'veryfast', gifColors: 128, gifDither: 'bayer', gifFps: 15, loop: true, audio: false, range: [0, len] }, () => {}, { cancelled: false });
    const blob = ex.blob;
    // the poster: a frame from the middle of the clip
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    await new Promise((r) => (v.onloadeddata = r));
    v.currentTime = Math.min(v.duration * 0.6, len * 0.6);
    await new Promise((r) => (v.onseeked = r));
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const jpg = c.toDataURL('image/jpeg', 0.8);
    const b64 = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(',')[1]);
      fr.readAsDataURL(blob);
    });
    return { webm: b64, jpg: jpg.split(',')[1] };
  }, id);
  fs.writeFileSync(path.join(out, thumb + '.webm'), Buffer.from(r.webm, 'base64'));
  fs.writeFileSync(path.join(out, thumb + '.jpg'), Buffer.from(r.jpg, 'base64'));
  console.log(`${Math.round(Buffer.from(r.webm, 'base64').length / 1024)} KB`);
}
await browser.close();
server.close();
