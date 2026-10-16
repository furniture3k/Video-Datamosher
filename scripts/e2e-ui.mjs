// Broad UI sweep: exercises every effect, codec, panel and dialog in the real app and fails on any page error.
// Usage: npm run build && node scripts/e2e-ui.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const root = `http://localhost:${server.address().port}/`;
// the editor; the website is at the root
const url = root + 'app/';
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
// start in the editor (not the home screen), without the first-run tour or the automatic first mosh
await ctx.addInitScript(() => {
  for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 6).join('\n')));
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
// no model downloads in the sweep: a fake people segmenter (everything is a person)
await S(() => window.__moshpit.segment.setPersonSegmenter(async () => {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 9;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 16, 9);
  return c;
}));
await step('demo', async () => {
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.waitForFunction(() => window.__moshpit.store.project.clips.some((c) => c.transition), null, { timeout: 120000 });
  await settle();
});

const effectTypes = await S(() => ['kill', 'bloom', 'splice', 'stutter', 'shuffle', 'reverse', 'echo', 'drop', 'glitch', 'sequence', 'databend', 'mvedit', 'vectorWarp', 'chroma', 'pixelSort', 'rawbend', 'flowPaint', 'mask']);
for (const t of effectTypes)
  await step(`effect ${t} renders (UI add + delete)`, async () => {
    await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
    await page.keyboard.press('Shift+A');
    const name = { kill: 'Keyframe Killer', bloom: 'Bloom', splice: 'Motion Transfer', stutter: 'Stutter Loop', shuffle: 'Shuffle', reverse: 'Reverse Motion', echo: 'Echo', drop: 'Frame Drop', glitch: 'Byte Glitch', vectorWarp: 'Vector Warp', chroma: 'Chroma Drift', pixelSort: 'Pixel Sort', sequence: 'Frame Sequencer', databend: 'Databend', rawbend: 'Raw Bend', mvedit: 'Vector Edit', flowPaint: 'Flow Paint', mask: 'Subject Guard' }[t];
    // Simple mode lists the essentials; searching finds every effect
    await page.locator('.modal input[aria-label="Search effects"]').fill(name);
    await page.locator('.modal .item').filter({ hasText: name }).first().click();
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
  // Chromium has a Save dialog: stand in for it and keep what gets written
  await S(() => {
    window.__saved = { asked: 0, writes: [] };
    window.showSaveFilePicker = async (o) => {
      window.__saved.asked++;
      return { name: o.suggestedName, createWritable: async () => ({ write: async (b) => window.__saved.writes.push(await b.text()), close: async () => {} }) };
    };
  });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__saved.writes.length === 1);
  // Ctrl S again saves to the same file without asking
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__saved.writes.length === 2);
  if ((await S(() => window.__saved.asked)) !== 1) throw new Error('Ctrl S asked where to save twice');
  const f = path.join(os.tmpdir(), 'p.mosh.json');
  fs.writeFileSync(f, await S(() => window.__saved.writes[1]));
  await S(() => delete window.showSaveFilePicker);
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

await step('chaos dial: Q / Shift Q and drag', async () => {
  await page.keyboard.press('q');
  await page.keyboard.press('q');
  if ((await S(() => window.__moshpit.store.project.chaos)) !== 1.5) throw new Error('Q should push chaos to 150%');
  await settle();
  await page.keyboard.press('Shift+Q');
  await page.keyboard.press('Shift+Q');
  if ((await S(() => window.__moshpit.store.project.chaos)) !== undefined) throw new Error('Shift+Q should bring chaos back to as made');
  const dial = page.getByRole('slider', { name: 'Chaos' });
  const box = await dial.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  if (!((await S(() => window.__moshpit.store.project.chaos)) > 1.2)) throw new Error('dragging the dial up should make it wilder');
  await dial.dblclick();
  if ((await S(() => window.__moshpit.store.project.chaos)) !== undefined) throw new Error('double-click resets the dial');
  await settle();
});

await step('snapshots: save, compare, restore', async () => {
  const before = await S(() => window.__moshpit.store.project.effects.length);
  await page.getByRole('button', { name: 'Snapshots' }).click();
  await page.getByRole('button', { name: /Save snapshot/ }).click();
  await page.locator('.modal .card').first().waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  // the shortcut takes one too (nothing changed since, so no duplicate is added)
  await page.keyboard.press('Control+Shift+S');
  await S(() => window.__moshpit.store.edit((p) => (p.effects = [])));
  await page.getByRole('button', { name: 'Snapshots' }).click();
  await page.locator('.modal .card').first().getByRole('button', { name: 'Restore' }).click();
  await page.waitForFunction((n) => window.__moshpit.store.project.effects.length === n, before, { timeout: 10000 });
  if (await S(() => window.__moshpit.store.ui.dialog)) throw new Error('Restore should close the dialog');
  await settle();
  await page.getByRole('button', { name: 'Snapshots' }).click();
  await page.locator('.modal .card').first().getByRole('button', { name: 'Compare' }).click();
  await page.waitForFunction(() => window.__moshpit.store.ui.compareSnap && !document.querySelector('.stage-note')?.textContent?.includes('loading'), null, { timeout: 120000 });
  await S(() => ((window.__moshpit.store.ui.compare = 'off'), (window.__moshpit.store.ui.compareSnap = null)));
});

