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
const idle = () => page.waitForFunction(() => { const s = window.__moshpit.store; return !s.status.busy && !s.status.pending && !s.status.engine; }, null, { timeout: 180000 });
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
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.waitForFunction(() => window.__moshpit.store.project.clips.some((c) => c.transition), null, { timeout: 120000 });
  await settle();
});

const effectTypes = await S(() => ['kill', 'bloom', 'splice', 'stutter', 'shuffle', 'reverse', 'echo', 'drop', 'glitch', 'vectorWarp', 'chroma', 'pixelSort']);
for (const t of effectTypes)
  await step(`effect ${t} renders (UI add + delete)`, async () => {
    await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
    await page.keyboard.press('Shift+A');
    await page.locator('.modal .item').filter({ hasText: await S((t) => ({ kill: 'Keyframe Killer', bloom: 'Bloom', splice: 'Motion Transfer', stutter: 'Stutter Loop', shuffle: 'Shuffle', reverse: 'Reverse Motion', echo: 'Echo', drop: 'Frame Drop', glitch: 'Byte Glitch', vectorWarp: 'Vector Warp', chroma: 'Chroma Drift', pixelSort: 'Pixel Sort' })[t], t) }).first().click();
    await settle();
    const n = await S(() => window.__moshpit.store.render.frames.length);
    if (!n) throw new Error('no frames');
    await page.keyboard.press('Delete');
  });

await step('advanced mode + every glitch mode via UI select', async () => {
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
  await page.keyboard.press('Shift+A');
  await page.locator('.modal .item').filter({ hasText: 'Byte Glitch' }).click();
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
    await page.locator('.tabs button', { hasText: 'Encode' }).click();
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
  await page.locator('.tabs button', { hasText: 'Audio' }).click();
  await page.locator('.field').filter({ hasText: 'Sync mode' }).locator('select').selectOption('original');
  await settle();
});

await step('presets: apply each built-in', async () => {
  await page.keyboard.press('p');
  const names = await page.locator('.modal .main .nm').allTextContents();
  for (const name of names) {
    await page.locator('.modal .main').filter({ hasText: name }).first().click();
    await settle();
    await page.keyboard.press('p');
  }
  await page.keyboard.press('Escape');
});

await step('save user preset + delete it', async () => {
  await page.keyboard.press('p');
  await page.getByRole('button', { name: /Save current stack/ }).click();
  await page.getByText('Test preset').waitFor();
  await page.locator('.modal .del').first().click();
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
  await page.getByRole('button', { name: 'Apply to this project' }).click();
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
  await page.locator('.clip.video').first().click();
  await page.keyboard.press('Delete');
  if ((await S(() => window.__moshpit.store.project.clips.length)) !== 1) throw new Error('delete did nothing: ' + (await S(() => JSON.stringify({ n: window.__moshpit.store.project.clips.length, sel: window.__moshpit.store.ui.selectedClips, dlg: window.__moshpit.store.ui.dialog, ae: document.activeElement?.outerHTML.slice(0, 80) }))));
  await page.waitForTimeout(2000); // past the autosave
  await page.keyboard.press('Control+z');
  await settle();
  const n = await S(() => window.__moshpit.store.project.clips.length);
  if (n !== 2) throw new Error('clips: ' + n);
});

await step('editor: split, trim, reorder, transitions', async () => {
  await S(() => window.__moshpit.store.seek(1));
  await page.locator('.wrap').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await S(() => (window.__moshpit.store.ui.selectedClips = []));
  await page.keyboard.press('s');
  if ((await S(() => window.__moshpit.store.project.clips.length)) !== 3) throw new Error('split failed');
  // trim the right edge of the first clip with the mouse
  const edge = page.locator('.clip.video').first().locator('.edge.r');
  const box = await edge.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x - 25, box.y + 10, { steps: 5 });
  await page.mouse.up();
  const out = await S(() => window.__moshpit.store.project.clips[0].out);
  if (!(out < 1)) throw new Error('trim failed: ' + out);
  // drag the last clip to the front
  const lastId = await S(() => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').at(-1).id);
  const last = page.locator('.clip.video').last();
  const lb = await last.boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + 20);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2 - 30, lb.y + 20, { steps: 3 });
  const vb = await page.locator('.v-lane').boundingBox();
  await page.mouse.move(vb.x + 2, lb.y + 20, { steps: 8 });
  await page.mouse.up();
  const first = await S(() => window.__moshpit.store.project.clips[0].id);
  if (first !== lastId) throw new Error('reorder failed');
  // every transition type renders
  for (const t of ['dissolve', 'wipeleft', 'pixelize', 'melt', 'bloom', 'glitch', 'stutter', 'liquid']) {
    await S((t) => { const s = window.__moshpit.store; const v = s.project.clips.filter((c) => c.track === 'v1'); window.__moshpit.edit.setTransition(v[1].id, t); }, t);
    await settle();
  }
  await page.locator('.trans').first().click();
  await page.locator('.tabs button', { hasText: 'Clip' }).waitFor();
  await page.getByRole('button', { name: 'Remove transition' }).click();
  await settle();
});

