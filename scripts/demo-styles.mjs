// Builds the reference styles (R1-R9) with sample footage, exports each, pulls frames with ffmpeg
// and makes a contact sheet per style, in the gitignored demo-output/ folder.
// Usage: npm run build && node scripts/demo-styles.mjs      (ONLY=regex picks styles)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const out = path.resolve('demo-output');
fs.mkdirSync(out, { recursive: true });
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const url = `http://localhost:${server.address().port}/app/`;
const exe = process.env.CHROMIUM || chromium.executablePath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  if (window !== window.top) return;
  for (const [k, v] of Object.entries({ startHome: true, seenWelcome: true, autoMosh: true })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const S = (fn, arg) => page.evaluate(fn, arg);
const idle = () => page.waitForFunction(() => { const s = window.__moshpit.store; return !s.status.busy && !s.status.pending && !s.status.engine; }, null, { timeout: 300000 });

// R1 is not a starter: a subject sits between ornaments and the background, so it is built by hand
const STYLES = [
  { id: 'r2-kinetic-lyrics', ref: 'R2', starter: 'Kinetic lyrics' },
  { id: 'r3-scrapbook', ref: 'R3', starter: 'Scrapbook' },
  { id: 'r4-product-demo', ref: 'R4', starter: 'Product demo' },
  { id: 'r5-cinematic', ref: 'R5', starter: 'Cinematic' },
  { id: 'r6-degraded-film', ref: 'R6', starter: 'Degraded film' },
  { id: 'r7-r9-red-notes', ref: 'R7-R9', starter: 'Red notes' },
  { id: 'extra-split-screen', ref: '', starter: 'Split screen' },
];

const summary = [];
for (const st of STYLES) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(st.id)) continue;
  process.stdout.write(`• ${st.id}… `);
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__moshpit?.store && !window.__moshpit.store.status.engine, null, { timeout: 120000 });
    await page.locator('[data-testid=home]').waitFor();
    await page.locator('.starter', { hasText: st.starter }).first().click();
    await page.getByRole('button', { name: 'Try with sample footage' }).click();
    await page.waitForFunction(() => !window.__moshpit.store.ui.home && window.__moshpit.store.project.clips.length > 0, null, { timeout: 180000 });
    await page.waitForTimeout(800);
    await idle();
    // the editor view first (what the layers look like), then the mosh
    await page.screenshot({ path: path.join(out, st.id + '-editor.png') });
    // export as WebM through the queue
    await page.keyboard.press('e');
    await page.getByRole('button', { name: /^WebM/ }).click();
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await page.locator('.queue .job.done').waitFor({ timeout: 600000 });
    const dl = page.waitForEvent('download');
    await page.locator('.queue .job.done a[download]').click();
    const file = path.join(out, st.id + '.webm');
    await (await dl).saveAs(file);
    // frames: six evenly spaced, as a contact sheet
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) || 4;
    const fpsOut = (6 / dur).toFixed(4);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `fps=${fpsOut},scale=480:-1,tile=3x2:padding=6:color=black`, '-frames:v', '1', path.join(out, st.id + '-sheet.png')]);
    summary.push({ id: st.id, ref: st.ref, seconds: Math.round(dur * 10) / 10, bytes: fs.statSync(file).size });
    console.log('ok');
  } catch (e) {
    console.log('FAILED\n   ' + String(e.message).split('\n').slice(0, 4).join('\n   '));
    await page.screenshot({ path: path.join(out, st.id + '-failed.png') }).catch(() => {});
    summary.push({ id: st.id, ref: st.ref, failed: String(e.message).split('\n')[0] });
  }
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
await browser.close();
server.close();
console.log(`\n${summary.filter((s) => !s.failed).length}/${summary.length} styles exported to ${out}`);
process.exit(summary.some((s) => s.failed) ? 1 : 0);
