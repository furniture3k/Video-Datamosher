<script lang="ts">
  import { formatSeconds } from '../engine/eta';
  import { compoundOf } from '../engine/compound';
  import { makeCompound, openCompound } from '../lib/compound.svelte';
  import { beatInfo, refreshBeats, beatInputs } from '../lib/beatinfo.svelte';
  import { usesBeats } from '../engine/audiofx';
  import { untrack } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { layoutVideo, clipLen, nearestCut, mediaOf, transitionName, isBlend, isMoshTransition, remapToFootage, trimClip, moveVideo, rollEdit, slipClip, changeVideoTrack, isOverlayTrack, clipEnd, splitClip, splitText, type Placed } from '../engine/timeline';
  import { VIDEO_TRACK, CLIP_AUDIO, clipOn, type Clip, type Project, type TextClip, type TransitionType } from '../engine/types';
  import { tc } from '../lib/timecode';
  import { mediaState } from '../lib/mediastate.svelte';
  import { addFiles, addToTimeline } from '../lib/media';
  import * as edit from '../lib/edit';
  import Icon from './Icon.svelte';
  import Waveform from './Waveform.svelte';

  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

  let scroller: HTMLDivElement;
  let rulerLane = $state<HTMLDivElement>();
  let viewW = $state(800);
  const narrow = $derived(viewW < 600);
  /** laptop widths: the toolbar's buttons lose their words so the time and zoom stay on one line */
  const compactBar = $derived(viewW < 1120);
  /** gutter (track header) width */
  const G = $derived(narrow ? 92 : 172);
  let keyCanvas = $state<HTMLCanvasElement>();
  let resultCanvas = $state<HTMLCanvasElement>();
  let fxOpen = $state(true);

  $effect(() => {
    store.ui.timelineViewW = viewW;
  });

  const fps = $derived(store.project.encoder.fps);
  const duration = $derived(store.duration);
  const placed = $derived(layoutVideo(store.project));
  const audioTracks = $derived(store.project.tracks.filter((t) => t.kind === 'audio' && t.id !== CLIP_AUDIO));
  /** upper video tracks, top one first (as drawn) */
  const upperTracks = $derived(edit.videoTracks(store.project).reverse().map((id) => store.project.tracks.find((t) => t.id === id)!));
  const mainTrack = $derived(store.project.tracks.find((t) => t.id === VIDEO_TRACK));
  const markers = $derived(store.project.markers ?? []);
  const locked = (track: string) => edit.lockedTrack(track);
  /** drag kind of a clip: the magnetic main track, a freely placed clip, or a title */
  const kindOf = (c: Clip): 'v' | 'a' => (c.track === VIDEO_TRACK ? 'v' : 'a');
  const clipAudioTrack = $derived(store.project.tracks.find((t) => t.id === CLIP_AUDIO));
  const fitPps = $derived(Math.max(2, (viewW - G - 30) / Math.max(5, duration)));
  const pps = $derived(store.ui.pxPerSec || fitPps);
  const W = $derived(Math.max(viewW - G, Math.ceil((duration + (store.ui.pxPerSec ? 8 : 0)) * pps) + 30));
  const x = (t: number) => t * pps;
  const xf = (f: number) => (f / fps) * pps;
  const nOut = $derived(store.render?.frames.length ?? 0);
  const fresh = $derived(store.renderFresh);
  const sel = $derived(new Set(store.ui.selectedClips));
  const totalF = $derived(Math.max(1, store.totalFrames));

  const ticks = $derived.by(() => {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * pps >= 64) ?? 600;
    const out: number[] = [];
    const end = W / pps;
    for (let s = 0; s <= end; s += step) out.push(Math.round(s * 1000) / 1000);
    return { out, step };
  });
  const fmtTick = (s: number) => {
    if (ticks.step < 1) return s.toFixed(ticks.step < 0.25 ? 1 : 2).replace(/\.?0+$/, '') + 's';
    const m = Math.floor(s / 60);
    const ss = Math.round(s % 60);
    return m ? `${m}:${String(ss).padStart(2, '0')}` : `${ss}s`;
  };

  function laneT(e: { clientX: number }): number {
    const left = rulerLane?.getBoundingClientRect().left ?? 0;
    return Math.max(0, (e.clientX - left) / pps);
  }

  // the beat grid (and the BPM shown for beat-triggered effects) follows the music as it's edited
  let beatTimer = 0;
  $effect(() => {
    if (!beatInfo.grid && !store.project.effects.some(usesBeats)) return;
    void beatInputs(store.project);
    clearTimeout(beatTimer);
    beatTimer = window.setTimeout(refreshBeats, 400);
  });

  // ---------------------------------------------------------------- snapping
  function snapTargets(exclude: string | null): number[] {
    const t: number[] = [0, store.ui.time, duration];
    for (const pl of placed) if (pl.clip.id !== exclude) t.push(pl.start, pl.end);
    for (const c of store.project.clips) if (c.track !== VIDEO_TRACK && c.id !== exclude) t.push(c.start, c.start + clipLen(c));
    for (const tx of store.project.texts) if (tx.id !== exclude) t.push(tx.start, tx.start + tx.duration);
    for (const m of markers) t.push(m.t);
    if (beatInfo.grid) t.push(...beatInfo.beats);
    if (store.ui.inPoint !== null) t.push(store.ui.inPoint);
    if (store.ui.outPoint !== null) t.push(store.ui.outPoint);
    return t;
  }
  function snapT(t: number, ev: { shiftKey: boolean }, exclude: string | null, targets: number[] | null = null): number {
    if (!store.ui.snap || ev.shiftKey) return t;
    const tol = 8 / pps;
    let best = t;
    let bd = tol;
    for (const c of targets ?? snapTargets(exclude)) if (Math.abs(c - t) < bd) ((bd = Math.abs(c - t)), (best = c));
    return best;
  }

  // ---------------------------------------------------------------- dragging
  type Drag =
    | { k: 'scrub' }
    | { k: 'move'; id: string; kind: 'v' | 'a' | 't'; x0: number; dx: number; moved: boolean; orig: Clip | TextClip; before: Project; grab: number; insert?: number; targets: number[]; to?: string; toT?: number }
    | { k: 'trim'; id: string; kind: 'v' | 'a' | 't'; edge: 'l' | 'r'; x0: number; orig: Clip | TextClip; before: Project; targets: number[] }
    | { k: 'fade'; id: string; edge: 'in' | 'out'; x0: number; orig: Clip }
    | { k: 'fx'; id: string; mode: 'move' | 'l' | 'r'; x0: number; s0: number; e0: number }
    | { k: 'trans'; id: string; x0: number; d0: number; before: Project }
    | { k: 'roll'; left: string; right: string; x0: number; origL: Clip; origR: Clip; before: Project; targets: number[]; cut: number }
    | { k: 'slip'; id: string; x0: number; orig: Clip; before: Project }
    | { k: 'vfade'; id: string; edge: 'in' | 'out'; x0: number; orig: Clip }
    | { k: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean; base: string[]; moved: boolean; t: number }
    | { k: 'marker'; id: string; x0: number; t0: number; moved: boolean };
  let drag = $state<Drag | null>(null);

  // Touch: a finger on a clip or effect bar scrolls the timeline unless it's held still for a
  // moment (then it drags). Holding and letting go opens the clip menu. Taps select / seek.
  let pending: { x: number; y: number; timer: number; start: () => void; tap: () => void; held: boolean } | null = null;
  function touchGate(e: PointerEvent, start: () => void, tap: () => void = () => {}): boolean {
    if (e.pointerType !== 'touch') return false;
    clearTimeout(pending?.timer);
    const p = { x: e.clientX, y: e.clientY, timer: 0, start, tap, held: false };
    p.timer = window.setTimeout(() => {
      p.held = true;
      start();
      navigator.vibrate?.(15);
    }, 320);
    pending = p;
    return true;
  }
  function onTouchMove(e: TouchEvent) {
    // once a drag has started, stop the page from scrolling under the finger
    if (drag && drag.k !== 'scrub') e.preventDefault();
  }
  // must be non-passive to be allowed to cancel scrolling
  $effect(() => {
    const el = scroller;
    if (!el) return;
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  });
  let menuAt = 0;
  function closeMenu() {
    // the click that ends a touch hold would close the menu it just opened
    if (performance.now() - menuAt > 400) menu = null;
  }

  /** Clicking the timeline takes keyboard focus away from inspector fields, so shortcuts work. */
  function releaseFocus() {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(a.tagName)) a.blur();
  }

  /** Empty track area: click moves the playhead (and deselects), drag draws a selection box. */
  function scrubDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // on touch, lanes scroll; a tap seeks
    if (touchGate(e, () => {}, () => ((store.ui.playing = false), store.seek(laneT(e))))) return;
    if (store.ui.tool === 'blade') return;
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    drag = { k: 'marquee', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add, base: add ? [...store.ui.selectedClips] : [], moved: false, t: snapT(laneT(e), e, null) };
  }
  function playheadDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.ui.playing = false;
    drag = { k: 'scrub' };
  }
  function rulerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    store.ui.playing = false;
    drag = { k: 'scrub' };
    store.seek(snapT(laneT(e), e, null));
  }

  function clipDown(e: PointerEvent, id: string, kind: 'v' | 'a' | 't') {
    if (e.button !== 0) return;
    e.stopPropagation();
    menu = null;
    const c = kind === 't' ? undefined : store.project.clips.find((x) => x.id === id);
    if (c && locked(c.track)) return;
    if (store.ui.tool === 'blade' && e.pointerType !== 'touch') return bladeAt(e, id, kind);
    if (c && (store.ui.tool === 'trim' || e.altKey) && e.pointerType !== 'touch') {
      // slip: same place and length, other footage
      store.selectClip(id);
      drag = { k: 'slip', id, x0: e.clientX, orig: clone(c), before: clone($state.snapshot(store.project)) as Project };
      return;
    }
    const ev = { clientX: e.clientX, clientY: e.clientY, shiftKey: false } as PointerEvent;
    const hold = () => {
      store.selectClip(id);
      startMove(ev, id, kind);
    };
    if (touchGate(e, hold, () => store.selectClip(id))) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) store.selectClip(id, true);
    else if (!sel.has(id)) store.selectClip(id);
    else store.ui.tab = 'clip';
    startMove(e, id, kind);
  }

  function startMove(e: PointerEvent, id: string, kind: 'v' | 'a' | 't') {
    const orig = kind === 't' ? store.project.texts.find((t) => t.id === id)! : store.project.clips.find((c) => c.id === id)!;
    const start = kind === 'v' ? (placed.find((p) => p.clip.id === id)?.start ?? 0) : (orig as { start: number }).start;
    drag = { k: 'move', id, kind, x0: e.clientX, dx: 0, moved: false, orig: clone(orig), before: clone($state.snapshot(store.project)) as Project, grab: laneT(e) - start, targets: snapTargets(id) };
  }

  /** Blade tool: cut the clip where it was clicked. */
  function bladeAt(e: PointerEvent, id: string, kind: 'v' | 'a' | 't') {
    const t = snapT(laneT(e), e, id);
    if (kind === 't') {
      const tx = store.project.texts.find((x) => x.id === id);
      if (!tx || t <= tx.start + 0.05 || t >= tx.start + tx.duration - 0.05) return;
      store.edit((p) => void splitText(p, id, t));
      return;
    }
    store.editTimeline((p) => void splitClip(p, id, t));
  }

  function edgeDown(e: PointerEvent, id: string, kind: 'v' | 'a' | 't', edge: 'l' | 'r') {
    if (e.button !== 0) return;
    e.stopPropagation();
    const c0 = kind === 't' ? undefined : store.project.clips.find((x) => x.id === id);
    if (c0 && locked(c0.track)) return;
    if (store.ui.tool === 'blade') return bladeAt(e, id, kind);
    // roll: Trim tool or Alt on a cut between two main-track clips
    if (kind === 'v' && (store.ui.tool === 'trim' || e.altKey)) {
      const i = placed.findIndex((p) => p.clip.id === id);
      const l = edge === 'r' ? placed[i] : placed[i - 1];
      const r = edge === 'r' ? placed[i + 1] : placed[i];
      if (l && r && r.overlap <= 0) {
        drag = { k: 'roll', left: l.clip.id, right: r.clip.id, x0: e.clientX, origL: clone(l.clip), origR: clone(r.clip), before: clone($state.snapshot(store.project)) as Project, targets: snapTargets(null).filter((x) => Math.abs(x - r.start) > 1e-3), cut: r.start };
        return;
      }
    }
    store.selectClip(id);
    const orig = kind === 't' ? store.project.texts.find((t) => t.id === id)! : store.project.clips.find((c) => c.id === id)!;
    drag = { k: 'trim', id, kind, edge, x0: e.clientX, orig: clone(orig), before: clone($state.snapshot(store.project)) as Project, targets: snapTargets(id) };
  }

  function fadeDown(e: PointerEvent, c: Clip, edge: 'in' | 'out') {
    e.stopPropagation();
    if (locked(c.track)) return;
    store.selectClip(c.id);
    drag = { k: 'fade', id: c.id, edge, x0: e.clientX, orig: clone(c) };
  }
  function vfadeDown(e: PointerEvent, c: Clip, edge: 'in' | 'out') {
    e.stopPropagation();
    if (locked(c.track)) return;
    store.selectClip(c.id);
    drag = { k: 'vfade', id: c.id, edge, x0: e.clientX, orig: clone(c) };
  }

  // ---------------------------------------------------------------- markers
  let editingMarker = $state<string | null>(null);
  function markerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const m = markers.find((x) => x.id === id);
    if (m) drag = { k: 'marker', id, x0: e.clientX, t0: m.t, moved: false };
  }
  function markerMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    store.edit((p) => (p.markers = (p.markers ?? []).filter((m) => m.id !== id)));
  }

  // ---------------------------------------------------------------- auto-scroll while dragging
  function edgeScroll(e: PointerEvent) {
    if (!scroller || !drag || drag.k === 'marquee') return;
    const r = scroller.getBoundingClientRect();
    const left = r.left + G;
    const zone = 36;
    if (e.clientX < left + zone) scroller.scrollLeft -= Math.ceil((left + zone - e.clientX) / 3);
    else if (e.clientX > r.right - zone) scroller.scrollLeft += Math.ceil((e.clientX - (r.right - zone)) / 3);
  }

  function fxDown(e: PointerEvent, id: string, mode: 'move' | 'l' | 'r') {
    e.stopPropagation();
    const fx = store.project.effects.find((f) => f.id === id)!;
    const ev = { clientX: e.clientX, clientY: e.clientY, button: 0, pointerType: 'mouse', stopPropagation() {} } as unknown as PointerEvent;
    if (mode === 'move' && touchGate(e, () => fxDown(ev, id, mode), () => store.selectEffect(id))) return;
    store.selectEffect(id);
    drag = { k: 'fx', id, mode, x0: e.clientX, s0: fx.start, e0: fx.end };
  }

  function transDown(e: PointerEvent, clipId: string) {
    e.stopPropagation();
    store.selectTransition(clipId);
    const c = store.project.clips.find((x) => x.id === clipId);
    if (c?.transition) drag = { k: 'trans', id: clipId, x0: e.clientX, d0: c.transition.duration, before: clone($state.snapshot(store.project)) as Project };
  }

  function snapFrame(f: number, ev: PointerEvent, id: string) {
    if (!store.ui.snap || ev.shiftKey) return f;
    const cands = [0, totalF, Math.round(store.ui.time * fps), ...(beatInfo.grid ? beatInfo.beats.map((b) => Math.round(b * fps)) : []), ...store.cuts, ...store.project.encoder.keyMarkers, ...store.project.effects.flatMap((e) => (e.id === id ? [] : [e.start, e.end]))];
    const tol = 8 / (pps / fps);
    let best = f;
    let bd = tol;
    for (const c of cands) if (Math.abs(c - f) < bd) ((bd = Math.abs(c - f)), (best = c));
    return best;
  }

  function onMove(e: PointerEvent) {
    if (pending && !pending.held && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 8) {
      // the finger moved first: it's a scroll, not a drag
      clearTimeout(pending.timer);
      pending = null;
    }
    const d = drag;
    if (!d) return;
    edgeScroll(e);
    if (d.k === 'scrub') return store.seek(snapT(laneT(e), e, null));
    if (d.k === 'marquee') {
      d.x1 = e.clientX;
      d.y1 = e.clientY;
      if (!d.moved && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 5) return;
      d.moved = true;
      const x0 = Math.min(d.x0, d.x1);
      const x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      const y1 = Math.max(d.y0, d.y1);
      const hit: string[] = [];
      scroller.querySelectorAll<HTMLElement>('[data-clip]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1) hit.push(el.dataset.clip!);
      });
      store.ui.selectedClips = [...new Set([...d.base, ...hit])];
      store.ui.selectedTransition = null;
      return;
    }
    if (d.k === 'marker') {
      const m = store.project.markers?.find((x) => x.id === d.id);
      if (!m) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      m.t = Math.max(0, Math.min(duration, snapT(d.t0 + (e.clientX - d.x0) / pps, e, null, snapTargets(null).filter((x) => Math.abs(x - d.t0) > 1e-6))));
      return;
    }
    if (d.k === 'roll') {
      let dt = (e.clientX - d.x0) / pps;
      dt = snapT(d.cut + dt, e, null, d.targets) - d.cut;
      rollEdit(store.project, d.left, d.right, dt, d.origL, d.origR);
      return;
    }
    if (d.k === 'slip') {
      slipClip(store.project, d.id, (e.clientX - d.x0) / pps, d.orig);
      return;
    }
    if (d.k === 'vfade') {
      const c = store.project.clips.find((x) => x.id === d.id);
      if (!c) return;
      const dt = (e.clientX - d.x0) / pps;
      const max = clipLen(c);
      if (d.edge === 'in') c.vfadeIn = Math.round(Math.max(0, Math.min(max - (c.vfadeOut ?? 0), (d.orig.vfadeIn ?? 0) + dt)) * 100) / 100;
      else c.vfadeOut = Math.round(Math.max(0, Math.min(max - (c.vfadeIn ?? 0), (d.orig.vfadeOut ?? 0) - dt)) * 100) / 100;
      return;
    }
    if (d.k === 'fx') {
      const df = Math.round(((e.clientX - d.x0) / pps) * fps);
      const fx = store.project.effects.find((f) => f.id === d.id);
      if (!fx) return;
      if (d.mode === 'move') {
        const len = d.e0 - d.s0;
        let s = snapFrame(d.s0 + df, e, d.id);
        if (s === d.s0 + df) s = snapFrame(d.e0 + df, e, d.id) - len;
        s = Math.max(0, Math.min(totalF - len, s));
        fx.start = s;
        fx.end = s + len;
      } else if (d.mode === 'l') fx.start = Math.max(0, Math.min(fx.end - 1, snapFrame(d.s0 + df, e, d.id)));
      else fx.end = Math.min(totalF, Math.max(fx.start + 1, snapFrame(d.e0 + df, e, d.id)));
      return;
    }
    if (d.k === 'trans') {
      const c = store.project.clips.find((x) => x.id === d.id);
      if (c?.transition) c.transition.duration = Math.max(0.1, Math.min(10, Math.round((d.d0 + (e.clientX - d.x0) / pps) * 20) / 20));
      return;
    }
    if (d.k === 'fade') {
      const c = store.project.clips.find((x) => x.id === d.id);
      if (!c) return;
      const dt = (e.clientX - d.x0) / pps;
      const max = clipLen(c);
      if (d.edge === 'in') c.fadeIn = Math.max(0, Math.min(max - c.fadeOut, d.orig.fadeIn + dt));
      else c.fadeOut = Math.max(0, Math.min(max - c.fadeIn, d.orig.fadeOut - dt));
      return;
    }
    if (d.k === 'trim') {
      let dt = (e.clientX - d.x0) / pps;
      if (d.kind === 't') {
        const tx = store.project.texts.find((t) => t.id === d.id)!;
        const o = d.orig as TextClip;
        if (d.edge === 'l') {
          const s = Math.min(o.start + o.duration - 0.2, Math.max(0, snapT(o.start + dt, e, d.id, d.targets)));
          tx.start = s;
          tx.duration = o.start + o.duration - s;
        } else tx.duration = Math.max(0.2, snapT(o.start + o.duration + dt, e, d.id, d.targets) - o.start);
        return;
      }
      const o = d.orig as Clip;
      const start = d.kind === 'v' ? (layoutVideo(d.before).find((p) => p.clip.id === d.id)?.start ?? 0) : o.start;
      const edgeT = d.edge === 'l' ? start : start + clipLen(o);
      // ripple trims on the video track keep the clip's start; snap the moving edge
      if (!(d.kind === 'v' && d.edge === 'l')) dt = snapT(edgeT + dt, e, d.id, d.targets) - edgeT;
      trimClip(store.project, d.id, d.edge, dt, o);
      return;
    }
    if (d.k === 'move') {
      d.dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(d.dx) < 4) return;
      d.moved = true;
      const t = laneT(e);
      const lane = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track]') as HTMLElement | null)?.dataset.track;
      if (d.kind === 'v') {
        // onto an upper video track: it leaves the main track
        if (lane && isOverlayTrack(lane) && !locked(lane)) {
          d.to = lane;
          d.toT = snapT(Math.max(0, t - d.grab), e, d.id, d.targets);
          d.insert = undefined;
          return;
        }
        d.to = undefined;
        d.insert = nearestCut(d.before, t);
        return;
      }
      if (d.kind === 't') {
        const tx = store.project.texts.find((x) => x.id === d.id)!;
        const o = d.orig as TextClip;
        let s = Math.max(0, t - d.grab);
        const s2 = snapT(s, e, d.id, d.targets);
        s = s2 !== s ? s2 : snapT(s + o.duration, e, d.id, d.targets) - o.duration;
        tx.start = Math.max(0, s);
        return;
      }
      const c = store.project.clips.find((x) => x.id === d.id)!;
      const len = clipLen(c);
      // an upper-track clip dropped on the main track goes in at the nearest cut
      if (lane === VIDEO_TRACK && isOverlayTrack(c.track)) {
        d.to = VIDEO_TRACK;
        d.insert = nearestCut(d.before, t);
        return;
      }
      d.to = undefined;
      d.insert = undefined;
      let s = Math.max(0, t - d.grab);
      const s2 = snapT(s, e, d.id, d.targets);
      s = s2 !== s ? s2 : snapT(s + len, e, d.id, d.targets) - len;
      c.start = Math.max(0, s);
      // clips change tracks only between tracks of their kind
      if (lane && lane !== VIDEO_TRACK && lane !== CLIP_AUDIO && isOverlayTrack(lane) === isOverlayTrack(c.track) && !locked(lane)) c.track = lane;
    }
  }

  function onUp(e: PointerEvent | null = null) {
    if (pending) {
      clearTimeout(pending.timer);
      const p = pending;
      pending = null;
      if (!p.held && e?.type === 'pointerup') p.tap();
      // held without moving: show the clip's menu
      if (p.held && drag?.k === 'move' && !drag.moved) {
        const id = drag.id;
        const kind = drag.kind;
        drag = null;
        openMenuAt(p.x, p.y, id, kind);
        return;
      }
    }
    const d = drag;
    drag = null;
    if (!d || d.k === 'scrub') return;
    if (d.k === 'marquee') {
      if (!d.moved) {
        // a click on empty space: move the playhead there and drop the selection
        store.ui.playing = false;
        store.seek(d.t);
        if (!d.add) {
          store.ui.selectedClips = [];
          store.ui.selectedTransition = null;
        }
      }
      return;
    }
    if (d.k === 'marker') {
      if (d.moved) store.commit('marker' + d.id + Math.random());
      else store.seek(d.t0);
      return;
    }
    if (d.k === 'vfade') return store.commit('vfade' + d.id + Math.random());
    if (d.k === 'roll' || d.k === 'slip') {
      remapToFootage(d.before, store.project);
      return store.commit(d.k + Math.random());
    }
    if (d.k === 'fx') return store.commit('fx-' + d.id + Math.random());
    if (d.k === 'trans' || d.k === 'fade') {
      if (d.k === 'trans') remapToFootage(d.before, store.project);
      return store.commit(d.k + d.id + Math.random());
    }
    if (d.k === 'move' && d.kind === 'v') {
      if (d.moved && d.to) store.editTimeline((p) => changeVideoTrack(p, d.id, d.to!, d.toT ?? 0));
      else if (d.moved && d.insert !== undefined) store.editTimeline((p) => moveVideo(p, d.id, d.insert!));
      return;
    }
    if (d.k === 'move' && d.to === VIDEO_TRACK && d.insert !== undefined) {
      // undo the live moves of the drag, then make it one edit
      store.set(d.before, false);
      store.editTimeline((p) => changeVideoTrack(p, d.id, VIDEO_TRACK, 0, d.insert));
      return;
    }
    if ((d.k === 'move' && d.moved) || d.k === 'trim') {
      remapToFootage(d.before, store.project);
      store.commit('drag' + Math.random());
    }
  }

  // ---------------------------------------------------------------- drop from the bin / desktop
  let hint = $state<{ track: string; index?: number; start?: number; cut?: number } | null>(null);

  function dragKind(e: DragEvent): 'media' | 'transition' | 'files' | null {
    const t = e.dataTransfer?.types ?? [];
    if (t.includes('application/x-moshpit-media')) return 'media';
    if (t.includes('application/x-moshpit-transition')) return 'transition';
    if (t.includes('Files')) return 'files';
    return null;
  }

  function laneOver(e: DragEvent, track: string) {
    const k = dragKind(e);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    const t = laneT(e);
    if (k === 'transition') {
      if (track !== VIDEO_TRACK || placed.length < 2) return (hint = null);
      let best = 1;
      for (let i = 1; i < placed.length; i++) if (Math.abs(placed[i].start - t) < Math.abs(placed[best].start - t)) best = i;
      hint = { track, cut: best };
      return;
    }
    if (track === VIDEO_TRACK || track === CLIP_AUDIO) hint = { track: VIDEO_TRACK, index: nearestCut(store.project, t) };
    else hint = { track, start: snapT(t, e, null) };
  }

  async function laneDrop(e: DragEvent, track: string) {
    const k = dragKind(e);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    const h = hint;
    hint = null;
    if (!h) return;
    if (k === 'transition') {
      const type = e.dataTransfer!.getData('application/x-moshpit-transition') as TransitionType;
      if (h.cut !== undefined && placed[h.cut]) {
        edit.setTransition(placed[h.cut].clip.id, type);
        store.selectTransition(placed[h.cut].clip.id);
      }
      return;
    }
    const place = h.index !== undefined ? { track: VIDEO_TRACK as 'v1', index: h.index } : { track: h.track, start: h.start ?? 0 };
    if (k === 'files') return void addFiles(e.dataTransfer!.files, place);
    const m = mediaOf(store.project, e.dataTransfer!.getData('application/x-moshpit-media'));
    if (m) addToTimeline(m, place);
  }

  async function newTrackDrop(e: DragEvent) {
    const k = dragKind(e);
    if (k !== 'media' && k !== 'files') return;
    e.preventDefault();
    e.stopPropagation();
    const id = edit.addAudioTrack();
    hint = { track: id, start: snapT(laneT(e), e, null) };
    await laneDrop(e, id);
  }

  async function newVideoTrackDrop(e: DragEvent) {
    const k = dragKind(e);
    if (k !== 'media' && k !== 'files') return;
    e.preventDefault();
    e.stopPropagation();
    const id = edit.addVideoTrack();
    hint = { track: id, start: snapT(laneT(e), e, null) };
    await laneDrop(e, id);
  }

  /** Blade tool: a line follows the mouse where the cut would go. */
  let bladeX = $state<number | null>(null);
  function bladeHover(e: PointerEvent) {
    if (store.ui.tool !== 'blade' || e.pointerType === 'touch') return;
    const onLane = (e.target as HTMLElement).closest('.lane:not(.ruler)');
    bladeX = onLane ? x(snapT(laneT(e), e, null)) : null;
  }

  // ---------------------------------------------------------------- context menu
  let menu = $state<{ x: number; y: number; id: string; kind: 'v' | 'a' | 't' } | null>(null);
  function openMenu(e: MouseEvent, id: string, kind: 'v' | 'a' | 't') {
    e.preventDefault();
    // touch long-press is handled by the hold gesture
    if ((e as PointerEvent).pointerType === 'touch' || pending || drag) return;
    openMenuAt(e.clientX, e.clientY, id, kind);
  }
  function openMenuAt(x: number, y: number, id: string, kind: 'v' | 'a' | 't') {
    if (!sel.has(id)) store.selectClip(id);
    // keep the menu on screen
    menuAt = performance.now();
    menu = { x: Math.max(4, Math.min(x, window.innerWidth - 220)), y: Math.max(4, Math.min(y, window.innerHeight - 500)), id, kind };
  }
  const CLIP_LABELS = ['#d9534f', '#e8833a', '#e0c341', '#5cc46b', '#4fa3e0', '#9b7be0', '#d95b8f'];
  const menuClip = $derived(menu && menu.kind !== 't' ? store.project.clips.find((c) => c.id === menu!.id) : undefined);

  // ---------------------------------------------------------------- canvases
  const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  $effect(() => {
    const r = store.render;
    const w = W;
    void pps;
    void fresh;
    void store.project.encoder.keyMarkers.length;
    void store.ui.theme;
    if (!keyCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    keyCanvas.width = Math.ceil(Math.min(w, 16000) * dpr);
    keyCanvas.height = 14 * dpr;
    const ctx = keyCanvas.getContext('2d')!;
    ctx.scale((dpr * Math.min(w, 16000)) / w, dpr);
    ctx.clearRect(0, 0, w, 14);
    if (r && fresh)
      r.prep.frames.forEach((f, i) => {
        if (f.type === 'I') {
          ctx.fillStyle = css('--f-i');
          ctx.fillRect(xf(i), 3, Math.max(1, xf(1)), 8);
        }
      });
    ctx.fillStyle = css('--accent');
    for (const m of store.project.encoder.keyMarkers) {
      ctx.beginPath();
      ctx.moveTo(xf(m), 1);
      ctx.lineTo(xf(m) + 4, 7);
      ctx.lineTo(xf(m), 13);
      ctx.lineTo(xf(m) - 4, 7);
      ctx.fill();
    }
  });

  const outW = $derived(Math.max(4, x(duration)));
  const TAG_VARS: Record<string, string> = { orig: '--f-p', dup: '--f-dup', glitch: '--f-glitch', moved: '--f-moved', spliced: '--f-spliced', replaced: '--f-replaced' };
  $effect(() => {
    const r = store.render;
    const w = outW;
    void store.ui.theme;
    if (!resultCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.min(w, 16000);
    resultCanvas.width = Math.ceil(cw * dpr);
    resultCanvas.height = 22 * dpr;
    const ctx = resultCanvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, 22);
    if (!r) return;
    const n = r.frames.length;
    const fw = cw / n;
    r.frames.forEach((f, i) => {
      ctx.fillStyle = f.type === 'I' ? css('--f-i') : css(TAG_VARS[f.tag] ?? '--f-p');
      ctx.fillRect(i * fw, f.type === 'I' ? 2 : 6, Math.max(fw - (fw > 3 ? 1 : 0), 0.6), f.type === 'I' ? 18 : 10);
    });
  });

  function keysDbl(e: MouseEvent) {
    const f = Math.round(laneT(e) * fps);
    store.edit((p) => {
      const m = p.encoder.keyMarkers;
      const near = m.findIndex((k) => Math.abs(xf(k) - xf(f)) < 6);
      if (near >= 0) m.splice(near, 1);
      else m.push(f);
    });
  }

  function outDown(e: PointerEvent) {
    if (!nOut) return;
    const el = e.currentTarget as HTMLElement;
    const pick = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      store.seekFrame(Math.floor(((ev.clientX - r.left) / outW) * nOut));
    };
    store.ui.playing = false;
    store.ui.view = 'mosh';
    pick(e);
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => pick(ev);
    el.addEventListener('pointermove', mv);
    // (lost capture: after pointerup and after a cancelled touch)
    el.addEventListener('lostpointercapture', () => el.removeEventListener('pointermove', mv), { once: true });
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const t = laneT(e);
      const before = (e.clientX - (rulerLane?.getBoundingClientRect().left ?? 0));
      edit.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
      requestAnimationFrame(() => (scroller.scrollLeft += t * pps - before));
    }
  }

  // when the whole timeline fits on screen there is nothing to scroll to
  $effect(() => {
    void W;
    void viewW;
    if (scroller && scroller.scrollWidth <= scroller.clientWidth + 1) scroller.scrollLeft = 0;
  });

  // keep the playhead in view while playing or jumping around (not while dragging: that scrolls itself)
  $effect(() => {
    const px = x(store.ui.time);
    if (!scroller || untrack(() => drag)) return;
    const visL = scroller.scrollLeft;
    const visW = scroller.clientWidth - G;
    if (px < visL || px > visL + visW - 30) scroller.scrollLeft = Math.max(0, px - (store.ui.playing ? 40 : visW / 2));
  });

  const outX = $derived(nOut ? (store.ui.playhead / nOut) * outW : 0);
  const peaksOf = (id: string) => mediaState[id]?.peaks;
  const vName = (pl: Placed) => pl.media.source.name.replace(/\.[^.]+$/, '');
  const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`);
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} onclick={closeMenu} />

{#if drag?.k === 'marquee' && drag.moved}
  <div class="marquee" style="left:{Math.min(drag.x0, drag.x1)}px;top:{Math.min(drag.y0, drag.y1)}px;width:{Math.abs(drag.x1 - drag.x0)}px;height:{Math.abs(drag.y1 - drag.y0)}px"></div>
{/if}

<div class="wrap">
  <div class="toolbar" class:narrow class:compact={compactBar}>
    <button class="ghost" title="Split at playhead  S" onclick={edit.splitAtPlayhead} disabled={!store.project.clips.length}><Icon name="blade" /><span class="tlbl">Split</span></button>
    <button class="ghost" title="Delete selected  Del" onclick={() => edit.deleteSelected()} disabled={!store.ui.selectedClips.length && !store.ui.selectedTransition}><Icon name="trash" /><span class="tlbl">Delete</span></button>
    <button class="ghost" title="Duplicate selected  D" onclick={edit.duplicateSelected} disabled={!store.ui.selectedClips.length}><Icon name="copy" /><span class="tlbl">Duplicate</span></button>
    <button class="ghost" title="Add a melt at the cut nearest the playhead  Ctrl T" onclick={() => edit.transitionAtPlayhead('melt')} disabled={placed.length < 2}><Icon name="split" /><span class="tlbl">Transition</span></button>
    <button class="ghost" title="Add a text title at the playhead" onclick={() => edit.addText()}><Icon name="text" /><span class="tlbl">Text</span></button>
    <span class="tsep"></span>
    <span class="tools" role="radiogroup" aria-label="Timeline tool">
      <button class="icon ghost" class:on={store.ui.tool === 'select'} role="radio" aria-checked={store.ui.tool === 'select'} title="Select tool  A: drag clips to move, edges to trim (Alt: roll a cut, slip a clip)" aria-label="Select tool" onclick={() => (store.ui.tool = 'select')}><Icon name="pointer" /></button>
      <!-- Simple mode: the Trim and Blade tools stay on their keys (T, B) -->
      {#if store.ui.advanced || store.ui.tool !== 'select'}
      <button class="icon ghost" class:on={store.ui.tool === 'trim'} role="radio" aria-checked={store.ui.tool === 'trim'} title="Trim tool  T: drag a cut to roll it (one clip gets longer, the next shorter), drag a clip to slip its footage" aria-label="Trim tool" onclick={() => (store.ui.tool = 'trim')}><Icon name="trim" /></button>
      <button class="icon ghost" class:on={store.ui.tool === 'blade'} role="radio" aria-checked={store.ui.tool === 'blade'} title="Blade tool  B: click a clip to cut it there" aria-label="Blade tool" onclick={() => (store.ui.tool = 'blade')}><Icon name="blade" /></button>
      {/if}
    </span>
    <button class="icon ghost" title="Add / remove a marker at the playhead  M" aria-label="Marker" onclick={edit.toggleMarker}><Icon name="marker" /></button>
    <button class="icon ghost" title="Freeze frame: hold the picture at the playhead for 2 s  Shift R" aria-label="Freeze frame" onclick={() => edit.freezeAtPlayhead()} disabled={!store.project.clips.length}><Icon name="freeze" /></button>
    <span class="tsep"></span>
    <button class="icon ghost" class:on={store.ui.snap} title="Snapping  N (hold Shift while dragging to ignore)" aria-label="Snapping" onclick={() => (store.ui.snap = !store.ui.snap)}><Icon name="magnet" /></button>
    <span class="grow"></span>
    {#if store.ui.inPoint !== null || store.ui.outPoint !== null}
      <button class="ghost small inout mono" title="In–Out range (loop and export). Click to clear  Alt X" onclick={() => (edit.markIn(null), edit.markOut(null))}>{tc(store.ui.inPoint ?? 0, fps)} → {tc(store.ui.outPoint ?? duration, fps)} ×</button>
    {/if}
    <span class="mono small faint dur">{tc(store.ui.time, fps)} / {tc(duration, fps)}</span>
    <button class="icon ghost" title="Zoom out  −" aria-label="Zoom out" onclick={() => edit.zoom(1 / 1.5)}><span class="zt">−</span></button>
    <button class="icon ghost" title="Zoom in  +  (Ctrl+wheel)" aria-label="Zoom in" onclick={() => edit.zoom(1.5)}><span class="zt">+</span></button>
    <button class="icon ghost" class:on={!store.ui.pxPerSec} title="Fit the whole timeline" aria-label="Zoom to fit" onclick={edit.zoomFit}><Icon name="fit" /></button>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tl tool-{store.ui.tool}" bind:this={scroller} bind:clientWidth={viewW} onwheel={onWheel} onpointerdowncapture={releaseFocus} onpointermove={bladeHover} onpointerleave={() => (bladeX = null)}>
    <div class="inner" class:narrow style="width:{G + W}px;--g:{G}px">
      <!-- ruler -->
      <div class="trow ruler-row">
        <div class="g g-ruler" title={store.status.busy ? `Rendering the mosh: ${store.status.stage || 'starting'}, ${Math.round(store.status.overall * 100)}% done${store.status.eta !== null ? `, about ${formatSeconds(store.status.eta)} left` : ''}` : undefined}>
          {#if store.status.busy}
            <span class="label busy mono">{Math.round(store.status.overall * 100)}%{store.status.eta !== null ? ` · ${formatSeconds(store.status.eta)}` : ''}</span>
          {:else}
            <span class="label">Timeline</span>
          {/if}
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane ruler" bind:this={rulerLane} style="width:{W}px" onpointerdown={rulerDown}>
          {#each ticks.out as s}
            <div class="tick" style="left:{x(s)}px"><span class="mono">{fmtTick(s)}</span></div>
          {/each}
          {#if store.status.busy}
            <!-- how far the mosh render has got, all its stages together -->
            <div class="rprog" style="width:{Math.max(0.5, store.status.overall * 100)}%" aria-hidden="true"></div>
          {/if}
          {#if beatInfo.grid && beatInfo.status === 'ready'}
            {@const down = new Set(beatInfo.downbeats.map((d) => Math.round(d * 1000)))}
            {@const gap = pps * (60 / Math.max(1, beatInfo.bpm))}
            {#each beatInfo.beats as b, i}
              {#if gap >= 4 || down.has(Math.round(b * 1000))}
                <div class="beat" class:down={down.has(Math.round(b * 1000))} style="left:{x(b)}px" title={i === 0 ? `${Math.round(beatInfo.bpm)} BPM` : undefined}></div>
              {/if}
            {/each}
          {/if}
          {#if store.ui.inPoint !== null || store.ui.outPoint !== null}
            {@const a = store.ui.inPoint ?? 0}
            {@const b = store.ui.outPoint ?? duration}
            <div class="inoutr" class:off={!store.ui.loopOn} style="left:{x(a)}px;width:{Math.max(1, x(b) - x(a))}px" title="In–Out range"></div>
          {/if}
          {#each markers as m (m.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="marker" style="left:{x(m.t)}px;--mc:{m.color}" title="{m.name || 'Marker'} · {tc(m.t, fps)}. Click to jump, drag to move, double-click to name, right-click to delete." onpointerdown={(e) => markerDown(e, m.id)} ondblclick={(e) => (e.stopPropagation(), (editingMarker = m.id))} oncontextmenu={(e) => markerMenu(e, m.id)}>
              {#if m.name}<span class="mname">{m.name}</span>{/if}
            </div>
            {#if editingMarker === m.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="medit" style="left:{x(m.t) + 6}px" autofocus value={m.name} placeholder="Marker name" aria-label="Marker name"
                onpointerdown={(e) => e.stopPropagation()}
                onkeydown={(e) => { e.stopPropagation(); const el = e.target as HTMLInputElement; if (e.key === 'Escape') el.value = m.name; if (e.key === 'Enter' || e.key === 'Escape') el.blur(); }}
                onblur={(e) => { const v = (e.target as HTMLInputElement).value; editingMarker = null; if (v !== m.name) store.edit(() => (m.name = v)); }} />
            {/if}
          {/each}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="phandle" style="left:{x(store.ui.time)}px" title="Playhead: drag to scrub" onpointerdown={playheadDown}></div>
        </div>
      </div>

      <!-- mosh effects -->
      <div class="trow">
        <button class="g g-head ghost" onclick={() => (fxOpen = !fxOpen)} title="Mosh effects placed on the timeline">
          <span class="caret" class:open={fxOpen}>▸</span>Mosh FX<span class="faint mono">{store.project.effects.length || ''}</span>
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane fxhead" style="width:{W}px" onpointerdown={scrubDown}>
          {#if !fxOpen}
            {#each store.project.effects as fx (fx.id)}
              <div class="mini" style="left:{xf(fx.start)}px;width:{Math.max(2, xf(fx.end) - xf(fx.start))}px;--c:{EFFECTS[fx.type]?.color}"></div>
            {/each}
          {/if}
          {#each placed.filter((p) => p.index > 0 && isMoshTransition(p.clip.transition)) as pl (pl.clip.id)}
            <div class="mini tr" style="left:{x(pl.start)}px;width:{Math.max(2, x(pl.clip.transition!.duration))}px" title="{transitionName(pl.clip.transition!.type)} (transition)"></div>
          {/each}
        </div>
      </div>
      {#if fxOpen}
        {#each store.project.effects as fx (fx.id)}
          {@const def = EFFECTS[fx.type]}
          <div class="trow">
            <button class="g fxname ghost" class:sel={store.ui.selectedEffect === fx.id} class:off={!fx.enabled} onclick={() => store.selectEffect(fx.id)}>
              <span class="code" style="--c:{def?.color}">{def?.icon}</span>
              <span class="fxlabel">{fx.name || def?.name}</span>
            </button>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="lane fx-lane" style="width:{W}px" onpointerdown={scrubDown}>
              <div
                class="bar"
                class:sel={store.ui.selectedEffect === fx.id}
                class:off={!fx.enabled}
                style="left:{xf(fx.start)}px;width:{Math.max(4, xf(fx.end) - xf(fx.start))}px;--c:{def?.color}"
                onpointerdown={(e) => fxDown(e, fx.id, 'move')}
                title="{def?.name}: frames {fx.start}–{fx.end}. Drag to move, drag edges to resize, hold Shift to disable snapping."
              >
                <div class="h l" onpointerdown={(e) => fxDown(e, fx.id, 'l')}></div>
                <span class="lbl"><span class="mono">{def?.icon}</span> {fx.name || def?.name}{#if Object.keys(fx.auto).length}<Icon name="curve" size={11} />{/if}</span>
                <div class="h r" onpointerdown={(e) => fxDown(e, fx.id, 'r')}></div>
              </div>
            </div>
          </div>
        {/each}
        <div class="trow">
          <button class="g add ghost" onclick={() => (store.ui.dialog = 'addEffect')} title="Add effect  A"><Icon name="plus" size={12} />Add effect</button>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane fx-lane empty" style="width:{W}px" onpointerdown={scrubDown}></div>
        </div>
      {/if}

      <!-- keyframes -->
      <div class="trow">
        <div class="g g-keys" title="Blue ticks: keyframes in the prepared video. Red diamonds: keyframes you forced (double-click the lane or press Shift K).">Keyframes</div>
        <canvas class="lane keys" bind:this={keyCanvas} style="width:{W}px" ondblclick={keysDbl} title="Double-click to add or remove a forced keyframe"></canvas>
      </div>

      <!-- titles -->
      {#if store.project.texts.length}
        <div class="trow">
          <div class="g g-track"><Icon name="text" size={12} /><span class="tname">Titles</span></div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane text-lane" style="width:{W}px" onpointerdown={scrubDown}>
            {#each store.project.texts as tx (tx.id)}
              <div class="clip text" data-clip={tx.id} class:sel={sel.has(tx.id)} style="left:{x(tx.start)}px;width:{Math.max(6, x(tx.duration))}px" onpointerdown={(e) => clipDown(e, tx.id, 't')} oncontextmenu={(e) => openMenu(e, tx.id, 't')} title={tx.text}>
                <div class="edge l" onpointerdown={(e) => edgeDown(e, tx.id, 't', 'l')}></div>
                <span class="cname">{tx.text || 'Text'}</span>{#if tx.moshed}<span class="badge">melts</span>{/if}
                <div class="edge r" onpointerdown={(e) => edgeDown(e, tx.id, 't', 'r')}></div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- upper video tracks (drawn over the main track) -->
      <div class="trow">
        <button class="g add ghost" onclick={() => edit.addVideoTrack()} title="Add a video track above. Clips there are drawn over the main track: picture-in-picture, overlays, blend modes."><Icon name="plus" size={12} />Video track</button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane newtrack vnew" style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => { const k = dragKind(e); if (k === 'media' || k === 'files') { e.preventDefault(); e.stopPropagation(); } }} ondrop={newVideoTrackDrop}>
          <span class="faint small">Drop video here for a new track on top</span>
        </div>
      </div>
      {#each upperTracks as tr (tr.id)}
        <div class="trow">
          <div class="g g-track video">
            <Icon name="film" size={12} /><span class="tname" title={tr.name}>{tr.name.replace('Video ', 'V')}</span>
            {@render trackButtons(tr.id)}
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane up-lane" class:muted={tr.muted} class:locked={tr.locked} data-track={tr.id} style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => laneOver(e, tr.id)} ondragleave={() => (hint = null)} ondrop={(e) => laneDrop(e, tr.id)}>
            {#each store.project.clips.filter((c) => c.track === tr.id) as c (c.id)}
              {@const m = mediaOf(store.project, c.mediaId)}
              {@const w = Math.max(4, x(clipLen(c)))}
              {@render vclip(c, m?.thumb, m?.source.name.replace(/\.[^.]+$/, '') ?? '', x(c.start), w, 'a')}
            {/each}
            {#if hint && hint.track === tr.id && hint.start !== undefined}
              <div class="insert" style="left:{x(hint.start)}px"></div>
            {/if}
            {#if drag?.k === 'move' && drag.kind === 'v' && drag.moved && drag.to === tr.id}
              {@const pl = placed.find((p) => drag?.k === 'move' && p.clip.id === drag.id)}
              {#if pl}<div class="ghostclip" style="left:{x(drag.toT ?? 0)}px;width:{Math.max(4, x(pl.end) - x(pl.start))}px"></div>{/if}
            {/if}
          </div>
        </div>
      {/each}

      <!-- video -->
      <div class="trow">
        <div class="g g-track video"><Icon name="film" size={12} /><span class="tname">{upperTracks.length ? 'V1' : 'Video'}</span>{#if mainTrack}{@render trackButtons(VIDEO_TRACK)}{/if}</div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane v-lane" class:muted={mainTrack?.muted} class:locked={mainTrack?.locked} data-track={VIDEO_TRACK} style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => laneOver(e, VIDEO_TRACK)} ondragleave={() => (hint = null)} ondrop={(e) => laneDrop(e, VIDEO_TRACK)}>
          {#if !placed.length}
            <div class="lane-empty">Drag clips here from the Media panel</div>
          {/if}
          {#each placed as pl (pl.clip.id)}
            {@const c = pl.clip}
            {@const moving = drag?.k === 'move' && drag.id === c.id && drag.moved}
            {@render vclip(c, pl.media.thumb, vName(pl), x(pl.start), Math.max(4, x(pl.end) - x(pl.start)), 'v', moving)}
            {#if moving && drag?.k === 'move' && !drag.to}
              <div class="ghostclip" style="left:{x(pl.start) + drag.dx}px;width:{Math.max(4, x(pl.end) - x(pl.start))}px"></div>
            {/if}
          {/each}
          {#each placed as pl (pl.clip.id)}
            {#if pl.index > 0}
              {@const t = pl.clip.transition}
              {@const selT = store.ui.selectedTransition === pl.clip.id}
              {#if t && (isBlend(t) || isMoshTransition(t))}
                <div
                  class="trans"
                  class:mosh={isMoshTransition(t)}
                  class:sel={selT}
                  style="left:{x(pl.start)}px;width:{Math.max(10, x(isBlend(t) ? pl.overlap : t.duration))}px"
                  onpointerdown={(e) => transDown(e, pl.clip.id)}
                  title="{transitionName(t.type)} · {t.duration}s. Click to edit, drag to change length."
                  role="button"
                  tabindex="-1"
                >
                  <span>{transitionName(t.type)}</span>
                </div>
              {:else}
                <button class="cutmark" class:sel={selT} style="left:{x(pl.start)}px" title="Add a transition here" aria-label="Transition" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => (e.stopPropagation(), store.selectTransition(pl.clip.id))}>+</button>
              {/if}
            {/if}
          {/each}
          {#if drag?.k === 'move' && drag.kind === 'v' && drag.moved && drag.insert !== undefined}
            {@const pos = drag.insert >= placed.length ? (placed.at(-1)?.end ?? 0) : placed[drag.insert].start}
            <div class="insert" style="left:{x(pos)}px"></div>
          {/if}
          {#if hint && hint.track === VIDEO_TRACK && hint.index !== undefined}
            {@const pos = hint.index >= placed.length ? (placed.at(-1)?.end ?? 0) : placed[hint.index].start}
            <div class="insert" style="left:{x(pos)}px"></div>
          {/if}
          {#if hint?.cut !== undefined && placed[hint.cut]}
            <div class="insert trhint" style="left:{x(placed[hint.cut].start)}px"></div>
          {/if}
        </div>
      </div>

      <!-- clip audio (sound of the video clips) -->
      {#if clipAudioTrack}
        <div class="trow">
          <div class="g g-track" title="The sound of the video clips">
            <Icon name="sound" size={12} /><span class="tname">Clip audio</span>
            {@render trackButtons(clipAudioTrack.id)}
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane a0-lane" class:muted={clipAudioTrack.muted} data-track={CLIP_AUDIO} style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => laneOver(e, VIDEO_TRACK)} ondragleave={() => (hint = null)} ondrop={(e) => laneDrop(e, VIDEO_TRACK)}>
            {#each placed as pl (pl.clip.id)}
              {#if pl.media.hasAudio}
                {@const c = pl.clip}
                {@const w = Math.max(4, x(pl.end) - x(pl.start))}
                <div class="clip audio linked" class:sel={sel.has(c.id)} class:muted={c.muted} class:off={!clipOn(c)} style="left:{x(pl.start)}px;width:{w}px" onpointerdown={(e) => clipDown(e, c.id, 'v')} oncontextmenu={(e) => openMenu(e, c.id, 'v')} title={c.muted ? 'Muted (or detached)' : 'Clip sound'}>
                  <Waveform peaks={peaksOf(pl.media.id)} from={c.in} to={c.out} reverse={c.reverse} width={w} height={26} />
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- audio tracks -->
      {#each audioTracks as tr (tr.id)}
        <div class="trow">
          <div class="g g-track">
            <Icon name="music" size={12} /><span class="tname" title={tr.name}>{tr.name}</span>
            {@render trackButtons(tr.id)}
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane a-lane" class:muted={tr.muted} class:locked={tr.locked} data-track={tr.id} style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => laneOver(e, tr.id)} ondragleave={() => (hint = null)} ondrop={(e) => laneDrop(e, tr.id)}>
            {#each store.project.clips.filter((c) => c.track === tr.id) as c (c.id)}
              {@const m = mediaOf(store.project, c.mediaId)}
              {@const w = Math.max(4, x(clipLen(c)))}
              <div class="clip audio" data-clip={c.id} class:sel={sel.has(c.id)} class:muted={c.muted} class:off={!clipOn(c)} class:labeled={!!c.label} style="left:{x(c.start)}px;width:{w}px;{c.label ? `--lab:${c.label}` : ''}" onpointerdown={(e) => clipDown(e, c.id, 'a')} oncontextmenu={(e) => openMenu(e, c.id, 'a')} title="{m?.source.name} · {fmtDur(clipLen(c))}">
                <Waveform peaks={m ? peaksOf(m.id) : undefined} from={c.in} to={c.out} reverse={c.reverse} width={w} height={34} />
                <span class="cname">{m?.source.name.replace(/\.[^.]+$/, '')}</span>
                {#if c.fadeIn > 0}<div class="fadeshape in" style="width:{x(c.fadeIn)}px"></div>{/if}
                {#if c.fadeOut > 0}<div class="fadeshape out" style="width:{x(c.fadeOut)}px"></div>{/if}
                <div class="fade in" style="left:{x(c.fadeIn)}px" onpointerdown={(e) => fadeDown(e, c, 'in')} title="Drag to fade in"></div>
                <div class="fade out" style="right:{x(c.fadeOut)}px" onpointerdown={(e) => fadeDown(e, c, 'out')} title="Drag to fade out"></div>
                <div class="edge l" onpointerdown={(e) => edgeDown(e, c.id, 'a', 'l')}></div>
                <div class="edge r" onpointerdown={(e) => edgeDown(e, c.id, 'a', 'r')}></div>
              </div>
            {/each}
            {#if hint && hint.track === tr.id && hint.start !== undefined}
              <div class="insert" style="left:{x(hint.start)}px"></div>
            {/if}
          </div>
        </div>
      {/each}
      <div class="trow">
        <button class="g add ghost" onclick={() => edit.addAudioTrack()} title="Add an audio track (music, voice-over…)"><Icon name="plus" size={12} />Audio track</button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane newtrack" style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => { const k = dragKind(e); if (k === 'media' || k === 'files') { e.preventDefault(); e.stopPropagation(); } }} ondrop={newTrackDrop}>
          <span class="faint small">Drop sound here for a new track</span>
        </div>
      </div>

      <!-- result -->
      <div class="trow out-row">
        <div class="g g-out" title="Output frames after moshing. Blue: keyframe. Grey: motion. Amber: repeated. Yellow: glitched. Teal: moved. Green: transferred. Click to view the mosh.">
          Output{#if store.render && !fresh}<span class="stale" title="Changed since the last render">●</span>{/if}
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane out" class:stale={!fresh} style="width:{W}px">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="outstrip" style="width:{outW}px" onpointerdown={outDown}>
            <canvas bind:this={resultCanvas} style="width:{Math.min(outW, 16000)}px;transform:scaleX({outW / Math.min(outW, 16000)})"></canvas>
            {#if (store.ui.inPoint !== null || store.ui.outPoint !== null) && nOut}
              <div class="loop" class:inactive={!store.ui.loopOn} style="left:{x(store.ui.inPoint ?? 0)}px;width:{x((store.ui.outPoint ?? duration) - (store.ui.inPoint ?? 0))}px"></div>
            {/if}
            {#if nOut}<div class="phead out-ph" style="left:{outX}px"></div>{/if}
          </div>
        </div>
      </div>

      <div class="phead main" style="left:{G + x(store.ui.time)}px"></div>
      {#if store.ui.tool === 'blade' && bladeX !== null}
        <div class="bladeline" style="left:{G + bladeX}px"></div>
      {/if}
    </div>
  </div>
</div>

{#snippet trackButtons(id: string)}
  {@const t = store.project.tracks.find((x) => x.id === id)}
  {#if t}
    <span class="tbtns">
      {#if t.kind === 'video'}
        <button class="tb" class:on={t.muted} title={t.muted ? 'Hidden: click to show this track' : 'Hide this track (it is left out of the picture)'} aria-label="Show / hide track" onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.muted = !t.muted))}><Icon name={t.muted ? 'eyeoff' : 'eye'} size={11} /></button>
      {:else}
        <button class="tb" class:on={t.muted} title="Mute" aria-label="Mute {t.name}" aria-pressed={!!t.muted} onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.muted = !t.muted))}>M</button>
        <button class="tb" class:on={t.solo} title="Solo" aria-label="Solo {t.name}" aria-pressed={!!t.solo} onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.solo = !t.solo))}>S</button>
        <button class="tb mosh" class:on={t.mosh} aria-label="Sound follows the mosh" aria-pressed={!!t.mosh} title={t.mosh ? 'Sound follows the mosh (stutters with the picture). Click to keep it clean.' : 'Sound stays clean. Click to make it follow the mosh.'} onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.mosh = !t.mosh))}>~</button>
      {/if}
      <button class="tb" class:on={t.locked} title={t.locked ? 'Locked: click to unlock' : 'Lock the track so its clips can\'t be changed by accident'} aria-label="Lock track" onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.locked = !t.locked || undefined))}><Icon name={t.locked ? 'lock' : 'unlock'} size={10} /></button>
      {#if id !== CLIP_AUDIO && id !== VIDEO_TRACK}<button class="tb rm" title="Remove track" aria-label="Remove {t.name}" onclick={() => edit.removeTrack(id)}>×</button>{/if}
    </span>
  {/if}
{/snippet}

{#snippet vclip(c: Clip, thumb: string | undefined, name: string, left: number, w: number, kind: 'v' | 'a', moving = false)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="clip video"
    data-clip={c.id}
    class:sel={sel.has(c.id)}
    class:moving
    class:off={!clipOn(c)}
    class:labeled={!!c.label}
    style="left:{left}px;width:{w}px;{thumb ? `--thumb:url(${thumb});` : ''}{c.label ? `--lab:${c.label};` : ''}"
    onpointerdown={(e) => clipDown(e, c.id, kind)}
    oncontextmenu={(e) => openMenu(e, c.id, kind)}
    ondblclick={() => compoundOf(mediaOf(store.project, c.mediaId)) && openCompound(c.mediaId)}
    title="{name} · {fmtDur(clipLen(c))}{clipOn(c) ? '' : ' · off (D to turn on)'}{compoundOf(mediaOf(store.project, c.mediaId)) ? ' · compound: double-click to edit inside' : ''}"
  >
    <div class="edge l" onpointerdown={(e) => edgeDown(e, c.id, kind, 'l')}></div>
    <span class="cname">{name}</span>
    {#if compoundOf(mediaOf(store.project, c.mediaId))}<span class="badge cmp">compound</span>{/if}
    {#if c.freeze}<span class="badge">freeze</span>{:else if c.ramp?.length}<span class="badge">ramp</span>{:else if c.speed !== 1}<span class="badge">{c.speed}×</span>{/if}
    {#if c.key}<span class="badge">key</span>{/if}
    {#if c.grade?.lut}<span class="badge">LUT</span>{/if}
    {#each [...new Set(Object.values(c.keys ?? {}).flatMap((pts) => (pts ?? []).map(([t]) => t)))] as kt}
      <span class="kdot" style="left:{x(kt)}px" title="Keyframe at {kt.toFixed(2)} s"></span>
    {/each}
    {#if c.reverse && !c.freeze}<span class="badge">rev</span>{/if}
    {#if c.blend && c.blend !== 'normal'}<span class="badge">{c.blend}</span>{/if}
    {#if (c.opacity ?? 1) < 1}<span class="badge">{Math.round((c.opacity ?? 1) * 100)}%</span>{/if}
    {#if (c.vfadeIn ?? 0) > 0}<div class="vfadeshape in" style="width:{x(c.vfadeIn ?? 0)}px"></div>{/if}
    {#if (c.vfadeOut ?? 0) > 0}<div class="vfadeshape out" style="width:{x(c.vfadeOut ?? 0)}px"></div>{/if}
    <div class="fade" style="left:{x(c.vfadeIn ?? 0)}px" onpointerdown={(e) => vfadeDown(e, c, 'in')} title="Drag to fade the picture in"></div>
    <div class="fade out" style="right:{x(c.vfadeOut ?? 0)}px" onpointerdown={(e) => vfadeDown(e, c, 'out')} title="Drag to fade the picture out"></div>
    <div class="edge r" onpointerdown={(e) => edgeDown(e, c.id, kind, 'r')}></div>
  </div>
{/snippet}

{#if menu}
  <div class="menu" style="left:{menu.x}px;top:{menu.y}px" role="menu">
    <button class="ghost" onclick={edit.splitAtPlayhead}><Icon name="blade" />Split at playhead<span class="kbd">S</span></button>
    <button class="ghost" onclick={edit.duplicateSelected}><Icon name="copy" />Duplicate<span class="kbd">Ctrl D</span></button>
    <button class="ghost" onclick={edit.copySelected}><Icon name="copy" />Copy<span class="kbd">Ctrl C</span></button>
    {#if menuClip}
      <button class="ghost" onclick={() => edit.toggleEnabled()}><Icon name={clipOn(menuClip) ? 'eyeoff' : 'eye'} />{clipOn(menuClip) ? 'Turn clip off' : 'Turn clip on'}<span class="kbd">D</span></button>
      {#if !menuClip.freeze}
        <button class="ghost" onclick={() => store.edit(() => (menuClip.reverse = !menuClip.reverse))}><Icon name="reset" />{menuClip.reverse ? 'Play forwards' : 'Reverse'}</button>
      {/if}
      {#if mediaOf(store.project, menuClip.mediaId)?.hasVideo && !menuClip.freeze && (menuClip.track === VIDEO_TRACK || isOverlayTrack(menuClip.track))}
        <button class="ghost" onclick={() => edit.freezeAtPlayhead()}><Icon name="freeze" />Freeze frame at playhead<span class="kbd">Shift R</span></button>
      {/if}
      {#if (menuClip.track === VIDEO_TRACK || isOverlayTrack(menuClip.track)) && mediaOf(store.project, menuClip.mediaId)?.hasAudio && !menuClip.freeze}
        <button class="ghost" onclick={() => store.edit(() => (menuClip.muted = !menuClip.muted))}><Icon name={menuClip.muted ? 'sound' : 'mute'} />{menuClip.muted ? 'Unmute sound' : 'Mute sound'}</button>
        {#if !menuClip.muted}<button class="ghost" onclick={() => edit.detach(menuClip.id)}><Icon name="music" />Detach audio</button>{/if}
      {/if}
      {#if menuClip.track === VIDEO_TRACK && placed[0]?.clip.id !== menuClip.id}
        <button class="ghost" onclick={() => (edit.setTransition(menuClip.id, 'melt'), store.selectTransition(menuClip.id))}><Icon name="split" />Melt into this clip</button>
        <button class="ghost" onclick={() => (edit.setTransition(menuClip.id, 'dissolve'), store.selectTransition(menuClip.id))}><Icon name="split" />Dissolve into this clip</button>
      {/if}
      {#if compoundOf(mediaOf(store.project, menuClip.mediaId))}
        <button class="ghost" onclick={() => openCompound(menuClip.mediaId)}><Icon name="folder" />Edit inside the compound</button>
      {:else if menuClip.track === VIDEO_TRACK}
        {#if store.ui.advanced}<button class="ghost" onclick={() => makeCompound()} title="Fold the selected main-track clips (first to last) into one clip with its own timeline"><Icon name="folder" />Make compound clip{store.ui.selectedClips.length > 1 ? ` (${store.ui.selectedClips.length})` : ''}</button>{/if}
      {/if}
      <button class="ghost" onclick={() => edit.markClip()}><Icon name="loop" />Mark In / Out on this clip<span class="kbd">X</span></button>
      <div class="labels" role="group" aria-label="Clip colour">
        {#each CLIP_LABELS as col}
          <button class="lab" style="--lc:{col}" class:on={menuClip.label === col} title="Colour label" aria-label="Colour label {col}" onclick={() => edit.setLabel(col)}></button>
        {/each}
        <button class="lab none" title="No colour" aria-label="No colour" onclick={() => edit.setLabel(null)}>×</button>
      </div>
    {/if}
    <hr />
    <button class="ghost danger" onclick={() => edit.deleteSelected()}><Icon name="trash" />Delete<span class="kbd">Del</span></button>
    <button class="ghost danger" onclick={() => edit.deleteSelected(true)}><Icon name="trash" />Ripple delete<span class="kbd">Shift Del</span></button>
  </div>
{/if}

<style>
  .kdot {
    position: absolute;
    bottom: 2px;
    width: 6px;
    height: 6px;
    margin-left: -3px;
    background: var(--accent);
    transform: rotate(45deg);
    pointer-events: none;
  }
  .badge.cmp {
    background: var(--accent);
    color: #000;
  }
  .wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 6px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .toolbar button {
    height: 26px;
    padding: 0 8px;
    gap: 5px;
    font-size: 12px;
  }
  .toolbar .icon {
    width: 28px;
    padding: 0;
  }
  .toolbar.narrow {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .toolbar.narrow .tlbl,
  .toolbar.narrow .dur,
  .toolbar.compact .tlbl {
    display: none;
  }
  .toolbar.narrow button {
    padding: 0 9px;
    flex: none;
  }
  .toolbar .on {
    color: var(--accent);
  }
  .tsep {
    width: 1px;
    height: 16px;
    background: var(--line-2);
    margin: 0 4px;
  }
  .dur {
    margin-right: 8px;
    white-space: nowrap;
  }
  .zt {
    font: 15px var(--mono);
    line-height: 1;
  }
  .tl {
    flex: 1;
    overflow: auto;
    position: relative;
    min-height: 0;
    background: var(--bg);
    overscroll-behavior: contain;
  }
  .inner {
    position: relative;
  }
  /* (not ".row": the global .row style adds a gap and centring that misalign the lanes) */
  .trow {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--line);
  }
  .g {
    width: var(--g);
    flex: none;
    position: sticky;
    left: 0;
    z-index: 4;
    background: var(--surface);
    border-right: 1px solid var(--line);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    min-height: 20px;
  }
  button.g {
    height: auto;
    border: none;
    border-right: 1px solid var(--line);
    border-radius: 0;
    justify-content: flex-start;
    background: var(--surface);
  }
  .lane {
    position: relative;
    flex: none;
    /* nothing may stick out past the end of the timeline (it would make the view scroll) */
    overflow: hidden;
  }
  .ruler-row {
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .ruler-row .g {
    z-index: 6;
  }
  .rprog {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
    transition: width 0.3s linear;
  }
  .g-ruler .label.busy {
    color: var(--accent);
    font-size: 10.5px;
    white-space: nowrap;
  }
  .ruler {
    height: 22px;
    cursor: ew-resize;
    touch-action: none;
    background: var(--surface);
  }
  .tick {
    position: absolute;
    top: 11px;
    bottom: 0;
    border-left: 1px solid var(--line-2);
    padding-left: 3px;
    font-size: 10px;
    color: var(--text-3);
    pointer-events: none;
  }
  .tick span {
    position: relative;
    top: -10px;
  }
  .beat {
    position: absolute;
    bottom: 0;
    height: 5px;
    border-left: 1px solid var(--accent);
    opacity: 0.55;
    pointer-events: none;
  }
  .beat.down {
    height: 9px;
    opacity: 0.95;
  }
  .g-head {
    color: var(--text-2);
  }
  .caret {
    display: inline-block;
    transition: transform 0.1s;
    font-size: 10px;
    color: var(--text-3);
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .fxhead {
    height: 20px;
  }
  .mini {
    position: absolute;
    top: 7px;
    height: 6px;
    background: var(--c);
    opacity: 0.8;
  }
  .mini.tr {
    background: var(--accent);
  }
  .fxname {
    height: 22px;
    color: var(--text);
  }
  .fxname.sel {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .fxname.off {
    opacity: 0.4;
  }
  .fxlabel {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .add {
    height: 22px;
    color: var(--text-3);
  }
  .fx-lane {
    height: 22px;
  }
  .bar {
    position: absolute;
    top: 3px;
    bottom: 3px;
    background: color-mix(in srgb, var(--c) 22%, var(--surface-2));
    border-left: 2px solid var(--c);
    cursor: grab;
    display: flex;
    align-items: center;
    overflow: hidden;
    touch-action: pan-x pan-y;
    user-select: none;
  }
  .bar.sel {
    outline: 1px solid var(--text);
    outline-offset: -1px;
  }
  .bar.off {
    opacity: 0.3;
    filter: grayscale(1);
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
  .g-keys {
    font-size: 11px;
    color: var(--text-3);
    min-height: 14px;
    height: 14px;
  }
  .keys {
    height: 14px;
    display: block;
    cursor: copy;
  }
  .g-track {
    min-height: 0;
  }
  .tname {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .narrow .tname,
  .narrow .tb.rm,
  .narrow .fxlabel {
    display: none;
  }
  .narrow .g {
    padding: 0 5px;
    gap: 3px;
  }
  .tbtns {
    display: flex;
    gap: 1px;
    margin-left: auto;
  }
  .tb {
    width: 17px;
    height: 17px;
    padding: 0;
    font: 10px var(--mono);
    border-radius: 2px;
    color: var(--text-3);
    background: transparent;
    border: 1px solid var(--line-2);
  }
  .tb.on {
    color: var(--accent-ink);
    background: var(--warn);
    border-color: var(--warn);
  }
  .tb.mosh.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .v-lane {
    height: 52px;
  }
  .a0-lane {
    height: 32px;
  }
  .a-lane {
    height: 42px;
  }
  .text-lane {
    height: 26px;
  }
  .lane.muted {
    opacity: 0.45;
  }
  .lane-empty {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-3);
    font-size: 12px;
    pointer-events: none;
  }
  .clip {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border: 1px solid var(--line-2);
    border-radius: 3px;
    overflow: hidden;
    cursor: grab;
    touch-action: pan-x pan-y;
    -webkit-touch-callout: none;
    user-select: none;
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .clip.video {
    background: var(--surface-3) var(--thumb, none) left center / auto 100% repeat-x;
  }
  .clip.audio {
    background: color-mix(in srgb, #4fa06a 26%, var(--surface-2));
    border-color: color-mix(in srgb, #4fa06a 50%, var(--line-2));
    color: #7fd39b;
  }
  .clip.audio.linked {
    background: color-mix(in srgb, #4f86a0 22%, var(--surface-2));
    border-color: color-mix(in srgb, #4f86a0 45%, var(--line-2));
    color: #8fc3dd;
  }
  .clip.audio.muted {
    opacity: 0.35;
  }
  .clip.audio :global(canvas) {
    position: absolute;
    left: 0;
    top: 3px;
  }
  .clip.text {
    background: color-mix(in srgb, #b98ad8 24%, var(--surface-2));
    border-color: color-mix(in srgb, #b98ad8 50%, var(--line-2));
    align-items: center;
  }
  .clip.sel {
    border-color: var(--text);
    box-shadow: inset 0 0 0 1px var(--text);
  }
  .clip.moving {
    opacity: 0.35;
  }
  .ghostclip {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border: 1px dashed var(--text);
    border-radius: 3px;
    pointer-events: none;
    z-index: 3;
  }
  .cname {
    font-size: 11px;
    color: #eee;
    background: rgba(0, 0, 0, 0.6);
    padding: 0 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    position: relative;
    z-index: 1;
    max-width: 100%;
  }
  .clip.text .cname {
    background: none;
    color: var(--text);
  }
  .badge {
    font: 10px var(--mono);
    background: rgba(0, 0, 0, 0.6);
    color: var(--warn);
    padding: 0 3px;
    pointer-events: none;
    position: relative;
    z-index: 1;
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: ew-resize;
    z-index: 2;
    touch-action: none;
  }
  .h,
  .fade,
  .trans {
    touch-action: none;
  }
  @media (pointer: coarse) {
    .edge {
      width: 14px;
    }
    .clip.sel .edge {
      background: rgba(255, 255, 255, 0.28);
    }
    .h {
      width: 14px;
    }
    .fade {
      width: 16px;
      height: 16px;
      margin-left: -8px;
      opacity: 0.85;
    }
    .fade.out {
      margin-right: -8px;
    }
    .cutmark {
      opacity: 1;
      width: 24px;
      height: 24px;
      margin-left: -12px;
      top: 14px;
    }
  }
  .edge:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  .edge.l {
    left: 0;
  }
  .edge.r {
    right: 0;
  }
  .fade {
    position: absolute;
    top: 0;
    width: 9px;
    height: 9px;
    margin-left: -4px;
    background: var(--text);
    border-radius: 50%;
    opacity: 0;
    cursor: ew-resize;
    z-index: 3;
  }
  .fade.out {
    margin-left: 0;
    margin-right: -4px;
  }
  .clip:hover .fade,
  .clip.sel .fade {
    opacity: 0.85;
  }
  .fadeshape {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.45);
  }
  .fadeshape.in {
    left: 0;
    clip-path: polygon(0 0, 0 100%, 100% 0);
  }
  .fadeshape.out {
    right: 0;
    clip-path: polygon(0 0, 100% 100%, 100% 0);
  }
  .trans {
    position: absolute;
    top: 26px;
    height: 20px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.55);
    border-radius: 3px;
    z-index: 2;
    cursor: ew-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
  }
  .trans.mosh {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    border-color: var(--accent);
  }
  .trans.sel {
    box-shadow: 0 0 0 2px var(--text);
  }
  .trans span {
    font-size: 10px;
    color: #fff;
    white-space: nowrap;
    text-shadow: 0 1px 2px #000;
    pointer-events: none;
  }
  .cutmark {
    position: absolute;
    top: 17px;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    padding: 0;
    border-radius: 50%;
    font: 13px/1 var(--mono);
    z-index: 2;
    opacity: 0;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
  }
  .v-lane:hover .cutmark,
  .cutmark.sel {
    opacity: 1;
  }
  /* touch screens (tablets get this timeline) have no hover to reveal them */
  @media (hover: none) {
    .cutmark {
      opacity: 1;
    }
  }
  .cutmark.sel {
    border-color: var(--accent);
    color: var(--accent);
  }
  .insert {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--warn);
    z-index: 4;
    pointer-events: none;
  }
  .insert.trhint {
    background: var(--accent);
    width: 4px;
    margin-left: -2px;
  }
  .newtrack {
    height: 26px;
    display: flex;
    align-items: center;
    padding-left: 12px;
  }
  .out-row {
    border-bottom: none;
  }
  .g-out {
    min-height: 28px;
  }
  .stale {
    color: var(--warn);
    margin-left: 4px;
    font-size: 9px;
  }
  .lane.out {
    height: 28px;
    background: var(--surface);
  }
  .lane.out.stale {
    opacity: 0.5;
  }
  .outstrip {
    position: relative;
    height: 100%;
    cursor: ew-resize;
  }
  .outstrip canvas {
    display: block;
    height: 22px;
    margin-top: 3px;
    transform-origin: left;
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
    width: 1px;
    background: var(--accent);
    pointer-events: none;
    z-index: 3;
  }
  .phead.main {
    top: 0;
    bottom: 29px;
  }
  .phead.main::before {
    content: '';
    position: absolute;
    top: 0;
    left: -4px;
    border: 4.5px solid transparent;
    border-top: 6px solid var(--accent);
  }
  .out-ph {
    top: 0;
    bottom: 0;
  }
  .menu {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    padding: 4px;
    min-width: 210px;
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    box-shadow: var(--shadow);
  }
  .menu button {
    justify-content: flex-start;
    color: var(--text);
    height: 27px;
    gap: 8px;
  }
  .menu .kbd {
    margin-left: auto;
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--line-2);
    width: 100%;
    margin: 4px 0;
  }
  .menu .danger {
    color: var(--danger);
  }
  @media (max-width: 860px), (max-height: 500px) and (pointer: coarse) {
    .toolbar button:not(.icon) {
      padding: 0 6px;
    }
  }
  .tools {
    display: inline-flex;
    gap: 1px;
  }
  .inout {
    color: var(--ok);
    font-size: 11px;
    margin-right: 6px;
  }
  .tool-blade .lane:not(.ruler),
  .tool-blade .clip {
    cursor: crosshair;
  }
  .tool-trim .clip {
    cursor: col-resize;
  }
  .bladeline {
    position: absolute;
    top: 22px;
    bottom: 29px;
    width: 1px;
    background: var(--danger, #e05a4f);
    pointer-events: none;
    z-index: 3;
  }
  .marquee {
    position: fixed;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
    z-index: 40;
  }
  .phandle {
    position: absolute;
    top: 0;
    width: 13px;
    height: 22px;
    margin-left: -6px;
    cursor: ew-resize;
    z-index: 4;
    touch-action: none;
  }
  .phandle::before {
    content: '';
    position: absolute;
    left: 1px;
    top: 0;
    width: 11px;
    height: 12px;
    background: var(--accent);
    clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
  }
  .inoutr {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    border-left: 2px solid var(--ok);
    border-right: 2px solid var(--ok);
    pointer-events: none;
  }
  .inoutr.off {
    opacity: 0.4;
  }
  .marker {
    position: absolute;
    top: 0;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    background: var(--mc);
    clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
    cursor: pointer;
    z-index: 3;
    touch-action: none;
  }
  .mname {
    position: absolute;
    left: 12px;
    top: -1px;
    font-size: 10px;
    color: var(--mc);
    white-space: nowrap;
    pointer-events: none;
  }
  .marker:has(.mname) {
    overflow: visible;
    clip-path: none;
    background: none;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 9px solid var(--mc);
    width: 0;
    height: 0;
  }
  .medit {
    position: absolute;
    top: 1px;
    height: 19px;
    width: 140px;
    font-size: 11px;
    z-index: 6;
  }
  .up-lane {
    height: 46px;
  }
  .lane.locked {
    background-image: repeating-linear-gradient(135deg, transparent 0 8px, rgba(255, 255, 255, 0.035) 8px 16px);
  }
  .lane.locked .clip {
    cursor: not-allowed;
  }
  .clip.off {
    opacity: 0.38;
    filter: grayscale(1);
  }
  .clip.labeled {
    box-shadow: inset 0 3px 0 var(--lab);
  }
  .vfadeshape {
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    background: linear-gradient(to right, rgba(0, 0, 0, 0.55), transparent);
  }
  .vfadeshape.in {
    left: 0;
  }
  .vfadeshape.out {
    right: 0;
    background: linear-gradient(to left, rgba(0, 0, 0, 0.55), transparent);
  }
  .vnew {
    height: 18px;
  }
  .labels {
    display: flex;
    gap: 4px;
    padding: 6px 8px 2px;
  }
  .lab {
    width: 16px;
    height: 16px;
    min-width: 0;
    padding: 0;
    border-radius: 50%;
    background: var(--lc);
    border: 1px solid var(--line-2);
  }
  .lab.on {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .lab.none {
    background: none;
    font-size: 11px;
    line-height: 1;
    color: var(--text-3);
  }
</style>