await step('editor: titles (clean and melted) + audio track + detach', async () => {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('textarea[aria-label=Text]').fill('MOSH');
  await page.locator('.field').filter({ hasText: 'Melt with the video' }).locator('input').check();
  await settle();
  await page.locator('.field').filter({ hasText: 'Melt with the video' }).locator('input').uncheck();
  await settle();
  await page.getByRole('button', { name: /Audio track/ }).first().click();
  const tracks = await S(() => window.__moshpit.store.project.tracks.length);
  if (tracks < 4) throw new Error('no new track');
});

await step('editor: edit view plays and keeps time', async () => {
  await S(() => window.__moshpit.store.setPref('view', 'edit'));
  await S(() => window.__moshpit.store.seek(0));
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  const t = await S(() => window.__moshpit.store.ui.time);
  if (!(t > 0.5)) throw new Error('edit playback did not advance: ' + t);
  await S(() => window.__moshpit.store.setPref('view', 'auto'));
  await settle();
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

const alignment = () =>
  S(() => {
    const lane = document.querySelector('.v-lane');
    const g = lane.previousElementSibling.getBoundingClientRect();
    const l = lane.getBoundingClientRect();
    const v = window.__moshpit.store.project.clips.filter((c) => c.track === 'v1');
    const second = document.querySelectorAll('.clip.video')[1]?.getBoundingClientRect();
    return { gap: Math.abs(l.left - g.right), height: Math.abs(l.height - g.height), n: v.length, second: second?.left };
  });

await step('timeline lanes line up with headers and the playhead', async () => {
  const a = await alignment();
  if (a.gap > 0.5 || a.height > 0.5) throw new Error('track headers and lanes misaligned: ' + JSON.stringify(a));
  // put the playhead exactly on the second clip's start and compare positions
  const cut = await S(() => {
    const s = window.__moshpit.store;
    const v = s.project.clips.filter((c) => c.track === 'v1');
    const len = (c) => (c.out - c.in) / c.speed;
    const t = len(v[0]) - (v[1].transition && ['dissolve', 'dip', 'dipwhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'circleopen', 'pixelize'].includes(v[1].transition.type) ? Math.min(v[1].transition.duration, len(v[0]) / 2, len(v[1]) / 2) : 0);
    s.seek(t);
    return t;
  });
  await page.waitForTimeout(200);
  const pos = await S(() => [document.querySelector('.phead.main').getBoundingClientRect().left, document.querySelectorAll('.clip.video')[1].getBoundingClientRect().left]);
  if (Math.abs(pos[0] - pos[1]) > 1) throw new Error(`playhead at ${pos[0]} but the cut (${cut}s) is drawn at ${pos[1]}`);
});

await step('phone layout: one panel at a time, timeline usable', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  for (const tab of ['Media', 'Inspector', 'Timeline']) {
    await page.locator('.mtabs button', { hasText: tab }).click();
    await page.waitForTimeout(150);
  }
  const box = await page.locator('footer .v-lane').boundingBox();
  if (!box || box.y + box.height > 844 || box.height < 30) throw new Error('timeline not on screen: ' + JSON.stringify(box));
  const a = await alignment();
  if (a.gap > 0.5 || a.height > 0.5) throw new Error('phone: track headers and lanes misaligned: ' + JSON.stringify(a));
  const overflow = await S(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollHeight > window.innerHeight + 1);
  if (overflow) throw new Error('page overflows the phone screen');
  await page.setViewportSize({ width: 1440, height: 900 });
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nUI sweep passed');
process.exitCode = failed ? 1 : 0;
