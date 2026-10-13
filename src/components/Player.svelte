<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { originalFrames, moshedAudioWav, type RenderResult } from '../lib/renderer';
  import { download } from '../lib/storage';
  import type { Project } from '../engine/types';

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let muted = $state(false);
  let originals = $state.raw<Uint8Array[] | null>(null);
  let origKey = '';
  let loadingOrig = $state(false);

  // ---- bitmap cache ----
  let cache = new Map<string, Promise<ImageBitmap>>();
  let cacheFor: RenderResult | null = null;
  function bitmap(jpegs: Uint8Array[], i: number, tag: string): Promise<ImageBitmap> | null {
    if (i < 0 || i >= jpegs.length) return null;
    const k = tag + i;
    let p = cache.get(k);
    if (!p) {
      p = createImageBitmap(new Blob([jpegs[i] as BlobPart], { type: 'image/jpeg' }));
      cache.set(k, p);
      if (cache.size > 240) {
        const first = cache.keys().next().value!;
        cache.get(first)!.then((b) => b.close());
        cache.delete(first);
      }
    }
    return p;
  }

  function resetCache() {
    cache.forEach((p) => p.then((b) => b.close()).catch(() => {}));
    cache = new Map();
  }

  let drawToken = 0;
  async function draw() {
    const r = store.render;
    if (!r || !canvas) return;
    if (cacheFor !== r) {
      resetCache();
      cacheFor = r;
    }
    const i = Math.min(store.ui.playhead, r.jpegs.length - 1);
    const tok = ++drawToken;
    const main = bitmap(r.jpegs, i, 'm');
    if (!main) return;
    const mode = store.ui.compare;
    const src = r.frames[i]?.src ?? i;
    const orig = mode !== 'off' && originals ? bitmap(originals, Math.min(src, originals.length - 1), 'o') : null;
    const [a, b] = await Promise.all([main, orig]);
    if (tok !== drawToken) return;
    const w = a.width;
    const h = a.height;
    const W = mode === 'side' ? w * 2 : w;
    if (canvas.width !== W || canvas.height !== h) {
      canvas.width = W;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    if (mode === 'side' && b) {
      ctx.drawImage(b, 0, 0, w, h);
      ctx.drawImage(a, w, 0, w, h);
    } else if (mode === 'split' && b) {
      ctx.drawImage(a, 0, 0, w, h);
      const sx = Math.round(w * store.ui.split);
      ctx.drawImage(b, 0, 0, sx, h, 0, 0, sx, h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx - 1, 0, 2, h);
    } else if (mode === 'hold' && b) {
      ctx.drawImage(b, 0, 0, w, h);
    } else ctx.drawImage(a, 0, 0, w, h);
    // prefetch
    for (let k = 1; k < 8; k++) bitmap(r.jpegs, i + k, 'm');
  }

  $effect(() => {
    void store.ui.playhead;
    void store.render;
    void store.ui.compare;
    void store.ui.split;
    void originals;
    draw();
  });

  // ---- originals for A/B ----
  $effect(() => {
    const mode = store.ui.compare;
    const r = store.render;
    if (mode === 'off' || !r) return;
    const p = $state.snapshot(store.project) as Project;
    const key = JSON.stringify([p.clips, p.encoder]);
    if (key === origKey) return;
    origKey = key;
    loadingOrig = true;
    originalFrames(p, p.encoder.previewWidth)
      .then((o) => (originals = o))
      .catch((e) => store.toast('Compare failed: ' + e.message, 'error'))
      .finally(() => (loadingOrig = false));
  });

  // ---- audio ----
  let actx: AudioContext | null = null;
  let abuf = $state.raw<AudioBuffer | null>(null);
  let srcNode: AudioBufferSourceNode | null = null;
  let audioKey = '';
  $effect(() => {
    const r = store.render;
    const a = $state.snapshot(store.project.audio);
    void store.project.clips.length;
    if (!r) return;
    const key = r.id + JSON.stringify(a);
    if (key === audioKey) return;
    audioKey = key;
    const p = $state.snapshot(store.project) as Project;
    moshedAudioWav(p, r.frames)
      .then(async (w) => {
        if (!w) return (abuf = null);
        actx ??= new AudioContext();
        abuf = await actx.decodeAudioData(w.slice().buffer);
      })
      .catch(() => (abuf = null));
  });

  function stopAudio() {
    try {
      srcNode?.stop();
    } catch {
      /* noop */
    }
    srcNode = null;
  }

  // ---- playback loop ----
  let raf = 0;
  let t0 = 0;
  let f0 = 0;
  $effect(() => {
    const playing = store.ui.playing;
    const r = store.render;
    if (!playing || !r) {
      cancelAnimationFrame(raf);
      stopAudio();
      return;
    }
    const n = r.frames.length;
    const range = (): [number, number] => (store.ui.loop && store.ui.loopOn ? store.ui.loop : [0, n]);
    if (store.ui.playhead >= range()[1] - 1) store.ui.playhead = range()[0];
    const startAudio = () => {
      stopAudio();
      if (!abuf || muted || !actx || store.ui.speed !== 1) return;
      actx.resume();
      srcNode = actx.createBufferSource();
      srcNode.buffer = abuf;
      srcNode.connect(actx.destination);
      srcNode.start(0, store.ui.playhead / r.fps);
    };
    t0 = performance.now();
    f0 = store.ui.playhead;
    startAudio();
    const tick = (now: number) => {
      const [a, b] = range();
      let f = f0 + Math.floor(((now - t0) / 1000) * r.fps * store.ui.speed);
      if (f >= b) {
        if (store.ui.loopOn || store.ui.loop) {
          f0 = a;
          t0 = now;
          f = a;
          store.ui.playhead = a;
          startAudio();
        } else {
          store.ui.playhead = n - 1;
          store.ui.playing = false;
          return;
        }
      }
      if (f !== store.ui.playhead) store.ui.playhead = f;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopAudio();
    };
  });

  const n = $derived(store.render?.frames.length ?? 0);
  const cur = $derived(store.render?.frames[store.ui.playhead]);
  const timeStr = $derived(store.render ? (store.ui.playhead / store.render.fps).toFixed(2) + 's' : '0.00s');

  function snapshot() {
    canvas.toBlob((b) => b && download(b, `${store.project.name.replace(/[^\w-]+/g, '_')}_frame${store.ui.playhead}.png`), 'image/png');
  }

  let draggingSplit = false;
  function splitMove(e: PointerEvent) {
    if (!draggingSplit) return;
    const rc = canvas.getBoundingClientRect();
    store.ui.split = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width));
  }

  const TAG_LABEL: Record<string, string> = { orig: 'original', dup: 'duplicate', glitch: 'glitched', moved: 'moved', spliced: 'transferred', replaced: 'filled' };
