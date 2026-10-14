// Drives the desktop app (Tauri, native FFmpeg) through WebDriver: load the example, render it,
// export MP4 and WebM, cancel an export, and import a file through the native engine.
//
// Needs tauri-driver (`cargo install tauri-driver`) and, on Linux, WebKitWebDriver
// (webkit2gtk-driver) and a display (xvfb-run). Build the app first:
//   npm run build && cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
//   xvfb-run node scripts/e2e-desktop.mjs [path/to/app]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const app = path.resolve(process.argv[2] ?? `src-tauri/target/debug/moshpit${process.platform === 'win32' ? '.exe' : ''}`);
const shots = path.resolve('test-results/desktop');
fs.mkdirSync(shots, { recursive: true });

const driver = spawn('tauri-driver', [], { stdio: ['ignore', 'inherit', 'inherit'] });
const base = 'http://127.0.0.1:4444';
async function wd(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url}: ${j.value?.message ?? r.status}`);
  return j.value;
}

let sid = '';
const exec = (fn, ...args) => wd('POST', `/session/${sid}/execute/sync`, { script: `return (${fn}).apply(null, arguments)`, args });
/** Run an async function in the page; resolves with its result or rejects with its error. */
const run = async (fn, ...args) => {
  const r = await wd('POST', `/session/${sid}/execute/async`, {
    script: `const done = arguments[arguments.length - 1]; Promise.resolve((${fn}).apply(null, Array.from(arguments).slice(0, -1))).then((v) => done({ v }), (e) => done({ e: String(e && e.stack || e) }));`,
    args,
  });
  if (r?.e) throw new Error(r.e);
  return r?.v;
};
const waitFor = async (fn, ms = 180000) => {
  const t = Date.now();
  while (!(await exec(fn))) {
    if (Date.now() - t > ms) throw new Error('timed out waiting for ' + fn);
    await new Promise((r) => setTimeout(r, 250));
  }
};
const shot = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from(await wd('GET', `/session/${sid}/screenshot`), 'base64'));
const step = async (name, fn) => {
  const t = Date.now();
  process.stdout.write(`• ${name}… `);
  await fn();
  console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
};
const rendered = () => {
  const c = document.querySelector('.stage canvas');
  const s = window.__moshpit.store;
  return c && !c.classList.contains('hidden') && !s.status.busy && !s.status.pending && !s.status.engine && s.showingMosh;
};
const exportOpts = (format, extra = {}) => ({ format, width: 0, scaler: 'bicubic', crf: 20, preset: 'veryfast', gifColors: 128, gifDither: 'bayer', gifFps: 12, loop: true, audio: true, ...extra });

let failed = false;
try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base + '/status');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  sid = (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: app } } } })).sessionId;
  await wd('POST', `/session/${sid}/timeouts`, { script: 600000 });

  await step('app starts with the native engine', async () => {
    await waitFor(() => window.__moshpitMounted, 60000);
    const info = await run(() => window.__TAURI_INTERNALS__.invoke('engine_info'));
    console.log(`\n  ${info.version} (${info.path})`);
    if (!/ffmpeg version/.test(info.version)) throw new Error('unexpected engine info');
  });
  await step('load example and render', async () => {
    await waitFor(() => [...document.querySelectorAll('button')].some((b) => /Load example/.test(b.textContent)), 60000);
    await exec(() => [...document.querySelectorAll('button')].find((b) => /Load example/.test(b.textContent)).click());
    await waitFor(() => window.__moshpit.store.project.clips.some((c) => c.transition));
    await waitFor(rendered);
    await shot('1-example.png');
    const info = await exec(() => document.querySelector('.frameinfo')?.textContent);
    if (!/1\/\d+/.test(info ?? '')) throw new Error('unexpected frame info: ' + info);
  });
  await step('export MP4', async () => {
    const r = await run(async (o) => {
      const { blob, name } = await window.__moshpit.renderer.exportVideo(window.__moshpit.store.project, o, () => {}, { cancelled: false });
      const head = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
      return { name, size: blob.size, box: String.fromCharCode(...head) };
    }, exportOpts('mp4', { width: 1920 }));
    console.log(`\n  ${r.name}: ${(r.size / 1024).toFixed(0)} KB`);
    if (r.box !== 'ftyp' || r.size < 10000) throw new Error('bad mp4: ' + JSON.stringify(r));
  });
  await step('export WebM with a pixel effect (chunked)', async () => {
    await exec(() => window.__moshpit.store.addEffect('chroma'));
    await waitFor(rendered);
    const r = await run(async (o) => {
      const { blob } = await window.__moshpit.renderer.exportVideo(window.__moshpit.store.project, o, () => {}, { cancelled: false });
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      return { size: blob.size, magic: [...head].map((b) => b.toString(16)).join('') };
    }, exportOpts('webm'));
    if (r.magic !== '1a45dfa3' || r.size < 10000) throw new Error('bad webm: ' + JSON.stringify(r));
    await shot('2-chroma.png');
  });
  await step('cancel an export', async () => {
    const r = await run(async (o) => {
      const m = window.__moshpit;
      const signal = { cancelled: false };
      const p = m.renderer.exportVideo(m.store.project, o, () => {}, signal);
      await new Promise((r) => setTimeout(r, 300));
      signal.cancelled = true;
      m.ffmpeg.cancel();
      try {
        await p;
        return 'finished';
      } catch (e) {
        return e.message;
      }
    }, exportOpts('mp4', { width: 3840, preset: 'slow' }));
    if (r !== 'cancelled' && r !== 'finished') throw new Error('unexpected: ' + r);
    // the engine still works afterwards
    const n = await run(async () => (await window.__moshpit.ffmpeg.run(['-f', 'lavfi', '-i', 'testsrc=d=0.1:s=64x64', '-frames:v', '1', 'o.png'], { outputs: ['o.png'] })).out['o.png'].length);
    if (!(n > 100)) throw new Error('engine broken after cancel');
  });
  await step('import a video file through the native engine', async () => {
    const r = await run(async () => {
      const m = window.__moshpit;
      const gen = await m.ffmpeg.run(['-f', 'lavfi', '-i', 'testsrc2=d=2:s=320x240:r=24', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'clip.mp4'], { outputs: ['clip.mp4'] });
      const file = new File([gen.out['clip.mp4']], 'clip.mp4', { type: 'video/mp4' });
      const before = m.store.project.media.length;
      await m.media.addFiles([file]);
      for (let i = 0; i < 400 && m.store.project.media.length === before; i++) await new Promise((r) => setTimeout(r, 100));
      const item = m.store.project.media.at(-1);
      return { added: m.store.project.media.length - before, w: item.width, h: item.height, audio: item.hasAudio, dur: item.duration };
    });
    if (r.added !== 1 || r.w !== 320 || r.h !== 240 || !r.audio) throw new Error('import failed: ' + JSON.stringify(r));
    await shot('3-imported.png');
  });
} catch (e) {
  failed = true;
  console.log('FAILED\n', e.message);
  if (sid) await shot('failure.png').catch(() => {});
} finally {
  if (sid) await wd('DELETE', `/session/${sid}`).catch(() => {});
  driver.kill();
}
process.exit(failed ? 1 : 0);
