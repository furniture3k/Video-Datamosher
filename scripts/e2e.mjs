// End-to-end smoke test: builds nothing, serves dist/ and drives the real app in Chromium.
// Usage: npm run build && npm run test:e2e
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const dist = path.resolve('dist');
const shots = path.resolve(process.env.SHOTS || 'test-results');
fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const server = http
  .createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (f.endsWith('/')) f += 'index.html';
    fs.readFile(f, (err, data) => {
      if (err) return res.writeHead(404).end();
      // cross-origin isolated, as the service worker makes the editor: the multithreaded engine runs
      // (the UI sweep runs without, on the single-threaded one)
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }).end(data);
    });
  })
  .listen(0);
// the editor (the website is at the root)
const url = `http://localhost:${server.address().port}/app/`;
const exe = process.env.CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
// a real input file with sound (needs native ffmpeg; skipped otherwise)
let sample = null;
try {
  sample = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mosh-e2e-')), 'dancer.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=25:d=3', '-f', 'lavfi', '-i', 'sine=f=330:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample]);
} catch {
  sample = null;
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// start in the editor (not the home screen), without the first-run tour or the automatic first mosh
await page.addInitScript(() => {
  // not in sandboxed frames (the Script effect's), which have no storage
  if (window !== window.top) return;
  for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
});

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : /retrying/.test(m.text()) && console.log('  [warn]', m.text())));
const step = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`• ${name}… `);
  await fn();
  console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
};
const waitRender = () =>
  page.waitForFunction(() => {
    const c = document.querySelector('.stage canvas');
    const s = window.__moshpit.store;
    return c && !c.classList.contains('hidden') && !s.status.busy && !s.status.pending && !s.status.engine && s.showingMosh;
  }, null, { timeout: 180000 });

