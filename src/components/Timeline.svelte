<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { layoutVideo, clipLen, nearestCut, mediaOf, transitionName, isBlend, isMoshTransition, remapToFootage, trimClip, moveVideo, type Placed } from '../engine/timeline';
  import { VIDEO_TRACK, CLIP_AUDIO, type Clip, type Project, type TextClip, type TransitionType } from '../engine/types';
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

  // ---------------------------------------------------------------- snapping
  function snapTargets(exclude: string | null): number[] {
    const t: number[] = [0, store.ui.time, duration];
    for (const pl of placed) if (pl.clip.id !== exclude) t.push(pl.start, pl.end);
    for (const c of store.project.clips) if (c.track !== VIDEO_TRACK && c.id !== exclude) t.push(c.start, c.start + clipLen(c));
    for (const tx of store.project.texts) if (tx.id !== exclude) t.push(tx.start, tx.start + tx.duration);
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
    | { k: 'move'; id: string; kind: 'v' | 'a' | 't'; x0: number; dx: number; moved: boolean; orig: Clip | TextClip; before: Project; grab: number; insert?: number; targets: number[] }
    | { k: 'trim'; id: string; kind: 'v' | 'a' | 't'; edge: 'l' | 'r'; x0: number; orig: Clip | TextClip; before: Project; targets: number[] }
    | { k: 'fade'; id: string; edge: 'in' | 'out'; x0: number; orig: Clip }
    | { k: 'fx'; id: string; mode: 'move' | 'l' | 'r'; x0: number; s0: number; e0: number }
    | { k: 'trans'; id: string; x0: number; d0: number; before: Project };
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

  function scrubDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // on touch, lanes scroll; a tap seeks
    if (touchGate(e, () => {}, () => ((store.ui.playing = false), store.seek(laneT(e))))) return;
    store.ui.playing = false;
    drag = { k: 'scrub' };
    store.seek(snapT(laneT(e), e, null));
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

  function edgeDown(e: PointerEvent, id: string, kind: 'v' | 'a' | 't', edge: 'l' | 'r') {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.selectClip(id);
    const orig = kind === 't' ? store.project.texts.find((t) => t.id === id)! : store.project.clips.find((c) => c.id === id)!;
    drag = { k: 'trim', id, kind, edge, x0: e.clientX, orig: clone(orig), before: clone($state.snapshot(store.project)) as Project, targets: snapTargets(id) };
  }

  function fadeDown(e: PointerEvent, c: Clip, edge: 'in' | 'out') {
    e.stopPropagation();
    store.selectClip(c.id);
    drag = { k: 'fade', id: c.id, edge, x0: e.clientX, orig: clone(c) };
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
    const cands = [0, totalF, Math.round(store.ui.time * fps), ...store.cuts, ...store.project.encoder.keyMarkers, ...store.project.effects.flatMap((e) => (e.id === id ? [] : [e.start, e.end]))];
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
    if (d.k === 'scrub') return store.seek(snapT(laneT(e), e, null));
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
      if (d.kind === 'v') {
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
      let s = Math.max(0, t - d.grab);
      const s2 = snapT(s, e, d.id, d.targets);
      s = s2 !== s ? s2 : snapT(s + len, e, d.id, d.targets) - len;
      c.start = Math.max(0, s);
      const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track]') as HTMLElement | null;
      const tr = lane?.dataset.track;
      if (tr && tr !== VIDEO_TRACK && tr !== CLIP_AUDIO) c.track = tr;
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
    if (d.k === 'fx') return store.commit('fx-' + d.id + Math.random());
    if (d.k === 'trans' || d.k === 'fade') {
      if (d.k === 'trans') remapToFootage(d.before, store.project);
      return store.commit(d.k + d.id + Math.random());
    }
    if (d.k === 'move' && d.kind === 'v') {
      if (d.moved && d.insert !== undefined) store.editTimeline((p) => moveVideo(p, d.id, d.insert!));
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
    menu = { x: Math.max(4, Math.min(x, window.innerWidth - 220)), y: Math.max(4, Math.min(y, window.innerHeight - 330)), id, kind };
  }
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
    const pick = (ev: PointerEvent) => {
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      store.seekFrame(Math.floor(((ev.clientX - r.left) / outW) * nOut));
    };
    store.ui.playing = false;
    store.ui.view = 'mosh';
    pick(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const el = e.currentTarget as HTMLElement;
    const mv = (ev: PointerEvent) => pick(Object.assign(ev, { currentTarget: el }) as PointerEvent);
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', () => el.removeEventListener('pointermove', mv), { once: true });
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const t = laneT(e);
      const before = (e.clientX - (rulerLane?.getBoundingClientRect().left ?? 0));
      edit.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
      requestAnimationFrame(() => (scroller.scrollLeft += t * pps - before));
    }
  }

  // keep the playhead in view while playing
  $effect(() => {
    if (!scroller || !store.ui.playing) return;
    const px = x(store.ui.time);
    const visL = scroller.scrollLeft;
    const visW = scroller.clientWidth - G;
    if (px < visL || px > visL + visW - 30) scroller.scrollLeft = px - 40;
  });

  const outX = $derived(nOut ? (store.ui.playhead / nOut) * outW : 0);
  const peaksOf = (id: string) => mediaState[id]?.peaks;
  const vName = (pl: Placed) => pl.media.source.name.replace(/\.[^.]+$/, '');
  const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`);
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} onclick={closeMenu} />

<div class="wrap">
  <div class="toolbar" class:narrow>
    <button class="ghost" title="Split at playhead  S" onclick={edit.splitAtPlayhead} disabled={!store.project.clips.length}><Icon name="blade" /><span class="tlbl">Split</span></button>
    <button class="ghost" title="Delete selected  Del" onclick={edit.deleteSelected} disabled={!store.ui.selectedClips.length && !store.ui.selectedTransition}><Icon name="trash" /><span class="tlbl">Delete</span></button>
    <button class="ghost" title="Duplicate selected  D" onclick={edit.duplicateSelected} disabled={!store.ui.selectedClips.length}><Icon name="copy" /><span class="tlbl">Duplicate</span></button>
    <button class="ghost" title="Add a melt at the cut nearest the playhead  T" onclick={() => edit.transitionAtPlayhead('melt')} disabled={placed.length < 2}><Icon name="split" /><span class="tlbl">Transition</span></button>
    <button class="ghost" title="Add a text title at the playhead" onclick={() => edit.addText()}><Icon name="text" /><span class="tlbl">Text</span></button>
    <span class="tsep"></span>
    <button class="icon ghost" class:on={store.ui.snap} title="Snapping  N (hold Shift while dragging to ignore)" aria-label="Snapping" onclick={() => (store.ui.snap = !store.ui.snap)}><Icon name="magnet" /></button>
    <span class="grow"></span>
    <span class="mono small faint dur">{fmtDur(store.ui.time)} / {fmtDur(duration)}</span>
    <button class="icon ghost" title="Zoom out  −" aria-label="Zoom out" onclick={() => edit.zoom(1 / 1.5)}><span class="zt">−</span></button>
    <button class="icon ghost" title="Zoom in  +  (Ctrl+wheel)" aria-label="Zoom in" onclick={() => edit.zoom(1.5)}><span class="zt">+</span></button>
    <button class="icon ghost" class:on={!store.ui.pxPerSec} title="Fit the whole timeline" aria-label="Zoom to fit" onclick={edit.zoomFit}><Icon name="fit" /></button>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tl" bind:this={scroller} bind:clientWidth={viewW} onwheel={onWheel} onpointerdowncapture={releaseFocus}>
    <div class="inner" class:narrow style="width:{G + W}px;--g:{G}px">
      <!-- ruler -->
      <div class="row ruler-row">
        <div class="g g-ruler"><span class="label">Timeline</span></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane ruler" bind:this={rulerLane} style="width:{W}px" onpointerdown={rulerDown}>
          {#each ticks.out as s}
            <div class="tick" style="left:{x(s)}px"><span class="mono">{fmtTick(s)}</span></div>
          {/each}
        </div>
      </div>

      <!-- mosh effects -->
      <div class="row">
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
          <div class="row">
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
        <div class="row">
          <button class="g add ghost" onclick={() => (store.ui.dialog = 'addEffect')} title="Add effect  A"><Icon name="plus" size={12} />Add effect</button>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane fx-lane empty" style="width:{W}px" onpointerdown={scrubDown}></div>
        </div>
      {/if}

      <!-- keyframes -->
      <div class="row">
        <div class="g g-keys" title="Blue ticks: keyframes in the prepared video. Red diamonds: keyframes you forced (double-click the lane or press K).">Keyframes</div>
        <canvas class="lane keys" bind:this={keyCanvas} style="width:{W}px" ondblclick={keysDbl} title="Double-click to add or remove a forced keyframe"></canvas>
      </div>

      <!-- titles -->
      {#if store.project.texts.length}
        <div class="row">
          <div class="g g-track"><Icon name="text" size={12} /><span class="tname">Titles</span></div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane text-lane" style="width:{W}px" onpointerdown={scrubDown}>
            {#each store.project.texts as tx (tx.id)}
              <div class="clip text" class:sel={sel.has(tx.id)} style="left:{x(tx.start)}px;width:{Math.max(6, x(tx.duration))}px" onpointerdown={(e) => clipDown(e, tx.id, 't')} oncontextmenu={(e) => openMenu(e, tx.id, 't')} title={tx.text}>
                <div class="edge l" onpointerdown={(e) => edgeDown(e, tx.id, 't', 'l')}></div>
                <span class="cname">{tx.text || 'Text'}</span>{#if tx.moshed}<span class="badge">melts</span>{/if}
                <div class="edge r" onpointerdown={(e) => edgeDown(e, tx.id, 't', 'r')}></div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- video -->
      <div class="row">
        <div class="g g-track video"><Icon name="film" size={12} /><span class="tname">Video</span></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane v-lane" data-track={VIDEO_TRACK} style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => laneOver(e, VIDEO_TRACK)} ondragleave={() => (hint = null)} ondrop={(e) => laneDrop(e, VIDEO_TRACK)}>
          {#if !placed.length}
            <div class="lane-empty">Drag clips here from the Media panel</div>
          {/if}
          {#each placed as pl (pl.clip.id)}
            {@const c = pl.clip}
            {@const moving = drag?.k === 'move' && drag.id === c.id && drag.moved}
            <div
              class="clip video"
              class:sel={sel.has(c.id)}
              class:moving
              style="left:{x(pl.start)}px;width:{Math.max(4, x(pl.end) - x(pl.start))}px;{pl.media.thumb ? `--thumb:url(${pl.media.thumb})` : ''}"
              onpointerdown={(e) => clipDown(e, c.id, 'v')}
              oncontextmenu={(e) => openMenu(e, c.id, 'v')}
              title="{pl.media.source.name} · {fmtDur(pl.end - pl.start)}"
            >
              <div class="edge l" onpointerdown={(e) => edgeDown(e, c.id, 'v', 'l')}></div>
              <span class="cname">{vName(pl)}</span>
              {#if c.speed !== 1}<span class="badge">{c.speed}×</span>{/if}
              {#if c.reverse}<span class="badge">rev</span>{/if}
              <div class="edge r" onpointerdown={(e) => edgeDown(e, c.id, 'v', 'r')}></div>
            </div>
            {#if moving && drag?.k === 'move'}
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
        <div class="row">
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
                <div class="clip audio linked" class:sel={sel.has(c.id)} class:muted={c.muted} style="left:{x(pl.start)}px;width:{w}px" onpointerdown={(e) => clipDown(e, c.id, 'v')} oncontextmenu={(e) => openMenu(e, c.id, 'v')} title={c.muted ? 'Muted (or detached)' : 'Clip sound'}>
                  <Waveform peaks={peaksOf(pl.media.id)} from={c.in} to={c.out} reverse={c.reverse} width={w} height={26} />
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <!-- audio tracks -->
      {#each audioTracks as tr (tr.id)}
        <div class="row">
          <div class="g g-track">
            <Icon name="music" size={12} /><span class="tname" title={tr.name}>{tr.name}</span>
            {@render trackButtons(tr.id)}
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="lane a-lane" class:muted={tr.muted} data-track={tr.id} style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => laneOver(e, tr.id)} ondragleave={() => (hint = null)} ondrop={(e) => laneDrop(e, tr.id)}>
            {#each store.project.clips.filter((c) => c.track === tr.id) as c (c.id)}
              {@const m = mediaOf(store.project, c.mediaId)}
              {@const w = Math.max(4, x(clipLen(c)))}
              <div class="clip audio" class:sel={sel.has(c.id)} class:muted={c.muted} style="left:{x(c.start)}px;width:{w}px" onpointerdown={(e) => clipDown(e, c.id, 'a')} oncontextmenu={(e) => openMenu(e, c.id, 'a')} title="{m?.source.name} · {fmtDur(clipLen(c))}">
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
      <div class="row">
        <button class="g add ghost" onclick={() => edit.addAudioTrack()} title="Add an audio track (music, voice-over…)"><Icon name="plus" size={12} />Audio track</button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane newtrack" style="width:{W}px" onpointerdown={scrubDown} ondragover={(e) => { const k = dragKind(e); if (k === 'media' || k === 'files') { e.preventDefault(); e.stopPropagation(); } }} ondrop={newTrackDrop}>
          <span class="faint small">Drop sound here for a new track</span>
        </div>
      </div>

      <!-- result -->
      <div class="row out-row">
        <div class="g g-out" title="Output frames after moshing. Blue: keyframe. Grey: motion. Amber: repeated. Yellow: glitched. Teal: moved. Green: transferred. Click to view the mosh.">
          Output{#if store.render && !fresh}<span class="stale" title="Changed since the last render">●</span>{/if}
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane out" class:stale={!fresh} style="width:{W}px">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="outstrip" style="width:{outW}px" onpointerdown={outDown}>
            <canvas bind:this={resultCanvas} style="width:{Math.min(outW, 16000)}px;transform:scaleX({outW / Math.min(outW, 16000)})"></canvas>
            {#if store.ui.loop && nOut}
              <div class="loop" class:inactive={!store.ui.loopOn} style="left:{(store.ui.loop[0] / nOut) * outW}px;width:{((store.ui.loop[1] - store.ui.loop[0]) / nOut) * outW}px"></div>
            {/if}
            {#if nOut}<div class="phead out-ph" style="left:{outX}px"></div>{/if}
          </div>
        </div>
      </div>

      <div class="phead main" style="left:{G + x(store.ui.time)}px"></div>
    </div>
  </div>
</div>

{#snippet trackButtons(id: string)}
  {@const t = store.project.tracks.find((x) => x.id === id)}
  {#if t}
    <span class="tbtns">
      <button class="tb" class:on={t.muted} title="Mute" onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.muted = !t.muted))}>M</button>
      <button class="tb" class:on={t.solo} title="Solo" onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.solo = !t.solo))}>S</button>
      <button class="tb mosh" class:on={t.mosh} title={t.mosh ? 'Sound follows the mosh (stutters with the picture). Click to keep it clean.' : 'Sound stays clean. Click to make it follow the mosh.'} onpointerdown={(e) => e.stopPropagation()} onclick={() => store.edit(() => (t.mosh = !t.mosh))}>~</button>
      {#if id !== CLIP_AUDIO}<button class="tb rm" title="Remove track" onclick={() => edit.removeTrack(id)}>×</button>{/if}
    </span>
  {/if}
{/snippet}

{#if menu}
  <div class="menu" style="left:{menu.x}px;top:{menu.y}px" role="menu">
    <button class="ghost" onclick={edit.splitAtPlayhead}><Icon name="blade" />Split at playhead<span class="kbd">S</span></button>
    <button class="ghost" onclick={edit.duplicateSelected}><Icon name="copy" />Duplicate<span class="kbd">D</span></button>
    <button class="ghost" onclick={edit.copySelected}><Icon name="copy" />Copy<span class="kbd">Ctrl C</span></button>
    {#if menuClip}
      <button class="ghost" onclick={() => store.edit(() => (menuClip.reverse = !menuClip.reverse))}><Icon name="reset" />{menuClip.reverse ? 'Play forwards' : 'Reverse'}</button>
      {#if menuClip.track === VIDEO_TRACK && mediaOf(store.project, menuClip.mediaId)?.hasAudio}
        <button class="ghost" onclick={() => store.edit(() => (menuClip.muted = !menuClip.muted))}><Icon name={menuClip.muted ? 'sound' : 'mute'} />{menuClip.muted ? 'Unmute sound' : 'Mute sound'}</button>
        {#if !menuClip.muted}<button class="ghost" onclick={() => edit.detach(menuClip.id)}><Icon name="music" />Detach audio</button>{/if}
      {/if}
      {#if menuClip.track === VIDEO_TRACK && placed[0]?.clip.id !== menuClip.id}
        <button class="ghost" onclick={() => (edit.setTransition(menuClip.id, 'melt'), store.selectTransition(menuClip.id))}><Icon name="split" />Melt into this clip</button>
        <button class="ghost" onclick={() => (edit.setTransition(menuClip.id, 'dissolve'), store.selectTransition(menuClip.id))}><Icon name="split" />Dissolve into this clip</button>
      {/if}
    {/if}
    <hr />
    <button class="ghost danger" onclick={edit.deleteSelected}><Icon name="trash" />Delete<span class="kbd">Del</span></button>
  </div>
{/if}

<style>
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
  .toolbar.narrow .dur {
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
    min-height: 100%;
  }
  .row {
    display: flex;
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
  }
  .ruler-row {
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .ruler-row .g {
    z-index: 6;
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
  @media (max-width: 860px) {
    .toolbar button:not(.icon) {
      padding: 0 6px;
    }
  }
</style>
