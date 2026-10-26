// The smoke test (MOSHPIT_SMOKE_TEST=1, see smoke.rs): run in the page once it has loaded, it checks
// the editor came up and that sound, video, the native FFmpeg and the network work, then reports
// back. A webview that crashes on any of them (a missing GStreamer plugin, a broken proxy) never
// reports, and the native side fails the test when it times out.
(async () => {
  const report = { userAgent: navigator.userAgent, page: document.visibilityState, checks: {} };
  const failed = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const within = (ms, p) => Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`no answer in ${ms / 1000}s`)))]);
  async function check(name, required, fn) {
    const t0 = performance.now();
    try {
      report.checks[name] = { ok: true, detail: await fn() };
    } catch (e) {
      report.checks[name] = { ok: false, required, detail: String((e && e.message) || e) };
      if (required) failed.push(name);
    }
    report.checks[name].ms = Math.round(performance.now() - t0);
  }
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

  await check('home screen', true, async () => {
    for (let i = 0; i < 120; i++) {
      const button = [...document.querySelectorAll('button')].find((b) => /new project/i.test(b.textContent || ''));
      if (button && !document.getElementById('boot')) return 'shown';
      await sleep(500);
    }
    throw new Error('still on the loading screen after 60s');
  });

  // a WAV made here: decoded by the webview's media framework, then played very quietly (the
  // output is what crashed the Linux webview without its GStreamer plugins; elsewhere a test machine
  // may have no sound device, so there it is only reported)
  const rate = 22050, n = Math.floor(rate / 4), wav = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  text(36, 'data'); wav.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 440) * 8000, true);
  const linux = /Linux/.test(navigator.userAgent);
  await check('sound decoding', true, async () => {
    const ctx = new OfflineAudioContext(1, rate, rate);
    // (the first decode after installing can wait for GStreamer to look through its plugins)
    const buffer = await within(60000, ctx.decodeAudioData(wav.buffer.slice(0)));
    return `${buffer.duration.toFixed(2)}s`;
  });
  await check('sound output', linux, async () => {
    const ctx = new AudioContext();
    const buffer = await within(15000, ctx.decodeAudioData(wav.buffer.slice(0)));
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.001;
    src.buffer = buffer;
    src.connect(gain).connect(ctx.destination);
    src.start();
    await within(5000, ctx.resume()).catch(() => {});
    await sleep(1000);
    const state = ctx.state;
    await within(5000, ctx.close()).catch(() => {});
    return `context ${state}`;
  });

  // WebM is what the Linux webview must play (its GStreamer plugins); elsewhere it's checked if
  // supported. Both ways the app plays video: its own files (the template previews on the home
  // screen) and a clip the user imported (a blob)
  const webm = document.createElement('video').canPlayType('video/webm; codecs="vp8"');
  const play = async (src) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.src = src;
    // in view, as an imported clip is in the preview (WebKit doesn't advance muted video no one can see)
    v.style.cssText = 'position:fixed;left:0;top:0;width:256px;height:144px;z-index:2147483647';
    document.body.appendChild(v);
    try {
      await within(20000, new Promise((ok, no) => {
        v.onloadeddata = ok;
        v.onerror = () => no(new Error('could not load: ' + (v.error ? v.error.message || 'error ' + v.error.code : '?')));
      }));
      await within(10000, v.play());
      for (let i = 0; i < 40 && !(v.currentTime > 0.5); i++) await sleep(250);
      if (!(v.currentTime > 0)) throw new Error(`did not play (ready state ${v.readyState}, network state ${v.networkState})`);
      return `${v.videoWidth}×${v.videoHeight}, played to ${v.currentTime.toFixed(2)}s`;
    } finally {
      v.remove();
    }
  };
  await check('video (template previews)', linux || webm !== '', async () => {
    // the home screen plays the previews it can see (src/home/StarterCard.svelte). It finds them with
    // an IntersectionObserver, which only reports while the window is drawn: on a test machine whose
    // window isn't, the first preview is started the way the observer would
    for (let i = 0; i < 40; i++) {
      const v = [...document.querySelectorAll('.starter video')].find((v) => v.currentTime > 0);
      if (v) return `${v.videoWidth}×${v.videoHeight}, playing at ${v.currentTime.toFixed(2)}s (${i > 6 ? 'started by the test' : 'started by the page'})`;
      const first = document.querySelector('.starter video');
      if (i === 6 && first) {
        first.dataset.play = 'on';
        first.play().catch(() => {});
      }
      await sleep(500);
    }
    const first = document.querySelector('.starter video');
    if (!first) throw new Error('could not load (shown as pictures)');
    throw new Error(`did not play (ready state ${first.readyState}, network state ${first.networkState}, page ${document.visibilityState})`);
  });
  await check('video (imported clip)', linux || webm !== '', async () => {
    const url = URL.createObjectURL(await (await fetch('examples/beat.webm')).blob());
    try {
      return await play(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  await check('ffmpeg', true, async () => {
    const info = await within(20000, invoke('engine_info'));
    if (!/^ffmpeg version/.test(info.version)) throw new Error('unexpected: ' + info.version);
    return info.version;
  });

  // the online features (fonts, cut-out and caption models) load through the webview's network stack
  await check('network', !!window.__MOSHPIT_SMOKE_NETWORK, async () => {
    const res = await within(20000, fetch(window.__MOSHPIT_SMOKE_URL, { cache: 'no-store' }));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return `HTTP ${res.status}, ${(await res.arrayBuffer()).byteLength} bytes`;
  });

  report.ok = failed.length === 0;
  report.failed = failed;
  await invoke('smoke_report', { ok: report.ok, report: JSON.stringify(report, null, 2) });
})();
