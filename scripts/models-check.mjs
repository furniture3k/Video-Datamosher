// Checks the on-device models for real: cut a known dog out of a committed photo (with each
// cut-out model) and find a known face in a committed portrait, and report pass/fail with timings.
// This is the one script that uses the network (models come from public CDNs on first use, then the
// browser caches them) and the one that opens a visible browser. Run it by hand, after `npm run build`:
//
//   node scripts/models-check.mjs                 (both models, a visible browser)
//   HEADLESS=1 node scripts/models-check.mjs      (no window)
//   THROTTLE=4 node scripts/models-check.mjs      (CPU slowed 4×, a stand-in for a phone)
//   ONLY=sam node scripts/models-check.mjs        (one cut-out model: sam or mediapipe)
//   FRAMES=8 node scripts/models-check.mjs        (frames for the speed test, default 6)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const fixtures = path.resolve('tests/fixtures');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http
  .createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let f = u.startsWith('/fixtures/') ? path.join(fixtures, u.slice('/fixtures/'.length)) : path.join(dist, u);
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || chromium.executablePath(),
  headless: !!process.env.HEADLESS,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  if (window !== window.top) return;
  for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page error]', e.message));
if (process.env.THROTTLE) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  console.log(`CPU throttled ${process.env.THROTTLE}×`);
}
await page.goto(base + '/app/');
await page.waitForFunction(() => window.__moshpit?.objectseg && window.__moshpit?.faces, null, { timeout: 30000 });
const info = await page.evaluate(() => ({ webgpu: !!navigator.gpu, ua: navigator.userAgent, cores: navigator.hardwareConcurrency }));
console.log(`browser: ${info.ua.match(/Chrome\/[\d.]+/)?.[0]} · WebGPU ${info.webgpu ? 'yes' : 'no'} · ${info.cores} cores`);

