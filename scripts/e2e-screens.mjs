// Screen sizes and picture shapes: the website, the home screen, the editor and its dialogs at every
// common window size (from the desktop app's smallest window to 4K, phones and tablets either way
// up), with projects of every aspect ratio. Fails on anything cut off past the window's edge, a page
// that scrolls sideways, controls drawn over each other, or a player picture of the wrong shape.
// Usage: npm run build && node scripts/e2e-screens.mjs   (SHOTS=dir keeps a screenshot of each)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { layoutProblems, pictureProblem } from './layout-check.mjs';

const dist = path.resolve(process.env.DIST || 'dist');
const shots = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'video/webm' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const root = `http://localhost:${server.address().port}/`;
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p)) || chromium.executablePath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// [name, width, height, device pixel ratio, touch]
const DESKTOP = [
  ['desktop-min', 900, 560, 1],
  // a 1366×768 laptop at 150% and 125% scaling (the desktop window fits itself to these)
  ['laptop-150%', 910, 512, 1.5],
  ['laptop-125%', 1092, 582, 1.25],
  ['netbook', 1024, 600, 1],
  ['laptop-720', 1280, 720, 1],
  ['laptop-retina', 1280, 800, 2],
  ['hd', 1366, 768, 1],
  ['mac-default', 1440, 900, 2],
  ['fhd', 1920, 1080, 1],
  ['qhd', 2560, 1440, 1],
  ['4k', 3840, 2160, 1],
  ['ultrawide', 3440, 1440, 1],
  ['portrait-monitor', 1080, 1920, 1],
  ['tablet-landscape', 1024, 768, 2, true],
];
const PHONE = [
  ['phone-small', 375, 667, 2, true],
  ['phone', 390, 844, 3, true],
  ['phone-landscape', 844, 390, 3, true],
  ['tablet-portrait', 768, 1024, 2, true],
];
const ASPECTS = ['auto', '9:16', '1:1', '4:5', '4:3', '21:9'];
const DIALOGS = ['export', 'help', 'presets', 'snapshots', 'share', 'addEffect', 'generate', 'storage', 'whatsnew', 'palette', 'history', 'batch', 'fonts', 'captions', 'variations'];

const problems = () => page.evaluate(layoutProblems);
/** The player's picture: its shape on screen against the project's, and that it fits its stage. */
const pictureCheck = () => page.evaluate(pictureProblem);

let failed = 0;
let page;
const check = async (label, extra) => {
  const found = await problems();
  if (extra) {
    const e = await extra();
    if (e) found.push(e);
  }
  if (shots) await page.screenshot({ path: path.join(shots, label.replace(/[^\w.-]+/g, '_') + '.png') });
  if (found.length) {
    failed++;
    console.log(`✗ ${label}\n    ${found.slice(0, 12).join('\n    ')}${found.length > 12 ? `\n    …and ${found.length - 12} more` : ''}`);
  } else console.log(`✓ ${label}`);
};

const open = async ([name, width, height, dpr, touch], prefs = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: !!touch, isMobile: !!touch && width < 900 });
  await ctx.addInitScript((prefs) => {
    if (window !== window.top) return;
    for (const [k, v] of Object.entries({ seenWelcome: true, autoMosh: false, startHome: false, ...prefs })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
  }, prefs);
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${name}] page error: ${e.message}`));
  return ctx;
};
const waitDrawn = () => page.waitForFunction(() => [...document.querySelectorAll('.stage canvas')].some((c) => !c.classList.contains('hidden') && c.width > 0), null, { timeout: 60000 });
const settle = () => page.waitForTimeout(400);

// the website: every size
for (const v of [...DESKTOP, ...PHONE]) {
  const ctx = await open(v);
  await page.goto(root);
  await settle();
  await check(`site ${v[0]}`);
  await ctx.close();
}

// the editor (and home screen) at every desktop size, with each picture shape
for (const v of DESKTOP) {
  const ctx = await open(v, { startHome: true });
  await page.goto(root + 'app/');
  await page.locator('.home').waitFor({ timeout: 30000 });
  await settle();
  await check(`home ${v[0]}`);
  await page.evaluate(async () => {
    const m = window.__moshpit;
    m.store.ui.home = false;
    await m.media.loadExample();
  });
  await page.waitForFunction(() => window.__moshpit.store.project.clips.length > 0, null, { timeout: 60000 });
  await waitDrawn();
  for (const a of ASPECTS) {
    await page.evaluate((a) => (window.__moshpit.store.project.encoder.aspect = a), a);
    await settle();
    await check(`editor ${v[0]} ${a}`, pictureCheck);
  }
  // both panels folded away, and the timeline as tall as it goes
  await page.evaluate(() => (window.__moshpit.store.ui.timelineHeight = 5000));
  await settle();
  await check(`editor ${v[0]} tall timeline`, pictureCheck);
  await page.evaluate(() => (window.__moshpit.store.ui.timelineHeight = 240));
  // a clip selected: the inspector shows its settings
  await page.evaluate(() => {
    const s = window.__moshpit.store;
    s.ui.selectedClips = [s.project.clips[0].id];
  });
  await settle();
  await check(`editor ${v[0]} clip selected`);
  for (const d of v[1] <= 1440 ? DIALOGS : ['export', 'help', 'addEffect']) {
    await page.evaluate((d) => (window.__moshpit.store.ui.dialog = d), d);
    await page.locator('[role=dialog]').first().waitFor({ timeout: 10000 }).catch(() => {});
    await settle();
    await check(`dialog ${d} ${v[0]}`);
    await page.evaluate(() => (window.__moshpit.store.ui.dialog = null));
  }
  await ctx.close();
}

// phones and tablets: the mobile editor
for (const v of PHONE) {
  const ctx = await open(v, { startHome: true });
  await page.goto(root + 'app/');
  await page.locator('.home').waitFor({ timeout: 30000 });
  await settle();
  await check(`home ${v[0]}`);
  await page.evaluate(async () => {
    const m = window.__moshpit;
    m.store.ui.home = false;
    await m.media.loadExample();
  });
  await page.waitForFunction(() => window.__moshpit.store.project.clips.length > 0, null, { timeout: 60000 });
  await waitDrawn().catch(() => {});
  for (const a of ASPECTS) {
    await page.evaluate((a) => (window.__moshpit.store.project.encoder.aspect = a), a);
    await settle();
    await check(`mobile ${v[0]} ${a}`, pictureCheck);
  }
  for (const d of ['export', 'help', 'addEffect', 'share']) {
    await page.evaluate((d) => (window.__moshpit.store.ui.dialog = d), d);
    await settle();
    await check(`dialog ${d} ${v[0]}`);
    await page.evaluate(() => (window.__moshpit.store.ui.dialog = null));
  }
  await ctx.close();
}

await browser.close();
server.close();
if (failed) {
  console.log(`\n${failed} screen${failed > 1 ? 's' : ''} with layout problems`);
  process.exit(1);
}
console.log('\nevery screen size lays out cleanly');
