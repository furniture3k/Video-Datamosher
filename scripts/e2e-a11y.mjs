// Accessibility check: runs axe-core on the website, the home screen, the editor and its main
// dialogs (desktop and phone sizes), and fails on any serious or critical problem.
// Usage: npm run build && node scripts/e2e-a11y.mjs   (A11Y_ALL=1 also lists moderate and minor ones)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(d)));
  })
  .listen(0);
const root = `http://localhost:${server.address().port}/`;
const axe = fs.readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');
// this container's Chromium, else the one Playwright installed (CI)
const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const exe = process.env.CHROMIUM || (fs.existsSync(local) ? local : chromium.executablePath());
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const LEVELS = process.env.A11Y_ALL ? ['minor', 'moderate', 'serious', 'critical'] : ['serious', 'critical'];
let problems = 0;

async function check(page, name) {
  await page.addScriptTag({ content: axe });
  const r = await page.evaluate(async () =>
    // the WebGL / video canvases and the timeline's drawn lanes are pictures, not text
    window.axe.run(document, { resultTypes: ['violations'], rules: { region: { enabled: false } } }),
  );
  const bad = r.violations.filter((v) => LEVELS.includes(v.impact));
  console.log(`• ${name}: ${bad.length ? bad.length + ' problem(s)' : 'ok'}`);
  for (const v of bad) {
    problems += v.impact === 'serious' || v.impact === 'critical' ? 1 : 0;
    console.log(`   [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`);
    for (const n of v.nodes.slice(0, 4)) console.log(`      ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
  }
}

async function app(viewport, prefs) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((prefs) => {
    if (window !== window.top) return;
    for (const [k, v] of Object.entries(prefs)) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
  }, prefs);
  return ctx.newPage();
}
const idle = (page) => page.waitForFunction(() => { const s = window.__moshpit.store; return !s.status.busy && !s.status.pending && !s.status.engine; }, null, { timeout: 180000 });

try {
  // the website
  {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(root);
    await page.locator('h1').waitFor();
    await check(page, 'website: landing page');
    await page.goto(root + 'docs/');
    await check(page, 'website: docs');
  }
  // the home screen
  {
    const page = await app({ width: 1440, height: 900 }, { startHome: true, seenWelcome: true, autoMosh: false });
    await page.goto(root + 'app/');
    await page.locator('[data-testid=home]').waitFor();
    await check(page, 'home screen');
  }
  // the editor and its dialogs
  const page = await app({ width: 1440, height: 900 }, { startHome: false, seenWelcome: true, autoMosh: false });
  await page.goto(root + 'app/');
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.waitForFunction(() => window.__moshpit.store.project.clips.some((c) => c.transition), null, { timeout: 120000 });
  await idle(page);
  await check(page, 'editor');
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await check(page, 'editor (advanced)');
  for (const [name, dialog] of [
    ['export', 'export'],
    ['add effect', 'addEffect'],
    ['presets', 'presets'],
    ['help', 'help'],
    ['command palette', 'palette'],
    ['history', 'history'],
    ['storage', 'storage'],
    ['batch', 'batch'],
    ['snapshots', 'snapshots'],
    ['share', 'share'],
  ]) {
    await page.evaluate((d) => (window.__moshpit.store.ui.dialog = d), dialog);
    await page.waitForTimeout(400);
    await check(page, `dialog: ${name}`);
    await page.evaluate(() => (window.__moshpit.store.ui.dialog = null));
  }
  // the keyboard in a dialog: focus goes in, Tab stays in, and comes back on close
  {
    await page.locator('header button', { hasText: 'Export' }).first().focus();
    await page.keyboard.press('e');
    await page.locator('.modal').waitFor();
    await page.waitForTimeout(200);
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('.modal'));
    if (!(await inside())) throw new Error('focus did not move into the dialog');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
      if (!(await inside())) throw new Error('Tab left the dialog');
    }
    await page.keyboard.press('Escape');
    await page.locator('.modal').waitFor({ state: 'detached' });
    const back = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (!/Export/.test(back ?? '')) throw new Error('focus did not come back: ' + back);
    console.log('• keyboard: dialogs keep and give back focus: ok');
  }
  // the tour
  await page.evaluate(() => (window.__moshpit.store.ui.welcome = true));
  await page.waitForTimeout(400);
  await check(page, 'tour');
  await page.evaluate(() => (window.__moshpit.store.ui.welcome = false));
  // phone
  const phone = await app({ width: 390, height: 844 }, { startHome: false, seenWelcome: true, autoMosh: false });
  await phone.goto(root + 'app/');
  await phone.getByRole('button', { name: 'Load example' }).first().click();
  await phone.waitForFunction(() => window.__moshpit.store.project.clips.length > 0, null, { timeout: 120000 });
  await idle(phone);
  await check(phone, 'phone editor');
} finally {
  await browser.close();
  server.close();
}
console.log(problems ? `\n${problems} serious or critical accessibility problem(s)` : '\nAccessibility check passed');
process.exitCode = problems ? 1 : 0;