</script>

<div class="player panel">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    bind:this={wrap}
    onpointerdown={(e) => {
      if (store.ui.compare === 'split') {
        draggingSplit = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        splitMove(e);
      }
    }}
    onpointermove={splitMove}
    onpointerup={() => (draggingSplit = false)}
  >
    <canvas bind:this={canvas} class:hidden={!store.render} class:split={store.ui.compare === 'split'}></canvas>
    {#if !store.render && !store.status.busy}
      <div class="placeholder">
        {#if store.project.clips.length}
          <div>Press <span class="kbd">Enter</span> or <button onclick={() => store.doRender(true)}>Render preview</button></div>
        {:else}
          <div class="hero">
            <div class="glitch" data-text="DATAMOSH">DATAMOSH</div>
            <p class="muted">Add a clip on the left to begin.<br />Then pick a preset, roll the dice, or stack effects yourself.</p>
          </div>
        {/if}
      </div>
    {/if}
    {#if store.status.busy}
      <div class="busy">
        <div class="bar"><div style="width:{Math.round(store.status.progress * 100)}%"></div></div>
        <span class="small mono">{store.status.stage || 'Working'}… {Math.round(store.status.progress * 100)}%</span>
      </div>
    {/if}
    {#if store.status.error}
      <div class="error small">
        <b>Render failed.</b> {store.status.error.split('\n')[0]}
        <details><summary>details</summary><pre>{store.status.error}</pre></details>
        <button onclick={() => store.doRender(true)}>Retry</button>
      </div>
    {/if}
    {#if store.ui.compare !== 'off' && store.render}
      <div class="cmp-label small mono">
        {#if loadingOrig}loading original…{:else if store.ui.compare === 'split'}◀ original | moshed ▶{:else if store.ui.compare === 'side'}original | moshed{:else}original (hold){/if}
      </div>
    {/if}
  </div>

  <div class="transport">
    <div class="row">
      <button class="icon ghost" title="Start (Home)" onclick={() => (store.ui.playhead = 0)}>⏮</button>
      <button class="icon ghost" title="Previous frame (←)" onclick={() => (store.ui.playhead = Math.max(0, store.ui.playhead - 1))}>◀</button>
      <button class="play" title="Play / pause (Space)" disabled={!store.render} onclick={() => (store.ui.playing = !store.ui.playing)}>{store.ui.playing ? '❚❚' : '▶'}</button>
      <button class="icon ghost" title="Next frame (→)" onclick={() => (store.ui.playhead = Math.min(n - 1, store.ui.playhead + 1))}>▶</button>
      <button class="icon ghost" title="End (End)" onclick={() => (store.ui.playhead = Math.max(0, n - 1))}>⏭</button>
      <button class="icon" class:on={store.ui.loopOn} title="Loop (L). Set a loop region with I / O." onclick={() => (store.ui.loopOn = !store.ui.loopOn)}>⟲</button>
      <select bind:value={store.ui.speed} title="Playback speed (audio plays at 1× only)">
        {#each [0.25, 0.5, 1, 1.5, 2] as s}<option value={s}>{s}×</option>{/each}
      </select>
      <button class="icon" class:on={muted} title="Mute preview audio" onclick={() => ((muted = !muted), muted && stopAudio())}>{muted ? '🔇' : '🔊'}</button>
    </div>
    <div class="info mono small">
      <span>{timeStr}</span>
      <span class="muted">frame {store.ui.playhead + 1}/{n}</span>
      {#if cur}
        <span class="type t{cur.type}">{cur.type}</span>
        <span class="muted">{TAG_LABEL[cur.tag]} · src {cur.src}</span>
      {/if}
    </div>
    <div class="row">
      <select bind:value={store.ui.compare} title="Compare with the original (C)">
        <option value="off">Compare: off</option>
        <option value="split">Split wipe</option>
        <option value="side">Side by side</option>
        <option value="hold">Original only</option>
      </select>
      <button class="icon ghost" title="Save this frame as PNG" disabled={!store.render} onclick={snapshot}>📷</button>
      <button title="Re-render now (Enter)" disabled={!store.project.clips.length} onclick={() => store.doRender(true)}>{store.ui.autoRender ? '⟳' : '⟳ Render'}</button>
    </div>
  </div>
</div>

<style>
  .player {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    display: grid;
    place-items: center;
    background: repeating-conic-gradient(var(--bg2) 0 25%, var(--bg) 0 50%) 0 0 / 24px 24px;
    border-radius: var(--radius) var(--radius) 0 0;
  }
  canvas {
    max-width: 100%;
    max-height: 100%;
    image-rendering: auto;
    box-shadow: var(--shadow);
  }
  canvas.split {
    cursor: ew-resize;
  }
  canvas.hidden {
    display: none;
  }
  .placeholder {
    text-align: center;
    padding: 20px;
  }
  .hero .glitch {
    font-size: clamp(36px, 7vw, 84px);
    font-weight: 700;
    font-family: var(--mono);
    position: relative;
    letter-spacing: 0.05em;
  }
  .glitch::before,
  .glitch::after {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    mix-blend-mode: screen;
  }
  .glitch::before {
    color: var(--accent);
    transform: translate(3px, 0);
    clip-path: inset(10% 0 55% 0);
    animation: g1 2.4s infinite steps(2);
  }
  .glitch::after {
    color: var(--accent2);
    transform: translate(-3px, 0);
    clip-path: inset(55% 0 10% 0);
    animation: g2 1.9s infinite steps(2);
  }
  @keyframes g1 {
    50% {
      transform: translate(-6px, 2px);
      clip-path: inset(30% 0 40% 0);
    }
  }
  @keyframes g2 {
    50% {
      transform: translate(5px, -1px);
      clip-path: inset(70% 0 5% 0);
    }
  }
  .busy {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    padding: 6px 10px;
    border-radius: 8px;
    backdrop-filter: blur(4px);
  }
  .bar {
    flex: 1;
    height: 6px;
    background: var(--line);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    transition: width 0.15s;
  }
  .error {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    background: color-mix(in srgb, var(--danger) 20%, var(--panel));
    border: 1px solid var(--danger);
    padding: 8px 10px;
    border-radius: 8px;
  }
  .error pre {
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    font-size: 11px;
  }
  .cmp-label {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .transport {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-top: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .play {
    width: 44px;
    font-size: 15px;
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .info {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .type {
    padding: 0 6px;
    border-radius: 4px;
    font-weight: 700;
    color: #000;
  }
  .tI {
    background: var(--accent2);
  }
  .tP {
    background: var(--accent3);
  }
  .tB,
  .tS,
  .t\? {
    background: var(--muted);
  }
</style>
