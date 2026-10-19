// Broad UI sweep: exercises every effect, codec, panel and dialog in the real app and fails on any page error.
// Usage: npm run build && node scripts/e2e-ui.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    // COI=1: cross-origin isolated, as the service worker makes the editor (the main e2e always is)
    const coi = process.env.COI ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' } : {};
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', ...coi }).end(d)));
  })
  .listen(0);
const root = `http://localhost:${server.address().port}/`;
// the editor; the website is at the root
const url = root + 'app/';
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write', 'midi'] });
// start in the editor (not the home screen), without the first-run tour or the automatic first mosh
await ctx.addInitScript(() => {
  // not in sandboxed frames (the Script effect's), which have no storage
  if (window !== window.top) return;
  for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 6).join('\n')));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text()) && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Test preset' : undefined));

const S = (fn, arg) => page.evaluate(fn, arg);
const idle = () => page.waitForFunction(() => { const s = window.__moshpit.store; return !s.status.busy && !s.status.pending && !s.status.engine; }, null, { timeout: 180000 }).catch(async (e) => { throw new Error(e.message + " status: " + JSON.stringify(await S(() => window.__moshpit.store.status))); });
const settle = async () => {
  await page.waitForTimeout(500);
  await idle();
  const err = await S(() => window.__moshpit.store.status.error);
  if (err) throw new Error('render error: ' + err);
};
let failed = 0;
const step = async (name, fn) => {
  // ONLY=regex runs just the matching steps (while working on one)
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return;
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

const effectTypes = await S(() => ['kill', 'bloom', 'splice', 'stutter', 'shuffle', 'reverse', 'echo', 'drop', 'glitch', 'sequence', 'databend', 'mvedit', 'vectorWarp', 'chroma', 'pixelSort', 'rawbend', 'flowPaint', 'script', 'vhs', 'crt', 'grain', 'posterize', 'threshold', 'halftone', 'lineArt', 'glow', 'vignette', 'lightLeak', 'gateWeave', 'dvTape', 'trails', 'hold', 'mask']);
for (const t of effectTypes)
  await step(`effect ${t} renders (UI add + delete)`, async () => {
    await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
    await page.keyboard.press('Shift+A');
    const name = { kill: 'Keyframe Killer', bloom: 'Bloom', splice: 'Motion Transfer', stutter: 'Stutter Loop', shuffle: 'Shuffle', reverse: 'Reverse Motion', echo: 'Echo', drop: 'Frame Drop', glitch: 'Byte Glitch', vectorWarp: 'Vector Warp', chroma: 'Chroma Drift', pixelSort: 'Pixel Sort', sequence: 'Frame Sequencer', databend: 'Databend', rawbend: 'Raw Bend', mvedit: 'Vector Edit', flowPaint: 'Flow Paint', script: 'Script', vhs: 'VHS', crt: 'CRT', grain: 'Film Grain', posterize: 'Posterise', threshold: '1-bit', halftone: 'Halftone', lineArt: 'Line Art', glow: 'Glow', vignette: 'Vignette', lightLeak: 'Light Leak', gateWeave: 'Gate Weave', dvTape: 'DV Tape', trails: 'Light Trails', hold: 'Step Print', mask: 'Subject Guard' }[t];
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

for (const codec of ['mpeg2', 'mpeg1', 'h264', 'mpeg4'])
  await step(`codec ${codec} at 12 fps`, async () => {
    await page.locator('.tabs button', { hasText: 'Encode' }).click();
    await page.locator('.field').filter({ hasText: 'Mosh codec' }).locator('select').selectOption(codec);
    await page.locator('.field').filter({ hasText: 'Frame rate' }).locator('select').selectOption('12');
    await settle();
    // H.264: every frame decodes (they're renumbered after the mosh). MPEG-1/2/4 decoders drop a
    // few frames of some moshes, as they always have; those only need to render.
    const r = await S(() => ({ n: window.__moshpit.store.render.frames.length, j: window.__moshpit.store.render.jpegs.length }));
    if (!r.n || !r.j || (codec === 'h264' && r.j < r.n - 1)) throw new Error(`${codec}: ${r.j} pictures for ${r.n} frames`);
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

await step('editor: a melting title that moves is burned in where it is on each frame', async () => {
  const keep = await S(() => {
    const st = window.__moshpit.store;
    const effects = JSON.parse(JSON.stringify(st.project.effects));
    st.edit((p) => {
      p.effects = [];
      p.layers.push({ id: 'mv', kind: 'text', row: 'g1', text: 'MM', start: 0, duration: 2, size: 0.3, color: '#000000', font: 'sans', bold: true, x: 0.2, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: true, follow: [[0, 0.2, 0.5], [2, 0.8, 0.5]] });
    });
    return effects;
  });
  await settle();
  const m = await S(async () => {
    const st = window.__moshpit.store;
    const r = st.render;
    const fps = st.project.encoder.fps;
    // how dark the left and right thirds are on frame i (the example's colour bars have no black)
    const at = async (i) => {
      const b = await createImageBitmap(new Blob([r.jpegs[i]], { type: 'image/jpeg' }), { resizeWidth: 48, resizeHeight: 27 });
      const c = new OffscreenCanvas(48, 27).getContext('2d');
      c.drawImage(b, 0, 0);
      const d = c.getImageData(0, 0, 48, 27).data;
      const third = (x0) => {
        let s = 0;
        let n = 0;
        for (let y = 0; y < 27; y++) for (let x = x0; x < x0 + 16; x++) (s += 255 - Math.max(d[(y * 48 + x) * 4], d[(y * 48 + x) * 4 + 1], d[(y * 48 + x) * 4 + 2])), n++;
        return s / n;
      };
      return { left: third(0), right: third(32) };
    };
    return { early: await at(Math.round(0.2 * fps)), late: await at(Math.round(1.8 * fps)) };
  });
  await S((effects) => window.__moshpit.store.edit((p) => ((p.effects = effects), (p.layers = p.layers.filter((l) => l.id !== 'mv')))), keep);
  await settle();
  // the title darkens the left early and the right late; the footage's own left-right difference cancels out
  const swing = m.early.left - m.early.right - (m.late.left - m.late.right);
  if (!(swing > 30 && m.early.left > m.late.left)) throw new Error('the melting title did not move with its path: ' + JSON.stringify(m));
});

await step('graphics rows: drag a title above for a new row and back, on desktop and on a phone', async () => {
  await S(() => {
    const base = { kind: 'text', row: 'g1', duration: 1.5, size: 0.1, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0, moshed: false };
    window.__moshpit.store.edit((p) => p.layers.push({ ...base, id: 'ra', text: 'RA', start: 0 }, { ...base, id: 'rb', text: 'RB', start: 2 }));
  });
  await page.waitForTimeout(200);
  const row = (id) => S((id) => window.__moshpit.store.project.layers.find((l) => l.id === id).row, id);
  const lanes = () => S(() => document.querySelectorAll('[data-row]').length);
  /** drag the item a little sideways (so it counts as a move), then to y */
  const dragTo = async (box, y) => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
    await page.mouse.move(box.x + box.width / 2 + 12, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  // desktop: above the top lane makes a new row on top; a sideways move alone keeps the row
  const b = await page.locator('.clip.text[data-clip="rb"]').boundingBox();
  await dragTo(b, b.y + b.height / 2);
  if ((await row('rb')) !== 'g1') throw new Error('a sideways drag changed the row');
  const top = await page.locator('[data-row]').first().boundingBox();
  await dragTo(await page.locator('.clip.text[data-clip="rb"]').boundingBox(), top.y - 8);
  if ((await row('rb')) !== 'g2' || (await row('ra')) !== 'g1' || (await lanes()) !== 2) throw new Error(`no new row: rb ${await row('rb')}, ${await lanes()} lanes`);
  const order = await S(() => window.__moshpit.store.project.layers.filter((l) => l.id === 'ra' || l.id === 'rb').map((l) => l.row));
  if (order.length !== 2) throw new Error('lost a title');
  // and back down onto the first row: the empty row goes away
  const g1 = await page.locator('[data-row="g1"]').boundingBox();
  await dragTo(await page.locator('.clip.text[data-clip="rb"]').boundingBox(), g1.y + g1.height / 2);
  if ((await row('rb')) !== 'g1' || (await lanes()) !== 1) throw new Error(`not back on the first row: rb ${await row('rb')}, ${await lanes()} lanes`);
  // phone: tap to select, then drag above the rows
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const item = page.locator('.mtl .item.text', { hasText: 'RB' });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  const mtop = await page.locator('.mtl [data-row]').first().boundingBox();
  await dragTo(await item.boundingBox(), mtop.y - 8);
  const phoneRow = await row('rb');
  await page.setViewportSize({ width: 1440, height: 900 });
  await S(() => window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((l) => l.id !== 'ra' && l.id !== 'rb'))));
  await settle();
  if (phoneRow !== 'g2') throw new Error('phone: dragging above the rows did not make a new row: ' + phoneRow);
});

/** Put a title on the picture for the handle steps, paused at 1 s, nothing selected. */
const handleTitle = (id, o = {}) =>
  S(([id, o]) => {
    const st = window.__moshpit.store;
    st.setPref('view', 'edit');
    st.ui.playing = false;
    st.edit((p) => p.layers.push({ id, kind: 'text', row: 'g1', text: 'HANDLES', start: 0, duration: 3, size: 0.15, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0, moshed: false, ...o }));
    st.seek(1);
    st.selectClip(null);
  }, [id, o]);
const layerOf = (id) => S((id) => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.find((l) => l.id === id))), id);
const dropLayer = (id) => S((id) => window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((l) => l.id !== id))), id);
const dragBy = async (box, dx, dy) => {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
};