try {
  await step('load app', async () => {
    await page.goto(url);
    await page.getByRole('button', { name: 'Load example' }).waitFor();
    if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error('not cross-origin isolated');
  });
  await step('load demo (generators + preset) and render', async () => {
    await page.getByRole('button', { name: 'Load example' }).click();
    await page.waitForFunction(() => window.__moshpit.store.project.clips.some((c) => c.transition), null, { timeout: 120000 });
    await waitRender();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, '1-demo.png') });
  });
  await step('the video engine runs multithreaded', async () => {
    if (!(await page.evaluate(() => window.__moshpit.ffmpeg.mt))) throw new Error('single-threaded engine loaded in an isolated page');
  });
  await step('frames rendered', async () => {
    const n = await page.evaluate(() => document.querySelector('.frameinfo')?.textContent);
    if (!/1\/\d+/.test(n ?? '')) throw new Error('unexpected frame info: ' + n);
  });
  await step('scrub to the mosh', async () => {
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, '2-scrubbed.png') });
  });
  await step('apply bloom preset', async () => {
    await page.keyboard.press('p');
    await page.getByRole('button', { name: /Bloom Explosion/ }).click();
    await page.waitForTimeout(500);
    await waitRender();
  });
  await step('variations grid', async () => {
    await page.keyboard.press('v');
    await page.waitForFunction(() => document.querySelectorAll('.cell canvas').length >= 6, null, { timeout: 240000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(shots, '6-variations.png') });
    await page.keyboard.press('Escape');
  });
  await step('add vector warp (pixel effect) and render', async () => {
    await page.keyboard.press('Shift+A');
    await page.getByRole('button', { name: /Vector Warp/ }).click();
    await page.waitForTimeout(500);
    await waitRender();
    await page.keyboard.press('End');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, '3-warp.png') });
  });
  await step('automate a parameter', async () => {
    // automation is an Advanced control
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.locator('.pc').first().getByTitle(/Automate/).click();
    await page.waitForSelector('.ae canvas');
  });
  await step('chaos roll + undo', async () => {
    await page.keyboard.press('r');
    await page.waitForTimeout(500);
    await waitRender();
    await page.keyboard.press('Control+z');
  });
  await step('compare split', async () => {
    await page.keyboard.press('c');
    await page.waitForTimeout(3000);
    await waitRender();
    await page.screenshot({ path: path.join(shots, '4-compare.png') });
    await page.keyboard.press('c');
  });
  await step('export GIF', async () => {
    await page.keyboard.press('e');
    await page.getByRole('button', { name: /^GIF/ }).click();
    const dl = page.waitForEvent('download', { timeout: 240000 });
    await page.getByRole('button', { name: /Export GIF/ }).click();
    const d = await dl;
    const p = path.join(shots, d.suggestedFilename());
    await d.saveAs(p);
    if (fs.statSync(p).size < 1000) throw new Error('gif too small');
    await page.screenshot({ path: path.join(shots, '5-export.png') });
    await page.keyboard.press('Escape');
  });
  await step('export MP4', async () => {
    await page.keyboard.press('e');
    await page.getByRole('button', { name: /^MP4/ }).click();
    const dl = page.waitForEvent('download', { timeout: 240000 });
    await page.getByRole('button', { name: /Export MP4/ }).click();
    const d = await dl;
    const p = path.join(shots, d.suggestedFilename());
    await d.saveAs(p);
    if (fs.statSync(p).size < 1000) throw new Error('mp4 too small');
    await page.keyboard.press('Escape');
  });
  if (sample)
    await step('import a real file with audio + audio export', async () => {
      await page.locator('input[type=file][multiple]').setInputFiles(sample);
      const item = page.locator('.item', { hasText: 'dancer.mp4' });
      await item.waitFor({ timeout: 60000 });
      await item.dragTo(page.locator('.v-lane'), { targetPosition: { x: 4, y: 25 } });
      await page.locator('.clip.video', { hasText: 'dancer' }).waitFor();
      await page.waitForTimeout(800);
      await waitRender();
      await page.locator('.tabs button', { hasText: 'Audio' }).click();
      await page.getByText('Bit depth').waitFor();
      await page.keyboard.press('e');
      await page.getByRole('button', { name: /^WebM/ }).click();
      // the vector warp from earlier is still on: slow under software GL
      const dl = page.waitForEvent('download', { timeout: 600000 });
      await page.getByRole('button', { name: /Export WEBM/ }).click();
      const d = await dl;
      const p = path.join(shots, d.suggestedFilename());
      await d.saveAs(p);
      // Chromium encodes VP9 itself (WebCodecs); the sound and the recipe are added by ffmpeg
      if (!(await page.locator('.done').textContent()).includes('hardware encoded')) throw new Error('webm export did not use the hardware encoder');
      try {
        const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format_tags=comment', '-of', 'csv=p=0', p]).toString();
        if (!probe.includes('audio')) throw new Error('export has no audio stream: ' + probe);
        if (!probe.includes('vp9')) throw new Error('hardware export is not VP9: ' + probe);
        if (!probe.includes('MOSH:')) throw new Error('hardware export lost its recipe: ' + probe.slice(0, 300));
      } catch (e) {
        if (/no audio|not VP9|recipe/.test(String(e.message))) throw e;
      }
      await page.keyboard.press('Escape');
    });
  await step('record from the (fake) camera onto the timeline', async () => {
    const n = await page.evaluate(() => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length);
    await page.getByRole('button', { name: 'Record' }).first().click();
    await page.getByRole('button', { name: 'Camera' }).click();
    await page.locator('.modal video.on').waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Record' }).click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Stop and add' }).click();
    await page.waitForFunction((n) => window.__moshpit.store.project.clips.filter((c) => c.track === 'v1').length === n + 1, n, { timeout: 60000 });
    const m = await page.evaluate(() => window.__moshpit.store.project.media.at(-1));
    // the recording is tidied so it has a real duration (and can be seeked)
    if (!(m.duration > 1.5 && m.duration < 4)) throw new Error('recording duration ' + m.duration);
  });
  await step('live mode with (fake) webcam', async () => {
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.getByRole('button', { name: 'Camera' }).click();
    await page.waitForTimeout(3000);
    await page.keyboard.press('4');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, '7-live.png') });
    const fps = await page.locator('.side .mono').first().textContent();
    if (!/[1-9]\d* fps/.test(fps ?? '')) throw new Error('live mode not running: ' + fps);
    await page.keyboard.press('Escape');
  });
  await step('phone layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, '8-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('horizontal overflow on phone width');
  });
  const real = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
  if (real.length) throw new Error('page errors:\n' + real.join('\n'));
  console.log('\nE2E passed. Screenshots in', shots);
} catch (e) {
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  console.error('\nE2E FAILED:', e.message, '\nerrors:', errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
