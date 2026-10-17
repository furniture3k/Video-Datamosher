<script lang="ts">
  import { ask } from '../lib/ask';
  const canScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  import { onDestroy, onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { GL, COPY, type Target } from '../lib/gl';
  import { FlowEngine, CHROMA, defaultFlow, type FlowParams } from '../lib/flow';
  import { vectorWarp } from '../engine/effects/pixel';
  import { addFiles } from '../lib/media';
  import { finalizeRecording } from '../lib/renderer';
  import Icon from '../components/Icon.svelte';
  import { getFile } from '../lib/storage';
  import { download } from '../lib/storage';

  let canvas: HTMLCanvasElement;
  let video: HTMLVideoElement;
  let fileInput: HTMLInputElement;
  let imgInput: HTMLInputElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p = $state<FlowParams & Record<string, any>>({ ...defaultFlow(), amplify: 1.2, residual: 0.05 });
  let chroma = $state(0);
  let autoReset = $state(0);
  let source = $state<'none' | 'camera' | 'screen' | 'file'>('none');
  let error = $state('');
  let recording = $state(false);
  let showUi = $state(true);
  let gl: GL | null = null;
  let engine: FlowEngine | null = null;
  let input: Target | null = null;
  let tmp: Target | null = null;
  let stream: MediaStream | null = null;
  let raf = 0;
  let frameCount = 0;
  let lastReset = performance.now();
  let pendingImage: ImageBitmap | null = null;
  let push = { x: 0, y: 0 };
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let fps = $state(0);
  let destroyed = false;
  // the latest useStream(): an older one that finishes later (or after Live closed) lets its stream go
  let attempt = 0;
  let fileUrl = '';
  // video frames are scaled to the engine size through this 2D canvas
  const scaler = document.createElement('canvas');
  const sctx = scaler.getContext('2d')!;

  const defs = vectorWarp.params;

  function setup(w: number, h: number) {
    const s = Math.min(1, 960 / w);
    const W = Math.round((w * s) / 2) * 2;
    const H = Math.round((h * s) / 2) * 2;
    if (gl && canvas.width === W && canvas.height === H) return;
    engine?.dispose();
    gl?.dispose(input, tmp);
    canvas.width = W;
    canvas.height = H;
    scaler.width = W;
    scaler.height = H;
    gl ??= new GL(canvas);
    input = gl.target(W, H);
    tmp = gl.target(W, H);
    engine = new FlowEngine(gl, W, H);
  }

  async function useStream(kind: 'camera' | 'screen') {
    error = '';
    stopSource();
    const my = ++attempt;
    try {
      // ideal (not exact) sizes: phones and some webcams reject hard constraints
      const s = kind === 'camera' ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } }) : await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (destroyed || my !== attempt) return void s.getTracks().forEach((t) => t.stop());
      stream = s;
      video.removeAttribute('src');
      video.srcObject = stream;
      video.loop = false;
      await video.play();
      source = kind;
    } catch (e) {
      if (destroyed || my !== attempt) return;
      error = (e as Error).message;
    }
  }
  async function useFile(f: Blob) {
    stopSource();
    attempt++;
    error = '';
    video.srcObject = null;
    fileUrl = URL.createObjectURL(f);
    video.src = fileUrl;
    video.loop = true;
    video.muted = true;
    try {
      await video.play();
      source = 'file';
    } catch (e) {
      error = 'This browser cannot play that file directly: ' + (e as Error).message;
    }
  }
  async function useClip(id: string) {
    const c = store.project.media.find((x) => x.id === id);
    if (c?.source.kind !== 'file') return;
    const b = await getFile(c.source.fileId).catch(() => null);
    if (destroyed) return;
    if (b) useFile(b);
    else error = 'That clip could not be read.';
  }
  function stopSource() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = '';
  }
  async function useImage(f: Blob) {
    try {
      const b = await createImageBitmap(f);
      if (destroyed) return b.close();
      pendingImage?.close();
      pendingImage = b;
    } catch {
      store.toast('That image could not be read.', 'error');
    }
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    setup(video.videoWidth, video.videoHeight);
    if (!gl || !engine || !input || !tmp) return;
    sctx.drawImage(video, 0, 0, scaler.width, scaler.height);
    gl.upload(input, scaler);
    push.x *= 0.9;
    push.y *= 0.9;
    const params = { ...p, drift: p.drift + push.x, driftY: p.driftY + push.y };
    const out = engine.step(input, params);
    if (pendingImage) {
      sctx.drawImage(pendingImage, 0, 0, scaler.width, scaler.height);
      gl.upload(tmp, scaler);
      engine.setCanvas(tmp);
      pendingImage.close();
      pendingImage = null;
    }
    if (autoReset > 0 && performance.now() - lastReset > autoReset * 1000) reset();
    if (chroma > 0) {
      gl.pass(CHROMA, tmp, { src: out.tex }, { size: [canvas.width, canvas.height], off: [chroma, 0], tear: chroma / 2, seed: frameCount % 97 });
      gl.pass(COPY, null, { src: tmp.tex });
    } else gl.pass(COPY, null, { src: out.tex });
    frameCount++;
  }

  function reset() {
    engine?.reset();
    lastReset = performance.now();
  }
  function randomize() {
    p = {
      ...p,
      amplify: +(Math.random() * 6 - 1.5).toFixed(2),
      rotate: Math.random() < 0.4 ? Math.round(Math.random() * 360 - 180) : 0,
      swap: Math.random() < 0.2,
      turbulence: Math.random() < 0.4 ? +(Math.random() * 3).toFixed(1) : 0,
      quantize: Math.random() < 0.3 ? Math.round(Math.random() * 6) : 0,
      residual: +(Math.random() * 0.3).toFixed(2),
      block: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
      smooth: Math.random() < 0.5,
      driftY: Math.random() < 0.3 ? +(Math.random() * 4 - 1).toFixed(1) : 0,
    };
  }
  const QUICK: [string, Partial<FlowParams>][] = [
    ['Liquid', { amplify: 2.5, rotate: 0, smooth: true, residual: 0.06, block: 8, turbulence: 0, driftY: 0, quantize: 0, swap: false }],
    ['Vortex', { amplify: 2, rotate: 90, smooth: false, residual: 0.1, block: 16, turbulence: 0, driftY: 0, swap: false }],
    ['Gravity', { amplify: 1, rotate: 0, driftY: 2.5, turbulence: 0.6, smooth: true, residual: 0.04, swap: false }],
    ['Explode', { amplify: 5, rotate: 0, smooth: false, residual: 0.02, block: 32, quantize: 4, swap: false }],
    ['Rewind', { amplify: -2, rotate: 0, smooth: true, residual: 0.08, block: 8, swap: false }],
    ['Blocks', { amplify: 1.5, rotate: 0, smooth: false, residual: 0.15, block: 16, quantize: 8, swap: true }],
  ];

  function rec() {
    if (recording) {
      recorder?.stop();
      recording = false;
      return;
    }
    const s = canvas.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    recorder = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : {});
    chunks = [];
    const t0 = performance.now();
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
      const name = `live-mosh-${Date.now() % 100000}`;
      const dur = (performance.now() - t0) / 1000;
      try {
        const file = await finalizeRecording(blob, name);
        if (await ask('Add the recording to your project as a clip? (Cancel = just download it)')) {
          await addFiles([file], { track: 'v1', index: Infinity }, dur);
        } else download(file, file.name);
      } catch (e) {
        store.toast('Could not save the recording: ' + (e as Error).message, 'error', 6000);
      }
    };
    recorder.start(250);
    recording = true;
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === ' ') (e.preventDefault(), reset());
    else if (e.key === 'r') randomize();
    else if (e.key === 'h') showUi = !showUi;
    else if (e.key === 'Escape') close();
    else if (/^[1-6]$/.test(e.key)) p = { ...p, ...QUICK[+e.key - 1][1] };
  }

  let last: { x: number; y: number } | null = null;
  function pmove(e: PointerEvent) {
    if (!last || !(e.buttons & 1)) return (last = { x: e.clientX, y: e.clientY });
    push.x += (e.clientX - last.x) * 0.15;
    push.y += (e.clientY - last.y) * 0.15;
    last = { x: e.clientX, y: e.clientY };
  }

  function close() {
    if (recording) recorder?.stop();
    recording = false;
    store.ui.dialog = null;
  }

  let fpsTimer = 0;
  onMount(() => {
    raf = requestAnimationFrame(loop);
    let lastCount = 0;
    fpsTimer = window.setInterval(() => ((fps = frameCount - lastCount), (lastCount = frameCount)), 1000);
  });
  onDestroy(() => {
    destroyed = true;
    // left some other way than close(): the recording so far is still offered
    if (recorder?.state === 'recording') recorder.stop();
    cancelAnimationFrame(raf);
    clearInterval(fpsTimer);
    stopSource();
    pendingImage?.close();
    pendingImage = null;
    engine?.dispose();
    gl?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  });

  const fileClips = $derived(store.project.media.filter((c) => c.source.kind === 'file' && !c.source.isImage && c.hasVideo));