await step('handles: pick a title on the player, move it, scale it from a corner and turn it; one undo step each', async () => {
  await handleTitle('hz');
  await page.waitForTimeout(300);
  const b = await page.locator('polygon.hit[data-gizmo="hz"]').boundingBox();
  const undo0 = await S(() => window.__moshpit.store.historySize.undo);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  if (JSON.stringify(await S(() => window.__moshpit.store.ui.selectedClips)) !== '["hz"]') throw new Error('clicking the title did not pick it');
  if (await S(() => window.__moshpit.store.ui.playing)) throw new Error('clicking the title started playback');
  const pic = await page.locator('svg.gizmo').boundingBox();
  // move: right by 80 px, a little down (snaps back to the middle)
  await dragBy(b, 80, 3);
  let l = await layerOf('hz');
  if (Math.abs(l.x - (0.5 + 80 / pic.width)) > 0.01 || l.y !== 0.5) throw new Error('move: ' + JSON.stringify(l));
  // scale from the bottom-right corner, outwards
  await dragBy(await page.locator('circle.corner').nth(2).boundingBox(), 40, 20);
  l = await layerOf('hz');
  if (!(l.size > 0.17)) throw new Error('scale: ' + JSON.stringify(l));
  // turn with the round handle
  await dragBy(await page.locator('circle.turn').boundingBox(), 120, 60);
  l = await layerOf('hz');
  if (!(Math.abs(l.rotate) > 20)) throw new Error('turn: ' + JSON.stringify(l));
  const undo1 = await S(() => window.__moshpit.store.historySize.undo);
  if (undo1 - undo0 !== 3) throw new Error(`expected 3 undo steps, got ${undo1 - undo0}`);
  await S(() => window.__moshpit.store.undo());
  if ((await layerOf('hz')).rotate) throw new Error('undo did not take the turn back');
  await dropLayer('hz');
});

await step('handles: double-click a title to type into it on the picture', async () => {
  await handleTitle('hy');
  await page.waitForTimeout(300);
  const b = await page.locator('polygon.hit[data-gizmo="hy"]').boundingBox();
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  const box = page.locator('textarea.inplace');
  await box.waitFor({ timeout: 3000 });
  await page.keyboard.type('NEW WORDS');
  await page.keyboard.press('Enter');
  await box.waitFor({ state: 'detached', timeout: 3000 });
  if ((await layerOf('hy')).text !== 'NEW WORDS') throw new Error('typing on the picture did not change the title: ' + (await layerOf('hy')).text);
  await dropLayer('hy');
});

await step('handles: a clip on a track above moves, and a keyframed zoom gets a key at the playhead', async () => {
  const id = await S(() => {
    const { store: st, edit, timeline } = window.__moshpit;
    const track = edit.addVideoTrack();
    const c = timeline.makeClip(st.project.media[0], track, { start: 0 });
    c.out = Math.min(c.out, 2);
    c.transform = { zoom: 0.4, x: -0.25 };
    c.keys = { zoom: [[0, 0.4], [2, 0.4]] };
    st.edit((p) => p.clips.push(c));
    st.ui.playing = false;
    st.seek(1);
    st.selectClip(null);
    return c.id;
  });
  await page.waitForTimeout(300);
  const b = await page.locator(`polygon.hit[data-gizmo="${id}"]`).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await dragBy(b, 0, 30);
  await dragBy(await page.locator('circle.corner').nth(2).boundingBox(), 30, 30);
  const c = await S((id) => JSON.parse(JSON.stringify(window.__moshpit.store.project.clips.find((x) => x.id === id))), id);
  await S((id) => window.__moshpit.store.edit((p) => (p.clips = p.clips.filter((x) => x.id !== id))), id);
  await settle();
  if (!(c.transform.y > 0.05)) throw new Error('the clip did not move: ' + JSON.stringify(c.transform));
  if (c.transform.zoom !== 0.4 || c.keys.zoom.length !== 3 || !(c.keys.zoom[1][1] > 0.45)) throw new Error('no zoom key at the playhead: ' + JSON.stringify(c.keys));
});

await step('handles on a phone: a tap picks a title without playing, two fingers pinch and twist it', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await handleTitle('hp');
  await page.waitForTimeout(300);
  const b = await page.locator('polygon.hit[data-gizmo="hp"]').boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  // synthetic touch pointers, as a phone sends them
  const touch = (type, id, x, y) =>
    S(([type, id, x, y]) => {
      const target = type === 'pointerdown' ? document.elementFromPoint(x, y) : window;
      target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, [type, id, x, y]);
  await touch('pointerdown', 1, cx, cy);
  await touch('pointerup', 1, cx, cy);
  const picked = await S(() => [window.__moshpit.store.ui.selectedClips.join(), window.__moshpit.store.ui.playing]);
  // first finger on the title, the second 60 px to its right, then that one swings to 120 px below
  await touch('pointerdown', 1, cx, cy);
  await touch('pointerdown', 2, cx + 60, cy);
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    const r = 60 + (i / 6) * 60;
    await touch('pointermove', 2, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  await touch('pointerup', 2, cx, cy + 120);
  await touch('pointerup', 1, cx, cy);
  const l = await layerOf('hp');
  // a tap on what's already picked plays, as a tap on the picture does (not a double tap: wait first)
  await page.waitForTimeout(500);
  const nb = await page.locator('polygon.hit[data-gizmo="hp"]').boundingBox();
  await touch('pointerdown', 1, nb.x + nb.width / 2, nb.y + nb.height / 2);
  await touch('pointerup', 1, nb.x + nb.width / 2, nb.y + nb.height / 2);
  const played = await S(() => window.__moshpit.store.ui.playing);
  await S(() => (window.__moshpit.store.ui.playing = false));
  await dropLayer('hp');
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle();
  if (picked[0] !== 'hp' || picked[1]) throw new Error('a tap on the title should pick it, not play: ' + JSON.stringify(picked));
  if (Math.abs(l.size - 0.3) > 0.01 || Math.abs((l.rotate ?? 0) - 90) > 1) throw new Error('pinch and twist: ' + JSON.stringify({ size: l.size, rotate: l.rotate }));
  if (!played) throw new Error('a tap on the picked title did not play');
});

await step('styles: put a built-in look on a title, save your own, new titles get the last one', async () => {
  await S(() => {
    const st = window.__moshpit.store;
    st.edit((p) => p.layers.push({ id: 'sty', kind: 'text', row: 'g1', text: 'STYLE', start: 0, duration: 2, size: 0.12, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0, moshed: false }));
    st.selectClip('sty');
  });
  await page.locator('.chip', { hasText: 'Word slam' }).click();
  const l = await S(() => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.find((x) => x.id === 'sty'))));
  if (l.font !== 'impact' || l.fit !== 'width' || l.color !== '#f3a8f0' || l.text !== 'STYLE') throw new Error('Word slam: ' + JSON.stringify(l));
  // a look of your own (the prompt answers "Test preset")
  await S(() => window.__moshpit.store.edit((p) => (p.layers.find((x) => x.id === 'sty').color = '#00ff88')));
  await page.getByRole('button', { name: 'Save style' }).click();
  await page.locator('.chip', { hasText: 'Test preset' }).waitFor();
  // a new title comes in that look
  await S(() => window.__moshpit.edit.addText());
  const fresh = await S(() => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.at(-1))));
  if (fresh.color !== '#00ff88' || fresh.font !== 'impact') throw new Error('the new title did not get the last style: ' + JSON.stringify(fresh));
  // delete it; back to the plain look (as new titles start) for the steps after this one
  await page.getByRole('button', { name: 'Delete the style Test preset' }).click();
  if (await page.locator('.chip', { hasText: 'Test preset' }).count()) throw new Error('style not deleted');
  await S(() => window.__moshpit.store.selectClip('sty'));
  await page.locator('.chip', { hasText: 'Clean' }).click();
  await S((id) => window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((l) => l.id !== 'sty' && l.id !== id))), fresh.id);
});

await step('words on the beat: one title per word, on the cuts, in the chosen look on a new row', async () => {
  const before = await S(() => window.__moshpit.store.project.layers.map((l) => l.id));
  await S(() => {
    const st = window.__moshpit.store;
    st.seek(0);
    st.ui.dialog = 'wordBeats';
  });
  try {
    await page.locator('textarea[aria-label="Words"]').fill('ONE TWO THREE');
    await page.locator('select[aria-label="On"]').selectOption('cuts');
    // three words on the cuts from the start: as many as there are pieces of video, at most three
    const pieces = await S(() => window.__moshpit.timeline.layoutVideo(window.__moshpit.store.project).length);
    const want = Math.min(3, pieces);
    const note = await page.getByRole('dialog').locator('[aria-live="polite"]').innerText();
    if (!note.startsWith(`${want} title`) || (want < 3) !== /don't fit/.test(note)) throw new Error(`summary (${pieces} pieces): ` + note);
    await page.getByRole('button', { name: 'Add titles' }).click();
  } finally {
    await S(() => (window.__moshpit.store.ui.dialog = null));
  }
  const added = await S((before) => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.filter((l) => !before.includes(l.id)))), before);
  const cuts = await S(() => window.__moshpit.timeline.layoutVideo(window.__moshpit.store.project).map((p) => p.start));
  await S((ids) => window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((l) => !ids.includes(l.id)))), added.map((l) => l.id));
  if (added.map((l) => l.text).join() !== ['ONE', 'TWO', 'THREE'].slice(0, Math.min(3, cuts.length)).join()) throw new Error('titles: ' + JSON.stringify(added.map((l) => l.text)));
  if (added.some((l, i) => Math.abs(l.start - cuts[i]) > 1e-6)) throw new Error('not on the cuts: ' + JSON.stringify([added.map((l) => l.start), cuts]));
  if (added.some((l) => l.fit !== 'width' || l.row === 'g1')) throw new Error('look or row: ' + JSON.stringify(added[0]));
});

