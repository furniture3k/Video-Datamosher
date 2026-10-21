// Screenshots and the demo GIF for the README and the website (docs/*.png, docs/demo.gif), taken
// from the real app with its drawn sample footage. Run it again after changing the interface.
// Usage: npm run build && node scripts/docs-shots.mjs   (then node scripts/og-image.mjs for the social card)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright-core';

const dist = path.resolve(process.env.DIST || 'dist');
const out = path.resolve('docs');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }).end(d)));
  })
  .listen(0);
const url = `http://localhost:${server.address().port}/app/`;
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p)) || chromium.executablePath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const prefs = { startHome: false, seenWelcome: true, autoMosh: false, tips: false, quickSeen: true, previewRes: 'full' };
async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    acceptDownloads: true,
    ...(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
  });
  await ctx.addInitScript((p) => {
    if (window !== window.top) return;
    for (const [k, v] of Object.entries(p)) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
  }, prefs);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__moshpit?.starters);
  // titles in the Impact style look the same on every machine (Linux has no Impact): a condensed font of the same weight under its name
  await page.evaluate(async () => {
    try {
      const css = await (await fetch('https://fonts.googleapis.com/css2?family=Anton')).text();
      const src = /\/\* latin \*\/[^}]*?url\((https:[^)]+)\)/.exec(css)?.[1];
      if (!src) return;
      const face = new FontFace('Impact', await (await fetch(src)).arrayBuffer());
      await face.load();
      document.fonts.add(face);
    } catch {
      /* the fallback, then */
    }
  });
  return { ctx, page };
}

/** A project of three drawn shots: a title that melts with them, a melt, then a bloom melt. */
const BUILD = async () => {
  const m = window.__moshpit;
  await m.starters.openExample({
    id: 'docs',
    name: 'Night melt',
    description: '',
    thumb: '',
    sample: [['nightdrive', 3], ['figure', 3], ['sunset', 3]],
    build: () =>
      m.store.edit((p) => {
        const v = p.clips.filter((c) => c.track === 'v1');
        if (v[1]) v[1].transition = { type: 'melt', duration: 1.2, intensity: 0.6 };
        if (v[2]) v[2].transition = { type: 'bloom', duration: 1.2, intensity: 0.6 };
      }),
  });
  m.store.seek(0);
  m.edit.addText();
  m.store.edit((p) => Object.assign(p.layers[p.layers.length - 1], { text: 'AFTER DARK', duration: 2.6, moshed: true, font: 'impact', bold: false, size: 0.2, color: '#ffffff', shadow: false, y: 0.42 }));
  m.store.selectClip(null);
};
const waitRender = (page) =>
  page.waitForFunction(() => {
    const c = document.querySelector('.stage canvas');
    const s = window.__moshpit.store;
    return c && !c.classList.contains('hidden') && !s.status.busy && !s.status.pending && !s.status.engine && s.showingMosh;
  }, null, { timeout: 600000 });
const settle = (page, ms = 800) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: path.join(out, name) });

// ---- the editor, a preset on, mid-melt
{
  const { ctx, page } = await open({ width: 1440, height: 900 });
  await page.evaluate(BUILD);
  // the demo GIF: the cut with its melts (before a preset goes on), small
  const gif = await page.evaluate(async () => {
    const m = window.__moshpit;
    const p = JSON.parse(JSON.stringify(m.store.project));
    const ex = await m.renderer.exportVideo(p, { format: 'gif', width: 420, scaler: 'bicubic', crf: 18, preset: 'veryfast', gifColors: 128, gifDither: 'bayer', gifFps: 12, loop: true, audio: false }, () => {}, { cancelled: false });
    const buf = new Uint8Array(await ex.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
    return btoa(s);
  });
  fs.writeFileSync(path.join(out, 'demo.gif'), Buffer.from(gif, 'base64'));
  process.stdout.write('demo.gif ');
  await page.keyboard.press('p');
  await page.getByRole('button', { name: /Bloom Explosion/ }).click();
  await settle(page);
  await waitRender(page);
  await page.evaluate(() => {
    const st = window.__moshpit.store;
    st.ui.tab = 'effects';
    const fx = st.project.effects[0];
    if (fx) st.ui.selectedEffect = fx.id;
    st.seek(3.6);
  });
  await settle(page, 1500);
  await shot(page, 'studio.png');
  process.stdout.write('studio ');

  // presets
  await page.keyboard.press('p');
  await settle(page, 1000);
  await shot(page, 'presets.png');
  await page.keyboard.press('Escape');
  process.stdout.write('presets ');

  // transitions: the tab, a Bloom melt picked on the timeline and its settings
  await page.getByRole('tab', { name: 'Transitions' }).click();
  await page.evaluate(() => {
    const st = window.__moshpit.store;
    const c = st.project.clips.filter((x) => x.track === 'v1')[2];
    st.selectTransition(c.id);
    st.seek(6.4);
  });
  await settle(page, 1500);
  await shot(page, 'transitions.png');
  process.stdout.write('transitions ');

  await ctx.close();
}

// ---- the export dialog: a vertical project made for Reels
{
  const { ctx, page } = await open({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const m = window.__moshpit;
    await m.starters.openExample(m.starters.TEMPLATES.find((t) => t.id === 'degraded'));
  });
  await waitRender(page).catch(() => {});
  await page.evaluate(() => window.__moshpit.store.seek(1.4));
  await page.keyboard.press('e');
  await settle(page);
  await page.locator('.modal .social select').selectOption('vertical');
  await settle(page, 600);
  await shot(page, 'export.png');
  process.stdout.write('export ');
  await ctx.close();
}

// ---- phones: the editor, the transition sheet and the speed sheet, side by side
{
  const { ctx, page } = await open({ width: 414, height: 844 }, true);
  await page.evaluate(BUILD);
  await waitRender(page).catch(() => {});
  const parts = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moshpit-docs-'));
  const snap = async (n) => {
    const f = path.join(tmp, `${n}.png`);
    await page.screenshot({ path: f });
    parts.push(f);
  };
  await page.evaluate(() => window.__moshpit.store.seek(3.4));
  await settle(page, 1200);
  await snap('a');
  // the transition sheet
  await page.locator('.mtl .trans, [aria-label*="ransition"]').first().click().catch(() => {});
  await settle(page, 1000);
  await snap('b');
  await page.keyboard.press('Escape');
  await page.locator('.sheet .done, [aria-label="Done"]').first().click().catch(() => {});
  // a clip selected, its speed sheet
  await page.evaluate(() => {
    const st = window.__moshpit.store;
    st.selectClip(st.project.clips.find((c) => c.track === 'v1').id);
  });
  await settle(page, 500);
  await page.getByRole('button', { name: 'Speed' }).first().click().catch(() => {});
  await settle(page, 1000);
  await snap('c');
  // three phones side by side, at 1242 × 844
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...parts.flatMap((p) => ['-i', p]), '-filter_complex', parts.map((_, i) => `[${i}]scale=414:844[s${i}]`).join(';') + ';' + parts.map((_, i) => `[s${i}]`).join('') + `hstack=inputs=${parts.length}`, path.join(out, 'mobile.png')]);
  process.stdout.write('mobile ');
  await ctx.close();
}

console.log('\nwrote docs/studio.png, presets.png, transitions.png, export.png, mobile.png and demo.gif');
await browser.close();
server.close();
