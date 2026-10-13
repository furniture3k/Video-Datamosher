<script lang="ts">
  import { untrack } from 'svelte';
  import { store, type CompareMode } from '../lib/store.svelte';
  import { loadExample } from '../lib/media';
  import Icon from './Icon.svelte';
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
    if (p) {
      // most-recently-used goes to the end, so eviction never hits the frame on screen
      cache.delete(k);
      cache.set(k, p);
    } else {
      p = createImageBitmap(new Blob([jpegs[i] as BlobPart], { type: 'image/jpeg' }));
      cache.set(k, p);
      // keep decoded frames within ~160 MB
      const r = store.render;
      const limit = r ? Math.max(24, Math.min(240, Math.floor(160e6 / (r.w * r.h * 4 * (store.ui.compare !== 'off' ? 2 : 1))))) : 120;
      if (cache.size > limit) {
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
    let a: ImageBitmap, b: ImageBitmap | null;
    try {
      [a, b] = await Promise.all([main, orig]);
    } catch {
      return;
    }
    if (tok !== drawToken) return;
    if (!a.width || (b && !b.width)) return; // bitmap was closed meanwhile
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
    // Only these restart playback; everything else is read untracked so the
    // loop isn't torn down on every frame.
    const playing = store.ui.playing;
    const r = store.render;
    const buf = abuf;
    const mute = muted;
    const speed = store.ui.speed;
    if (!playing || !r) {
      cancelAnimationFrame(raf);
      stopAudio();
      return;
    }
    return untrack(() => {
      const n = r.frames.length;
      const range = (): [number, number] => (store.ui.loop && store.ui.loopOn ? store.ui.loop : [0, n]);
      const [a0, b0] = range();
      if (store.ui.playhead >= b0 - 1 || store.ui.playhead < a0) store.ui.playhead = a0;
      const startAudio = () => {
        stopAudio();
        if (!buf || mute || !actx || speed !== 1) return;
        actx.resume();
        srcNode = actx.createBufferSource();
        srcNode.buffer = buf;
        srcNode.connect(actx.destination);
        srcNode.start(0, Math.min(buf.duration, store.ui.playhead / r.fps));
      };
      t0 = performance.now();
      f0 = store.ui.playhead;
      startAudio();
      let expected = f0;
      const tick = (now: number) => {
        const [a, b] = range();
        if (store.ui.playhead !== expected) {
          // user seeked while playing: continue from there
          f0 = store.ui.playhead;
          t0 = now;
          startAudio();
        }
        let f = f0 + Math.floor(((now - t0) / 1000) * r.fps * speed);
        if (f >= b) {
          if (store.ui.loopOn) {
            f0 = a;
            t0 = now;
            f = a;
            store.ui.playhead = a;
            expected = a;
            startAudio();
          } else {
            store.ui.playhead = n - 1;
            store.ui.playing = false;
            return;
          }
        }
        if (f !== store.ui.playhead) store.ui.playhead = f;
        expected = f;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        stopAudio();
      };
    });
  });

  const n = $derived(store.render?.frames.length ?? 0);
  const cur = $derived(store.render?.frames[store.ui.playhead]);
  // SMPTE-style timecode: MM:SS:FF
  const timecode = $derived.by(() => {
    const fps = store.render?.fps ?? store.project.encoder.fps;
    const f = store.ui.playhead;
    const secs = Math.floor(f / fps);
    const p2 = (x: number) => String(x).padStart(2, '0');
    return `${p2(Math.floor(secs / 60))}:${p2(secs % 60)}:${p2(f % fps)}`;
  });

  function snapshot() {
    canvas.toBlob((b) => b && download(b, `${store.project.name.replace(/[^\w-]+/g, '_')}_frame${store.ui.playhead}.png`), 'image/png');
  }

  let draggingSplit = false;
  function splitMove(e: PointerEvent) {
    if (!draggingSplit) return;
    const rc = canvas.getBoundingClientRect();
    store.ui.split = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width));
  }

  const TAG_LABEL: Record<string, string> = { orig: '', dup: 'repeated', glitch: 'glitched', moved: 'moved', spliced: 'transferred', replaced: 'filled' };
  const COMPARE: [CompareMode, string][] = [
    ['off', 'Off'],
    ['split', 'Wipe'],
    ['side', 'Side'],
    ['hold', 'Source'],
  ];
</script>