await step('fonts: a font file and a Google Font, put on the title, loaded before it is drawn', async () => {
  // a font file from this machine (the step needs one; FONT_FILE can point at another)
  const file = process.env.FONT_FILE || '/mnt/skills/examples/canvas-design/canvas-fonts/BigShoulders-Bold.ttf';
  if (!fs.existsSync(file)) return console.log('(no font file on this machine: skipped) ');
  const b64 = fs.readFileSync(file).toString('base64');
  await S(() => {
    const st = window.__moshpit.store;
    st.edit((p) => p.layers.push({ id: 'fnt', kind: 'text', row: 'g1', text: 'FONTS', start: 0, duration: 2, size: 0.2, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: true }));
    st.selectClip('fnt');
    st.ui.dialog = 'fonts';
  });
  try {
    await page.locator('input[aria-label="Font file"]').setInputFiles(file);
    await page.waitForFunction(() => window.__moshpit.store.project.layers.find((l) => l.id === 'fnt').font.startsWith('font:'), null, { timeout: 10000 });
    const ok = await S(() => {
      const id = window.__moshpit.store.project.layers.find((l) => l.id === 'fnt').font.slice(5);
      return document.fonts.check(`20px "mp-${id}"`) && [...document.fonts].some((f) => f.family === `mp-${id}` && f.status === 'loaded');
    });
    if (!ok) throw new Error('the imported font is not loaded');
    // a melting title in it renders (the fonts are loaded before drawing)
    await settle();
    // Google Fonts, from a fake Google (the tests run offline)
    await S((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.__moshpit.fonts.setFontFetcher(async (url) => (url.includes('googleapis') ? new Response("/* latin */\n@font-face { font-family: 'Anton'; src: url(https://fonts.gstatic.com/anton.woff2) format('woff2'); }") : new Response(bytes)));
      window.__moshpit.store.selectClip('fnt');
      window.__moshpit.store.ui.dialog = 'fonts';
    }, b64);
    await page.getByRole('button', { name: 'Add Anton' }).click();
    await page.waitForFunction(() => window.__moshpit.store.project.fonts?.some((f) => f.google === 'Anton'), null, { timeout: 10000 });
    const anton = await S(() => window.__moshpit.store.project.fonts.find((f) => f.google === 'Anton').id);
    if ((await S(() => window.__moshpit.store.project.layers.find((l) => l.id === 'fnt').font)) !== 'font:' + anton) throw new Error('the Google Font is not on the title');
  } finally {
    await S(() => {
      window.__moshpit.fonts.setFontFetcher(null);
      window.__moshpit.store.ui.dialog = null;
      window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((l) => l.id !== 'fnt')));
    });
  }
});

await step('shapes: add a box from the toolbar, it is drawn and scales with the handles; draw a line with the pen', async () => {
  await S(() => {
    const st = window.__moshpit.store;
    st.setPref('view', 'edit');
    st.ui.playing = false;
    st.seek(1);
    st.selectClip(null);
  });
  const before = await S(() => window.__moshpit.store.project.layers.map((l) => l.id));
  const now = await S(() => window.__moshpit.store.ui.time);
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  await page.getByRole('button', { name: 'Add box' }).click();
  const box = await S((before) => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.find((l) => !before.includes(l.id)))), before);
  try {
    if (box?.kind !== 'shape' || box.shape !== 'rect' || Math.abs(box.start - now) > 1e-6) throw new Error('no box at the playhead: ' + JSON.stringify(box));
    if (JSON.stringify(await S(() => window.__moshpit.store.ui.selectedClips)) !== JSON.stringify([box.id])) throw new Error('the new box is not selected');
    await page.locator('.tabs button', { hasText: 'Clip' }).click();
    await page.getByRole('button', { name: 'Delete shape' }).waitFor({ timeout: 3000 });
    // a thick, filled green box, drawn at once: its middle is green on the preview
    await S((id) => window.__moshpit.store.edit((p) => Object.assign(p.layers.find((l) => l.id === id), { color: '#00ff00', fill: '#00ff00', drawOn: 0, width: 0.02 })), box.id);
    await page.waitForTimeout(400);
    const green = await S(() => {
      const cv = document.querySelector('.stage canvas.edit');
      const g = cv.getContext('2d');
      const d = g.getImageData(Math.floor(cv.width / 2) - 2, Math.floor(cv.height / 2) - 2, 4, 4).data;
      return d[1] > 200 && d[0] < 60 && d[2] < 60;
    });
    if (!green) throw new Error('the box is not drawn on the preview');
    // drag a corner outwards: both sides grow, in one undo step
    const undo0 = await S(() => window.__moshpit.store.historySize.undo);
    await dragBy(await page.locator('circle.corner').nth(2).boundingBox(), 40, 40);
    const big = await layerOf(box.id);
    if (!(big.w > box.w * 1.1 && big.h > box.h * 1.1) || Math.abs(big.w / big.h - box.w / box.h) > 0.01) throw new Error('scale: ' + JSON.stringify([box.w, box.h, big.w, big.h]));
    if ((await S(() => window.__moshpit.store.historySize.undo)) - undo0 !== 1) throw new Error('scaling was not one undo step');
    // the kind can change in the inspector
    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    if ((await layerOf(box.id)).shape !== 'circle') throw new Error('the kind did not change');
  } finally {
    await dropLayer(box.id);
  }
  // the pen: draw a stroke on the picture (with something on the timeline, so there's a picture)
  await handleTitle('penbg', { y: 0.9, size: 0.05 });
  await page.getByRole('button', { name: 'Shape', exact: true }).click();
  await page.getByRole('button', { name: 'Draw with the pen' }).click();
  if (!(await S(() => window.__moshpit.store.ui.pen))) throw new Error('the pen is not on');
  const st = await page.locator('.stage').boundingBox();
  await page.mouse.move(st.x + st.width * 0.4, st.y + st.height * 0.4);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(st.x + st.width * (0.4 + i * 0.02), st.y + st.height * (0.4 + Math.sin(i / 2) * 0.05));
  await page.mouse.up();
  const pen = await S(() => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.at(-1))));
  await dropLayer(pen.id);
  await dropLayer('penbg');
  if (pen.kind !== 'shape' || pen.shape !== 'pen' || !(pen.points?.length >= 5)) throw new Error('no pen stroke: ' + JSON.stringify(pen));
  if (await S(() => window.__moshpit.store.ui.pen)) throw new Error('the pen stays on after a stroke');
  await S(() => window.__moshpit.store.setPref('view', 'auto'));
});

await step('canvas: set the picture in as a card, in the preview and the render, on desktop and a phone', async () => {
  // something on the timeline, so there's a picture (when this step runs on its own)
  await handleTitle('cvbg', { y: 0.5, size: 0.05 });
  await S(() => {
    const st = window.__moshpit.store;
    st.setPref('view', 'edit');
    st.ui.playing = false;
    st.seek(0.5);
    st.selectClip(null);
  });
  await page.locator('.tabs button', { hasText: 'Encode' }).click();
  try {
    await page.getByRole('button', { name: 'Paper card', exact: true }).click();
    const c = await S(() => window.__moshpit.store.project.canvas);
    if (!c || c.inset <= 0 || c.bg !== 'color') throw new Error('no canvas: ' + JSON.stringify(c));
    await S(() => window.__moshpit.store.edit((p) => Object.assign(p.canvas, { color: '#ff00ff', shadow: 0 })));
    await page.waitForTimeout(500);
    // the frame's corner is the backdrop, its middle is still the picture
    const px = await S(() => {
      const cv = document.querySelector('.stage canvas.edit');
      const g = cv.getContext('2d');
      return [[...g.getImageData(2, 2, 1, 1).data], [...g.getImageData(cv.width / 2, cv.height / 2, 1, 1).data]];
    });
    const magenta = ([r, g, b]) => r > 220 && g < 40 && b > 220;
    if (!magenta(px[0])) throw new Error('no backdrop in the corner: ' + JSON.stringify(px[0]));
    if (magenta(px[1])) throw new Error('the backdrop covers the picture');
    // the mosh renders with the canvas (the backdrop goes into the prep graph)
    await S(() => window.__moshpit.store.doRender(true));
    await settle();
    if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('no frames with a canvas');
    // and on a phone, in the Look sheet
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.locator('.tools .tool', { hasText: 'Look' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Full frame', exact: true }).click();
    if (await S(() => window.__moshpit.store.project.canvas)) throw new Error('Full frame did not take the canvas off');
    await page.locator('.sheet .done').click();
  } finally {
    await S(() => window.__moshpit.store.edit((p) => delete p.canvas));
    await dropLayer('cvbg');
    await page.setViewportSize({ width: 1440, height: 900 });
    await S(() => window.__moshpit.store.setPref('view', 'auto'));
    await settle();
  }
});

await step('collage: split screen side by side, a stamp trail, an image backdrop', async () => {
  // a clip on the timeline (when this step runs on its own)
  if (!(await S(() => window.__moshpit.store.project.clips.length))) {
    await S(async () => {
      const m = window.__moshpit;
      await m.media.addFiles([new File([await m.renderer.renderGenerator('testsrc2', 2, 320, 180, 24)], 'testsrc2.mp4', { type: 'video/mp4' })]);
    });
    await idle();
  }
  // two clips at the playhead: the main track's and one on a track above
  const id = await S(() => {
    const { store: st, edit, timeline } = window.__moshpit;
    st.setPref('view', 'edit');
    st.ui.playing = false;
    const track = edit.addVideoTrack();
    const c = timeline.makeClip(st.project.media[0], track, { start: 0 });
    st.edit((p) => p.clips.push(c));
    st.seek(0.5);
    st.selectClip(null);
    return c.id;
  });
  try {
    await S(() => window.__moshpit.edit.arrangeGrid('side'));
    const T = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).transform, id);
    // the clip above is in the right half
    if (!(T.x > 0.15 && T.x < 0.35) || !(T.zoom > 0.5)) throw new Error('not in the right half: ' + JSON.stringify(T));
    const base = await S(() => {
      const { store: st, timeline } = window.__moshpit;
      return timeline.layoutVideo(st.project)[0].clip.transform;
    });
    if (!(base?.x < -0.15)) throw new Error('the main clip is not in the left half: ' + JSON.stringify(base));
    // a green square stepping right every half second, leaving copies
    const sq = await S(() => {
      const { store: st, edit } = window.__moshpit;
      const s = edit.addShape('rect');
      st.edit((p) => Object.assign(p.layers.find((l) => l.id === s.id), { start: 0, x: 0.2, y: 0.2, w: 0.05, h: 0.05 * 16 / 9, color: '#00ff00', fill: '#00ff00', drawOn: 0, boil: 0, trail: { every: 0.5, count: 3, dx: 0.15, dy: 0 } }));
      st.seek(1.2);
      return s.id;
    });
    await page.waitForTimeout(500);
    const greens = await S(() => {
      const cv = document.querySelector('.stage canvas.edit');
      const g = cv.getContext('2d');
      return [0.2, 0.35, 0.5, 0.65].map((x) => { const d = g.getImageData(Math.round(x * cv.width), Math.round(0.2 * cv.height), 1, 1).data; return d[1] > 200 && d[0] < 60 && d[2] < 60; });
    });
    await dropLayer(sq);
    // at 1.2 s: two steps taken, so copies at 0.2, 0.35 and 0.5, nothing yet at 0.65
    if (greens.join() !== 'true,true,true,false') throw new Error('stamp trail: ' + greens.join());
    // an image as the backdrop
    await S(async () => {
      const { media } = window.__moshpit;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#0000ff';
      g.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await media.addFiles([new File([blob], 'backdrop.png', { type: 'image/png' })], 'none');
    });
    await idle();
    await S(() => {
      const st = window.__moshpit.store;
      const im = st.project.media.find((m) => m.source.name === 'backdrop.png');
      st.edit((p) => (p.canvas = { bg: 'image', image: im.id, color: '#000000', inset: 0.1 }));
    });
    await page.waitForTimeout(800);
    const corner = await S(() => [...document.querySelector('.stage canvas.edit').getContext('2d').getImageData(2, 2, 1, 1).data]);
    if (!(corner[2] > 200 && corner[0] < 60)) throw new Error('no image backdrop: ' + corner.join());
    await S(() => window.__moshpit.store.doRender(true));
    await settle();
  } finally {
    await S((id) => {
      const st = window.__moshpit.store;
      st.edit((p) => {
        delete p.canvas;
        p.clips = p.clips.filter((c) => c.id !== id);
        for (const c of p.clips) delete c.transform;
        p.media = p.media.filter((m) => m.source.name !== 'backdrop.png');
      });
      st.setPref('view', 'auto');
    }, id);
    await settle();
  }
});

