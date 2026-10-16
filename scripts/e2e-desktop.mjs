// Drives the desktop app (Tauri, native FFmpeg) through WebDriver: load the example, render it,
// export MP4 and WebM, cancel an export, and import a file through the native engine.
//
// Needs tauri-driver (`cargo install tauri-driver`) and, on Linux, WebKitWebDriver
// (webkit2gtk-driver) and a display (xvfb-run). Build the app first:
//   npm run build && cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
//   xvfb-run node scripts/e2e-desktop.mjs [path/to/app]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const app = path.resolve(process.argv[2] ?? `src-tauri/target/debug/moshpit${process.platform === 'win32' ? '.exe' : ''}`);
const shots = path.resolve('test-results/desktop');
fs.mkdirSync(shots, { recursive: true });

// start from a clean profile (autosave would restore the last run's project)
if (process.platform === 'linux') {
  const os = await import('node:os');
  for (const d of ['.local/share', '.cache']) fs.rmSync(path.join(os.homedir(), d, 'io.github.furniture3k.moshpit'), { recursive: true, force: true });
}

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
    script: `${HEAD}; const done = arguments[arguments.length - 1]; Promise.resolve((${fn}).apply(null, Array.from(arguments).slice(0, -1))).then((v) => done({ v }), (e) => done({ e: String(e && e.stack || e) }));`,
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
const xdo = (args) => {
  try {
    return execFileSync('xdotool', args, { encoding: 'utf8' });
  } catch {
    return '';
  }
};
const hasXdotool = () => {
  try {
    execFileSync('xdotool', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
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
/** In-page helper source: first bytes and size of an export (in memory, or on disk on desktop). */
const HEAD = `async function head(r, n = 8) {
  if (r.blob) return { size: r.blob.size, bytes: [...new Uint8Array(await r.blob.slice(0, n).arrayBuffer())] };
  const all = new Uint8Array(await window.__TAURI_INTERNALS__.invoke('engine_read', { path: r.file }));
  return { size: all.length, bytes: [...all.subarray(0, n)] };
}`;
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
    // start in the editor (not the home screen), without the tour or the automatic first mosh
    await exec(() => {
      for (const [k, v] of Object.entries({ startHome: false, seenWelcome: true, autoMosh: false })) localStorage.setItem('moshpit:' + k, JSON.stringify(v));
      window.__moshpitMounted = false;
      setTimeout(() => location.reload(), 50);
    });
    await waitFor(() => window.__moshpitMounted, 60000);
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
      const r = await window.__moshpit.renderer.exportVideo(window.__moshpit.store.project, o, () => {}, { cancelled: false });
      const h = await head(r);
      return { name: r.name, size: h.size, box: String.fromCharCode(...h.bytes.slice(4, 8)), onDisk: !!r.file };
    }, exportOpts('mp4', { width: 1920 }));
    console.log(`\n  ${r.name}: ${(r.size / 1024).toFixed(0)} KB`);
    if (r.box !== 'ftyp' || r.size < 10000 || !r.onDisk) throw new Error('bad mp4: ' + JSON.stringify(r));
  });
  await step('export WebM with a pixel effect (chunked)', async () => {
    await exec(() => window.__moshpit.store.addEffect('chroma'));
    await waitFor(rendered);
    const r = await run(async (o) => {
      const h = await head(await window.__moshpit.renderer.exportVideo(window.__moshpit.store.project, o, () => {}, { cancelled: false }), 4);
      return { size: h.size, magic: h.bytes.map((b) => b.toString(16)).join('') };
    }, exportOpts('webm'));
    if (r.magic !== '1a45dfa3' || r.size < 10000) throw new Error('bad webm: ' + JSON.stringify(r));
    await shot('2-chroma.png');
  });
  await step('disk-backed export is byte-identical to the in-memory mosh', async () => {
    await exec(() => window.__moshpit.store.addEffect('glitch'));
    const r = await run(async () => {
      const m = window.__moshpit;
      const p = JSON.parse(JSON.stringify(m.store.project));
      const o = { format: 'avi', width: 0, scaler: 'bicubic', crf: 20, preset: 'veryfast', gifColors: 128, gifDither: 'bayer', gifFps: 12, loop: true, audio: false };
      const out = await m.renderer.exportVideo(p, o, () => {}, { cancelled: false });
      const disk = new Uint8Array(await window.__TAURI_INTERNALS__.invoke('engine_read', { path: out.file }));
      const prep = await m.renderer.prepare(p, p.encoder.width, undefined, undefined, false, false);
      const mem = m.mosh.writeMoshed(prep, m.mosh.applyBitstream(prep, p, m.renderer.cutsOf(p)));
      let same = disk.length === mem.length;
      for (let i = 0; same && i < mem.length; i++) if (disk[i] !== mem[i]) same = false;
      const glitched = m.mosh.applyBitstream(prep, p, m.renderer.cutsOf(p)).filter((f) => f.tag === 'glitch').length;
      return { same, disk: disk.length, mem: mem.length, onDisk: !!out.file, glitched };
    });
    await exec(() => window.__moshpit.store.undo?.());
    if (!r.same || !r.onDisk || !r.glitched) throw new Error('mismatch: ' + JSON.stringify(r));
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
  await step('export GIF, PNG frames and AVI with sound', async () => {
    for (const [fmt, magic] of [['gif', '47494638'], ['png', '504b0304'], ['avi', '52494646']]) {
      const r = await run(async (o) => {
        const h = await head(await window.__moshpit.renderer.exportVideo(window.__moshpit.store.project, o, () => {}, { cancelled: false }), 4);
        return { size: h.size, magic: h.bytes.map((b) => b.toString(16).padStart(2, '0')).join('') };
      }, exportOpts(fmt, fmt === 'png' ? { width: 160 } : {}));
      if (r.magic !== magic || r.size < 5000) throw new Error(`bad ${fmt}: ` + JSON.stringify(r));
    }
  });
  await step('import a 720p video: probe, waveform and preview copy', async () => {
    const r = await run(async () => {
      const m = window.__moshpit;
      const gen = await m.ffmpeg.run(['-f', 'lavfi', '-i', 'testsrc2=d=3:s=1280x720:r=24', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'clip.mp4'], { outputs: ['clip.mp4'] });
      const file = new File([gen.out['clip.mp4']], 'clip.mp4', { type: 'video/mp4' });
      const before = m.store.project.media.length;
      await m.media.addFiles([file]);
      for (let i = 0; i < 400 && m.store.project.media.length === before; i++) await new Promise((r) => setTimeout(r, 100));
      const item = m.store.project.media.at(-1);
      // background engine: waveform and (for >960px wide video) a preview copy
      for (let i = 0; i < 600; i++) {
        const st = m.mediaState[item.id];
        if (st?.peaks && (st.proxy === 'ready' || st.proxy === 'failed')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const st = m.mediaState[item.id];
      return { added: m.store.project.media.length - before, w: item.width, h: item.height, audio: item.hasAudio, peaks: st?.peaks?.length ?? 0, proxy: st?.proxy };
    });
    if (r.added !== 1 || r.w !== 1280 || r.h !== 720 || !r.audio || !r.peaks || r.proxy !== 'ready') throw new Error('import failed: ' + JSON.stringify(r));
    await waitFor(rendered);
    await shot('3-imported.png');
  });
  if (hasXdotool()) {
    await step('export from the dialog and save through the native Save dialog', async () => {
      const dest = path.join(shots, 'saved-export.mp4');
      fs.rmSync(dest, { force: true });
      await exec(() => (window.__moshpit.store.ui.dialog = 'export'));
      await waitFor(() => [...document.querySelectorAll('button')].some((b) => /^MP4/.test(b.textContent.trim())), 5000);
      await exec(() => [...document.querySelectorAll('button')].find((b) => /^MP4/.test(b.textContent.trim())).click());
      await exec(() => [...document.querySelectorAll('button')].find((b) => /Export MP4/.test(b.textContent)).click());
      // the GTK file chooser: type the full path into its name field and press Enter
      const t = Date.now();
      while (!xdo(['search', '--name', 'Save File']).trim()) {
        if (Date.now() - t > 120000) throw new Error('no Save dialog');
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 800));
      const win = xdo(['search', '--name', 'Save File']).trim().split('\n')[0];
      xdo(['windowfocus', '--sync', win]); // (no window manager under Xvfb, so focus rather than activate)
      xdo(['key', 'ctrl+a']);
      xdo(['type', '--delay', '5', dest]);
      xdo(['key', 'Return']);
      await waitFor(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Show in folder'), 30000);
      const head = fs.readFileSync(dest).subarray(4, 8).toString('latin1');
      if (head !== 'ftyp') throw new Error('saved file is not an mp4');
      await shot('4-saved.png');
      await exec(() => (window.__moshpit.store.ui.dialog = null));
    });
  }
  await step('external links open outside the app', async () => {
    await exec(() => {
      const a = document.createElement('a');
      a.href = 'https://example.com/';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const still = await exec(() => !!window.__moshpitMounted && location.hostname !== 'example.com');
    if (!still) throw new Error('the app navigated away');
  });
  const click = (text) => exec((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
    if (!b) throw new Error('no button ' + t);
    b.click();
  }, text);
  await step('save a preset (text question)', async () => {
    await exec(() => (window.__moshpit.store.ui.dialog = 'presets'));
    await click('Save current stack');
    await waitFor(() => document.querySelector('.ask-backdrop input'), 5000);
    await exec(() => {
      const i = document.querySelector('.ask-backdrop input');
      i.value = 'E2E preset';
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitFor(() => !document.querySelector('.ask-backdrop') && (localStorage.getItem('moshpit:userPresets') ?? '').includes('E2E preset'), 5000);
    await exec(() => (window.__moshpit.store.ui.dialog = null));
  });
  await step('new project (OK / Cancel question)', async () => {
    const n = await exec(() => window.__moshpit.store.project.clips.length);
    const open = async () => {
      await exec(() => document.querySelector('button[aria-label="More"]').click());
      await click('New project');
      await waitFor(() => document.querySelector('.ask-backdrop'), 5000);
    };
    await open();
    await click('Cancel');
    if ((await exec(() => window.__moshpit.store.project.clips.length)) !== n) throw new Error('cancel cleared the project');
    await open();
    await click('OK');
    await waitFor(() => window.__moshpit.store.project.clips.length === 0, 5000);
  });
  if (process.env.LONG_FILE) {
    // A long video imported from disk like a user would (e.g. made with
    // ffmpeg -f lavfi -i testsrc2=d=3600:s=1280x720:r=24 -f lavfi -i sine=d=3600 -c:v libx264 -preset ultrafast -c:a aac long.mp4)
    await step('long video: import, render and export', async () => {
      const t0 = Date.now();
      const el = Object.values(await wd('POST', `/session/${sid}/element`, { using: 'css selector', value: 'input[type=file][multiple]' }))[0];
      await wd('POST', `/session/${sid}/element/${el}/value`, { text: path.resolve(process.env.LONG_FILE) });
      let last = '';
      const total = await (async () => {
        for (;;) {
          const st = await exec(() => {
            const s = window.__moshpit.store;
            return { stage: s.status.stage, p: s.status.progress, busy: s.status.busy || s.status.pending, frames: s.render?.frames.length ?? 0, clips: s.project.clips.length, err: s.status.error };
          });
          const line = st.stage;
          if (line !== last && st.stage) console.log(`\n  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`), (last = line);
          if (st.err) throw new Error(st.err);
          if (st.clips && !st.busy && st.frames > 1000) return st.frames;
          await new Promise((r) => setTimeout(r, 2000));
        }
      })();
      console.log(`  rendered ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      const t1 = Date.now();
      await exec((o) => {
        const m = window.__moshpit;
        const t0 = performance.now();
        window.__exp = { stage: 'start', log: [] };
        m.renderer.exportVideo(m.store.project, o, (st) => {
          if (st !== window.__exp.stage) window.__exp.log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${st}`);
          window.__exp.stage = st;
        }, { cancelled: false }).then(
          (r) => (window.__exp.done = r.size),
          (e) => (window.__exp.err = String(e)),
        );
      }, exportOpts('mp4', { preset: 'veryfast' }));
      let lastStage = '';
      let lastLog = [];
      const r = await (async () => {
        for (;;) {
          let e;
          try {
            e = await exec(() => window.__exp);
          } catch (err) {
            console.log('\n  stages:', JSON.stringify(lastLog));
            throw err;
          }
          lastLog = e.log;
          if (e.err) throw new Error(e.err);
          if (e.done !== undefined) return e.done;
          if (e.stage !== lastStage) {
            const mem = execFileSync('ps', ['-eo', 'rss,comm'], { encoding: 'utf8' }).split('\n').filter((l) => /WebKitWeb|moshpit/.test(l)).map((l) => l.trim().replace(/^(\d+)/, (k) => Math.round(+k / 1024) + 'MB')).join(', ');
            console.log(`\n  [export ${((Date.now() - t1) / 1000).toFixed(0)}s] ${e.stage}  (${mem})`);
            lastStage = e.stage;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      })();
      console.log(`  exported ${(r / 1048576).toFixed(0)} MB in ${((Date.now() - t1) / 1000).toFixed(0)}s`, JSON.stringify(lastLog));
      if (total < +(process.env.LONG_FRAMES ?? 0)) throw new Error('output was cut short: ' + total + ' frames');
    });
  }
} catch (e) {
  failed = true;
  console.log('FAILED\n', e.message);
  if (sid) await shot('failure.png').catch(() => {});
} finally {
  if (sid) await wd('DELETE', `/session/${sid}`).catch(() => {});
  driver.kill();
}
process.exit(failed ? 1 : 0);