let failed = 0;
const report = [];
const check = async (name, fn) => {
  process.stdout.write(`• ${name}… `);
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)${r ? ' ' + r : ''}`);
    report.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    failed++;
    console.log('FAILED\n   ' + String(e.message).split('\n').slice(0, 5).join('\n   '));
    report.push({ name, ok: false, error: String(e.message) });
  }
};

// ---- faces
await check('find a face in the portrait', async () => {
  const r = await page.evaluate(async (url) => {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const t0 = performance.now();
    const cold = await window.__moshpit.faces.detectFaces(c);
    const first = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) await window.__moshpit.faces.detectFaces(c);
    return { cold, first, warm: (performance.now() - t1) / 5 };
  }, base + '/fixtures/portrait.jpg');
  if (r.cold.length !== 1) throw new Error('expected one face, found ' + r.cold.length);
  const f = r.cold[0];
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  // the face is in the upper middle of the portrait
  if (!(cx > 0.38 && cx < 0.6 && cy > 0.08 && cy < 0.35 && f.w > 0.15 && f.w < 0.5)) throw new Error('the face is not where it should be: ' + JSON.stringify(f));
  return `first ${r.first.toFixed(0)} ms (model download and start), then ${r.warm.toFixed(0)} ms a frame`;
});

// ---- cut-outs: three known subjects, each from a tap on them
const CASES = [
  { name: 'dog', file: 'dog.jpg', taps: [[0.5, 0.5], [0.3, 0.4], [0.82, 0.13]], inside: [[0.5, 0.5], [0.3, 0.4], [0.82, 0.13]], outside: [[0.05, 0.1], [0.95, 0.9]], area: [0.2, 0.65] },
  { name: 'astronaut', file: 'astronaut.jpg', taps: [[0.54, 0.24], [0.51, 0.08], [0.6, 0.4]], inside: [[0.54, 0.24], [0.51, 0.08], [0.6, 0.4]], outside: [[0.1, 0.1], [0.9, 0.9], [0.1, 0.9]], area: [0.07, 0.3] },
  { name: 'portrait', file: 'portrait.jpg', taps: [[0.5, 0.75], [0.2, 0.6], [0.5, 0.2]], inside: [[0.5, 0.75], [0.2, 0.6], [0.5, 0.2]], outside: [[0.05, 0.3], [0.92, 0.08]], area: [0.25, 0.8] },
];
const backends = (process.env.ONLY ? [process.env.ONLY] : ['mediapipe', 'sam']).filter((b) => b === 'sam' || b === 'mediapipe');
const FRAMES = Number(process.env.FRAMES || 6);
fs.mkdirSync('test-results', { recursive: true });
for (const backend of backends)
  for (const c of CASES) {
    await check(`cut out the ${c.name} with ${backend}`, async () => {
      const r = await page.evaluate(
        async ({ url, backend, c, FRAMES }) => {
          const { objectseg } = window.__moshpit;
          objectseg.setObjectBackend(backend);
          const img = await createImageBitmap(await (await fetch(url)).blob());
          const heap = () => performance.memory?.usedJSHeapSize ?? 0;
          const h0 = heap();
          const t0 = performance.now();
          const s = await objectseg.openFrame(img);
          // the quick model takes one tap; the precise one follows several, which say which thing is meant
          const prompt = { points: (backend === 'sam' ? c.taps : c.taps.slice(0, 1)).map(([x, y]) => [x, y, 1]) };
          const m = await s.mask(prompt);
          const first = performance.now() - t0;
          s.close();
          if (!m) return { none: true };
          const at = ([x, y]) => m.data[Math.min(m.h - 1, Math.floor(y * m.h)) * m.w + Math.min(m.w - 1, Math.floor(x * m.w))] > 127;
          let on = 0;
          for (const v of m.data) if (v > 127) on++;
          // the speed of cutting out through a clip: a new picture each time, the previous box and middle as the prompt
          const t1 = performance.now();
          for (let i = 0; i < FRAMES; i++) {
            const f = await objectseg.openFrame(img);
            await f.mask(prompt);
            f.close();
          }
          const perFrame = (performance.now() - t1) / FRAMES;
          const cv = document.createElement('canvas');
          cv.width = m.w;
          cv.height = m.h;
          const g = cv.getContext('2d');
          const id = g.createImageData(m.w, m.h);
          for (let i = 0; i < m.data.length; i++) id.data.set([m.data[i], m.data[i], m.data[i], 255], i * 4);
          g.putImageData(id, 0, 0);
          return { w: m.w, h: m.h, inside: c.inside.map(at), outside: c.outside.map(at), area: on / (m.w * m.h), first, perFrame, heapMB: (heap() - h0) / 1e6, load: objectseg.lastTimings.load, png: cv.toDataURL('image/png') };
        },
        { url: `${base}/fixtures/${c.file}`, backend, c, FRAMES },
      );
      if (r.none) throw new Error('the model found nothing');
      fs.writeFileSync(path.join('test-results', `models-${c.name}-${backend}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
      const line = `${r.perFrame.toFixed(0)} ms a frame (${(1000 / r.perFrame).toFixed(1)} a second) · first mask ${(r.first / 1000).toFixed(1)} s · model load ${(r.load / 1000).toFixed(1)} s · ${(r.area * 100).toFixed(0)}% of the picture · heap +${r.heapMB.toFixed(0)} MB`;
      report.push({ name: `${c.name}/${backend}`, perFrameMs: Math.round(r.perFrame), areaShare: Number(r.area.toFixed(3)), loadMs: Math.round(r.load), firstMs: Math.round(r.first), heapMB: Math.round(r.heapMB) });
      if (!r.inside.every(Boolean)) throw new Error(`the ${c.name} is not in the mask: ${line}`);
      if (r.outside.some(Boolean)) throw new Error(`the background is in the mask: ${line}`);
      if (!(r.area > c.area[0] && r.area < c.area[1])) throw new Error(`the mask is the wrong size: ${line}`);
      return line;
    });
  }

fs.writeFileSync(path.join('test-results', `models-report${process.env.THROTTLE ? '-throttled' : ''}.json`), JSON.stringify(report, null, 1));

console.log(failed ? `\n${failed} check(s) failed` : '\nModels check passed');
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