await step('blends, luma key and a phone mockup render, in the preview and the mosh', async () => {
  if (!(await S(() => window.__moshpit.store.project.clips.length))) {
    await S(async () => {
      const m = window.__moshpit;
      await m.media.addFiles([new File([await m.renderer.renderGenerator('testsrc2', 2, 320, 180, 24)], 'testsrc2.mp4', { type: 'video/mp4' })]);
    });
    await idle();
  }
  const id = await S(() => {
    const { store: st, edit, timeline } = window.__moshpit;
    st.setPref('view', 'edit');
    st.ui.playing = false;
    const track = edit.addVideoTrack();
    const c = timeline.makeClip(st.project.media[0], track, { start: 0 });
    c.blend = 'overlay';
    c.key = { color: '#000000', similarity: 0.2, blend: 0.05, spill: false, luma: 'dark' };
    st.edit((p) => {
      p.clips.push(c);
      p.canvas = { bg: 'color', color: '#ff00ff', inset: 0.12, radius: 0.08, device: 'phone' };
    });
    st.seek(0.5);
    st.selectClip(c.id);
    return c.id;
  });
  try {
    await page.locator('.tabs button', { hasText: 'Clip' }).click();
    await page.locator('.field', { hasText: 'Key by' }).waitFor({ timeout: 3000 });
    await page.waitForTimeout(500);
    // the phone's bezel is dark, just outside the card's left edge, half way down
    const px = await S(() => {
      const { store: st, canvas } = window.__moshpit;
      const cv = document.querySelector('.stage canvas.edit');
      const R = canvas.cardRect(st.project.canvas, cv.width, cv.height);
      const at = (x, y) => [...cv.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data];
      return { bezel: at(R.x - Math.min(cv.width, cv.height) * 0.012, R.y + R.h / 2), back: at(3, 3) };
    });
    if (!(px.bezel[0] < 60 && px.bezel[2] < 60)) throw new Error('no phone bezel: ' + px.bezel.join());
    if (!(px.back[0] > 200 && px.back[2] > 200 && px.back[1] < 60)) throw new Error('no backdrop: ' + px.back.join());
    await S(() => window.__moshpit.store.doRender(true));
    await settle();
    if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('no frames');
  } finally {
    await S((id) => {
      const st = window.__moshpit.store;
      st.edit((p) => {
        delete p.canvas;
        p.clips = p.clips.filter((c) => c.id !== id);
      });
      st.setPref('view', 'auto');
    }, id);
    await settle();
  }
});

await step('flipbook every 3 frames on a new track, and a whip pan at a cut', async () => {
  if ((await S(() => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length)) < 2) {
    await S(async () => {
      const m = window.__moshpit;
      const files = [];
      for (const g of ['testsrc2', 'mandelbrot']) files.push(new File([await m.renderer.renderGenerator(g, 2, 320, 180, 24)], g + '.mp4', { type: 'video/mp4' }));
      await m.media.addFiles(files);
    });
    await idle();
  }
  const before = await S(() => window.__moshpit.store.project.clips.map((c) => c.id));
  await S(() => {
    const st = window.__moshpit.store;
    st.seek(0);
    st.ui.dialog = 'flipbook';
  });
  try {
    // pick two pictures
    const pics = page.locator('.modal .pic');
    for (const i of [0, 1]) if ((await pics.nth(i).getAttribute('aria-pressed')) !== 'true') await pics.nth(i).click();
    await page.locator('select[aria-label="Swap"]').selectOption('frames');
    await page.locator('select[aria-label="Frames"]').selectOption('3');
    await page.locator('select[aria-label="For"]').selectOption('1');
    await page.getByRole('button', { name: 'Add flipbook' }).click();
  } finally {
    await S(() => (window.__moshpit.store.ui.dialog = null));
  }
  const added = await S((before) => JSON.parse(JSON.stringify(window.__moshpit.store.project.clips.filter((c) => !before.includes(c.id)))), before);
  // 1 s at 24 fps, a new picture every 3 frames: 8 clips on one new track, end to end
  if (added.length !== 8 || new Set(added.map((c) => c.track)).size !== 1 || added[0].track === 'v1') throw new Error('flipbook: ' + JSON.stringify(added.map((c) => [c.track, c.start])));
  if (Math.abs(added[1].start - 0.125) > 1e-6 || new Set(added.map((c) => c.mediaId)).size !== 2) throw new Error('timing or pictures: ' + JSON.stringify(added.map((c) => [c.mediaId, c.start])));
  await S((ids) => window.__moshpit.store.edit((p) => {
    const track = p.clips.find((c) => c.id === ids[0]).track;
    p.clips = p.clips.filter((c) => !ids.includes(c.id));
    p.tracks = p.tracks.filter((t) => t.id !== track);
  }), added.map((c) => c.id));
  // a whip pan at the first cut renders
  await S(() => window.__moshpit.edit.setTransition(window.__moshpit.timeline.layoutVideo(window.__moshpit.store.project)[1].clip.id, 'whipleft', { duration: 0.3 }));
  await settle();
  if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('no frames with a whip pan');
  await S(() => window.__moshpit.edit.setTransition(window.__moshpit.timeline.layoutVideo(window.__moshpit.store.project)[1].clip.id, null));
  await settle();
});