await step('variations: breed two, next generation, back', async () => {
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.querySelectorAll('.modal .cell .pv:not([disabled])').length >= 2, null, { timeout: 180000 });
  const tiles = page.locator('.modal .cell .pv:not([disabled])');
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  // Breed waits for every tile to finish rendering
  await page.getByRole('button', { name: 'Breed 2' }).click({ timeout: 180000 });
  await page.locator('.modal .gen', { hasText: 'Generation 2' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.modal .cell .pv:not([disabled])').length >= 4, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.locator('.modal .gen', { hasText: 'Generation 1' }).waitFor();
  await page.locator('.modal .cell').first().getByRole('button', { name: 'Use' }).click();
  await settle();
});

await step('export: Made for presets', async () => {
  await page.keyboard.press('e');
  const sel = page.locator('.modal .social select');
  await sel.selectOption('discord');
  await page.locator('.modal', { hasText: 'kbit/s to stay under 10 MB' }).waitFor();
  if (await page.locator('.modal', { hasText: 'Quality (CRF)' }).count()) throw new Error('a size-limited export has no CRF');
  await sel.selectOption('vertical');
  await page.getByRole('button', { name: 'Make it 9:16' }).waitFor();
  if ((await S(() => window.__moshpit.store.ui.guides)) !== 'vertical') throw new Error('vertical preset shows the safe zones');
  await sel.selectOption('');
  await page.keyboard.press('Escape');
  await S(() => (window.__moshpit.store.ui.guides = null));
});

await step('beats: import music, BPM, grid, beat-triggered and audio-reactive effects, auto-edit', async () => {
  // a 120 BPM click track (accent every 4th beat), made in the page and imported as music
  await S(async () => {
    const sr = 44100;
    const secs = 8;
    const n = sr * secs;
    const pcm = new Int16Array(n * 2);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let b = 0; b * 0.5 < secs; b++) {
      const s0 = Math.round((0.25 + b * 0.5) * sr);
      for (let i = 0; i < 2000 && s0 + i < n; i++) {
        let v = rnd() * Math.exp(-i / 300) * 0.6;
        if (b % 4 === 0) v += Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp(-i / 1500) * 0.4;
        pcm[(s0 + i) * 2] = pcm[(s0 + i) * 2 + 1] = Math.round(v * 32767);
      }
    }
    const head = new DataView(new ArrayBuffer(44));
    const str = (o, t) => [...t].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); head.setUint32(4, 36 + pcm.byteLength, true); str(8, 'WAVEfmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 2, true);
    head.setUint32(24, sr, true); head.setUint32(28, sr * 4, true); head.setUint16(32, 4, true); head.setUint16(34, 16, true); str(36, 'data'); head.setUint32(40, pcm.byteLength, true);
    const file = new File([head.buffer, pcm.buffer], 'clicks.wav', { type: 'audio/wav' });
    await window.__moshpit.media.addFiles([file], { track: 'a1', start: 0 });
  });
  await idle();
  await page.locator('.tabs button', { hasText: 'Audio' }).click();
  await page.getByRole('button', { name: 'Analyse' }).click();
  await page.waitForFunction(() => /^1(19|20|21)$/.test(document.querySelector('.bpm')?.textContent?.trim() ?? ''), null, { timeout: 60000 });
  await page.locator('.field', { hasText: 'Beat grid' }).locator('input, button, [role=switch]').first().click();
  await page.locator('.ruler .beat').first().waitFor({ timeout: 20000 });
  // a Bloom on the beat and a glitch whose amount follows the bass
  await S(() => {
    const st = window.__moshpit.store;
    const total = st.totalFrames;
    st.edit((p) => {
      p.effects = [
        { id: 'kb', type: 'kill', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { mode: 'all', replace: 'prev' }, auto: {}, locks: [] },
        { id: 'bb', type: 'bloom', enabled: true, solo: false, start: 0, end: total, seed: 2, params: { target: 'beats', beatOn: 'beats', beatEvery: 1, length: 'fill', timing: 'fit' }, auto: {}, locks: [] },
        { id: 'gb', type: 'glitch', enabled: true, solo: false, start: 0, end: total, seed: 3, params: { mode: 'flip', amount: 2, probability: 1, target: 'all', gate: 'always' }, auto: { amount: { kind: 'audio', track: 'auto', band: 'low', min: 0, max: 6, attack: 0, release: 3, threshold: 0.1 } }, locks: [] },
      ];
    });
  });
  await settle();
  const dupAtBeats = await S(() => {
    const r = window.__moshpit.store.render;
    // repeats show a frame somewhere other than where it came from (Byte Glitch retags them)
    return r.frames.filter((f) => (f.at ?? f.src) !== f.src).length;
  });
  if (!dupAtBeats) throw new Error('beat-triggered Bloom made no repeats');
  // the automation editor shows the Audio mode
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  await S(() => (window.__moshpit.store.ui.selectedEffect = 'gb'));
  await page.locator('.ae .seg button.on', { hasText: 'Audio' }).waitFor({ timeout: 10000 }).catch(async () => {
    await page.locator('.pc').filter({ hasText: 'Amount' }).getByTitle(/Automate/).click();
    await page.locator('.ae .seg button.on', { hasText: 'Audio' }).waitFor({ timeout: 10000 });
  });
  // auto-edit to the beat: cuts land on beats
  await page.locator('.tabs button', { hasText: 'Audio' }).click();
  await page.getByRole('button', { name: /Auto-edit to the beat/ }).click();
  await page.getByRole('button', { name: 'Cut to the beat' }).click({ timeout: 60000 });
  await page.waitForFunction(() => !window.__moshpit.store.ui.dialog, null, { timeout: 30000 });
  const ok = await S(() => {
    const st = window.__moshpit.store;
    const fps = st.project.encoder.fps;
    const starts = window.__moshpit.timeline.layoutVideo(st.project).slice(1).map((pl) => pl.start);
    // 120 BPM from 0.25 s, every 2 beats: a cut every second
    return starts.length >= 5 && starts.every((t) => Math.abs(((t - 0.25) % 1 + 1) % 1) * fps <= 1.01 || Math.abs((((t - 0.25) % 1) + 1) % 1 - 1) * fps <= 1.01);
  });
  if (!ok) throw new Error('auto-edit cuts are not on the beat: ' + JSON.stringify(await S(() => window.__moshpit.timeline.layoutVideo(window.__moshpit.store.project).map((pl) => pl.start))));
  await settle();
  await page.locator('.field', { hasText: 'Beat grid' }).locator('input, button, [role=switch]').first().click();
});

