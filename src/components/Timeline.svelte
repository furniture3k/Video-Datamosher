<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { clipDuration } from '../engine/mosh';
  import Icon from './Icon.svelte';

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
          ctx.fillStyle = css('--f-i');
          ctx.fillRect(x(i), 4, Math.max(1, ppf), 10);
        }
      });
    ctx.fillStyle = css('--accent');
    for (const m of store.project.encoder.keyMarkers) {
      ctx.beginPath();
      ctx.moveTo(x(m), 2);
      ctx.lineTo(x(m) + 5, 9);
      ctx.lineTo(x(m), 16);
      ctx.lineTo(x(m) - 5, 9);
      ctx.fill();
    }
  });

  const TAG_VARS: Record<string, string> = { orig: '--f-p', dup: '--f-dup', glitch: '--f-glitch', moved: '--f-moved', spliced: '--f-spliced', replaced: '--f-replaced' };
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
      ctx.fillStyle = f.type === 'I' ? css('--f-i') : css(TAG_VARS[f.tag] ?? '--f-p');
      ctx.fillRect(i * w, f.type === 'I' ? 4 : 8, Math.max(w - (w > 3 ? 1 : 0), 0.6), f.type === 'I' ? 18 : 10);
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

<div class="tl">
  <div class="gutter">
    <div class="g-ruler row">
      <span class="label grow">Timeline</span>
      <button class="icon ghost" title="Zoom out" aria-label="Zoom out" onclick={() => (store.ui.zoom = Math.max(1, store.ui.zoom / 1.5))}><span class="zt">−</span></button>
      <button class="icon ghost" title="Zoom in  Ctrl+wheel" aria-label="Zoom in" onclick={() => (store.ui.zoom = Math.min(40, store.ui.zoom * 1.5))}><span class="zt">+</span></button>
    </div>
    <div class="g-row">Clips</div>
    <div class="g-row keys" title="Blue ticks: keyframes in the source. Red diamonds: keyframes you forced (double-click the lane or press K).">Keyframes</div>
    <div class="g-fx">
      {#each store.project.effects as fx (fx.id)}
        <button class="g-row fxname ghost" class:sel={store.ui.selectedEffect === fx.id} class:off={!fx.enabled} onclick={() => ((store.ui.selectedEffect = fx.id), (store.ui.tab = 'effects'))}>
          <span class="code" style="--c:{EFFECTS[fx.type]?.color}">{EFFECTS[fx.type]?.icon}</span>
          <span class="fxlabel">{fx.name || EFFECTS[fx.type]?.name}</span>
        </button>
      {/each}
      <button class="g-row add ghost" onclick={() => (store.ui.dialog = 'addEffect')} title="Add effect  A"><Icon name="plus" size={12} />Add effect</button>
    </div>
    <div class="g-row result" title="Output frames after moshing. Blue: keyframe. Grey: motion. Amber: repeated. Yellow: glitched. Teal: moved. Green: transferred.">Output</div>
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
              <span class="lbl"><span class="mono">{def?.icon}</span> {fx.name || def?.name}{#if Object.keys(fx.auto).length}<Icon name="curve" size={11} />{/if}</span>
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
    min-height: 168px;
    max-height: 300px;
    overflow-x: hidden;
    overflow-y: auto;
    align-items: flex-start;
    background: var(--surface);
  }
  .gutter {
    width: 156px;
    flex: none;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    z-index: 2;
    position: sticky;
    left: 0;
  }
  .g-ruler {
    height: 24px;
    border-bottom: 1px solid var(--line);
    padding: 0 4px 0 10px;
    gap: 0;
  }
  .g-ruler button {
    width: 22px;
    height: 20px;
  }
  .zt {
    font: 14px var(--mono);
    line-height: 1;
  }
  .g-row {
    height: 24px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--text-2);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    overflow: hidden;
  }
  .g-row.keys {
    height: 18px;
    font-size: 11px;
    color: var(--text-3);
  }
  .g-fx {
    flex: none;
  }
  .fxname {
    width: 100%;
    height: 24px;
    border-radius: 0;
    justify-content: flex-start;
    color: var(--text);
    border: none;
    border-bottom: 1px solid var(--line);
  }
  .fxlabel {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fxname.sel {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .fxname.off {
    opacity: 0.4;
  }
  .add {
    width: 100%;
    height: 24px;
    border: none;
    border-radius: 0;
    justify-content: flex-start;
    color: var(--text-3);
  }
  .result {
    height: 30px;
    border-top: 1px solid var(--line);
    border-bottom: none;
    color: var(--text-2);
  }
  .scroller {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    position: relative;
    min-width: 0;
    background: var(--bg);
  }
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .ruler {
    height: 24px;
    border-bottom: 1px solid var(--line);
    position: relative;
    cursor: ew-resize;
    flex: none;
    background: var(--surface);
  }
  .tick {
    position: absolute;
    top: 12px;
    bottom: 0;
    border-left: 1px solid var(--line-2);
    padding-left: 3px;
    font-size: 10px;
    color: var(--text-3);
  }
  .tick span {
    position: relative;
    top: -10px;
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
    top: 3px;
    bottom: 3px;
    background: var(--surface-2) center / auto 100% repeat-x;
    border: 1px solid var(--line-2);
    overflow: hidden;
    font-size: 11px;
  }
  .clipblock.sel {
    border-color: var(--text-2);
  }
  .clipblock span {
    background: rgba(0, 0, 0, 0.72);
    color: #ddd;
    padding: 0 4px;
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
    border-bottom: 1px solid var(--line);
  }
  .bar {
    position: absolute;
    top: 4px;
    bottom: 4px;
    background: color-mix(in srgb, var(--c) 22%, var(--surface-2));
    border-left: 2px solid var(--c);
    cursor: grab;
    display: flex;
    align-items: center;
    overflow: hidden;
    touch-action: none;
  }
  .bar.sel {
    outline: 1px solid var(--text);
    outline-offset: -1px;
  }
  .bar.off {
    opacity: 0.3;
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
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text);
  }
  .lbl .mono {
    color: var(--c);
    font-size: 10px;
  }
  .h {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: ew-resize;
  }
  .h:hover {
    background: color-mix(in srgb, var(--c) 60%, transparent);
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
    background: var(--surface);
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
    background: rgba(127, 201, 127, 0.12);
    border-left: 1px solid var(--ok);
    border-right: 1px solid var(--ok);
    pointer-events: none;
  }
  .loop.inactive {
    opacity: 0.35;
  }
  .phead {
    position: absolute;
    top: 0;
    bottom: 30px;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }
  .phead::before {
    content: '';
    position: absolute;
    top: 0;
    left: -4px;
    border: 4.5px solid transparent;
    border-top: 6px solid var(--accent);
  }
  .result-ph {
    top: 0;
    bottom: 0;
  }
  .result-ph::before {
    display: none;
  }
  .cut {
    position: absolute;
    top: 24px;
    bottom: 30px;
    width: 0;
    border-left: 1px dashed var(--line-2);
    pointer-events: none;
  }
  @media (max-width: 860px) {
    .gutter {
      width: 104px;
    }
  }
</style>
