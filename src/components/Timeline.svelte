<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { clipDuration } from '../engine/mosh';

  let scroller: HTMLDivElement;
  let viewW = $state(800);
  let keyCanvas: HTMLCanvasElement;
  let resultCanvas: HTMLCanvasElement;

  const total = $derived(Math.max(1, store.totalFrames));
  const width = $derived(Math.max(200, (viewW - 4) * store.ui.zoom));
  const ppf = $derived(width / total);
  const x = (f: number) => f * ppf;
  const nOut = $derived(store.render?.frames.length ?? 0);
  const playSrc = $derived(store.render?.frames[store.ui.playhead]?.src ?? 0);
  const fps = $derived(store.project.encoder.fps);

  const clipBlocks = $derived.by(() => {
    let t = 0;
    return store.project.clips.map((c) => {
      const s = Math.round(t * fps);
      t += clipDuration(c);
      return { c, s, e: Math.round(t * fps) };
    });
  });

  const ticks = $derived.by(() => {
    const secs = total / fps;
    const pxPerSec = width / secs;
    const steps = [0.25, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => s * pxPerSec >= 70) ?? 60;
    const out: number[] = [];
    for (let s = 0; s <= secs; s += step) out.push(s);
    return out;
  });

  // seek to first output frame showing source frame `s`
  function seekSrc(s: number) {
    const fr = store.render?.frames;
    if (!fr) return;
    let best = 0;
    for (let i = 0; i < fr.length; i++)
      if (fr[i].src >= s) {
        best = i;
        break;
      } else best = i;
    store.ui.playhead = best;
  }

  function frameAt(e: PointerEvent | MouseEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(total, Math.round((e.clientX - r.left) / ppf)));
  }

  let scrubbing = false;
  function scrubDown(e: PointerEvent) {
    scrubbing = true;
    store.ui.playing = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekSrc(frameAt(e, e.currentTarget as HTMLElement));
  }
  function scrubMove(e: PointerEvent) {
    if (scrubbing) seekSrc(frameAt(e, e.currentTarget as HTMLElement));
  }

  // ---- effect bar dragging ----
  let drag: { id: string; mode: 'move' | 'l' | 'r'; x0: number; s0: number; e0: number } | null = null;
  function snap(f: number, ev: PointerEvent) {
    if (ev.shiftKey) return f;
    const cands = [0, total, playSrc, ...store.cuts, ...store.project.encoder.keyMarkers, ...store.project.effects.flatMap((e) => (e.id === drag?.id ? [] : [e.start, e.end]))];
    const tol = 8 / ppf;
    let best = f;
    let bd = tol;
    for (const c of cands) if (Math.abs(c - f) < bd) ((bd = Math.abs(c - f)), (best = c));
    return best;
  }
  function barDown(e: PointerEvent, id: string, mode: 'move' | 'l' | 'r') {
    e.stopPropagation();
    const fx = store.project.effects.find((f) => f.id === id)!;
    store.ui.selectedEffect = id;
    store.ui.tab = 'effects';
    drag = { id, mode, x0: e.clientX, s0: fx.start, e0: fx.end };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function barMove(e: PointerEvent) {
    if (!drag) return;
    const d = Math.round((e.clientX - drag.x0) / ppf);
    const fx = store.project.effects.find((f) => f.id === drag!.id);
    if (!fx) return;
    if (drag.mode === 'move') {
      const len = drag.e0 - drag.s0;
      let s = snap(drag.s0 + d, e);
      if (s === drag.s0 + d) {
        const en = snap(drag.e0 + d, e);
        s = en - len;
      }
      s = Math.max(0, Math.min(total - len, s));
      fx.start = s;
      fx.end = s + len;
    } else if (drag.mode === 'l') fx.start = Math.max(0, Math.min(fx.end - 1, snap(drag.s0 + d, e)));
    else fx.end = Math.min(total, Math.max(fx.start + 1, snap(drag.e0 + d, e)));
  }
  function barUp() {
    if (drag) store.commit('drag-' + drag.id + Math.random());
    drag = null;
  }

  // ---- canvases ----
  const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  $effect(() => {
    const r = store.render;
    void width;
    void store.project.encoder.keyMarkers.length;
    void store.ui.theme;
    if (!keyCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    keyCanvas.width = Math.ceil(width * dpr);
    keyCanvas.height = 18 * dpr;
    const ctx = keyCanvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, 18);
    if (r)
      r.prep.frames.forEach((f, i) => {
        if (f.type === 'I') {
          ctx.fillStyle = css('--accent2');
          ctx.fillRect(x(i), 3, Math.max(1.5, ppf), 12);
        }
      });
    ctx.fillStyle = css('--accent3');
    for (const m of store.project.encoder.keyMarkers) {
      ctx.beginPath();
      ctx.moveTo(x(m), 2);
      ctx.lineTo(x(m) + 5, 9);
      ctx.lineTo(x(m), 16);
      ctx.lineTo(x(m) - 5, 9);
      ctx.fill();
    }
  });

  const TAG_COLORS: Record<string, string> = { orig: '', dup: '#ffb84d', glitch: '#ffe14d', moved: '#4dd8ff', spliced: '#5cff5c', replaced: '#ff7de9' };
  $effect(() => {
    const r = store.render;
    void width;
    void store.ui.theme;
    if (!resultCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    resultCanvas.width = Math.ceil(width * dpr);
    resultCanvas.height = 26 * dpr;
    const ctx = resultCanvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, 26);
    if (!r) return;
    const n = r.frames.length;
    const w = width / n;
    r.frames.forEach((f, i) => {
      ctx.fillStyle = f.type === 'I' ? css('--accent2') : TAG_COLORS[f.tag] || css('--faint');
      ctx.fillRect(i * w, f.type === 'I' ? 2 : 6, Math.max(w - (w > 3 ? 0.5 : 0), 0.6), f.type === 'I' ? 22 : 14);
    });
  });

  function keysDbl(e: MouseEvent) {
    const f = frameAt(e, e.currentTarget as HTMLElement);
    store.edit((p) => {
      const m = p.encoder.keyMarkers;
      const near = m.findIndex((k) => Math.abs(k - f) * ppf < 6);
      if (near >= 0) m.splice(near, 1);
      else m.push(f);
    });
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const z = Math.min(40, Math.max(1, store.ui.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      store.ui.zoom = z;
    }
  }

  // keep playhead visible while playing
  $effect(() => {
    if (!scroller || !store.ui.playing) return;
    const px = x(playSrc);
    if (px < scroller.scrollLeft || px > scroller.scrollLeft + scroller.clientWidth - 20) scroller.scrollLeft = px - 40;
  });

  const resultX = $derived(nOut ? (store.ui.playhead / nOut) * width : 0);
</script>

<div class="tl panel">
  <div class="gutter">
    <div class="g-ruler row">
      <button class="icon ghost" title="Zoom out" onclick={() => (store.ui.zoom = Math.max(1, store.ui.zoom / 1.5))}>－</button>
      <button class="icon ghost" title="Zoom in (Ctrl+wheel)" onclick={() => (store.ui.zoom = Math.min(40, store.ui.zoom * 1.5))}>＋</button>
    </div>
    <div class="g-row">Clips</div>
    <div class="g-row small keys" title="Blue = keyframes in the prepared video. Yellow diamonds = extra keyframes you forced (double-click the row or press K)">Keyframes</div>
    <div class="g-fx">
      {#each store.project.effects as fx (fx.id)}
        <button class="g-row fxname ghost" class:sel={store.ui.selectedEffect === fx.id} class:off={!fx.enabled} onclick={() => ((store.ui.selectedEffect = fx.id), (store.ui.tab = 'effects'))}>
          <span style="color:{EFFECTS[fx.type]?.color}">{EFFECTS[fx.type]?.icon}</span>
          {fx.name || EFFECTS[fx.type]?.name}
        </button>
      {/each}
      <button class="g-row add ghost" onclick={() => (store.ui.dialog = 'addEffect')} title="Add effect (A)">＋ Add effect</button>
    </div>
    <div class="g-row result" title="The output after moshing, frame by frame. Blue = keyframe, grey = motion frame, orange = duplicated, yellow = glitched, cyan = moved, green = transferred.">Result</div>
  </div>

  <div class="scroller" bind:this={scroller} bind:clientWidth={viewW} onwheel={onWheel}>
    <div class="content" style="width:{width}px">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ruler" onpointerdown={scrubDown} onpointermove={scrubMove} onpointerup={() => (scrubbing = false)}>
        {#each ticks as s}
          <div class="tick" style="left:{x(s * fps)}px"><span class="mono">{s % 1 ? s.toFixed(2) : s}s</span></div>
        {/each}
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="row-clips" onpointerdown={scrubDown} onpointermove={scrubMove} onpointerup={() => (scrubbing = false)}>
        {#each clipBlocks as b, i (b.c.id)}
          <div class="clipblock" class:sel={store.ui.selectedClip === b.c.id} style="left:{x(b.s)}px;width:{Math.max(2, x(b.e) - x(b.s))}px;{b.c.thumb ? `background-image:url(${b.c.thumb})` : ''}">
            <span>{i + 1}. {b.c.source.name}</span>
          </div>
        {/each}
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <canvas class="row-keys" bind:this={keyCanvas} style="width:{width}px" ondblclick={keysDbl} title="Double-click to add or remove a forced keyframe"></canvas>

      <div class="fx-rows">
        {#each store.project.effects as fx (fx.id)}
          {@const def = EFFECTS[fx.type]}
          <div class="fx-row">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="bar"
              class:sel={store.ui.selectedEffect === fx.id}
              class:off={!fx.enabled}
              style="left:{x(fx.start)}px;width:{Math.max(4, x(fx.end) - x(fx.start))}px;--c:{def?.color}"
              onpointerdown={(e) => barDown(e, fx.id, 'move')}
              onpointermove={barMove}
              onpointerup={barUp}
              title="{def?.name}: frames {fx.start}–{fx.end}. Drag to move, drag edges to resize, hold Shift to disable snapping."
            >
              <div class="h l" onpointerdown={(e) => barDown(e, fx.id, 'l')} onpointermove={barMove} onpointerup={barUp}></div>
              <span class="lbl">{def?.icon} {fx.name || def?.name}{Object.keys(fx.auto).length ? ' 〰' : ''}</span>
              <div class="h r" onpointerdown={(e) => barDown(e, fx.id, 'r')} onpointermove={barMove} onpointerup={barUp}></div>
            </div>
          </div>
        {/each}
        <div class="fx-row"></div>
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="result-wrap" onpointerdown={(e) => {
        scrubbing = true;
        store.ui.playing = false;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        store.ui.playhead = Math.max(0, Math.min(nOut - 1, Math.floor(((e.clientX - r.left) / width) * nOut)));
      }} onpointermove={(e) => {
        if (!scrubbing) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        store.ui.playhead = Math.max(0, Math.min(nOut - 1, Math.floor(((e.clientX - r.left) / width) * nOut)));
      }} onpointerup={() => (scrubbing = false)}>
        <canvas bind:this={resultCanvas} style="width:{width}px"></canvas>
        {#if store.ui.loop && nOut}
          <div class="loop" class:inactive={!store.ui.loopOn} style="left:{(store.ui.loop[0] / nOut) * width}px;width:{((store.ui.loop[1] - store.ui.loop[0]) / nOut) * width}px"></div>
        {/if}
        <div class="phead result-ph" style="left:{resultX}px"></div>
      </div>

      {#each store.cuts as c}
        <div class="cut" style="left:{x(c)}px"></div>
      {/each}
      {#if store.render}
        <div class="phead" style="left:{x(playSrc)}px"></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .tl {
    display: flex;
    min-height: 180px;
    max-height: 300px;
    overflow-x: hidden;
    overflow-y: auto;
    align-items: flex-start;
  }
  .gutter {
    width: 150px;
    flex: none;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    z-index: 2;
  }
  .g-ruler {
    height: 22px;
    border-bottom: 1px solid var(--line);
    padding: 0 4px;
  }
  .g-ruler button {
    padding: 0 6px;
    min-width: 0;
    font-size: 12px;
  }
  .g-row {
    height: 24px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    overflow: hidden;
  }
  .g-row.keys {
    height: 18px;
  }
  .g-fx {
    flex: none;
  }
  .fxname {
    width: 100%;
    border-radius: 0;
    text-align: left;
    color: var(--text);
    gap: 6px;
    border: none;
    border-bottom: 1px solid var(--line);
  }
  .fxname.sel {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .fxname.off {
    opacity: 0.45;
  }
  .add {
    width: 100%;
    border: none;
    border-radius: 0;
    color: var(--accent);
  }
  .result {
    height: 30px;
    border-top: 1px solid var(--line);
    border-bottom: none;
    color: var(--text);
    font-weight: 700;
  }
  .scroller {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    position: relative;
    min-width: 0;
  }
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .ruler {
    height: 22px;
    border-bottom: 1px solid var(--line);
    position: relative;
    cursor: ew-resize;
    flex: none;
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--line);
    padding-left: 3px;
    font-size: 10px;
    color: var(--muted);
  }
  .row-clips {
    height: 24px;
    position: relative;
    border-bottom: 1px solid var(--line);
    cursor: ew-resize;
    flex: none;
  }
  .clipblock {
    position: absolute;
    top: 2px;
    bottom: 2px;
    background: var(--panel2) center / auto 100% repeat-x;
    border: 1px solid var(--line);
    border-radius: 4px;
    overflow: hidden;
    font-size: 11px;
  }
  .clipblock.sel {
    border-color: var(--accent);
  }
  .clipblock span {
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    padding: 0 4px;
    border-radius: 0 0 4px 0;
    white-space: nowrap;
  }
  .row-keys {
    height: 18px;
    border-bottom: 1px solid var(--line);
    display: block;
    flex: none;
    cursor: copy;
  }
  .fx-rows {
    flex: none;
  }
  .fx-row {
    height: 24px;
    position: relative;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
  }
  .bar {
    position: absolute;
    top: 3px;
    bottom: 3px;
    background: color-mix(in srgb, var(--c) 35%, var(--panel2));
    border: 1px solid var(--c);
    border-radius: 5px;
    cursor: grab;
    display: flex;
    align-items: center;
    overflow: hidden;
    touch-action: none;
  }
  .bar.sel {
    box-shadow: 0 0 0 2px var(--text);
  }
  .bar.off {
    opacity: 0.35;
    filter: grayscale(1);
  }
  .bar:active {
    cursor: grabbing;
  }
  .lbl {
    font-size: 11px;
    padding: 0 10px;
    white-space: nowrap;
    pointer-events: none;
  }
  .h {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    background: color-mix(in srgb, var(--c) 70%, transparent);
  }
  .h.l {
    left: 0;
  }
  .h.r {
    right: 0;
  }
  .result-wrap {
    height: 30px;
    border-top: 1px solid var(--line);
    position: relative;
    cursor: ew-resize;
    flex: none;
  }
  .result-wrap canvas {
    display: block;
    height: 26px;
    margin-top: 2px;
  }
  .loop {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    border-left: 2px solid var(--ok);
    border-right: 2px solid var(--ok);
    pointer-events: none;
  }
  .loop.inactive {
    opacity: 0.35;
  }
  .phead {
    position: absolute;
    top: 0;
    bottom: 30px;
    width: 2px;
    background: var(--accent);
    pointer-events: none;
    box-shadow: 0 0 6px var(--accent);
  }
  .result-ph {
    top: 0;
    bottom: 0;
  }
  .cut {
    position: absolute;
    top: 22px;
    bottom: 30px;
    width: 0;
    border-left: 1px dashed var(--muted);
    pointer-events: none;
  }
  @media (max-width: 860px) {
    .gutter {
      width: 96px;
    }
  }
</style>
