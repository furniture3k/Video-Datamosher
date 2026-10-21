// Renders the looping previews of the templates and examples on the home screen
// (public/app/examples/<thumb>.webm and a .jpg poster) with the app itself, from its sample footage.
// With --site it renders the website's videos instead (public/site/: the hero, and the same clips
// before and after moshing for the comparison slider).
// Usage: npm run build && node scripts/example-thumbs.mjs [--site] [thumb…]   (needs a fresh build)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dist = path.resolve(process.env.DIST || 'dist');
const out = path.resolve('public/app/examples');
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
await ctx.addInitScript(() => {
  for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${server.address().port}/app/`);
await page.waitForFunction(() => window.__moshpit?.starters);
// titles in the Impact style look the same on every machine (Linux has no Impact): a condensed font of the same weight under its name
await page.evaluate(async () => {
  try {
    const css = await (await fetch('https://fonts.googleapis.com/css2?family=Anton')).text();
    // the Latin letters' file (the CSS lists one file per alphabet)
    const url = /\/\* latin \*\/[^}]*?url\((https:[^)]+)\)/.exec(css)?.[1];
    if (!url) return;
    const face = new FontFace('Impact', await (await fetch(url)).arrayBuffer());
    await face.load();
    document.fonts.add(face);
  } catch {
    /* the thin fallback, then */
  }
});
// cut-outs without downloading a model: the subject is whatever differs from the colour in the
// corners (the sample footage's subjects sit on a plain background)
await page.evaluate(() =>
  window.__moshpit.objectseg.setObjectSegmenter(async (img) => {
    const w = 96;
    const h = Math.max(2, Math.round((w * img.height) / img.width));
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const at = (x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1], d[(y * w + x) * 4 + 2]];
    const bg = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)].reduce((a, q) => a.map((v, i) => v + q[i] / 4), [0, 0, 0]);
    const data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = Math.hypot(d[i * 4] - bg[0], d[i * 4 + 1] - bg[1], d[i * 4 + 2] - bg[2]) > 150 ? 255 : 0;
    return { w, h, data };
  }),
);

/** In the page: export the open project as WebM, with a poster frame. */
const EXPORT = async ({ width, crf, seconds }) => {
  const m = window.__moshpit;
  const st = m.store;
  while (st.status.busy || st.status.pending || st.status.engine) await new Promise((r) => setTimeout(r, 200));
  const p = JSON.parse(JSON.stringify(st.project));
  const len = Math.min(seconds, st.totalFrames / p.encoder.fps);
  const ex = await m.renderer.exportVideo(p, { format: 'webm', width, scaler: 'bicubic', crf, preset: 'veryfast', gifColors: 128, gifDither: 'bayer', gifFps: 15, loop: true, audio: false, range: [0, len] }, () => {}, { cancelled: false });
  const blob = ex.blob;
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
  const b64 = await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(String(fr.result).split(',')[1]);
    fr.readAsDataURL(blob);
  });
  return { webm: b64, jpg: c.toDataURL('image/jpeg', 0.82).split(',')[1] };
};
const save = (dir, name, r) => {
  fs.writeFileSync(path.join(dir, name + '.webm'), Buffer.from(r.webm, 'base64'));
  fs.writeFileSync(path.join(dir, name + '.jpg'), Buffer.from(r.jpg, 'base64'));
  console.log(`${Math.round(Buffer.from(r.webm, 'base64').length / 1024)} KB`);
};

if (process.argv.includes('--site')) {
  const site = path.resolve('public/site');
  fs.mkdirSync(site, { recursive: true });
  fs.copyFileSync(path.resolve('docs/studio.png'), path.join(site, 'studio.png'));
  const videos = !process.argv.includes('--gallery-only');
  // three drawn shots melting into each other
  if (videos) await page.evaluate(async () => {
    const m = window.__moshpit;
    await m.starters.openExample({
      id: 'site', name: 'moshpit', description: '', thumb: '',
      sample: [['nightdrive', 2.5], ['citylights', 2.5], ['sunset', 2.5]],
      build: () => m.store.edit((p) => {
        const v = p.clips.filter((c) => c.track === 'v1');
        if (v[1]) v[1].transition = { type: 'melt', duration: 1.2, intensity: 0.6 };
        if (v[2]) v[2].transition = { type: 'bloom', duration: 1.2, intensity: 0.6 };
      }),
    });
  });
  if (videos) {
  process.stdout.write('• hero… ');
  save(site, 'hero', await page.evaluate(EXPORT, { width: 512, crf: 50, seconds: 7 }));
  process.stdout.write('• after… ');
  save(site, 'after', await page.evaluate(EXPORT, { width: 480, crf: 50, seconds: 7 }));
  // the same clips, cut together without any moshing
  await page.evaluate(() => {
    const st = window.__moshpit.store;
    st.edit((p) => {
      for (const c of p.clips) c.transition = undefined;
      for (const t of p.layers) t.moshed = false;
      p.effects = [];
    });
  });
  process.stdout.write('• before… ');
  save(site, 'before', await page.evaluate(EXPORT, { width: 480, crf: 50, seconds: 7 }));
  }
  // the gallery starts with the examples and their recipes (people's posts are added after them)
  const gallery = path.join(site, 'gallery.json');
  const posts = fs.existsSync(gallery) ? JSON.parse(fs.readFileSync(gallery, 'utf8')).filter((g) => g.author !== 'moshpit') : [];
  const seeds = [];
  for (const id of ['ex-melt', 'ex-vortex', 'ex-life', 'ex-bloom']) {
    const g = await page.evaluate(async (id) => {
      const m = window.__moshpit;
      const e = m.starters.EXAMPLES.find((x) => x.id === id);
      await m.starters.openExample(e);
      return { title: e.name, author: 'moshpit', media: `./app/examples/${e.thumb}.webm`, poster: `./app/examples/${e.thumb}.jpg`, recipe: await m.projectio.shareCode() };
    }, id);
    seeds.push(g);
  }
  fs.writeFileSync(gallery, JSON.stringify([...posts, ...seeds], null, 2) + '\n');
  console.log(`• gallery: ${posts.length} posts + ${seeds.length} examples`);
  await browser.close();
  server.close();
  process.exit(0);
}

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
  await page.evaluate(async (id) => {
    const m = window.__moshpit;
    await m.starters.openExample([...m.starters.EXAMPLES, ...m.starters.TEMPLATES].find((x) => x.id === id));
  }, id);
  save(out, thumb, await page.evaluate(EXPORT, { width: 256, crf: 42, seconds: 4 }));
}
await browser.close();
server.close();