await step('faces get stickers that follow them; emoji with particles; a heart', async () => {
  if (!(await S(() => window.__moshpit.store.project.clips.length))) {
    await S(async () => {
      const m = window.__moshpit;
      await m.media.addFiles([new File([await m.renderer.renderGenerator('testsrc2', 2, 320, 180, 24)], 'testsrc2.mp4', { type: 'video/mp4' })]);
    });
    await idle();
  }
  // a fake face detector (no model download): one face, drifting right
  await S(() => {
    let k = 0;
    window.__moshpit.faces.setFaceDetector(async () => [{ x: 0.3 + 0.01 * k++, y: 0.3, w: 0.2, h: 0.25 }]);
  });
  const id = await S(() => {
    const st = window.__moshpit.store;
    const c = st.project.clips.find((x) => x.track === 'v1' && st.project.media.find((m) => m.id === x.mediaId)?.source.kind === 'file' && !st.project.media.find((m) => m.id === x.mediaId)?.source.isImage);
    st.selectClip(c.id);
    st.seek(window.__moshpit.timeline.layoutVideo(st.project).find((pl) => pl.clip.id === c.id).start + 0.1);
    return c.id;
  });
  const before = await S(() => window.__moshpit.store.project.layers.map((l) => l.id));
  try {
    await page.locator('.tabs button', { hasText: 'Clip' }).click();
    await page.getByRole('button', { name: 'Find faces' }).click();
    await page.waitForFunction((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).paths?.some((p) => p.name === 'Face 1'), id, { timeout: 60000 });
    const face = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).paths.find((p) => p.name === 'Face 1'), id);
    if (!(face.pts.length >= 3) || !(face.pts.at(-1)[1] > face.pts[0][1])) throw new Error('face track: ' + JSON.stringify(face.pts.slice(0, 3)));
    await page.locator('.pathrow', { hasText: 'Face 1' }).locator('select[aria-label="Sticker on it"]').selectOption('😎');
    const st = await S((before) => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.find((l) => !before.includes(l.id)))), before);
    if (st?.text !== '😎' || !(st.follow?.length > 1) || !(st.size > 0.1)) throw new Error('sticker: ' + JSON.stringify(st));
    // the emoji rises in particles; a heart; both render
    await S((sid) => {
      const { store: s, edit } = window.__moshpit;
      s.edit((p) => (p.layers.find((l) => l.id === sid).particles = { kind: 'rise', count: 10, speed: 0.4, spread: 0.5 }));
      edit.addShape('heart');
    }, st.id);
    await settle();
    if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('no frames');
  } finally {
    await S(({ id, before }) => {
      const s = window.__moshpit.store;
      window.__moshpit.faces.setFaceDetector(null);
      s.edit((p) => {
        p.layers = p.layers.filter((l) => before.includes(l.id));
        const c = p.clips.find((x) => x.id === id);
        c.paths = c.paths?.filter((pp) => !pp.name.startsWith('Face'));
      });
    }, { id, before });
    await settle();
  }
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
  await page.locator('.field', { hasText: 'Key it out' }).locator('input').click();
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
  // zoomed in and moved: the box drawn on the player has to be mapped back into the clip's own picture
  await S((id) => window.__moshpit.store.edit((p) => (p.clips.find((c) => c.id === id).transform = { zoom: 1.25, x: 0.05, y: -0.04 })), id);
  await page.getByRole('button', { name: 'Track an object' }).click();
  await page.locator('.picknote').waitFor();
  // a box drawn with the mouse around the pattern (40..100 × 90..150 of the 320×240 source at t=0)
  const scr = await S((id) => {
    const { store, motion } = window.__moshpit;
    const p = store.project;
    const c = p.clips.find((x) => x.id === id);
    const r = motion.pictureRect(c, p);
    const T = { zoom: 1.25, x: 0.05, y: -0.04 };
    // fit, then zoom about the centre and move (as the preview draws it)
    const uv = (x, y) => {
      const fx = r.x + (x / 320) * r.w;
      const fy = r.y + (y / 240) * r.h;
      return [(r.W / 2 + T.x * r.W + (fx - r.W / 2) * T.zoom) / r.W, (r.H / 2 + T.y * r.H + (fy - r.H / 2) * T.zoom) / r.H];
    };
    const shown = [...document.querySelectorAll('.stage canvas')].find((cv) => !cv.classList.contains('hidden'));
    const rc = shown.getBoundingClientRect();
    const k = Math.min(rc.width / shown.width, rc.height / shown.height);
    const ox = rc.left + (rc.width - shown.width * k) / 2;
    const oy = rc.top + (rc.height - shown.height * k) / 2;
    const px = ([u, v]) => [ox + u * shown.width * k, oy + v * shown.height * k];
    return [...px(uv(40, 90)), ...px(uv(100, 150))];
  }, id);
  await page.mouse.move(scr[0], scr[1]);
  await page.mouse.down();
  await page.mouse.move((scr[0] + scr[2]) / 2, (scr[1] + scr[3]) / 2, { steps: 4 });
  await page.mouse.move(scr[2], scr[3], { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).paths?.length, id, { timeout: 60000 });
  await idle();
  const tr = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).paths[0], id);
  const pts = tr.pts;
  if (!pts || pts.length < 60) throw new Error('track too short: ' + (pts?.length ?? 0));
  // in the clip's own picture the pattern slides 60 px/s of 320: centre x goes from ~70/320 to ~240/320
  const first = pts[0][1];
  const last = pts.at(-1)[1];
  if (Math.abs(first - 70 / 320) > 0.03 || Math.abs(last - 245 / 320) > 0.04) throw new Error(`track went ${first} → ${last}`);
  for (const [, , y] of pts) if (Math.abs(y - 120 / 240) > 0.03) throw new Error('track wandered to y ' + y);
  if (!tr.size || Math.abs(tr.size[0] - 60 / 320) > 0.02) throw new Error('box size not kept: ' + JSON.stringify(tr.size));
  // the tracked box shows on the player while the clip is selected
  await page.locator('.tracklayer .tbox').waitFor({ timeout: 5000 });
  // Subject Guard on the tracked object renders
  await S(({ id, pathId }) => {
    const { store } = window.__moshpit;
    store.edit((p) => {
      const total = Math.round(p.encoder.fps * 3);
      p.effects = [
        { id: 'gk', type: 'kill', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { mode: 'all', keepFirst: true }, auto: {}, locks: [] },
        { id: 'gv', type: 'mask', enabled: true, solo: false, start: 0, end: total, seed: 2, params: { source: 'track', keep: 'subject', scale: 1.4, feather: 0.03, expand: 0.05, mix: 1 }, auto: {}, locks: [], data: { clipId: id, pathId } },
        { id: 'gw', type: 'vectorWarp', enabled: true, solo: false, start: 0, end: total, seed: 3, params: { amplify: 2, rotate: 0, swap: false, drift: 0, driftY: 0, turbulence: 0, quantize: 0, threshold: 0, block: 16, search: 8, smooth: true, residual: 0.05, refresh: 0, mix: 1 }, auto: {}, locks: [] },
      ];
    });
  }, { id, pathId: tr.id });
  await settle();
  if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('no frames with a guard on the track');
  await S(() => window.__moshpit.store.edit((p) => (p.effects = [])));
  await settle();
  await page.locator('.pathrow').getByRole('button', { name: 'Title follows' }).click();
  const tx = await S(() => window.__moshpit.store.project.layers.at(-1));
  if (!tx.follow?.length) throw new Error('title does not follow');
  // mark it: a box, an arrow and a label, all following it
  const n0 = await S(() => window.__moshpit.store.project.layers.length);
  await S((id) => (window.__moshpit.store.ui.selectedClips = [id]), id);
  await page.locator('.pathrow').getByRole('button', { name: 'Mark it' }).click();
  const marks = await S((n0) => JSON.parse(JSON.stringify(window.__moshpit.store.project.layers.slice(n0))), n0);
  if (marks.map((l) => l.shape ?? l.kind).join() !== 'rect,arrow,text' || marks.some((l) => !(l.follow?.length > 1))) throw new Error('marks: ' + JSON.stringify(marks.map((l) => [l.kind, l.shape, l.follow?.length])));
  // the box moves right with the pattern
  const fb = marks[0].follow;
  if (!(fb.at(-1)[1] - fb[0][1] > 0.3)) throw new Error('the box does not follow the pattern: ' + JSON.stringify([fb[0], fb.at(-1)]));
  await S((ids) => window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((l) => !ids.includes(l.id)))), marks.map((l) => l.id));
  // (the new title is selected now: back to the clip)
  await S((id) => (window.__moshpit.store.ui.selectedClips = [id]), id);
  await page.getByRole('button', { name: 'Stabilize', exact: true }).click();
  await page.waitForFunction((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).stab, id, { timeout: 60000 });
  await settle();
});

await step('preview: GPU grading and keying match the CPU', async () => {
  const r = await S(() => {
    const { preview, gradegl } = window.__moshpit;
    const W = 64;
    const H = 48;
    const src = document.createElement('canvas');
    src.width = W;
    src.height = H;
    const g = src.getContext('2d');
    // every hue and level, plus a green-screen patch to key out
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      g.fillStyle = `hsl(${(x / W) * 360} ${40 + (y % 4) * 20}% ${(y / H) * 100}%)`;
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = '#00ff00';
    g.fillRect(4, 4, 12, 12);
    const G = { brightness: 0.05, contrast: 1.3, saturation: 1.4, gamma: 0.9, hue: 25 };
    const key = { color: '#00ff00', similarity: 0.25, blend: 0.08, spill: true };
    // a LUT that swaps red and blue, half strength
    const n = 9;
    const data = new Float32Array(n ** 3 * 3);
    for (let b = 0; b < n; b++) for (let gg = 0; gg < n; gg++) for (let rr = 0; rr < n; rr++) data.set([b / (n - 1), gg / (n - 1), rr / (n - 1)], (rr + gg * n + b * n * n) * 3);
    const lut = { title: 't', size: n, data };
    const cpu = g.getImageData(0, 0, W, H);
    preview.chromaKeyPixels(cpu.data, key);
    preview.gradePixels(cpu.data, G);
    const gpu = gradegl.GradeGL.create();
    if (!gpu) return { none: true };
    gpu.apply(src, W, H, G, key, null, 1);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const o = out.getContext('2d');
    o.drawImage(gpu.canvas, 0, 0);
    const got = o.getImageData(0, 0, W, H).data;
    let worst = 0;
    let at = null;
    for (let i = 0; i < got.length; i += 4) {
      // fully keyed-out pixels have no colour to compare
      if (cpu.data[i + 3] === 0 && got[i + 3] === 0) continue;
      // colour as it shows (canvases keep little colour in nearly see-through pixels), and alpha
      for (let c = 0; c < 4; c++) {
        const d = c === 3 ? Math.abs(got[i + 3] - cpu.data[i + 3]) : (Math.abs(got[i + c] - cpu.data[i + c]) * cpu.data[i + 3]) / 255;
        if (d > worst) ((worst = d), (at = { i: i / 4, c, got: [...got.slice(i, i + 4)], cpu: [...cpu.data.slice(i, i + 4)] }));
      }
    }
    // and a LUT on its own, against the CPU's trilinear lookup
    const plain = { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 };
    const cpu2 = g.getImageData(0, 0, W, H);
    const tmp = [0, 0, 0];
    for (let i = 0; i < cpu2.data.length; i += 4) {
      const v = [0, 1, 2].map((c) => cpu2.data[i + c] / 255);
      window.__moshpit.lut.sampleLut(lut, v[0], v[1], v[2], tmp);
      for (let c = 0; c < 3; c++) cpu2.data[i + c] = (v[c] + (tmp[c] - v[c]) * 0.5) * 255;
    }
    gpu.apply(src, W, H, plain, null, lut, 0.5);
    o.clearRect(0, 0, W, H);
    o.drawImage(gpu.canvas, 0, 0);
    const got2 = o.getImageData(0, 0, W, H).data;
    let worstLut = 0;
    for (let i = 0; i < got2.length; i += 4) for (let c = 0; c < 3; c++) worstLut = Math.max(worstLut, Math.abs(got2[i + c] - cpu2.data[i + c]));
    gpu.dispose();
    return { worst, worstLut, at };
  });
  if (r.none) throw new Error('no WebGL2 for the GPU grader');
  // a level or two of rounding between float GPU maths and 8-bit CPU steps
  if (r.worst > 3 || r.worstLut > 3) throw new Error('GPU differs from CPU: ' + JSON.stringify(r));
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
  const caps = await S(() => window.__moshpit.store.project.layers.filter((t) => t.caption).map((t) => [t.text, t.words?.length]));
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

/** Mean difference (0..255) between frame `i` of the render and the clean footage at the same place (or its left / right half). */
const diffFromClean = (i, half = '') =>
  S(async ([i, half]) => {
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
    let n = 0;
    for (let k = 0; k < a.length; k += 4) {
      const x = (k / 4) % 64;
      if ((half === 'left' && x >= 28) || (half === 'right' && x < 36)) continue;
      d += Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]);
      n++;
    }
    return d / n / 3;
  }, [i, half]);

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