await step('sequencer: G adds one, paint the grid, renders', async () => {
  await S(() => window.__moshpit.store.edit((p) => (p.effects = [])));
  await page.keyboard.press('g');
  await page.locator('.seq .grid').waitFor({ timeout: 10000 });
  const cells = page.locator('.seq .cell');
  // paint Glitch on the first two steps (row 5, columns 0-1) and clear the bloom on step 0
  const n = await S(() => window.__moshpit.store.project.effects[0].data?.steps?.length ?? 8);
  await cells.nth(4 * n + 0).click();
  await cells.nth(4 * n + 1).click();
  const steps = await S(() => window.__moshpit.store.project.effects[0].data.steps);
  if (steps[0] !== 'glitch' || steps[1] !== 'glitch') throw new Error('grid did not paint: ' + JSON.stringify(steps));
  await page.getByRole('button', { name: 'Random', exact: true }).click();
  await settle();
  if (!(await S(() => window.__moshpit.store.render.frames.length))) throw new Error('no frames');
});

await step('generation loss: 3 generations render with the same length', async () => {
  const len0 = await S(() => window.__moshpit.store.totalFrames);
  await S(() => window.__moshpit.store.edit((p) => ((p.encoder.generations = 3), (p.encoder.genCrush = 2))));
  await settle();
  const len = await S(() => window.__moshpit.store.render.frames.length);
  if (Math.abs(len - len0) > 1) throw new Error(`length changed: ${len0} -> ${len}`);
  await S(() => window.__moshpit.store.edit((p) => delete p.encoder.generations));
  await settle();
});

await step('motion pack: Motion Transfer from Vortex renders', async () => {
  await S(() => {
    const st = window.__moshpit.store;
    const total = st.totalFrames;
    st.edit((p) => {
      p.effects = [
        { id: 'k1', type: 'kill', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { mode: 'all', replace: 'prev' }, auto: {}, locks: [] },
        { id: 'x1', type: 'splice', enabled: true, solo: false, start: Math.round(total * 0.3), end: Math.round(total * 0.7), seed: 2, params: { source: 'pack', pack: 'vortex', from: 0, length: 0, mode: 'replace', loops: 1, speed: 1, timing: 'fit' }, auto: {}, locks: [] },
      ];
    });
    st.ui.selectedEffect = 'x1';
  });
  await settle();
  const spliced = await S(() => window.__moshpit.store.render.frames.filter((f) => f.tag === 'spliced').length);
  if (spliced < 10) throw new Error('no pack motion spliced: ' + spliced);
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  await page.locator('.pc', { hasText: 'Motion from' }).locator('button.on', { hasText: 'A motion pack' }).waitFor();
});

await step('bake the mosh into a clip (add to media)', async () => {
  const before = await S(() => window.__moshpit.store.project.media.length);
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Bake the mosh into a clip/ }).click();
  await page.getByRole('button', { name: 'Add to media' }).click();
  await page.waitForFunction((n) => window.__moshpit.store.project.media.length === n + 1 && !window.__moshpit.store.ui.dialog, before, { timeout: 240000 });
  const m = await S(() => window.__moshpit.store.project.media.at(-1));
  if (!m.source.name.endsWith('_baked.mp4') || !m.hasVideo || !(m.duration > 1)) throw new Error('baked clip looks wrong: ' + JSON.stringify(m));
  await idle();
  // and again, replacing the timeline: one clip of the bake, no effects (undo brings it all back)
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Bake the mosh into a clip/ }).click();
  await page.getByRole('button', { name: 'Replace the timeline' }).click();
  await page.waitForFunction(() => !window.__moshpit.store.ui.dialog, null, { timeout: 240000 });
  const after = await S(() => ({ clips: window.__moshpit.store.project.clips.map((c) => c.track), fx: window.__moshpit.store.project.effects.length }));
  if (after.clips.join() !== 'v1' || after.fx) throw new Error('replace left: ' + JSON.stringify(after));
  await page.keyboard.press('Control+z');
  if ((await S(() => window.__moshpit.store.project.clips.length)) < 2) throw new Error('undo did not bring the timeline back');
  await settle();
});

await step('NLE: keyframes, speed ramp, scopes', async () => {
  await S(() => window.__moshpit.store.edit((p) => (p.effects = [])));
  await settle();
  const first = await S(() => window.__moshpit.store.project.clips.find((c) => c.track === 'v1').id);
  await S((id) => {
    const st = window.__moshpit.store;
    st.ui.selectedClips = [id];
    st.seek(0.1);
  }, first);
  await page.locator('.tabs button', { hasText: 'Clip' }).click();
  const posX = page.locator('.field', { hasText: 'Position X' });
  await posX.locator('.kf').click();
  await S(() => window.__moshpit.store.seek(1.2));
  await posX.locator('input.val').fill('0.4');
  await posX.locator('input.val').press('Enter');
  const keys = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).keys?.x, first);
  if (!keys || keys.length !== 2 || keys[1][1] !== 0.4) throw new Error('keyframes not set: ' + JSON.stringify(keys));
  await page.locator('.clip .kdot').first().waitFor();
  // speed ramp
  const clipLength = () => S((id) => window.__moshpit.timeline.clipLen(window.__moshpit.store.project.clips.find((c) => c.id === id)), first);
  const len0 = await clipLength();
  await page.locator('.field', { hasText: 'Speed ramp' }).locator('select').selectOption('up');
  const ramp = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).ramp, first);
  if (!ramp?.length) throw new Error('no ramp');
  if (Math.abs((await clipLength()) - len0) < 0.05) throw new Error('ramp did not change the clip length');
  await settle();
  // scopes
  // (the keyboard shortcut is Shift+S; focus is still in the inspector here, so use the player's menu)
  const scopes = async () => {
    await page.getByRole('button', { name: 'More player options' }).click();
    await page.locator('.pmenu .mitem', { hasText: 'Scopes' }).click();
  };
  await scopes();
  await page.locator('.scopes canvas').waitFor();
  for (const k of ['Parade', 'Vector', 'Histogram', 'Waveform']) await page.locator('.scopes button', { hasText: k }).click();
  await scopes();
  if (await page.locator('.scopes canvas').count()) throw new Error('scopes did not close');
});

