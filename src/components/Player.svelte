<script lang="ts">
  import { untrack, onDestroy } from 'svelte';
  import { store, type CompareMode } from '../lib/store.svelte';
  import { loadExample } from '../lib/media';
  import Icon from './Icon.svelte';
  import { originalFrames, moshedAudioWav, type RenderResult } from '../lib/renderer';
  import { EditPreview, EditAudio } from '../lib/preview';
  import { drawTexts } from '../lib/text';
  import { download } from '../lib/storage';
  import type { Project } from '../engine/types';

  let canvas: HTMLCanvasElement;
  let editCanvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let muted = $state(false);
  let originals = $state.raw<Uint8Array[] | null>(null);
  let origKey = '';
  let loadingOrig = $state(false);

  const mosh = $derived(store.showingMosh);

  // ---- bitmap cache (mosh frames) ----
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
    // clean titles sit on top of the mosh (they're baked in only on export)
    if (mode !== 'hold' && store.project.texts.length) drawTexts(ctx, store.project.texts, src / r.fps, w, h, 'clean');
    // prefetch
    for (let k = 1; k < 8; k++) bitmap(r.jpegs, i + k, 'm');
  }

  $effect(() => {
    void store.ui.playhead;
    void store.render;
    void store.ui.compare;
    void store.ui.split;
    void originals;
    void JSON.stringify(store.project.texts);
    if (mosh) draw();
  });

  // ---- live edit preview ----
  let preview: EditPreview | null = null;
  const editAudio = new EditAudio();
  let dirty = false;
  function drawEdit() {
    if (!editCanvas) return;
    preview ??= new EditPreview(editCanvas);
    preview.onDirty = () => {
      if (!store.ui.playing && !dirty) {
        dirty = true;
        requestAnimationFrame(() => {
          dirty = false;
          if (!mosh) drawEdit();
        });
      }
    };
    preview.draw(store.project, store.ui.time, store.ui.playing && !mosh, store.ui.speed);
  }
  $effect(() => {
    // redraw when the time or anything on the timeline changes (while paused)
    void store.ui.time;
    void JSON.stringify(store.project.clips);
    void JSON.stringify(store.project.texts);
    void store.project.media.length;
    void store.project.encoder.aspect;
    if (!mosh && !store.ui.playing) untrack(drawEdit);
  });
  $effect(() => {
    if (mosh) preview?.pauseAll();
  });
  onDestroy(() => {
    preview?.dispose();
    editAudio.dispose();
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

  // ---- mosh audio ----
  let actx: AudioContext | null = null;
  let abuf = $state.raw<AudioBuffer | null>(null);
  let srcNode: AudioBufferSourceNode | null = null;
  let audioKey = '';
  $effect(() => {
    const r = store.render;
    const a = $state.snapshot(store.project.audio);
    const tracks = $state.snapshot(store.project.tracks);
    if (!r) return;
    const key = r.id + JSON.stringify([a, tracks]);
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
    editAudio.stop();
  }

  // ---- playback loop ----
  let raf = 0;
  $effect(() => {
    // Only these restart playback; everything else is read untracked so the
    // loop isn't torn down on every frame.
    const playing = store.ui.playing;
    const r = store.render;
    const buf = abuf;
    const mute = muted;
    const speed = store.ui.speed;
    const showMosh = mosh;
    if (!playing || (showMosh && !r)) {
      cancelAnimationFrame(raf);
      stopAudio();
      preview?.pauseAll();
      if (!showMosh) untrack(drawEdit);
      return;
    }
    return untrack(() => (showMosh && r ? playMosh(r, buf, mute, speed) : playEdit(mute, speed)));
  });

  function playMosh(r: RenderResult, buf: AudioBuffer | null, mute: boolean, speed: number) {
    const n = r.frames.length;
    // pick up where the edit preview was
    const cur = r.frames[store.ui.playhead];
    if (!cur || Math.abs(cur.src / r.fps - store.ui.time) > 1.5 / r.fps) store.ui.playhead = Math.min(n - 1, store.frameAtTime(store.ui.time));
    const range = (): [number, number] => (store.ui.loop && store.ui.loopOn ? store.ui.loop : [0, n]);
    const [a0, b0] = range();
    if (store.ui.playhead >= b0 - 1 || store.ui.playhead < a0) store.seekFrame(a0);
    const startAudio = () => {
      stopAudio();
      if (!buf || mute || !actx || speed !== 1) return;
      actx.resume();
      srcNode = actx.createBufferSource();
      srcNode.buffer = buf;
      srcNode.connect(actx.destination);
      srcNode.start(0, Math.min(buf.duration, store.ui.playhead / r.fps));
    };
    let t0 = performance.now();
    let f0 = store.ui.playhead;
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
          store.seekFrame(a);
          expected = a;
          startAudio();
        } else {
          store.seekFrame(n - 1);
          store.ui.playing = false;
          return;
        }
      }
      if (f !== store.ui.playhead) store.seekFrame(f);
      expected = f;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopAudio();
    };
  }

  function playEdit(mute: boolean, speed: number) {
    const end = store.duration;
    if (end <= 0) {
      store.ui.playing = false;
      return;
    }
    if (store.ui.time >= end - 0.05) store.seek(0);
    let t0 = store.ui.time;
    let n0 = performance.now();
    const startAudio = () => editAudio.start($state.snapshot(store.project) as Project, store.ui.time, mute || speed !== 1);
    startAudio();
    let expected = t0;
    let audioKey = JSON.stringify([store.project.clips, store.project.tracks]);
    const tick = (now: number) => {
      if (Math.abs(store.ui.time - expected) > 1e-6) {
        // seeked while playing
        t0 = store.ui.time;
        n0 = now;
        startAudio();
      }
      const k = JSON.stringify([store.project.clips, store.project.tracks]);
      if (k !== audioKey) {
        audioKey = k;
        t0 = store.ui.time;
        n0 = now;
        startAudio();
      }
      let t = t0 + ((now - n0) / 1000) * speed;
      if (t >= store.duration) {
        if (store.ui.loopOn) {
          t = 0;
          t0 = 0;
          n0 = now;
          store.seek(0);
          startAudio();
        } else {
          store.seek(store.duration);
          store.ui.playing = false;
          return;
        }
      }
      store.seek(t);
      expected = store.ui.time;
      preview?.draw(store.project, t, true, speed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      editAudio.stop();
      preview?.pauseAll();
    };
  }

  const n = $derived(store.render?.frames.length ?? 0);
  const cur = $derived(mosh ? store.render?.frames[store.ui.playhead] : undefined);
  const p2 = (x: number) => String(x).padStart(2, '0');
  // SMPTE-style timecode: MM:SS:FF (timeline time in the edit view, output frames in the mosh view)
  const timecode = $derived.by(() => {
    const fps = store.render?.fps ?? store.project.encoder.fps;
    const f = mosh ? store.ui.playhead : Math.round(store.ui.time * fps);
    const secs = Math.floor(f / fps);
    return `${p2(Math.floor(secs / 60))}:${p2(secs % 60)}:${p2(f % fps)}`;
  });

  function step(d: number) {
    store.ui.playing = false;
    if (mosh) store.seekFrame(store.ui.playhead + d);
    else store.seek(store.ui.time + d / store.project.encoder.fps);
  }
  function toStart() {
    if (mosh) store.seekFrame(0);
    else store.seek(0);
  }
  function toEnd() {
    if (mosh) store.seekFrame(n - 1);
    else store.seek(store.duration);
  }

  function snapshot() {
    (mosh ? canvas : editCanvas).toBlob((b) => b && download(b, `${store.project.name.replace(/[^\w-]+/g, '_')}_${mosh ? 'frame' + store.ui.playhead : 't' + store.ui.time.toFixed(2)}.png`), 'image/png');
  }

  let draggingSplit = false;
  function splitMove(e: PointerEvent) {
    if (!draggingSplit) return;
    // the canvas is letterboxed (object-fit: contain): measure against the picture itself
    const rc = canvas.getBoundingClientRect();
    const k = Math.min(rc.width / canvas.width, rc.height / canvas.height);
    const cw = canvas.width * k;
    const left = rc.left + (rc.width - cw) / 2;
    store.ui.split = Math.min(1, Math.max(0, (e.clientX - left) / cw));
  }

  const TAG_LABEL: Record<string, string> = { orig: '', dup: 'repeated', glitch: 'glitched', moved: 'moved', spliced: 'transferred', replaced: 'filled' };
  const COMPARE: [CompareMode, string][] = [
    ['off', 'Off'],
    ['split', 'Wipe'],
    ['side', 'Side'],
    ['hold', 'Source'],
  ];
  const VIEWS: ['auto' | 'edit' | 'mosh', string, string][] = [
    ['auto', 'Auto', 'Show the mosh when it is up to date, otherwise the live edit'],
    ['edit', 'Edit', 'Always show the live edit preview (no mosh, instant)'],
    ['mosh', 'Mosh', 'Always show the last rendered mosh'],
  ];
  const hasTimeline = $derived(store.project.clips.length > 0 || store.project.texts.length > 0);
</script>

<div class="player">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    bind:this={wrap}
    onpointerdown={(e) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
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
    <canvas bind:this={canvas} class:hidden={!mosh} class:split={store.ui.compare === 'split'}></canvas>
    <canvas bind:this={editCanvas} class="edit" class:hidden={mosh || !hasTimeline}></canvas>
    {#if hasTimeline}
      <div class="badge-view mono" class:live={!mosh} title={mosh ? 'Showing the rendered mosh' : 'Live edit preview: your cut as it is, before moshing'}>
        {#if mosh}mosh{:else}edit{#if store.status.busy || store.status.pending}<span class="faint"> · mosh rendering</span>{:else if store.render && !store.renderFresh && !store.ui.autoRender}<span class="faint"> · mosh out of date</span>{/if}{/if}
      </div>
    {/if}
    {#if !hasTimeline && !store.status.busy}
      <div class="empty">
        {#if store.project.media.length}
          <p class="muted">The timeline is empty.</p>
          <p class="muted small">Drag clips from the Media panel onto the timeline below.</p>
        {:else}
          <p>No footage.</p>
          <p class="muted small">Import a clip from the Media panel or drop files anywhere.<br />Two clips with lots of motion make the best melts.</p>
          <button onclick={() => loadExample()}>Load example</button>
        {/if}
      </div>
    {/if}
    {#if store.status.busy}
      <div class="stage-note mono">{store.status.stage || 'Working'} {Math.round(store.status.progress * 100)}%</div>
    {:else if store.ui.compare !== 'off' && mosh}
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
      {#if mosh}<span class="faint">{n ? store.ui.playhead + 1 : 0}/{n}</span>{/if}
      {#if cur}
        <span class="ftype" class:i={cur.type === 'I'}>{cur.type}</span>
        <span class="faint">{TAG_LABEL[cur.tag]}</span>
      {/if}
    </div>

    <div class="buttons">
      <button class="icon ghost" title="Start  Home" aria-label="Start" onclick={toStart}><Icon name="start" /></button>
      <button class="icon ghost" title="Previous frame  ←" aria-label="Previous frame" onclick={() => step(-1)}><Icon name="prev" /></button>
      <button class="play" title="Play / pause  Space" aria-label={store.ui.playing ? 'Pause' : 'Play'} disabled={!hasTimeline} onclick={() => (store.ui.playing = !store.ui.playing)}>
        <Icon name={store.ui.playing ? 'pause' : 'play'} />
      </button>
      <button class="icon ghost" title="Next frame  →" aria-label="Next frame" onclick={() => step(1)}><Icon name="next" /></button>
      <button class="icon ghost" title="End  End" aria-label="End" onclick={toEnd}><Icon name="end" /></button>
    </div>

    <div class="right">
      <button class="icon ghost" class:on={store.ui.loopOn} title="Loop  L  (set a region with I / O)" aria-label="Loop" onclick={() => (store.ui.loopOn = !store.ui.loopOn)}><Icon name="loop" /></button>
      <select bind:value={store.ui.speed} title="Playback speed (sound plays at 1× only)" aria-label="Playback speed">
        {#each [0.25, 0.5, 1, 1.5, 2] as s}<option value={s}>{s}×</option>{/each}
      </select>
      <button class="icon ghost" class:on={muted} title="Mute preview" aria-label="Mute" onclick={() => ((muted = !muted), muted && stopAudio())}><Icon name={muted ? 'mute' : 'sound'} /></button>
      <span class="divider"></span>
      <div class="seg" role="group" aria-label="Preview">
        {#each VIEWS as [v, label, tip]}
          <button class:on={store.ui.view === v} title={tip} onclick={() => store.setPref('view', v)}>{label}</button>
        {/each}
      </div>
      <span class="divider"></span>
      <span class="label cmp-label">A/B</span>
      <div class="seg" role="group" aria-label="Compare with source  C">
        {#each COMPARE as [m, label]}
          <button class:on={store.ui.compare === m} onclick={() => (store.ui.compare = m)}>{label}</button>
        {/each}
      </div>
      <span class="divider"></span>
      <button class="icon ghost" title="Save this frame as PNG" aria-label="Save frame" disabled={!hasTimeline} onclick={snapshot}><Icon name="still" /></button>
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
    inset: 12px;
    width: calc(100% - 24px);
    height: calc(100% - 24px);
    object-fit: contain;
  }
  canvas.split {
    cursor: ew-resize;
  }
  canvas.hidden {
    display: none;
  }
  .badge-view {
    position: absolute;
    right: 10px;
    top: 8px;
    font-size: 11px;
    color: var(--text-2);
    background: rgba(0, 0, 0, 0.5);
    padding: 1px 6px;
    border-radius: 2px;
    border-left: 2px solid var(--accent);
    z-index: 2;
  }
  .badge-view.live {
    border-left-color: var(--ok);
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
    .render-btn,
    .cmp-label {
      display: none;
    }
  }
</style>