await step('mosh maps: a gradient, a painted map, a picture and depth keep the left side clean', async () => {
  // a picture: white on the left, black on the right
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosh-map-'));
  const png = path.join(dir, 'halfmap.png');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180', '-vf', "geq=lum='if(lt(X,W/2),255,0)':cb=128:cr=128", '-frames:v', '1', png]);
  await page.locator('aside input[type=file][multiple]').first().setInputFiles(png);
  await page.locator('.item', { hasText: 'halfmap.png' }).waitFor({ timeout: 60000 });
  await S(() =>
    window.__moshpit.maps.setDepthModel(async () => {
      // near on the left
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 18;
      const g = c.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, 32, 18);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 16, 18);
      return c;
    }),
  );
  const setMap = (params, data) =>
    S(([params, data]) => {
      const st = window.__moshpit.store;
      const total = st.totalFrames;
      // keep the clip, drop the image from the timeline (it's only a map)
      const mediaId = st.project.media.find((m) => m.source.name === 'halfmap.png')?.id;
      st.edit((p) => {
        p.clips = p.clips.filter((c) => c.mediaId !== mediaId);
        p.effects = [
          { id: 'mk', type: 'kill', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { mode: 'all', replace: 'prev' }, auto: {}, locks: [] },
          { id: 'mb', type: 'bloom', enabled: true, solo: false, start: 0, end: total, seed: 2, params: { target: 'every', interval: 2, length: 'fill', timing: 'fit' }, auto: {}, locks: [] },
          { id: 'mm', type: 'mask', enabled: true, solo: false, start: 0, end: total, seed: 3, params: { keep: 'subject', feather: 0, expand: 0, mix: 1, shape: 'linear', angle: 0, gx: 0.5, gy: 0.5, spread: 0.1, ...params }, auto: {}, locks: [], data: data === 'media' ? { mediaId } : data },
        ];
      });
    }, [params, data]);
  const i = await S(() => Math.floor(window.__moshpit.store.render.frames.length * 0.8));
  const results = {};
  for (const [name, params, data] of [
    ['gradient', { source: 'gradient' }, undefined],
    ['paint', { source: 'paint' }, { maskStrokes: [{ pts: [[0.2, 0], [0.2, 1]], radius: 0.25 }] }],
    ['media', { source: 'media' }, 'media'],
    ['depth', { source: 'depth' }, undefined],
  ]) {
    await setMap(params, data);
    await settle();
    const l = await diffFromClean(i, 'left');
    const r = await diffFromClean(i, 'right');
    results[name] = [Math.round(l * 10) / 10, Math.round(r * 10) / 10];
    if (!(r > 8 && l < r * 0.4)) throw new Error(`${name}: left ${l.toFixed(1)} vs right ${r.toFixed(1)} ` + JSON.stringify(results));
  }
  // painting the map on the player
  await setMap({ source: 'paint' }, { maskStrokes: [] });
  await S(() => (window.__moshpit.store.ui.selectedEffect = 'mm'));
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  await page.getByRole('button', { name: 'Paint clean' }).click();
  const box = await page.locator('.paintlayer').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await page.locator('.paintlayer .maskimg').waitFor();
  if ((await S(() => window.__moshpit.store.project.effects.find((e) => e.id === 'mm').data.maskStrokes.length)) !== 1) throw new Error('the painted stroke was not kept');
  await page.keyboard.press('Escape');
  await S(() => window.__moshpit.maps.setDepthModel(null));
  await settle();
});

await step('text animations: each one draws less (or moves) while coming in, then the whole title', async () => {
  const r = await S(() => {
    const { drawText } = window.__moshpit.text;
    const base = { id: 't', text: 'HELLO MOSH', start: 1, duration: 3, size: 0.2, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, animIn: 1 };
    const lit = (anim, t) => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const g = c.getContext('2d');
      drawText(g, { ...base, anim }, 320, 180, 1, t);
      const d = g.getImageData(0, 0, 320, 180).data;
      let n = 0;
      let sy = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 128) (n++, (sy += Math.floor((i - 3) / 4 / 320)));
      return { n, y: n ? sy / n : 0 };
    };
    const out = {};
    for (const a of ['none', 'type', 'glitch', 'slide', 'pop']) out[a] = { early: lit(a, 1.25), done: lit(a, 2.5) };
    return out;
  });
  const full = r.none.done.n;
  if (!(full > 500)) throw new Error('title did not draw: ' + JSON.stringify(r));
  for (const a of ['type', 'glitch', 'slide', 'pop']) if (Math.abs(r[a].done.n - full) > full * 0.02) throw new Error(`${a} did not settle into the title: ` + JSON.stringify(r[a]));
  if (!(r.type.early.n < full * 0.6)) throw new Error('typewriter shows too much early on: ' + JSON.stringify(r.type));
  if (!(r.pop.early.n < full * 0.9)) throw new Error('pop is not smaller early on: ' + JSON.stringify(r.pop));
  if (!(r.slide.early.y > r.slide.done.y + 2)) throw new Error('slide does not rise: ' + JSON.stringify(r.slide));
  if (Math.abs(r.glitch.early.n - full) < full * 0.02 && Math.abs(r.glitch.early.y - r.none.done.y) < 0.5) throw new Error('glitch looks like the plain title: ' + JSON.stringify(r.glitch));
  // the setting in the Clip tab
  await S(() => {
    const st = window.__moshpit.store;
    st.edit((p) => p.layers.push({ id: 'tt', kind: 'text', row: 'g1', text: 'TITLE', start: 0, duration: 2, size: 0.12, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0, moshed: false }));
    st.ui.selectedClips = ['tt'];
  });
  await page.locator('.tabs button', { hasText: 'Clip' }).click();
  await page.locator('.field', { hasText: 'Comes in' }).locator('select').selectOption('glitch');
  if ((await S(() => window.__moshpit.store.project.layers.find((t) => t.id === 'tt').anim)) !== 'glitch') throw new Error('animation not set from the Clip tab');
  await S(() => window.__moshpit.store.edit((p) => (p.layers = p.layers.filter((t) => t.id !== 'tt'))));
  await settle();
});

await step('MIDI: right-click a setting, move a knob, it follows; undo, then forget', async () => {
  await S(() => {
    const st = window.__moshpit.store;
    const total = st.totalFrames;
    st.edit((p) => (p.effects = [{ id: 'cm', type: 'chroma', enabled: true, solo: false, start: 0, end: total, seed: 1, params: { offset: 6, angle: 0, wobble: 0.2, scanTear: 0 }, auto: {}, locks: [] }]));
    st.ui.selectedEffect = 'cm';
  });
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  const offset = page.locator('.pc', { hasText: 'Offset' }).first();
  // this Chromium has no MIDI system: a stand-in with one (silent) keyboard plugged in
  await S(() => (navigator.requestMIDIAccess = async () => ({ inputs: new Map([['k', { name: 'Test keys', onmidimessage: null }]]), onstatechange: null })));
  await offset.click({ button: 'right' });
  await offset.locator('.ctl.learn').waitFor();
  const st = await S(() => window.__moshpit.controls.controls.midi);
  if (st !== 'on') throw new Error('MIDI is ' + st);
  // a knob: CC 21 on channel 1, all the way up
  await S(() => window.__moshpit.controls.simulate('cc:1:21', 0.5));
  await offset.locator('.ctl', { hasText: 'CC 21' }).waitFor();
  await S(() => window.__moshpit.controls.simulate('cc:1:21', 1));
  await page.waitForFunction(() => window.__moshpit.store.project.effects[0].params.offset === 40);
  await S(() => window.__moshpit.controls.simulate('cc:1:21', 0.25));
  await page.waitForFunction(() => window.__moshpit.store.project.effects[0].params.offset === 10);
  // one undo step for the whole move
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => window.__moshpit.store.project.effects[0].params.offset === 6);
  // other controls don't touch it
  await S(() => window.__moshpit.controls.simulate('cc:1:22', 1));
  await page.waitForTimeout(100);
  if ((await S(() => window.__moshpit.store.project.effects[0].params.offset)) !== 6) throw new Error('an unmapped control moved the setting');
  // the mapping is listed in Help
  await S(() => window.__moshpit.commands.runCommand('help'));
  await page.locator('.ctrls li', { hasText: 'Chroma Drift · Offset' }).waitFor();
  await S(() => (window.__moshpit.store.ui.dialog = null));
  await page.locator('.modal').waitFor({ state: 'detached' });
  await offset.click({ button: 'right' });
  if (await S(() => (window.__moshpit.store.project.controls ?? []).length)) throw new Error('right-click did not forget the control');
  await settle();
});