<div class="player">
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
    {#if store.status.busy}
      <div class="progress" style="width:{Math.max(2, Math.round(store.status.progress * 100))}%"></div>
    {/if}
    <canvas bind:this={canvas} class:hidden={!store.render} class:split={store.ui.compare === 'split'}></canvas>
    {#if !store.render && !store.status.busy}
      <div class="empty">
        {#if store.project.clips.length}
          <p class="muted">Nothing rendered yet.</p>
          <button onclick={() => store.doRender(true)}><Icon name="render" />Render preview</button>
        {:else}
          <p>No footage.</p>
          <p class="muted small">Import a clip from the Media panel or drop files anywhere.<br />Two clips with lots of motion make the best melts.</p>
          <button onclick={() => loadExample()}>Load example</button>
        {/if}
      </div>
    {/if}
    {#if store.status.busy}
      <div class="stage-note mono">{store.status.stage || 'Working'} {Math.round(store.status.progress * 100)}%</div>
    {:else if store.ui.compare !== 'off' && store.render}
      <div class="stage-note mono">
        {#if loadingOrig}loading source{:else if store.ui.compare === 'split'}source | mosh{:else if store.ui.compare === 'side'}source | mosh{:else}source{/if}
      </div>
    {/if}
    {#if store.status.error}
      <div class="error small">
        <div class="row"><b class="grow">Render failed</b><button onclick={() => store.doRender(true)}>Retry</button></div>
        <div>{store.status.error.split('\n')[0]}</div>
        <details><summary class="faint">Details</summary><pre>{store.status.error}</pre></details>
      </div>
    {/if}
  </div>

  <div class="transport">
    <div class="tc mono" title="minutes:seconds:frames">{timecode}</div>
    <div class="frameinfo mono small">
      <span class="faint">{n ? store.ui.playhead + 1 : 0}/{n}</span>
      {#if cur}
        <span class="ftype" class:i={cur.type === 'I'}>{cur.type}</span>
        <span class="faint">{TAG_LABEL[cur.tag]}</span>
      {/if}
    </div>

    <div class="buttons">
      <button class="icon ghost" title="Start  Home" aria-label="Start" onclick={() => (store.ui.playhead = 0)}><Icon name="start" /></button>
      <button class="icon ghost" title="Previous frame  ←" aria-label="Previous frame" onclick={() => (store.ui.playhead = Math.max(0, store.ui.playhead - 1))}><Icon name="prev" /></button>
      <button class="play" title="Play / pause  Space" aria-label={store.ui.playing ? 'Pause' : 'Play'} disabled={!store.render} onclick={() => (store.ui.playing = !store.ui.playing)}>
        <Icon name={store.ui.playing ? 'pause' : 'play'} />
      </button>
      <button class="icon ghost" title="Next frame  →" aria-label="Next frame" onclick={() => (store.ui.playhead = Math.min(n - 1, store.ui.playhead + 1))}><Icon name="next" /></button>
      <button class="icon ghost" title="End  End" aria-label="End" onclick={() => (store.ui.playhead = Math.max(0, n - 1))}><Icon name="end" /></button>
    </div>

    <div class="right">
      <button class="icon ghost" class:on={store.ui.loopOn} title="Loop  L  (set a region with I / O)" aria-label="Loop" onclick={() => (store.ui.loopOn = !store.ui.loopOn)}><Icon name="loop" /></button>
      <select bind:value={store.ui.speed} title="Playback speed (sound plays at 1× only)" aria-label="Playback speed">
        {#each [0.25, 0.5, 1, 1.5, 2] as s}<option value={s}>{s}×</option>{/each}
      </select>
      <button class="icon ghost" class:on={muted} title="Mute preview" aria-label="Mute" onclick={() => ((muted = !muted), muted && stopAudio())}><Icon name={muted ? 'mute' : 'sound'} /></button>
      <span class="divider"></span>
      <span class="label cmp-label">A/B</span>
      <div class="seg" role="group" aria-label="Compare with source  C">
        {#each COMPARE as [m, label]}
          <button class:on={store.ui.compare === m} onclick={() => (store.ui.compare = m)}>{label}</button>
        {/each}
      </div>
      <span class="divider"></span>
      <button class="icon ghost" title="Save this frame as PNG" aria-label="Save frame" disabled={!store.render} onclick={snapshot}><Icon name="still" /></button>
      <button class="icon ghost render-btn" title="Render now  Enter" aria-label="Render now" disabled={!store.project.clips.length} onclick={() => store.doRender(true)}><Icon name="render" /></button>
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
    background: var(--bg);
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    max-width: calc(100% - 24px);
    max-height: calc(100% - 24px);
  }
  canvas.split {
    cursor: ew-resize;
  }
  canvas.hidden {
    display: none;
  }
  .progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 2px;
    background: var(--accent);
    transition: width 0.15s;
    z-index: 2;
  }
  .stage-note {
    position: absolute;
    left: 10px;
    top: 8px;
    font-size: 11px;
    color: var(--text-2);
    text-transform: lowercase;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
    padding: 24px;
    line-height: 1.5;
  }
  .error {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-left: 2px solid var(--danger);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .error pre {
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    font: 11px var(--mono);
    color: var(--text-2);
  }
  .transport {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .tc {
    font-size: 20px;
    letter-spacing: 0.02em;
    color: var(--text);
    grid-column: 1;
    grid-row: 1;
    justify-self: start;
  }
  .frameinfo {
    grid-column: 1;
    grid-row: 1;
    justify-self: start;
    margin-left: 112px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .ftype {
    padding: 0 4px;
    border: 1px solid var(--line-2);
    color: var(--text-2);
  }
  .ftype.i {
    color: var(--f-i);
    border-color: var(--f-i);
  }
  .buttons {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .play {
    width: 40px;
    height: 30px;
    padding: 0;
    margin: 0 4px;
  }
  .right {
    grid-column: 3;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .right select {
    width: 62px;
  }
  .divider {
    width: 1px;
    height: 16px;
    background: var(--line-2);
    margin: 0 4px;
  }
  @media (max-width: 1280px) {
    .frameinfo {
      display: none;
    }
    .cmp-label {
      display: none;
    }
  }
  @media (max-width: 860px) {
    .stage {
      min-height: 56vw;
    }
    .transport {
      grid-template-columns: auto 1fr;
      row-gap: 6px;
    }
    .buttons {
      grid-column: 2;
      justify-self: end;
    }
    .right {
      grid-column: 1 / -1;
      justify-self: stretch;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .divider,
    .render-btn {
      display: none;
    }
  }
</style>
