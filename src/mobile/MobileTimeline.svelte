<script lang="ts">
  import * as haptics from '../lib/haptics';
  // Phone timeline, in the style of mobile editors: the playhead stays in the middle and the
  // footage scrolls under it. Swipe to scrub, pinch to zoom, tap to select, drag the white
  // handles to trim, press and hold a clip to move it.
  import { untrack } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { layoutVideo, clipLen, nearestCut, remapToFootage, trimClip, moveVideo, isOverlayTrack, mediaOf } from '../engine/timeline';
  import { VIDEO_TRACK, CLIP_AUDIO, clipOn, type Clip, type Project, type TextClip } from '../engine/types';
  import { mediaState } from '../lib/mediastate.svelte';
  import Icon from '../components/Icon.svelte';
  import Waveform from '../components/Waveform.svelte';

  let { onadd, onaction }: { onadd: () => void; onaction: (a: 'fx' | 'text' | 'music' | 'transition') => void } = $props();

  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  let sc: HTMLDivElement;
  let viewW = $state(360);
  let pps = $state(64);
  const half = $derived(Math.round(viewW / 2));
  const fps = $derived(store.project.encoder.fps);
  const duration = $derived(store.duration);
  const placed = $derived(layoutVideo(store.project));
  const sel = $derived(new Set(store.ui.selectedClips));
  const totalF = $derived(Math.max(1, store.totalFrames));
  const overlays = $derived(store.project.clips.filter((c) => isOverlayTrack(c.track)));
  const audioTracks = $derived(store.project.tracks.filter((t) => t.kind === 'audio' && t.id !== CLIP_AUDIO));
  const audioRows = $derived(audioTracks.map((t) => ({ t, clips: store.project.clips.filter((c) => c.track === t.id) })).filter((r) => r.clips.length));
  const W = $derived(Math.max(1, duration * pps));
  const x = (t: number) => t * pps;

  // ---- the playhead stays put; scrolling moves time
  let lastSet = -1;
  function onScroll() {
    if (Math.abs(sc.scrollLeft - lastSet) < 1.5) return;
    if (store.ui.playing) store.ui.playing = false;
    store.seek(sc.scrollLeft / pps);
  }
  $effect(() => {
    const target = store.ui.time * pps;
    void viewW;
    untrack(() => {
      if (!sc || Math.abs(sc.scrollLeft - target) < 1.5) return;
      sc.scrollLeft = target;
      lastSet = sc.scrollLeft;
    });
  });

  // ---- ruler
  const ticks = $derived.by(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * pps >= 56) ?? 600;
    const out: number[] = [];
    for (let t = 0; t <= duration + 1e-6; t += step) out.push(t);
    return { step, out };
  });
  const mmss = (s: number) => ((r) => `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`)(Math.round(s));
  const fmt = (s: number) => (s >= 60 ? mmss(s) : `${Math.round(s * 10) / 10}s`.replace('.0s', 's'));

  // ---- pinch to zoom (time under the playhead stays put)
  let pinch: { d0: number; p0: number } | null = null;
  const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  function touchStart(e: TouchEvent) {
    if (e.touches.length !== 2) return;
    pinch = { d0: dist(e), p0: pps };
    // a second finger is a pinch, not a press and hold
    if (press) clearTimeout(press.timer), (press = null);
  }
  function touchMove(e: TouchEvent) {
    // while a clip is picked up, the finger moves it rather than scrolling the timeline (a scroll
    // would cancel the pointer and drop the clip)
    if (drag && e.cancelable) return e.preventDefault();
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    pps = Math.max(8, Math.min(600, pinch.p0 * (dist(e) / pinch.d0)));
  }
  function touchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinch = null;
  }
  $effect(() => {
    if (!sc) return;
    const el = sc;
    el.addEventListener('touchmove', touchMove, { passive: false });
    return () => el.removeEventListener('touchmove', touchMove);
  });
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    pps = Math.max(8, Math.min(600, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  }

  // ---- taps, trims, moves
  type D =
    | { k: 'trim'; id: string; ck: 'v' | 'a' | 't'; edge: 'l' | 'r'; x0: number; orig: Clip | TextClip; before: Project }
    | { k: 'move'; id: string; ck: 'a' | 't'; x0: number; s0: number; before: Project; moved: boolean }
    | { k: 'fx'; id: string; mode: 'move' | 'l' | 'r'; x0: number; s0: number; e0: number; moved: boolean }
    | { k: 'reorder'; id: string; x: number; insert: number; before: Project };
  let drag = $state<D | null>(null);
  let press: { timer: number; x: number; y: number } | null = null;
  const timeAt = (clientX: number) => (sc.scrollLeft + clientX - sc.getBoundingClientRect().left - half) / pps;

  function listen() {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  function unlisten() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }
  /** Run `fn` if this press ends as a tap (lifted near where it went down, not cancelled by a scroll). */
  function onTap(e: PointerEvent, fn: () => void) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (ev.type === 'pointerup' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) fn();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** A main-track clip: tap selects, press and hold picks it up to move it. */
  function clipDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    clearTimeout(press?.timer);
    const p = { timer: 0, x: e.clientX, y: e.clientY };
    p.timer = window.setTimeout(() => {
      press = null;
      if (placed.length < 2) return;
      haptics.grab();
      store.selectClip(id);
      drag = { k: 'reorder', id, x: e.clientX, insert: placed.findIndex((q) => q.clip.id === id), before: clone($state.snapshot(store.project)) as Project };
    }, 380);
    press = p;
    const cancel = (ev: PointerEvent) => {
      if (press && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 8) clearTimeout(p.timer), (press = null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', cancel);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // moved away, or held and picked up: not a tap
      if (press !== p) return;
      // a cancelled press (the browser took it for a scroll or pinch) mustn't pick the clip up later
      clearTimeout(p.timer);
      press = null;
      if (ev.type !== 'pointerup') return;
      if (store.ui.selectedClips.length === 1 && sel.has(id)) store.selectClip(null);
      else store.selectClip(id);
    };
    window.addEventListener('pointermove', cancel);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    listen();
  }

  function edgeDown(e: PointerEvent, id: string, ck: 'v' | 'a' | 't', edge: 'l' | 'r') {
    e.stopPropagation();
    e.preventDefault();
    const orig = ck === 't' ? store.project.texts.find((t) => t.id === id)! : store.project.clips.find((c) => c.id === id)!;
    drag = { k: 'trim', id, ck, edge, x0: e.clientX, orig: clone($state.snapshot(orig)) as Clip | TextClip, before: clone($state.snapshot(store.project)) as Project };
    haptics.grab();
    listen();
  }

  /** Audio clips and titles: tap selects; once selected, drag to move. */
  function itemDown(e: PointerEvent, id: string, ck: 'a' | 't') {
    if (e.button !== 0) return;
    if (!sel.has(id)) return onTap(e, () => store.selectClip(id));
    e.stopPropagation();
    const s0 = ck === 't' ? store.project.texts.find((t) => t.id === id)!.start : store.project.clips.find((c) => c.id === id)!.start;
    drag = { k: 'move', id, ck, x0: e.clientX, s0, before: clone($state.snapshot(store.project)) as Project, moved: false };
    listen();
  }

  function fxDown(e: PointerEvent, id: string, mode: 'move' | 'l' | 'r') {
    if (e.button !== 0) return;
    if (mode === 'move' && store.ui.selectedEffect !== id) return onTap(e, () => store.selectEffect(id));
    e.stopPropagation();
    const fx = store.project.effects.find((f) => f.id === id)!;
    drag = { k: 'fx', id, mode, x0: e.clientX, s0: fx.start, e0: fx.end, moved: false };
    listen();
  }

  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    const dt = (e.clientX - ('x0' in d ? d.x0 : d.x)) / pps;
    if (d.k === 'trim') {
      if (d.ck === 't') {
        const tx = store.project.texts.find((t) => t.id === d.id);
        const o = d.orig as TextClip;
        if (!tx) return;
        if (d.edge === 'l') {
          const s = Math.min(o.start + o.duration - 0.2, Math.max(0, o.start + dt));
          tx.start = s;
          tx.duration = o.start + o.duration - s;
        } else tx.duration = Math.max(0.2, o.duration + dt);
        return;
      }
      trimClip(store.project, d.id, d.edge, dt, d.orig as Clip);
      return;
    }
    if (d.k === 'move') {
      if (!d.moved && Math.abs(dt * pps) < 4) return;
      d.moved = true;
      const s = Math.max(0, Math.round((d.s0 + dt) * fps) / fps);
      if (d.ck === 't') {
        const tx = store.project.texts.find((t) => t.id === d.id);
        if (tx) tx.start = s;
      } else {
        const c = store.project.clips.find((x) => x.id === d.id);
        if (c) c.start = s;
      }
      return;
    }
    if (d.k === 'fx') {
      const fx = store.project.effects.find((f) => f.id === d.id);
      if (!fx) return;
      const df = Math.round(dt * fps);
      if (!d.moved && Math.abs(dt * pps) < 4) return;
      d.moved = true;
      if (d.mode === 'move') {
        const len = d.e0 - d.s0;
        fx.start = Math.max(0, Math.min(totalF - len, d.s0 + df));
        fx.end = fx.start + len;
      } else if (d.mode === 'l') fx.start = Math.max(0, Math.min(fx.end - 1, d.s0 + df));
      else fx.end = Math.min(totalF, Math.max(fx.start + 1, d.e0 + df));
      return;
    }
    if (d.k === 'reorder') {
      d.x = e.clientX;
      const insert = nearestCut(d.before, timeAt(e.clientX));
      if (insert !== d.insert) haptics.tick();
      d.insert = insert;
      // keep the finger's spot in view near the edges
      const r = sc.getBoundingClientRect();
      if (e.clientX < r.left + 40) sc.scrollLeft -= 8;
      else if (e.clientX > r.right - 40) sc.scrollLeft += 8;
    }
  }

  function onUp(e: PointerEvent) {
    unlisten();
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.k === 'trim') {
      remapToFootage(d.before, store.project);
      store.commit('mtrim' + Math.random());
    } else if (d.k === 'move' && d.moved) {
      remapToFootage(d.before, store.project);
      store.commit('mmove' + Math.random());
    } else if (d.k === 'fx' && d.moved) store.commit('mfx' + Math.random());
    else if (d.k === 'reorder' && e.type === 'pointerup') {
      const from = placed.findIndex((q) => q.clip.id === d.id);
      if (d.insert !== from && d.insert !== from + 1) store.editTimeline((p) => moveVideo(p, d.id, d.insert));
    }
  }

  const reorderX = $derived.by(() => {
    if (drag?.k !== 'reorder') return null;
    const i = (drag as Extract<D, { k: 'reorder' }>).insert;
    return i >= placed.length ? x(placed.at(-1)?.end ?? 0) : x(placed[i].start);
  });
  const tapEmpty = (e: PointerEvent) => {
    // the gaps in the lanes and the ruler are empty space too, not only the margins
    if ((e.target as Element).closest('.clip, .item, .fxbar, button')) return;
    onTap(e, () => {
      store.selectClip(null);
      store.selectEffect(null);
      store.ui.selectedTransition = null;
    });
  };
  const peaks = (id: string) => mediaState[id]?.peaks;
  const fmtLen = (s: number) => (s >= 59.95 ? mmss(s) : `${s.toFixed(1)}s`);