await step('script: runs in a sandbox without the network, endless loops stop, and code from elsewhere asks first', async () => {
  // the sandbox: no network APIs, an opaque origin, and a time limit
  const probe = await S(() => window.__moshpit.scripts.runScript('function mosh(){ return [typeof fetch, typeof XMLHttpRequest, typeof importScripts, typeof WebSocket, typeof indexedDB, self.location.href.slice(0, 9)]; }', [], { seed: 1 }));
  if (JSON.stringify(probe.plan) !== JSON.stringify(['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'blob:null'])) throw new Error('sandbox: ' + JSON.stringify(probe));
  const loop = await S(() => window.__moshpit.scripts.runScript('function mosh(){ for(;;){} }', [], { seed: 1 }, 800));
  if (!/longer than/.test(loop.error ?? '')) throw new Error('an endless loop was not stopped: ' + JSON.stringify(loop));
  const after = await S(() => window.__moshpit.scripts.runScript('function mosh(f){ return [1, 0]; }', [{}, {}], { seed: 1 }));
  if (JSON.stringify(after.plan) !== '[1,0]') throw new Error('the sandbox did not recover: ' + JSON.stringify(after));

  // code from elsewhere: shown first, does nothing until allowed
  const code = 'function mosh(frames) { /* from a recipe */ return frames.map((f, i) => frames.length - 1 - i); }';
  const range = await S((code) => {
    const st = window.__moshpit.store;
    const a = Math.floor(st.totalFrames * 0.25);
    const b = Math.floor(st.totalFrames * 0.5);
    st.edit((p) => (p.effects = [{ id: 'sc', type: 'script', enabled: true, solo: false, start: a, end: b, seed: 3, params: { amount: 0.5, timing: 'fit' }, auto: {}, locks: [], data: { code } }]));
    return [a, b];
  }, code);
  await page.locator('.modal', { hasText: 'This mosh contains code' }).waitFor({ timeout: 60000 });
  if (!(await page.locator('.modal pre').textContent()).includes('from a recipe')) throw new Error('the code is not shown');
  await page.getByRole('button', { name: "Don't run it" }).click();
  await settle();
  const srcs = () => S(([a, b]) => window.__moshpit.store.render.frames.slice(a, b).map((f) => f.src), range);
  const plain = await srcs();
  if (plain[0] !== range[0]) throw new Error('the code ran without being allowed');
  // allowed now (as if from the dialog), it reverses its part of the video
  await S((code) => window.__moshpit.scripts.approve(code), code);
  await S(() => window.__moshpit.store.edit((p) => (p.effects[0].seed = 4)));
  await settle();
  const rev = await srcs();
  if (!(rev[0] > rev[rev.length - 1])) throw new Error('the script did not reverse the frames: ' + rev.join(','));
  // a broken script says why under its code
  await S(() => {
    const code = 'function mosh(){ return 5; }';
    window.__moshpit.scripts.approve(code);
    window.__moshpit.store.edit((p) => (p.effects[0].data = { code }));
    window.__moshpit.store.ui.selectedEffect = 'sc';
  });
  await settle();
  await page.locator('.tabs button', { hasText: 'Effects' }).click();
  await page.locator('.err', { hasText: 'must return an array' }).waitFor();
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
  // tracking from the phone tools: arm it, drag a box on the preview, a track appears
  const tid = await S(() => window.__moshpit.store.selectedClip?.id);
  const paths0 = await S((id) => window.__moshpit.store.project.clips.find((c) => c.id === id).paths?.length ?? 0, tid);
  await page.locator('.tools .tool', { hasText: 'Track' }).click();
  await page.locator('.picknote').waitFor();
  if ((await S(() => window.__moshpit.store.ui.trackPick)) !== tid) throw new Error('Track tool did not arm tracking');
  const st = await page.locator('.preview .stage').boundingBox();
  await page.mouse.move(st.x + st.width * 0.4, st.y + st.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.65, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(({ id, n }) => (window.__moshpit.store.project.clips.find((c) => c.id === id).paths?.length ?? 0) > n || window.__moshpit.store.toasts.some((t) => t.kind === 'error'), { id: tid, n: paths0 }, { timeout: 60000 });
  const err = await S(() => window.__moshpit.store.toasts.find((t) => t.kind === 'error')?.text);
  if (err) throw new Error('phone tracking: ' + err);
  // marking from the phone tools: arm it, drag a box, a box, arrow and label are added
  const nl = await S(() => window.__moshpit.store.project.layers.length);
  await page.locator('.tools .tool', { hasText: 'Mark it' }).click();
  await page.locator('.picknote').waitFor();
  await page.mouse.move(st.x + st.width * 0.4, st.y + st.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.65, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction((n) => window.__moshpit.store.project.layers.length >= n + 3 || window.__moshpit.store.toasts.some((t) => t.kind === 'error'), nl, { timeout: 60000 });
  const merr = await S(() => window.__moshpit.store.toasts.find((t) => t.kind === 'error')?.text);
  if (merr) throw new Error('phone marking: ' + merr);
  await S((n) => window.__moshpit.store.edit((p) => (p.layers = p.layers.slice(0, n))), nl);
  if (!(await S(() => window.__moshpit.store.selectedClip))) await S((id) => window.__moshpit.store.selectClip(id), tid);
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
  // a render still running in this tab would keep writing its own flag over the planted one
  await idle();
  await S(() => localStorage.setItem('moshpit:busy', JSON.stringify({ kind: 'render', at: Date.now() - 60000, tab: 'gone' })));
  await page.reload();
  await page.waitForFunction(() => window.__moshpit?.store);
  await page.locator('.toast', { hasText: 'closed while it was rendering' }).waitFor({ timeout: 20000 });
  if (await S(() => window.__moshpit.store.ui.autoRender)) throw new Error('auto-render was not paused');
  await page.locator('.toast button', { hasText: 'Resume auto-render' }).click();
  if (!(await S(() => window.__moshpit.store.ui.autoRender))) throw new Error('resume did not turn auto-render back on');
  if (await S(() => localStorage.getItem('moshpit:busy') && JSON.parse(localStorage.getItem('moshpit:busy')).tab === 'gone')) throw new Error('stale flag was not cleared');
  await idle();
  // after the reload the service worker serves the editor, cross-origin isolated: the
  // multithreaded engine runs (its worker scripts must be inside the service worker's scope)
  if (!process.env.COI && !(await S(() => crossOriginIsolated && window.__moshpit.ffmpeg.mt))) throw new Error('the service worker did not give the editor the multithreaded engine');
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

await step('languages: the home screen in Spanish and Japanese, then back to English', async () => {
  await S(() => window.__moshpit.projects.goHome());
  await page.locator('[data-testid=home]').waitFor();
  const lang = page.locator('footer select[aria-label="Language"]');
  await lang.selectOption('es');
  await page.locator('h1', { hasText: 'Haz que algo se derrita' }).waitFor();
  await page.getByRole('button', { name: 'Nuevo proyecto' }).waitFor();
  if ((await S(() => document.documentElement.lang)) !== 'es') throw new Error('page language not set');
  await page.locator('footer select[aria-label="Idioma"]').selectOption('ja');
  await page.locator('h1', { hasText: '何かを溶かそう' }).waitFor();
  await page.locator('footer select[aria-label="言語"]').selectOption('en');
  await page.locator('h1', { hasText: 'Make something melt' }).waitFor();
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

await step('command palette: find and run a command by name', async () => {
  const loop = await S(() => window.__moshpit.store.ui.loopOn);
  await page.keyboard.press('Control+p');
  await page.locator('.pal input').waitFor();
  await page.keyboard.type('loop on');
  await page.keyboard.press('Enter');
  await page.waitForFunction((l) => window.__moshpit.store.ui.loopOn !== l && !window.__moshpit.store.ui.dialog, loop);
  // effects and presets are in it too
  await page.keyboard.press('Control+p');
  await page.keyboard.type('add effect bloom');
  if (!(await page.locator('.pal .row.on', { hasText: 'Add effect: Bloom' }).count())) throw new Error('the palette did not find Bloom');
  await page.keyboard.press('Escape');
  await page.locator('.pal').waitFor({ state: 'detached' });
});

await step('history: named steps, jump back and forward', async () => {
  const n0 = await S(() => window.__moshpit.store.historySize.undo);
  await S(() => window.__moshpit.store.addEffect('chroma'));
  await page.keyboard.press('Control+Alt+z');
  await page.locator('.steps .row.now', { hasText: 'Add Chroma Drift' }).waitFor();
  // back one step, then forward again from the list
  await page.locator('.steps .row').nth(1).click();
  await page.waitForFunction((n) => window.__moshpit.store.historySize.undo === n, n0);
  await page.locator('.steps .row.future', { hasText: 'Add Chroma Drift' }).click();
  await page.waitForFunction((n) => window.__moshpit.store.historySize.undo === n + 1, n0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await settle();
});

await step('shortcuts: change one in Help, use it, back to the defaults', async () => {
  await page.keyboard.press('?');
  const row = page.locator('tr', { hasText: 'Loop on / off' });
  await row.locator('.keybtn').click();
  await page.keyboard.press('Shift+L');
  await row.locator('.kbd', { hasText: 'Shift L' }).waitFor();
  await page.keyboard.press('Escape');
  const loop = await S(() => window.__moshpit.store.ui.loopOn);
  await page.keyboard.press('Shift+L');
  if ((await S(() => window.__moshpit.store.ui.loopOn)) === loop) throw new Error('the new shortcut did nothing');
  await page.keyboard.press('?');
  await page.getByRole('button', { name: 'Defaults' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  if ((await S(() => window.__moshpit.store.ui.loopOn)) !== loop) throw new Error('the default shortcut did not come back');
});

await step('effects: favourites, saved settings and a live preview', async () => {
  await page.keyboard.press('Shift+A');
  await page.locator('.cell', { hasText: 'Chroma Drift' }).locator('.star').click();
  await page.locator('.fams h4', { hasText: 'Favourites' }).waitFor();
  // a live preview on your own footage (short timelines only)
  if (await page.locator('.pvt input').count()) {
    if (!(await page.locator('.pvt input').isChecked())) await page.locator('.pvt input').check();
    await page.locator('.cell', { hasText: 'Chroma Drift' }).first().locator('.item').hover();
    await page.locator('.livepv img').waitFor({ timeout: 120000 });
  }
  await page.locator('.cell', { hasText: 'Chroma Drift' }).first().locator('.item').click();
  await page.locator('.editor select.saved').selectOption('save'); // the prompt answers "Test preset"
  await page.waitForFunction(() => [...document.querySelectorAll('.editor select.saved option')].some((o) => o.textContent === 'Test preset'));
  await page.locator('.editor select.saved').selectOption('use:Test preset');
  await page.keyboard.press('Control+z');
  await settle();
});

await step('a big video gets a preview copy made by the browser\'s own encoder', async () => {
  // 1280 px wide (preview copies are made above 960), VP9, which this Chromium can decode
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mosh-ui-')), 'wide.webm');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24:d=3', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', f]);
  } catch {
    console.log('(no ffmpeg, skipped)');
    return;
  }
  await page.locator('aside input[type=file][multiple]').first().setInputFiles(f);
  const badge = page.locator('.item', { hasText: 'wide.webm' }).locator('.proxy');
  await badge.waitFor({ timeout: 120000 });
  if (!(await badge.getAttribute('title')).includes('hardware')) throw new Error('the preview copy was not made with WebCodecs');
  // the mosh preview reads the copy with ffmpeg
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), clips: [], effects: [] }));
  await page.locator('.item', { hasText: 'wide.webm' }).locator('button[aria-label="Add to timeline"]').click();
  await settle();
  if (!(await S(() => window.__moshpit.store.render?.frames.length))) throw new Error('no frames from the preview copy');
});

await step('media is kept in the file system (OPFS), and files from IndexedDB move there', async () => {
  const r = await S(async () => {
    const { storage } = window.__moshpit;
    const dir = await storage.opfs();
    if (!dir) return { opfs: false };
    const names = [];
    for await (const [name] of dir.entries()) names.push(name);
    // a file as older versions kept it
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('moshpit', 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    await new Promise((res, rej) => {
      const t = db.transaction('files', 'readwrite');
      t.objectStore('files').put(new Blob([new Uint8Array(12345)], { type: 'video/mp4' }), 'legacy:test');
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    const moved = await storage.moveFilesToDisk();
    storage.files.delete('legacy:test');
    const back = await storage.getFile('legacy:test');
    const left = await new Promise((res) => {
      const q = db.transaction('files', 'readonly').objectStore('files').get('legacy:test');
      q.onsuccess = () => res(q.result);
    });
    const onDisk = back instanceof File;
    await storage.pruneFiles((await window.__moshpit.store.keepFiles()));
    return { opfs: true, names: names.length, moved, size: back?.size, onDisk, left: !!left };
  });
  if (!r.opfs) throw new Error('no OPFS in Chromium');
  if (r.names < 2) throw new Error('imported media is not in OPFS: ' + JSON.stringify(r));
  if (!r.moved || r.size !== 12345 || !r.onDisk || r.left) throw new Error('migration from IndexedDB: ' + JSON.stringify(r));
});

await step('export queue: exports in the background while editing carries on', async () => {
  await S(() => window.__moshpit.store.set({ ...JSON.parse(JSON.stringify(window.__moshpit.store.project)), effects: [] }));
  await settle();
  await page.keyboard.press('e');
  await page.getByRole('button', { name: /^WebM/ }).click();
  await page.getByRole('button', { name: 'Add to queue' }).click();
  await page.locator('.queue .job').first().waitFor();
  if (await S(() => window.__moshpit.store.ui.dialog)) throw new Error('the export dialog stayed open');
  // the editor still renders while the queue works (on the other engine)
  await page.keyboard.press('Shift+A');
  await page.locator('.modal input[aria-label="Search effects"]').fill('Bloom');
  await page.locator('.modal .item').filter({ hasText: 'Bloom' }).first().click();
  await settle();
  await page.locator('.queue .job.done').waitFor({ timeout: 300000 });
  const link = page.locator('.queue .job.done a[download]');
  if (!(await link.getAttribute('download'))?.endsWith('.webm')) throw new Error('no download for the queued export');
  await page.screenshot({ path: path.resolve('test-results/export-queue.png') });
  await page.locator('.queue .job.done button[aria-label="Remove from the list"]').click();
  await page.locator('.queue').waitFor({ state: 'detached' });
});

await step('recipe files: save one, clear the mosh, open it again; batch two videos through the queue', async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.__moshpit?.store && !window.__moshpit.store.status.engine, null, { timeout: 120000 });
  // a fresh project with the example in it (the editor reopens the last project)
  await S(async () => {
    await window.__moshpit.projects.startProject();
    await window.__moshpit.media.loadExample();
  });
  await page.waitForFunction(() => window.__moshpit.store.project.clips.some((c) => c.transition), null, { timeout: 120000 });
  // the example's mosh is in its transitions; recipes carry the effect stack
  await S(() => {
    const st = window.__moshpit.store;
    const total = st.totalFrames;
    st.edit((p) => p.effects.push({ id: 'rb', type: 'bloom', enabled: true, solo: false, start: Math.round(total * 0.2), end: Math.round(total * 0.6), seed: 7, params: { target: 'every', interval: 3, length: 'fill', timing: 'fit' }, auto: {}, locks: [] }, { id: 'rv', type: 'vhs', enabled: true, solo: false, start: 0, end: total, seed: 8, params: { tracking: 0.4, bleed: 8, wobble: 0.6, noise: 0.25, colour: 0.85 }, auto: {}, locks: [] }));
  });
  await settle();
  const before = await S(() => window.__moshpit.store.project.effects.map((e) => e.type).join());
  // save: a download where there's no Save dialog
  await S(() => (window.showSaveFilePicker = undefined));
  const dl = page.waitForEvent('download');
  await S(() => window.__moshpit.commands.runCommand('save-recipe'));
  const d = await dl;
  if (!d.suggestedFilename().endsWith('.moshrecipe')) throw new Error('recipe file name: ' + d.suggestedFilename());
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mosh-recipe-')), d.suggestedFilename());
  await d.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (saved.moshpit !== 'recipe' || !saved.recipe.fx.length) throw new Error('recipe file contents: ' + JSON.stringify(saved).slice(0, 200));
  // clear the effects, then open the recipe
  await S(() => window.__moshpit.store.edit((p) => (p.effects = [])));
  const chooser = page.waitForEvent('filechooser');
  await S(() => window.__moshpit.commands.runCommand('open-recipe'));
  await (await chooser).setFiles(file);
  await page.waitForFunction((b) => window.__moshpit.store.project.effects.map((e) => e.type).join() === b, before);
  await settle();

  // batch: two short videos, as WebM
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosh-batch-'));
  const vids = ['one.mp4', 'two.mp4'].map((n, i) => {
    const f = path.join(dir, n);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=24:d=${2 + i}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    return f;
  });
  await S(() => window.__moshpit.commands.runCommand('batch'));
  const vchooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose videos…' }).click();
  await (await vchooser).setFiles(vids);
  await page.locator('.modal .field', { hasText: 'Format' }).locator('select').selectOption('webm');
  await page.getByRole('button', { name: 'Export 2 videos' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.queue .job').length === 2, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.queue .job.done').length === 2, null, { timeout: 400000 });
  const names = await page.locator('.queue .job.done a[download]').evaluateAll((as) => as.map((a) => a.getAttribute('download')));
  if (!(names.some((n) => n.startsWith('one')) && names.some((n) => n.startsWith('two')) && names.every((n) => n.endsWith('.webm')))) throw new Error('batch exports: ' + names.join(', '));
});

await step('layout: fold and resize the panels, switch layouts, and it is kept', async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.__moshpit?.store && !window.__moshpit.store.ui.home, null, { timeout: 60000 });
  const width = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
  const player0 = await width('main .center');
  // fold the media panel with its arrow
  await page.locator('main .colsize').first().hover();
  await page.getByRole('button', { name: 'Fold away the media panel' }).click();
  await page.locator('aside.left').waitFor({ state: 'hidden' });
  if (!((await width('main .center')) > player0 + 200)) throw new Error('the player did not get the room: ' + player0 + ' → ' + (await width('main .center')) + ' ' + (await page.locator('main').evaluate((m) => getComputedStyle(m).gridTemplateColumns + ' | ' + m.getAttribute('style'))));
  await page.getByRole('button', { name: 'Show the media panel' }).click();
  await page.locator('aside.left').waitFor();
  // drag the inspector's edge 120 px to the left: it gets wider
  const r0 = await width('aside.right');
  const edge = await page.locator('main .colsize').nth(1).boundingBox();
  await page.mouse.move(edge.x + 3, edge.y + 40);
  await page.mouse.down();
  await page.mouse.move(edge.x - 117, edge.y + 40, { steps: 6 });
  await page.mouse.up();
  const r1 = await width('aside.right');
  if (Math.abs(r1 - r0 - 120) > 6) throw new Error(`inspector ${r0} → ${r1}`);
  // a layout from the palette, kept after a reload
  await S(() => window.__moshpit.commands.runCommand('layout-mosh'));
  await page.locator('aside.left').waitFor({ state: 'hidden' });
  await page.reload();
  await page.waitForFunction(() => window.__moshpit?.store && !window.__moshpit.store.ui.home, null, { timeout: 60000 });
  if (await page.locator('aside.left').isVisible()) throw new Error('the layout was not kept');
  if (Math.abs((await width('aside.right')) - 420) > 2) throw new Error('Mosh layout inspector width');
  // back to the usual
  await S(() => window.__moshpit.layout.useLayout({ left: 260, right: 330, leftOpen: true, rightOpen: true, timeline: 260 }));
  await page.locator('aside.left').waitFor();
});

await step('website: landing page, gallery and docs', async () => {
  await page.goto(root);
  await page.locator('h1', { hasText: 'Break your videos' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#gallery-list .gcard').length >= 4);
  // the website never loads the editor (or its video engine)
  if (await S(() => !!window.__moshpit)) throw new Error('the editor loaded on the landing page');
  // the effect rack is built from the app's effects, and picking a key describes it
  if ((await page.locator('#rack .key').count()) < 20) throw new Error('the effect rack is missing effects');
  await page.locator('#rack .key[data-fx="bloom"]').click();
  await page.locator('.display-name', { hasText: 'Bloom' }).waitFor();
  // the frame diagram loses its keyframe and gets it back
  await page.locator('#frames-btn').click();
  await page.waitForFunction(() => document.getElementById('frames').dataset.removed === 'true');
  await page.locator('#frames-btn').click();
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
