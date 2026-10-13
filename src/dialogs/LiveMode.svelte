<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { GL, COPY, type Target } from '../lib/gl';
  import { FlowEngine, CHROMA, defaultFlow, type FlowParams } from '../lib/flow';
  import { vectorWarp } from '../engine/effects/pixel';
  import { addFiles } from '../lib/media';
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
    gl ??= new GL(canvas);
    input = gl.target(W, H);
    tmp = gl.target(W, H);
    engine = new FlowEngine(gl, W, H);
  }

  async function useStream(kind: 'camera' | 'screen') {
    error = '';
    stopSource();
    try {
      stream = kind === 'camera' ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } }) : await navigator.mediaDevices.getDisplayMedia({ video: true });
      video.srcObject = stream;
      video.loop = false;
      await video.play();
      source = kind;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function useFile(f: Blob) {
    stopSource();
    video.srcObject = null;
    video.src = URL.createObjectURL(f);
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
    const c = store.project.clips.find((x) => x.id === id);
    if (c?.source.kind !== 'file') return;
    const b = await getFile(c.source.fileId);
    if (b) useFile(b);
  }
  function stopSource() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    setup(video.videoWidth, video.videoHeight);
    if (!gl || !engine || !input || !tmp) return;
    gl.upload(input, video);
    push.x *= 0.9;
    push.y *= 0.9;
    const params = { ...p, drift: p.drift + push.x, driftY: p.driftY + push.y };
    const out = engine.step(input, params);
    if (pendingImage) {
      gl.upload(tmp, pendingImage);
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
      const blob = new Blob(chunks, { type: 'video/webm' });
      const name = `live-mosh-${Date.now() % 100000}.webm`;
      if (confirm('Add the recording to your project as a clip? (Cancel = just download it)')) {
        await addFiles([new File([blob], name, { type: 'video/webm' })], (performance.now() - t0) / 1000);
      } else download(blob, name);
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
    store.ui.dialog = null;
  }

  let fpsTimer = 0;
  onMount(() => {
    raf = requestAnimationFrame(loop);
    let lastCount = 0;
    fpsTimer = window.setInterval(() => ((fps = frameCount - lastCount), (lastCount = frameCount)), 1000);
  });
  onDestroy(() => {
    cancelAnimationFrame(raf);
    clearInterval(fpsTimer);
    stopSource();
    engine?.dispose();
    gl?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  });

  const fileClips = $derived(store.project.clips.filter((c) => c.source.kind === 'file' && !c.source.isImage));
</script>

<svelte:window onkeydown={onKey} />

<div class="live">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="stage" onpointermove={pmove} ondragover={(e) => e.preventDefault()} ondrop={async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) pendingImage = await createImageBitmap(f);
    else useFile(f);
  }}>
    <canvas bind:this={canvas} class:hidden={source === 'none'}></canvas>
    {#if source === 'none'}
      <div class="pick">
        <h2>◉ Live Mosh</h2>
        <p class="muted">A real-time flow engine. Move in front of the camera, drag on the picture to push the pixels, and press <span class="kbd">Space</span> to snap back to a clean image.</p>
        <div class="row" style="justify-content:center;flex-wrap:wrap">
          <button class="primary" onclick={() => useStream('camera')}>📷 Webcam</button>
          <button onclick={() => useStream('screen')}>🖥 Screen</button>
          <button onclick={() => fileInput.click()}>🎞 Video file</button>
          {#each fileClips as c}
            <button onclick={() => useClip(c.id)}>▶ {c.source.name}</button>
          {/each}
        </div>
        {#if error}<p style="color:var(--danger)">{error}</p>{/if}
      </div>
    {/if}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} muted playsinline hidden></video>
  </div>

  {#if showUi}
    <div class="side panel">
      <div class="row">
        <b class="grow">Live controls</b>
        <span class="small mono muted">{fps} fps</span>
        <button class="icon ghost" title="Close (Esc)" onclick={close}>✕</button>
      </div>
      <div class="row wrap">
        <button class="primary" onclick={reset} title="Space">⟲ Reset image</button>
        <button onclick={randomize} title="R">🎲</button>
        <button onclick={() => imgInput.click()} title="Use an image as the base picture (or drop one)">🖼 Base image</button>
        <button class:rec={recording} onclick={rec}>{recording ? '■ Stop' : '● Rec'}</button>
      </div>
      <div class="row wrap quick">
        {#each QUICK as [name, q], i}
          <button class="small" onclick={() => (p = { ...p, ...q })} title="Key {i + 1}">{i + 1}. {name}</button>
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
      <p class="small muted">Space reset · R random · 1–6 quick looks · H hide panel · drag on the picture to push pixels · drop an image to mosh into it</p>
    </div>
  {:else}
    <button class="show" onclick={() => (showUi = true)}>☰</button>
  {/if}
  <input bind:this={fileInput} type="file" accept="video/*" hidden onchange={(e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) useFile(f);
  }} />
  <input bind:this={imgInput} type="file" accept="image/*" hidden onchange={async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) pendingImage = await createImageBitmap(f);
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
    text-align: center;
    max-width: 520px;
    padding: 20px;
    color: #eee;
  }
  .side {
    width: 300px;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 0;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .quick button {
    padding: 3px 7px;
  }
  .params {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pr {
    font-size: 12.5px;
  }
  .rec {
    background: var(--danger);
    color: #fff;
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
    }
  }
</style>