</script>

<svelte:window onkeydown={onKey} />

<div class="live">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" onpointermove={pmove} ondragover={(e) => e.preventDefault()} ondrop={async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) useImage(f);
    else useFile(f);
  }}>
    <canvas bind:this={canvas} class:hidden={source === 'none'}></canvas>
    {#if source === 'none'}
      <div class="pick">
        <div class="label">Live</div>
        <p class="muted">Real-time flow mosh. Drag on the picture to push pixels; <span class="kbd">Space</span> snaps back to a clean frame.</p>
        <div class="row" style="justify-content:center;flex-wrap:wrap">
          <button class="primary" onclick={() => useStream('camera')}><Icon name="camera" />Camera</button>
          {#if canScreen}<button onclick={() => useStream('screen')}><Icon name="screen" />Screen</button>{/if}
          <button onclick={() => fileInput.click()}><Icon name="file" />Video file</button>
          {#each fileClips as c}
            <button onclick={() => useClip(c.id)}><Icon name="play" size={12} />{c.source.name}</button>
          {/each}
        </div>
        {#if error}<p style="color:var(--danger)">{error}</p>{/if}
      </div>
    {/if}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} muted playsinline hidden></video>
  </div>

  {#if showUi}
    <div class="side">
      <div class="row">
        <span class="label grow">Live</span>
        <span class="small mono faint">{fps} fps</span>
        <button class="icon ghost" title="Close  Esc" aria-label="Close" onclick={close}><Icon name="x" /></button>
      </div>
      <div class="row wrap">
        <button class="primary" onclick={reset} title="Space"><Icon name="reset" size={14} />Reset</button>
        <button class="icon" onclick={randomize} title="Randomize  R" aria-label="Randomize"><Icon name="dice" size={14} /></button>
        <button onclick={() => imgInput.click()} title="Use an image as the base picture (or drop one)"><Icon name="image" size={14} />Base image</button>
        <button class:rec={recording} onclick={rec}><Icon name="rec" size={12} />{recording ? 'Stop' : 'Rec'}</button>
      </div>
      <div class="row wrap quick">
        {#each QUICK as [name, q], i}
          <button class="small" onclick={() => (p = { ...p, ...q })} title="Key {i + 1}"><span class="mono faint">{i + 1}</span>{name}</button>
        {/each}
      </div>
      <div class="params">
        {#each defs as d (d.key)}
          {#if d.type === 'number' || d.type === 'int'}
            <label class="pr">
              <span class="row"><span class="grow" title={d.help}>{d.label}</span><span class="mono small">{p[d.key]}</span></span>
              <input type="range" min={d.min} max={d.max} step={d.type === 'int' ? 1 : (d.step ?? 0.01)} bind:value={p[d.key]} />
            </label>
          {:else if d.type === 'bool'}
            <label class="row pr"><span class="grow" title={d.help}>{d.label}</span><input type="checkbox" class="switch" bind:checked={p[d.key]} /></label>
          {:else if d.type === 'select' && d.key === 'block'}
            <label class="row pr"><span class="grow" title={d.help}>{d.label}</span>
              <select value={String(p.block)} onchange={(e) => (p.block = +(e.target as HTMLSelectElement).value)}>
                {#each d.options as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </label>
          {/if}
        {/each}
        <label class="pr">
          <span class="row"><span class="grow">Chroma split</span><span class="mono small">{chroma}</span></span>
          <input type="range" min="0" max="30" step="0.5" bind:value={chroma} />
        </label>
        <label class="pr">
          <span class="row"><span class="grow" title="Automatically snap back to the clean image every N seconds (0 = never)">Auto reset</span><span class="mono small">{autoReset ? autoReset + 's' : 'off'}</span></span>
          <input type="range" min="0" max="20" step="0.5" bind:value={autoReset} />
        </label>
      </div>
      <p class="small faint keys"><span class="kbd">Space</span> reset <span class="kbd">R</span> randomize <span class="kbd">1</span>–<span class="kbd">6</span> looks <span class="kbd">H</span> hide panel. Drop an image to mosh into it.</p>
    </div>
  {:else}
    <button class="show icon" aria-label="Show controls" onclick={() => (showUi = true)}><Icon name="more" /></button>
  {/if}
  <input bind:this={fileInput} type="file" accept="video/*" hidden onchange={(e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) useFile(f);
    (e.target as HTMLInputElement).value = '';
  }} />
  <input bind:this={imgInput} type="file" accept="image/*" hidden onchange={async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) useImage(f);
    (e.target as HTMLInputElement).value = '';
  }} />
</div>

<style>
  .live {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: #000;
    display: flex;
  }
  .stage {
    flex: 1;
    display: grid;
    place-items: center;
    min-width: 0;
    position: relative;
    touch-action: none;
  }
  canvas {
    max-width: 100%;
    max-height: 100vh;
    cursor: grab;
  }
  canvas.hidden {
    display: none;
  }
  .pick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    max-width: 460px;
    padding: 20px;
    color: var(--text);
  }
  .side {
    width: 290px;
    overflow: auto;
    padding: 0 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--surface);
    border-left: 1px solid var(--line);
  }
  .side > .row:first-child {
    height: 40px;
    border-bottom: 1px solid var(--line);
    margin: 0 -12px;
    padding: 0 6px 0 12px;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .quick {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
  }
  .quick button {
    justify-content: flex-start;
    padding: 0 6px;
    font-size: 11.5px;
  }
  .params {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-top: 1px solid var(--line);
    padding-top: 6px;
  }
  .pr {
    font-size: 12.5px;
    color: var(--text-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px 0;
  }
  .pr.row {
    flex-direction: row;
  }
  .rec {
    color: var(--accent);
  }
  .keys {
    line-height: 1.9;
  }
  .show {
    position: absolute;
    top: 10px;
    right: 10px;
  }
  @media (max-width: 760px) {
    .live {
      flex-direction: column;
    }
    .side {
      width: 100%;
      max-height: 45vh;
      border-left: none;
      border-top: 1px solid var(--line);
    }
  }
</style>