</script>

<div class="mtl" bind:clientWidth={viewW}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroller" bind:this={sc} onscroll={onScroll} ontouchstart={touchStart} ontouchend={touchEnd} onwheel={onWheel}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="content" style="width:{W + viewW}px;padding:0 {half}px" onpointerdown={tapEmpty}>
      <div class="ruler" style="width:{W}px">
        {#each ticks.out as t}
          <span class="tick" style="left:{x(t)}px">{fmt(t)}</span>
        {/each}
      </div>

      <!-- mosh effects -->
      <div class="lane fx" style="width:{W}px">
        {#each store.project.effects as fx (fx.id)}
          {@const def = EFFECTS[fx.type]}
          {@const on = store.ui.selectedEffect === fx.id}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fxbar"
            class:sel={on}
            class:off={!fx.enabled}
            style="left:{x(fx.start / fps)}px;width:{Math.max(6, x((fx.end - fx.start) / fps))}px;--c:{def?.color}"
            onpointerdown={(e) => fxDown(e, fx.id, 'move')}
          >
            <span class="fxname">{fx.name || def?.name}</span>
            {#if on}
              <span class="h l" onpointerdown={(e) => fxDown(e, fx.id, 'l')}></span>
              <span class="h r" onpointerdown={(e) => fxDown(e, fx.id, 'r')}></span>
            {/if}
          </div>
        {/each}
        {#if !store.project.effects.length && placed.length}
          <button class="pill" style="left:{Math.min(x(store.ui.time), W)}px" onclick={() => onaction('fx')}><Icon name="plus" size={12} />Add mosh effect</button>
        {/if}
      </div>

      <!-- main video track -->
      <div class="lane main" style="width:{W}px">
        {#each placed as pl, i (pl.clip.id)}
          {@const c = pl.clip}
          {@const on = sel.has(c.id)}
          {@const w = x(pl.end - pl.start)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="clip"
            class:sel={on}
            class:off={!clipOn(c)}
            class:lifted={drag?.k === 'reorder' && drag.id === c.id}
            style="left:{x(pl.start)}px;width:{w}px;{pl.media.thumb ? `background-image:url(${pl.media.thumb})` : ''}"
            onpointerdown={(e) => clipDown(e, c.id)}
          >
            <span class="len mono">{fmtLen(pl.end - pl.start)}</span>
            {#if c.speed !== 1 || c.ramp}<span class="badge mono">{c.ramp ? 'ramp' : c.speed + '×'}</span>{/if}
            {#if c.reverse}<span class="badge rev"><Icon name="reverse" size={11} /></span>{/if}
            {#if on && store.ui.selectedClips.length === 1}
              <span class="h l" onpointerdown={(e) => edgeDown(e, c.id, 'v', 'l')}><i></i></span>
              <span class="h r" onpointerdown={(e) => edgeDown(e, c.id, 'v', 'r')}><i></i></span>
            {/if}
          </div>
          {#if i > 0}
            {@const t = c.transition}
            <button
              class="cut"
              class:has={!!t}
              class:on={store.ui.selectedTransition === c.id}
              style="left:{x(pl.start + pl.overlap / 2)}px"
              aria-label="Transition into {pl.media.source.name}"
              onclick={(e) => {
                e.stopPropagation();
                store.selectTransition(c.id);
                onaction('transition');
              }}><Icon name={t ? 'melt' : 'transition'} size={12} /></button
            >
          {/if}
        {/each}
        {#if reorderX !== null}<div class="insert" style="left:{reorderX}px"></div>{/if}
      </div>

      <!-- video tracks above the main one (overlays, adjustment layers) -->
      {#if overlays.length}
        <div class="lane small" style="width:{W}px">
          {#each overlays as c (c.id)}
            {@const m = mediaOf(store.project, c.mediaId)}
            {@const on = sel.has(c.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="item ov" class:sel={on} style="left:{x(c.start)}px;width:{x(clipLen(c))}px;{m?.thumb ? `background-image:url(${m.thumb})` : ''}" onpointerdown={(e) => itemDown(e, c.id, 'a')}>
              <span class="nm">{m?.source.kind === 'adjust' ? 'Adjust' : m?.source.name}</span>
              {#if on}
                <span class="h l" onpointerdown={(e) => edgeDown(e, c.id, 'a', 'l')}><i></i></span>
                <span class="h r" onpointerdown={(e) => edgeDown(e, c.id, 'a', 'r')}><i></i></span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- titles -->
      <div class="lane small" style="width:{W}px">
        {#each store.project.texts as tx (tx.id)}
          {@const on = sel.has(tx.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="item text" class:sel={on} style="left:{x(tx.start)}px;width:{x(tx.duration)}px" onpointerdown={(e) => itemDown(e, tx.id, 't')}>
            <Icon name="text" size={11} /><span class="nm">{tx.text}</span>
            {#if on}
              <span class="h l" onpointerdown={(e) => edgeDown(e, tx.id, 't', 'l')}><i></i></span>
              <span class="h r" onpointerdown={(e) => edgeDown(e, tx.id, 't', 'r')}><i></i></span>
            {/if}
          </div>
        {/each}
        {#if !store.project.texts.length && placed.length}
          <button class="pill" style="left:{Math.min(x(store.ui.time), W)}px" onclick={() => onaction('text')}><Icon name="plus" size={12} />Add text</button>
        {/if}
      </div>

      <!-- music and sound -->
      {#each audioRows as row (row.t.id)}
        <div class="lane small" style="width:{W}px">
          {#each row.clips as c (c.id)}
            {@const m = mediaOf(store.project, c.mediaId)}
            {@const on = sel.has(c.id)}
            {@const w = x(clipLen(c))}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="item audio" class:sel={on} class:muted={row.t.muted} style="left:{x(c.start)}px;width:{w}px" onpointerdown={(e) => itemDown(e, c.id, 'a')}>
              <div class="wave"><Waveform peaks={m ? peaks(m.id) : undefined} from={c.in} to={c.out} reverse={c.reverse} width={w} height={28} /></div>
              <span class="nm"><Icon name="music" size={11} />{m?.source.name}</span>
              {#if on}
                <span class="h l" onpointerdown={(e) => edgeDown(e, c.id, 'a', 'l')}><i></i></span>
                <span class="h r" onpointerdown={(e) => edgeDown(e, c.id, 'a', 'r')}><i></i></span>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
      {#if !audioRows.length && placed.length}
        <div class="lane small" style="width:{W}px">
          <button class="pill" style="left:{Math.min(x(store.ui.time), W)}px" onclick={() => onaction('music')}><Icon name="music" size={12} />Add music</button>
        </div>
      {/if}
    </div>
  </div>
  <div class="playline" style="left:{half}px"></div>
  <button class="addclip" aria-label="Add media" onclick={onadd}><Icon name="plus" size={20} stroke={2} /></button>
  {#if !placed.length && !store.project.texts.length}
    <div class="emptyhint">
      <button class="primary big" onclick={onadd}><Icon name="plus" size={18} stroke={2} />Add videos or photos</button>
    </div>
  {/if}
</div>

<style>
  .mtl {
    position: relative;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    overflow: hidden;
  }
  .scroller {
    height: 100%;
    overflow-x: auto;
    overflow-y: auto;
    scrollbar-width: none;
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
  }
  .scroller::-webkit-scrollbar {
    display: none;
  }
  .content {
    position: relative;
    min-height: 100%;
    box-sizing: border-box;
    padding-bottom: 12px !important;
  }
  .ruler {
    position: relative;
    height: 24px;
  }
  .tick {
    position: absolute;
    top: 6px;
    font: 10px var(--mono);
    color: var(--text-3);
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .tick::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 14px;
    width: 1px;
    height: 4px;
    background: var(--line-2);
  }
  .lane {
    position: relative;
    height: 30px;
    margin-bottom: 6px;
  }
  .lane.main {
    height: 58px;
    margin: 4px 0 8px;
  }
  .lane.fx {
    height: 26px;
  }
  .clip {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 6px;
    background-color: var(--surface-3);
    background-size: auto 100%;
    background-repeat: repeat-x;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
    touch-action: pan-x pan-y;
    overflow: visible;
  }
  .clip + .clip {
    margin-left: 0;
  }
  .clip.off {
    opacity: 0.35;
  }
  .clip.sel {
    box-shadow:
      inset 0 0 0 2px var(--text),
      0 0 0 1px rgba(0, 0, 0, 0.6);
    z-index: 2;
  }
  .clip.lifted {
    opacity: 0.6;
    transform: translateY(-4px);
  }
  .len {
    position: absolute;
    left: 6px;
    bottom: 4px;
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
  }
  .badge {
    position: absolute;
    right: 6px;
    top: 4px;
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    display: inline-flex;
    align-items: center;
  }
  .badge.rev {
    right: auto;
    left: 6px;
  }
  .h {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 18px;
    background: var(--text);
    display: grid;
    place-items: center;
    touch-action: none;
    z-index: 3;
  }
  .h i {
    width: 2px;
    height: 40%;
    border-radius: 1px;
    background: var(--bg);
  }
  .h.l {
    left: -16px;
    border-radius: 6px 0 0 6px;
  }
  .h.r {
    right: -16px;
    border-radius: 0 6px 6px 0;
  }
  .cut {
    position: absolute;
    top: 50%;
    width: 24px;
    height: 24px;
    padding: 0;
    margin: -12px 0 0 -12px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--line-2);
    color: var(--text-2);
    z-index: 4;
  }
  .cut.has {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
  .cut.on {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  .insert {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 3px;
    margin-left: -1px;
    border-radius: 2px;
    background: var(--accent);
    z-index: 5;
  }
  .fxbar,
  .item {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 5px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    font-size: 11px;
    white-space: nowrap;
    overflow: visible;
    touch-action: pan-x pan-y;
  }
  .fxbar {
    background: color-mix(in srgb, var(--c) 30%, var(--surface-2));
    border-left: 3px solid var(--c);
    color: var(--text);
  }
  .fxbar.off {
    opacity: 0.4;
  }
  .fxbar.sel,
  .item.sel {
    box-shadow: inset 0 0 0 2px var(--text);
    touch-action: none;
    z-index: 2;
  }
  .fxbar .h,
  .item .h {
    width: 14px;
  }
  .fxbar .h.l,
  .item .h.l {
    left: -12px;
    border-radius: 5px 0 0 5px;
  }
  .fxbar .h.r,
  .item .h.r {
    right: -12px;
    border-radius: 0 5px 5px 0;
  }
  .fxname,
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .item.text {
    background: #6c4fb8;
    color: #fff;
  }
  .item.ov {
    background-color: #2f5f8a;
    background-size: auto 100%;
    background-repeat: repeat-x;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .item.audio {
    background: #1f5a4a;
    color: #d9fff2;
    padding: 0;
  }
  .item.audio.muted {
    opacity: 0.45;
  }
  .wave {
    position: absolute;
    inset: 0;
    color: rgba(160, 255, 220, 0.45);
    overflow: hidden;
    border-radius: 5px;
  }
  .item.audio .nm {
    position: relative;
    padding: 0 8px;
  }
  .pill {
    position: absolute;
    top: 0;
    height: 100%;
    margin-left: 10px;
    border-radius: 6px;
    border: 1px dashed var(--line-2);
    background: transparent;
    color: var(--text-3);
    font-size: 12px;
  }
  .playline {
    position: absolute;
    top: 4px;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    border-radius: 1px;
    pointer-events: none;
    z-index: 10;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  }
  .addclip {
    position: absolute;
    right: 10px;
    top: 58px;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    border: none;
    z-index: 11;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }
  .emptyhint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 12;
    background: var(--bg);
  }
  .big {
    height: 48px;
    padding: 0 22px;
    border-radius: 24px;
    font-size: 15px;
  }
</style>
