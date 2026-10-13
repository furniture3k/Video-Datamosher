// Broad UI sweep: exercises every effect, codec, panel and dialog in the real app and fails on any page error.
// Usage: npm run build && node scripts/e2e-ui.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const url = `http://localhost:${server.address().port}/`;
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text()) && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Test preset' : undefined));

const S = (fn, arg) => page.evaluate(fn, arg);
const idle = () => page.waitForFunction(() => { const s = window.__moshpit.store; return !s.status.busy && !s.status.pending; }, null, { timeout: 180000 });
const settle = async () => {
  await page.waitForTimeout(500);
  await idle();
  const err = await S(() => window.__moshpit.store.status.error);
  if (err) throw new Error('render error: ' + err);
};
let failed = 0;
const step = async (name, fn) => {
  process.stdout.write(`• ${name}… `);
  try {
    await fn();
    if (errors.length) throw new Error(errors.splice(0).join('\n'));
    console.log('ok');
  } catch (e) {
    failed++;
    console.log('FAILED\n   ' + String(e.message).split('\n').slice(0, 6).join('\n   '));
  }
};

await page.goto(url);
await step('demo', async () => {
  await page.getByRole('button', { name: '▶ Try a demo' }).click();
  await settle();
});

const effectTypes = await S(() => ['kill', 'bloom', 'splice', 'stutter', 'shuffle', 'reverse', 'echo', 'drop', 'glitch', 'vectorWarp', 'chroma', 'pixelSort']);
for (const t of effectTypes)
  await step(`effect ${t} renders (UI add + delete)`, async () => {
    await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
    await page.keyboard.press('a');
    await page.locator('.card').filter({ hasText: await S((t) => ({ kill: 'Keyframe Killer', bloom: 'Bloom', splice: 'Motion Transfer', stutter: 'Stutter Loop', shuffle: 'Shuffle', reverse: 'Reverse Motion', echo: 'Echo', drop: 'Frame Drop', glitch: 'Byte Glitch', vectorWarp: 'Vector Warp', chroma: 'Chroma Drift', pixelSort: 'Pixel Sort' })[t], t) }).first().click();
    await settle();
    const n = await S(() => window.__moshpit.store.render.frames.length);
    if (!n) throw new Error('no frames');
    await page.keyboard.press('Delete');
  });

await step('advanced mode + every glitch mode via UI select', async () => {
  await page.locator('label.mode input').check();
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
  await page.keyboard.press('a');
  await page.locator('.card').filter({ hasText: 'Byte Glitch' }).click();
  for (const mode of ['flip', 'shift', 'insert', 'delete', 'swap']) {
    await page.locator('.pc select').first().selectOption(mode);
    await settle();
  }
});

await step('LFO automation on a number param', async () => {
  await page.locator('.pc').filter({ hasText: 'Amount' }).getByTitle(/Automate/).click();
  await page.getByRole('button', { name: 'LFO' }).click();
  await settle();
  const auto = await S(() => window.__moshpit.store.project.effects[0].auto.amount?.kind);
  if (auto !== 'lfo') throw new Error('lfo not set');
});

for (const codec of ['mpeg2', 'mpeg1', 'mpeg4'])
  await step(`codec ${codec} at 12 fps`, async () => {
    await page.locator('nav button', { hasText: 'Encode' }).click();
    await page.locator('.field').filter({ hasText: 'Mosh codec' }).locator('select').selectOption(codec);
    await page.locator('.field').filter({ hasText: 'Frame rate' }).locator('select').selectOption('12');
    await settle();
  });

await step('encoder internals toggles', async () => {
  await page.locator('.field').filter({ hasText: 'B-frames' }).locator('input[type=number]').fill('2');
  await page.locator('.field').filter({ hasText: 'B-frames' }).locator('input[type=number]').press('Enter');
  await page.locator('.field').filter({ hasText: 'Quarter-pixel' }).locator('input').check();
  await page.locator('.field').filter({ hasText: 'Frame rate' }).locator('select').selectOption('24');
  await settle();
});

await step('audio panel', async () => {
  await page.locator('nav button', { hasText: 'Audio' }).click();
  await page.locator('.field').filter({ hasText: 'Sync mode' }).locator('select').selectOption('original');
  await settle();
});

await step('presets: apply each built-in', async () => {
  const n = await S(() => document.querySelectorAll('.card').length);
  await page.keyboard.press('p');
  const names = await page.locator('.modal .card b').allTextContents();
  for (const name of names) {
    await page.locator('.modal .card').filter({ hasText: name }).first().click();
    await settle();
    await page.keyboard.press('p');
  }
  await page.keyboard.press('Escape');
});

await step('save user preset + delete it', async () => {
  await page.keyboard.press('p');
  await page.getByRole('button', { name: /Save current as preset/ }).click();
  await page.getByText('Test preset').waitFor();
  await page.locator('.card-wrap .del').first().click();
  await page.keyboard.press('Escape');
});

await step('share code round trip', async () => {
  const before = await S(() => JSON.stringify(window.__moshpit.store.project.effects.map((e) => [e.type, e.start, e.end])));
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Share/ }).click();
  await page.waitForFunction(() => document.querySelector('textarea[readonly]')?.value.startsWith('MOSH:'));
  const code = await page.locator('textarea[readonly]').inputValue();
  await page.keyboard.press('Escape');
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Share/ }).click();
  await page.locator('textarea:not([readonly])').fill(code);
  await page.getByRole('button', { name: 'Apply to my project' }).click();
  await settle();
  const after = await S(() => JSON.stringify(window.__moshpit.store.project.effects.map((e) => [e.type, e.start, e.end])));
  if (before !== after) throw new Error(`mismatch ${before} vs ${after}`);
});

await step('save + load project file', async () => {
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const f = path.join(os.tmpdir(), 'p.mosh.json');
  await (await dl).saveAs(f);
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
  await page.locator('input[type=file][accept*=json]').setInputFiles(f);
  await page.waitForFunction(() => window.__moshpit.store.project.effects.length > 0);
  await settle();
});

await step('remove a clip, then undo brings it back and renders', async () => {
  await page.waitForTimeout(1500);
  await page.locator('.clip').first().getByTitle('Remove clip').click();
  await page.waitForTimeout(2000); // past the autosave
  await page.keyboard.press('Control+z');
  await settle();
  const n = await S(() => window.__moshpit.store.project.clips.length);
  if (n !== 2) throw new Error('clips: ' + n);
});

await step('light theme + new project + undo', async () => {
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Light theme/ }).click();
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /New project/ }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+z');
  await settle();
});

await step('playback runs and loops', async () => {
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  const p1 = await S(() => window.__moshpit.store.ui.playhead);
  await page.waitForTimeout(500);
  const p2 = await S(() => window.__moshpit.store.ui.playhead);
  await page.keyboard.press('Space');
  if (!(p1 > 5 && p2 !== p1)) throw new Error(`playhead ${p1} -> ${p2}`);
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nUI sweep passed');
process.exitCode = failed ? 1 : 0;