await step('NLE: adjustment layer, chroma key with eyedropper, LUT import', async () => {
  // adjustment layer from the media panel, darkened
  await page.locator('.tabs[role=tablist] button', { hasText: 'Media' }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  const adj = await S(() => window.__moshpit.store.selectedClip);
  const m = await S((id) => window.__moshpit.store.project.media.find((x) => x.id === id).source.kind, adj.mediaId);
  if (m !== 'adjust' || adj.track === 'v1') throw new Error('adjustment layer not placed on top: ' + JSON.stringify(adj));
  await page.locator('.tabs button', { hasText: 'Clip' }).click();
  const br = page.locator('.field', { hasText: 'Brightness' }).locator('input.val');
  await br.fill('-0.4');
  await br.press('Enter');
  await settle();
  // a generated clip on top, keyed
  await S(() => {
    const st = window.__moshpit.store;
    const gen = st.project.media.find((x) => x.source.kind === 'file' && !x.source.compound && x.hasVideo && x.source.kind !== 'adjust');
    window.__moshpit.edit.placeOnTop(gen);
  });
  await page.locator('.field', { hasText: 'Key out a colour' }).locator('input').click();
  await page.getByRole('button', { name: 'Pick from player' }).click();
  const stage = await page.locator('.player .stage').boundingBox();
  await page.mouse.click(stage.x + stage.width * 0.3, stage.y + stage.height * 0.5);
  const key = await S(() => window.__moshpit.store.selectedClip?.key);
  if (!key || !/^#[0-9a-f]{6}$/.test(key.color)) throw new Error('eyedropper did not set a key colour: ' + JSON.stringify(key));
  await settle();
  // LUT: import a .cube (an inverting one) and render with it
  const cube = 'TITLE "invert"\nLUT_3D_SIZE 2\n' + [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${1 - r} ${1 - g} ${1 - b}`))).join('\n') + '\n';
  await page.locator('.lutrow input[type=file]').setInputFiles({ name: 'invert.cube', mimeType: 'text/plain', buffer: Buffer.from(cube) });
  await page.waitForFunction(() => window.__moshpit.store.selectedClip?.grade?.lut, null, { timeout: 10000 });
  await settle();
  if (!(await S(() => window.__moshpit.store.renderFresh))) throw new Error('render with LUT not fresh');
});

await step('NLE: make a compound, edit inside, close re-renders it', async () => {
  const ids = await S(() => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').slice(0, 2).map((c) => c.id));
  if (ids.length < 2) throw new Error('need two main-track clips');
  const n0 = await S(() => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length);
  await S((ids) => (window.__moshpit.store.ui.selectedClips = ids), ids);
  await page.locator(`.clip.video[data-clip="${ids[0]}"]`).click({ button: 'right' });
  await page.getByRole('button', { name: /Make compound clip/ }).click();
  await page.waitForFunction((n) => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length === n - 1 && !window.__moshpit.store.ui.dialog, n0, { timeout: 240000 });
  const cmp = await S(() => window.__moshpit.store.project.clips.find((c) => window.__moshpit.store.project.media.find((m) => m.id === c.mediaId)?.source.compound));
  if (!cmp) throw new Error('no compound clip');
  await settle();
  // edit inside: drop its last clip, then close
  await page.locator(`.clip.video[data-clip="${cmp.id}"]`).dblclick();
  await page.locator('.crumbs').waitFor();
  const inside = await S(() => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length);
  if (inside !== 2) throw new Error('inside the compound there should be 2 clips, found ' + inside);
  const d0 = await S((id) => window.__moshpit.store.seqStack[0].parent.media.find((m) => m.id === id).duration, cmp.mediaId);
  await S(() => {
    const st = window.__moshpit.store;
    st.ui.selectedClips = [st.project.clips.filter((c) => c.track === 'v1')[1].id];
  });
  await page.keyboard.press('Shift+Delete');
  await page.locator('.crumbs').getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => !window.__moshpit.store.seqStack.length && !window.__moshpit.store.ui.dialog, null, { timeout: 240000 });
  const d1 = await S((id) => window.__moshpit.store.project.media.find((m) => m.id === id).duration, cmp.mediaId);
  if (!(d1 < d0 - 0.2)) throw new Error(`compound did not get shorter: ${d0} -> ${d1}`);
  await settle();
});

await step('analysis: track an object, title follows, stabilize', async () => {
  // a clip with a test pattern sliding right across black, made in the page's own FFmpeg
  await S(async () => {
    const { ffmpeg, media } = window.__moshpit;
    const r = await ffmpeg.run(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=3', '-f', 'lavfi', '-i', 'testsrc2=s=60x60:r=24:d=3', '-filter_complex', "[0][1]overlay=x='40+t*60':y=90", '-t', '3', '-pix_fmt', 'yuv420p', 'slide.mp4'], { outputs: ['slide.mp4'] });
    await media.addFiles([new File([r.out['slide.mp4']], 'slide.mp4', { type: 'video/mp4' })], { track: 'v1', index: 0 });
  });
  await idle();
  const id = await S(() => window.__moshpit.store.project.clips.find((c) => c.track === 'v1' && window.__moshpit.store.project.media.find((m) => m.id === c.mediaId)?.source.name === 'slide.mp4').id);
  await S((id) => ((window.__moshpit.store.ui.selectedClips = [id]), window.__moshpit.store.seek(0.02)), id);
  await page.locator('.tabs button', { hasText: 'Clip' }).click();
  // the button arms the player; the box itself is given in picture coordinates
  await page.getByRole('button', { name: 'Track an object' }).click();
  await page.locator('.picknote').waitFor();
  await page.keyboard.press('Escape');
  const box = await S((id) => {
    const p = window.__moshpit.store.project;
    const c = p.clips.find((x) => x.id === id);
    const r = window.__moshpit.motion.pictureRect(c, p);
    const uv = (x, y) => [(r.x + (x / 320) * r.w) / r.W, (r.y + (y / 240) * r.h) / r.H];
    return [...uv(40, 90), ...uv(100, 150)];
  }, id);
  await S(({ id, box }) => window.__moshpit.motion.trackClip(id, box), { id, box });
  const pts = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).paths?.[0]?.pts, id);
  if (!pts || pts.length < 60) throw new Error('track too short: ' + (pts?.length ?? 0));
  // the pattern slides 60 px/s of 320: centre x goes from ~70/320 to ~240/320
  const first = pts[0][1];
  const last = pts.at(-1)[1];
  if (!(first < 0.3 && last > 0.65)) throw new Error(`track went ${first} → ${last}`);
  await page.locator('.pathrow').getByRole('button', { name: 'Title follows' }).click();
  const tx = await S(() => window.__moshpit.store.project.texts.at(-1));
  if (!tx.follow?.length) throw new Error('title does not follow');
  // (the new title is selected now: back to the clip)
  await S((id) => (window.__moshpit.store.ui.selectedClips = [id]), id);
  await page.getByRole('button', { name: 'Stabilize', exact: true }).click();
  await page.waitForFunction((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).stab, id, { timeout: 60000 });
  await settle();
});

await step('captions: listen (fake recogniser), add, subtitles', async () => {
  // something to listen to (the fake recogniser below ignores what it hears)
  await S(async () => {
    const { ffmpeg, media } = window.__moshpit;
    const r = await ffmpeg.run(['-f', 'lavfi', '-i', 'sine=d=2', 'tone.wav'], { outputs: ['tone.wav'] });
    await media.addFiles([new File([r.out['tone.wav']], 'tone.wav', { type: 'audio/wav' })], { track: 'a1', start: 0 });
  });
  await idle();
  await S(() => window.__moshpit.captions.setTranscriber(async () => [{ t0: 0.1, t1: 0.4, text: 'Hello' }, { t0: 0.4, t1: 0.8, text: 'mosh.' }, { t0: 1.5, t1: 1.9, text: 'Again' }]));
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Auto captions/ }).click();
  await page.locator('.modal select').filter({ has: page.locator('option[value="karaoke"]') }).selectOption('karaoke');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Add captions' }).click();
  const caps = await S(() => window.__moshpit.store.project.texts.filter((t) => t.caption).map((t) => [t.text, t.words?.length]));
  if (JSON.stringify(caps) !== JSON.stringify([['Hello mosh.', 2], ['Again', 1]])) throw new Error('captions: ' + JSON.stringify(caps));
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Auto captions/ }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '.srt' }).click();
  if (!(await dl).suggestedFilename().endsWith('.srt')) throw new Error('no .srt');
  await page.keyboard.press('Escape');
  await S(() => window.__moshpit.captions.setTranscriber(null));
});

await step('export: 9:16 reframe with a melt loop', async () => {
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
  await settle();
  await page.keyboard.press('e');
  await page.locator('.modal .fmt', { hasText: 'MP4' }).click();
  await page.locator('.modal .field', { hasText: 'Shape' }).locator('select').selectOption('9:16');
  await page.locator('.modal .field', { hasText: 'Loop' }).locator('select').selectOption('melt');
  await page.locator('.modal .field', { hasText: 'Output size' }).locator('select').selectOption('480');
  await page.getByRole('button', { name: 'Export MP4' }).click();
  await page.locator('.modal .done video').waitFor({ timeout: 300000 });
  // (headless Chromium can't decode H.264, so read the file with the app's own FFmpeg)
  const dims = await S(async () => {
    const blob = await (await fetch(document.querySelector('.modal .done video').src)).blob();
    const r = await window.__moshpit.ffmpeg.run(['-i', '/m/x.mp4'], { mounts: { 'x.mp4': blob } });
    const v = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(r.log);
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.log);
    return [+v[1], +v[2], +d[1] * 3600 + +d[2] * 60 + +d[3]];
  });
  if (!(dims[0] < dims[1])) throw new Error('not portrait: ' + JSON.stringify(dims));
  const want = await S(() => window.__moshpit.store.duration);
  if (Math.abs(dims[2] - want) > 0.3) throw new Error(`loop export length ${dims[2]} vs timeline ${want}`);
  await S(() => {
    // don't leave reframing / looping on for the next exports
    localStorage.removeItem('moshpit:exportOpts');
  });
  await page.keyboard.press('Escape');
});

await step('export: crossfade loop keeps its sound', async () => {
  await page.keyboard.press('e');
  await page.locator('.modal .fmt', { hasText: 'MP4' }).click();
  await page.locator('.modal .field', { hasText: 'Loop' }).locator('select').selectOption('crossfade');
  await page.locator('.modal .field', { hasText: 'Output size' }).locator('select').selectOption('480');
  await page.getByRole('button', { name: 'Export MP4' }).click();
  await page.locator('.modal .done video').waitFor({ timeout: 300000 });
  const info = await S(async () => {
    const blob = await (await fetch(document.querySelector('.modal .done video').src)).blob();
    const r = await window.__moshpit.ffmpeg.run(['-i', '/m/x.mp4'], { mounts: { 'x.mp4': blob } });
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.log);
    return { audio: /Audio: /.test(r.log), secs: +d[1] * 3600 + +d[2] * 60 + +d[3], hasSound: window.__moshpit.store.project.media.some((m) => m.hasAudio) };
  });
  const want = await S(() => window.__moshpit.store.duration);
  if (info.hasSound && !info.audio) throw new Error('crossfade loop lost its audio');
  if (!(info.secs < want && info.secs > want - 1.5)) throw new Error(`crossfade loop length ${info.secs} vs timeline ${want}`);
  await S(() => localStorage.removeItem('moshpit:exportOpts'));
  await page.keyboard.press('Escape');
});

/** Mean difference (0..255) between frame `i` of the render and the clean footage at the same place. */
const diffFromClean = (i) =>
  S(async (i) => {
    const st = window.__moshpit.store;
    const r = st.render;
    const orig = await window.__moshpit.renderer.originalFrames(JSON.parse(JSON.stringify(st.project)), r.w);
    const f = r.frames[i];
    const pix = async (j) => {
      const b = await createImageBitmap(new Blob([j], { type: 'image/jpeg' }), { resizeWidth: 64, resizeHeight: 36 });
      const c = new OffscreenCanvas(64, 36).getContext('2d');
      c.drawImage(b, 0, 0);
      return c.getImageData(0, 0, 64, 36).data;
    };
    const a = await pix(r.jpegs[i]);
    const b = await pix(orig[Math.min(orig.length - 1, f.at ?? f.src)]);
    let d = 0;
    for (let k = 0; k < a.length; k += 4) d += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
    return d / (a.length / 4) / 3;
  }, i);

await step('subject guard: the guarded part stays clean while the rest moshes', async () => {
  const setFx = (guard) =>
    S((guard) => {
      const st = window.__moshpit.store;
      const total = st.totalFrames;
      const fx = [
        { id: 'gk', type: 'kill', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { mode: 'all', replace: 'prev' }, auto: {}, locks: [] },
        { id: 'gb', type: 'bloom', enabled: true, solo: false, start: 0, end: total, seed: 2, params: { target: 'every', interval: 2, length: 'fill', timing: 'fit' }, auto: {}, locks: [] },
      ];
      if (guard) fx.push({ id: 'gg', type: 'mask', enabled: true, solo: false, start: 0, end: total, seed: 3, params: { source: guard, keep: 'subject', threshold: 0, feather: 0, expand: 0.2, mix: 1, size: 0.2 }, auto: {}, locks: [] });
      st.edit((p) => (p.effects = fx));
    }, guard);
  await setFx(null);
  await settle();
  const i = await S(() => Math.floor(window.__moshpit.store.render.frames.length * 0.8));
  const moshed = await diffFromClean(i);
  await setFx('luma');
  await settle();
  const guarded = await diffFromClean(i);
  await setFx('person');
  await settle();
  const person = await diffFromClean(i);
  if (!(moshed > 12 && guarded < moshed * 0.4 && person < moshed * 0.4)) throw new Error(`moshed ${moshed.toFixed(1)}, guarded ${guarded.toFixed(1)}, people ${person.toFixed(1)}`);
  // the editor for it
  await S(() => (window.__moshpit.store.ui.selectedEffect = 'gg'));
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  await page.locator('.sh', { hasText: 'Subject' }).waitFor();
});

await step('flow paint: paint a stroke on the player and it moves the picture', async () => {
  await S(() => {
    const st = window.__moshpit.store;
    const total = st.totalFrames;
    st.edit((p) => (p.effects = [{ id: 'fp', type: 'flowPaint', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { strength: 2, follow: 0, residual: 0, refresh: 0, turbulence: 0 }, auto: {}, locks: [] }]));
    st.ui.selectedEffect = 'fp';
  });
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  await page.getByRole('button', { name: 'Paint on the player' }).click();
  await page.locator('.paintlayer').waitFor();
  const box = await page.locator('.player canvas:not(.hidden)').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width * (0.2 + k * 0.06), box.y + box.height * 0.5);
  await page.mouse.up();
  const strokes = await S(() => window.__moshpit.store.project.effects[0].data?.strokes);
  if (!strokes?.length || strokes[0].pts.length < 5 || strokes[0].tool !== 'push') throw new Error('no stroke: ' + JSON.stringify(strokes));
  await page.waitForFunction(() => document.querySelectorAll('.paintlayer .arrow').length > 5);
  await page.keyboard.press('Escape');
  await settle();
  const i = await S(() => Math.floor(window.__moshpit.store.render.frames.length * 0.6));
  if (!((await diffFromClean(i)) > 8)) throw new Error('painted flow did not change the picture');
});

await step('light theme + new project + undo', async () => {
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /Light theme/ }).click();
  // a new project leaves the old one in the list: go home and open it again
  const before = await S(() => ({ id: window.__moshpit.store.projectId, clips: window.__moshpit.store.project.clips.length }));
  await page.locator('.menu-wrap > button').click();
  await page.getByRole('button', { name: /New project/ }).click();
  await page.waitForFunction(() => window.__moshpit.store.project.clips.length === 0);
  await page.locator('header .brand').click();
  await page.locator('[data-testid=home]').waitFor();
  const card = page.locator('.card.project').filter({ has: page.locator('.thumb') }).first();
  await card.waitFor();
  await page.locator('.card.project .open').first().click();
  await page.waitForFunction((id) => window.__moshpit.store.projectId === id && !window.__moshpit.store.ui.home, before.id);
  if ((await S(() => window.__moshpit.store.project.clips.length)) !== before.clips) throw new Error('reopened project lost clips');
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
    const len = (c) => window.__moshpit.timeline.clipLen(c);
    const t = len(v[0]) - (v[1].transition && ['dissolve', 'dip', 'dipwhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'circleopen', 'pixelize'].includes(v[1].transition.type) ? Math.min(v[1].transition.duration, len(v[0]) / 2, len(v[1]) / 2) : 0);
    s.seek(t);
    return { t, id: v[1].id };
  });
  await page.waitForTimeout(200);
  // the second clip of the main track (upper tracks have video clips too)
  const pos = await S((id) => [document.querySelector('.phead.main').getBoundingClientRect().left, document.querySelector(`.clip.video[data-clip="${id}"]`).getBoundingClientRect().left], cut.id);
  if (Math.abs(pos[0] - pos[1]) > 1) throw new Error(`playhead at ${pos[0]} but the cut (${cut.t}s) is drawn at ${pos[1]}`);
});

await step('phone layout: mobile editor, timeline and tool sheets usable', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const clip = await page.locator('.mtl .clip').first().boundingBox();
  if (!clip || clip.y + clip.height > 844 || clip.height < 40) throw new Error('timeline clips not on screen: ' + JSON.stringify(clip));
  // the playhead stays in the middle: scrubbing the timeline moves time
  const t0 = await S(() => window.__moshpit.store.ui.time);
  await S(() => (document.querySelector('.mtl .scroller').scrollLeft += 60));
  await page.waitForTimeout(200);
  if ((await S(() => window.__moshpit.store.ui.time)) === t0) throw new Error('scrolling the phone timeline did not move the playhead');
  // the bottom tools change with the selection and open sheets over the timeline
  await page.locator('.mtl .clip').first().click();
  await page.locator('.tools .tool', { hasText: 'Speed' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet .chip', { hasText: '2×' }).click();
  if ((await S(() => window.__moshpit.store.selectedClip?.speed)) !== 2) throw new Error('speed sheet did not set the speed');
  await page.keyboard.press('Control+Z');
  await page.locator('.sheet .done').click();
  await page.locator('.tools .back').click();
  await page.locator('.tools .tool', { hasText: 'Media' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet .done').click();
  const overflow = await S(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollHeight > window.innerHeight + 1);
  if (overflow) throw new Error('page overflows the phone screen');
  await page.setViewportSize({ width: 1440, height: 900 });
});

await step('menu: what\'s new, storage, report a problem', async () => {
  await page.locator('.menu-wrap > button').click();
  await page.locator('.menu button', { hasText: "What's new" }).click();
  const notes = await page.locator('.modal').innerText();
  const version = await S(() => document.querySelector('.modal h4')?.textContent ?? '');
  if (!/\d+\.\d+\.\d+/.test(version) || notes.length < 80) throw new Error('what\'s new shows no release notes');
  await page.keyboard.press('Escape');
  await page.locator('.menu-wrap > button').click();
  await page.locator('.menu button', { hasText: 'Storage' }).click();
  await page.locator('.modal .r', { hasText: 'Media in this project' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('Escape');
  // the bug report link carries diagnostics but none of the person's file names
  const url = await S(() => window.__moshpit.report.reportUrl('test'));
  const q = new URL(url).searchParams;
  if (q.get('template') !== 'bug_report.yml' || !/moshpit \d/.test(q.get('diagnostics') ?? '')) throw new Error('report link is missing its details: ' + url.slice(0, 200));
  const names = await S(() => window.__moshpit.store.project.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.name] : [])));
  for (const n of names) if (q.get('diagnostics').includes(n)) throw new Error('report leaks a file name: ' + n);
});

await step('incoming: a project file dropped or opened with the app is opened', async () => {
  const clips = await S(() => window.__moshpit.store.project.clips.length);
  await S(async () => {
    const p = JSON.stringify({ ...window.__moshpit.store.project, name: 'Opened from outside' });
    await window.__moshpit.incoming.openFiles([new File([p], 'outside.mosh.json', { type: 'application/json' })]);
  });
  if ((await S(() => window.__moshpit.store.project.name)) !== 'Opened from outside') throw new Error('project file was not opened');
  if ((await S(() => window.__moshpit.store.project.clips.length)) !== clips) throw new Error('opening the project lost clips');
});

await step('crash recovery: a stale render flag pauses auto-render after a reload', async () => {
  await S(() => localStorage.setItem('moshpit:busy', JSON.stringify({ kind: 'render', at: Date.now() - 60000, tab: 'gone' })));
  await page.reload();
  await page.waitForFunction(() => window.__moshpit?.store);
  await page.locator('.toast', { hasText: 'closed while it was rendering' }).waitFor({ timeout: 20000 });
  if (await S(() => window.__moshpit.store.ui.autoRender)) throw new Error('auto-render was not paused');
  await page.locator('.toast button', { hasText: 'Resume auto-render' }).click();
  if (!(await S(() => window.__moshpit.store.ui.autoRender))) throw new Error('resume did not turn auto-render back on');
  if (await S(() => localStorage.getItem('moshpit:busy') && JSON.parse(localStorage.getItem('moshpit:busy')).tab === 'gone')) throw new Error('stale flag was not cleared');
  await idle();
});

await step('home: open an example, then come back to the list', async () => {
  await S(() => window.__moshpit.projects.goHome());
  await page.locator('[data-testid=home]').waitFor();
  const n0 = await page.locator('.card.project').count();
  await page.locator('.starter', { hasText: 'Vortex' }).last().click();
  await page.waitForFunction(() => !window.__moshpit.store.ui.home && window.__moshpit.store.project.effects.length > 0, null, { timeout: 120000 });
  await settle();
  if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('example did not render');
  await page.locator('header .brand').click();
  await page.locator('[data-testid=home]').waitFor();
  await page.waitForFunction((n) => document.querySelectorAll('.card.project').length === n + 1, n0);
  // the card got a picture of the project
  if (!(await page.locator('.card.project').first().locator('img').count())) throw new Error('project card has no picture');
});

await step('template: melt transitions with sample footage', async () => {
  await page.locator('.starter', { hasText: 'Melt transitions' }).click();
  await page.getByRole('button', { name: 'Try with sample footage' }).click();
  await page.waitForFunction(() => !window.__moshpit.store.ui.home && window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length === 3, null, { timeout: 120000 });
  const melts = await S(() => window.__moshpit.store.project.clips.filter((c) => c.transition?.type === 'melt').length);
  if (melts !== 2) throw new Error('expected a melt on both cuts, got ' + melts);
  await settle();
});

await step('home: rename, duplicate and delete a project', async () => {
  await S(() => window.__moshpit.projects.goHome());
  await page.locator('[data-testid=home]').waitFor();
  const count = () => page.locator('.card.project').count();
  const n0 = await count();
  const first = page.locator('.card.project').first();
  await first.locator('.more').click();
  await page.locator('.card.project .menu button', { hasText: 'Duplicate' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.card.project').length === n + 1, n0);
  await page.locator('.card.project', { hasText: ' copy' }).first().locator('.more').click();
  await page.locator('.card.project .menu button', { hasText: 'Rename' }).click(); // the prompt answers "Test preset"
  await page.locator('.card.project', { hasText: 'Test preset' }).waitFor();
  await page.locator('.card.project', { hasText: 'Test preset' }).locator('.more').click();
  await page.locator('.card.project .menu button', { hasText: 'Delete' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.card.project').length === n, n0);
  if (await page.locator('.card.project', { hasText: 'Test preset' }).count()) throw new Error('deleted project still listed');
});

await step('first mosh: clips imported into an empty project get melted', async () => {
  await S(() => window.__moshpit.store.setPref('autoMosh', true));
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.waitForFunction(() => !window.__moshpit.store.ui.home);
  await S(async () => {
    const m = window.__moshpit;
    const files = [];
    for (const g of ['testsrc2', 'mandelbrot']) files.push(new File([await m.renderer.renderGenerator(g, 2, 320, 180, 24)], g + '.mp4', { type: 'video/mp4' }));
    await m.media.addFiles(files);
  });
  await page.waitForFunction(() => window.__moshpit.store.project.clips.some((c) => c.transition?.type === 'melt'), null, { timeout: 30000 });
  await page.locator('.toast button', { hasText: 'Undo' }).click();
  if (await S(() => window.__moshpit.store.project.clips.some((c) => c.transition))) throw new Error('Undo did not take the first mosh off');
  await S(() => window.__moshpit.store.setPref('autoMosh', false));
  await settle();
});

await step('tour: steps through the editor and is remembered', async () => {
  await S(() => (window.__moshpit.store.ui.welcome = true));
  await page.locator('.tour .card').waitFor();
  for (let i = 0; i < 6 && (await page.locator('.tour').count()); i++) {
    const hole = await page.locator('.tour .hole').boundingBox();
    if (!hole || hole.width < 20) throw new Error('tour step has nothing lit up');
    await page.locator('.tour .card button.primary').click();
  }
  if (await page.locator('.tour').count()) throw new Error('tour did not finish');
  if ((await S(() => localStorage.getItem('moshpit:seenWelcome'))) !== 'true') throw new Error('tour not remembered');
});

await step('home on a phone: fits the screen', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await S(() => window.__moshpit.projects.goHome());
  await page.locator('[data-testid=home]').waitFor();
  const overflow = await S(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('home overflows the phone screen sideways');
  await page.locator('.card.project .open').first().click();
  await page.waitForFunction(() => !window.__moshpit.store.ui.home);
  await page.setViewportSize({ width: 1440, height: 900 });
});

await step('website: landing page, gallery and docs', async () => {
  await page.goto(root);
  await page.locator('h1', { hasText: 'Break your videos' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#gallery-list .gcard').length >= 4);
  // the website never loads the editor (or its video engine)
  if (await S(() => !!window.__moshpit)) throw new Error('the editor loaded on the landing page');
  await page.locator('.nav a', { hasText: 'Docs' }).click();
  await page.locator('.prose h1', { hasText: 'moshpit docs' }).waitFor();
  await page.locator('.prose a', { hasText: 'Effects' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.prose h3[id]').length >= 18);
});

await step('website: the installed app opening the old address lands in the editor', async () => {
  await page.goto(root + '?source=pwa');
  await page.waitForURL(/\/app\/\?source=pwa/);
  await page.waitForFunction(() => window.__moshpit?.store);
});

await step('website: a gallery recipe link opens the mosh in the editor', async () => {
  const code = JSON.parse(fs.readFileSync(path.join(dist, 'site/gallery.json'), 'utf8')).find((g) => g.title === 'Vortex').recipe;
  await page.goto(url + '#recipe=' + encodeURIComponent(code));
  await page.waitForFunction(() => window.__moshpit?.store && !window.__moshpit.store.ui.home && window.__moshpit.store.project.name === 'Shared recipe' && window.__moshpit.store.project.effects.length + window.__moshpit.store.project.clips.filter((c) => c.transition).length > 0, null, { timeout: 120000 });
  if (await S(() => location.hash)) throw new Error('the recipe stayed in the address');
  await settle();
});

await browser.close();
server.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nUI sweep passed');
process.exitCode = failed ? 1 : 0;
