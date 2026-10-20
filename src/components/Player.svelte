<script lang="ts">
  import { reportProblem } from '../lib/report';
  import { formatSeconds } from '../engine/eta';
  import { untrack, onDestroy, onMount } from 'svelte';
  import { store, type CompareMode } from '../lib/store.svelte';
  import { loadExample, addFiles } from '../lib/media';
  import Logo from './Logo.svelte';
  import Icon from './Icon.svelte';
  import { originalFrames, renderPreview, moshedAudio, type RenderResult } from '../lib/renderer';
  import { snapshots, setFrameGrabber } from '../lib/snapshots.svelte';
  import { lutState } from '../lib/luts.svelte';
  import Scopes from './Scopes.svelte';
  import { trackClip, pathOnTimeline, pathSize, pathAt, guardPath } from '../lib/motion.svelte';
  import { rasterizeField, type Stroke } from '../engine/flowfield';
  import { drawMask, type MaskStroke } from '../lib/maps';
  import { SAMPLE_RATE } from '../engine/audio';
  import { EditPreview, EditAudio } from '../lib/preview';
  import { drawLayers } from '../lib/layers';
  import Gizmo from './Gizmo.svelte';
  import { addPen } from '../lib/edit';
  import { fontState } from '../lib/fonts.svelte';
  import { audioCtx } from '../lib/audioctx';
  import { download } from '../lib/storage';
  import type { Project } from '../engine/types';
  import { tc, parseTimecode } from '../lib/timecode';
  import { outputSize } from '../engine/args';

  /** phones: a bigger picture and a simpler transport (time, play, undo / redo) */
  let { compact = false }: { compact?: boolean } = $props();
  let canvas: HTMLCanvasElement;
  let editCanvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let muted = $state(false);
  let originals = $state.raw<Uint8Array[] | null>(null);
  let origKey = '';
  /** bumped when new originals arrive, so their decoded frames don't mix with the last ones' */
  let origGen = 0;
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
        cache.get(first)!.then((b) => b.close(), () => {});
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
    const fr = r.frames[i];
    const src = fr ? (fr.at ?? fr.src) : i;
    const orig = mode !== 'off' && originals ? bitmap(originals, Math.min(src, originals.length - 1), 'o' + origGen + ':') : null;
    let a: ImageBitmap, b: ImageBitmap | null;
    try {
      [a, b] = await Promise.all([main, orig]);
    } catch {
      return;
    }
    // a newer frame was asked for, or the player went away (phone ↔ desktop layout) while decoding
    if (tok !== drawToken || !canvas) return;
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
    if (mode !== 'hold' && store.project.layers.length) drawLayers(ctx, store.project.layers, src / r.fps, w, h, 'clean');
    // prefetch
    for (let k = 1; k < 8; k++) bitmap(r.jpegs, i + k, 'm');
  }

  $effect(() => {
    void store.ui.playhead;
    void store.render;
    void store.ui.compare;
    void store.ui.split;
    void originals;
    void layersSig;
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
  // deep signatures of the timeline: worked out again only when it changes, not on every frame
  const clipsSig = $derived(JSON.stringify(store.project.clips));
  const layersSig = $derived(JSON.stringify(store.project.layers));
  const soundSig = $derived(JSON.stringify(store.project.tracks) + clipsSig);
  $effect(() => {
    // redraw when the time or anything on the timeline changes (while paused)
    void store.ui.time;
    void clipsSig;
    void layersSig;
    void store.project.media.length;
    void store.project.encoder.aspect;
    void lutState.loaded;
    void fontState.loaded;
    if (!mosh && !store.ui.playing) untrack(drawEdit);
  });
  $effect(() => {
    if (mosh) preview?.pauseAll();
  });
  onDestroy(() => {
    preview?.dispose();
    editAudio.dispose();
    // decoded mosh frames hold their pixels until closed (switching phone ↔ desktop layout remounts the player)
    resetCache();
  });

  /** A snapshot's mosh, one picture per timeline frame (so it lines up with the current render). */
  async function snapshotFrames(p: Project, width: number): Promise<Uint8Array[]> {
    const r = await renderPreview(p, width);
    const out: Uint8Array[] = [];
    r.frames.forEach((f, i) => {
      const pos = f.at ?? f.src;
      out[pos] ??= r.jpegs[i];
    });
    // fill holes (dropped frames) with the picture before
    for (let i = 0; i < out.length; i++) out[i] ??= out[i - 1] ?? r.jpegs[0];
    return out;
  }
  const cmpName = $derived(store.ui.compareSnap ? (snapshots.list.find((s) => s.id === store.ui.compareSnap)?.name ?? 'snapshot') : 'source');
  // the edit preview is drawn as sharp as the stage is on screen
  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!wrap) return;
      stageSize = wrap.clientWidth * 1e5 + wrap.clientHeight;
      const tw = Math.round(wrap.clientWidth * (window.devicePixelRatio || 1));
      preview ??= new EditPreview(editCanvas);
      if (Math.abs(preview.targetWidth - tw) > 32) {
        preview.targetWidth = tw;
        if (!mosh && !store.ui.playing) drawEdit();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });
  onMount(() => {
    setFrameGrabber(() => {
      const src = mosh ? canvas : editCanvas;
      if (!src?.width) return '';
      const c = document.createElement('canvas');
      c.width = 192;
      c.height = Math.max(1, Math.round((src.height * 192) / src.width));
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    });
    return () => setFrameGrabber(null);
  });

  // ---- originals for A/B ----
  $effect(() => {
    const mode = store.ui.compare;
    const r = store.render;
    if (mode === 'off' || !r) return;
    const p = $state.snapshot(store.project) as Project;
    const snap = store.ui.compareSnap ? snapshots.list.find((s) => s.id === store.ui.compareSnap) : null;
    const key = snap ? 'snap:' + snap.id + ':' + r.w : JSON.stringify([p.clips.map(({ label: _l, paths: _p, ...c }) => c), p.encoder, r.w]);
    if (key === origKey) return;
    origKey = key;
    loadingOrig = true;
    (snap ? snapshotFrames(snap.project, r.w) : originalFrames(p, r.w))
      .then((o) => {
        // a later request (another snapshot, an edit) wins over this one
        if (origKey !== key) return;
        origGen++;
        originals = o;
      })
      .catch((e) => origKey === key && store.toast('Compare failed: ' + e.message, 'error'))
      .finally(() => origKey === key && (loadingOrig = false));
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
    moshedAudio(p, r.frames)
      .then((pcm) => {
        if (!pcm || pcm.length < 2) return (abuf = null);
        actx ??= audioCtx();
        // straight into an AudioBuffer: no WAV copy and decode (that took several times the memory on long projects)
        const n = pcm.length >> 1;
        const b = actx.createBuffer(2, n, SAMPLE_RATE);
        const L = b.getChannelData(0);
        const R = b.getChannelData(1);
        for (let i = 0; i < n; i++) {
          L[i] = pcm[i * 2] / 32768;
          R[i] = pcm[i * 2 + 1] / 32768;
        }
        abuf = b;
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
    const speed = store.ui.speed * store.ui.shuttle;
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

  /** The loop range in timeline seconds: In–Out when looping with marks, else the whole timeline. */
  function timeRange(): [number, number] {
    const a = store.ui.inPoint;
    const b = store.ui.outPoint;
    if (store.ui.loopOn && (a !== null || b !== null)) return [a ?? 0, Math.min(store.duration, b ?? store.duration)];
    return [0, store.duration];
  }

  function playMosh(r: RenderResult, buf: AudioBuffer | null, mute: boolean, speed: number) {
    const n = r.frames.length;
    // pick up where the edit preview was
    const cur = r.frames[store.ui.playhead];
    if (!cur || Math.abs((cur.at ?? cur.src) / r.fps - store.ui.time) > 1.5 / r.fps) store.ui.playhead = Math.min(n - 1, store.frameAtTime(store.ui.time));
    const range = (): [number, number] => {
      const [a, b] = timeRange();
      return b >= store.duration - 1e-6 && a <= 0 ? [0, n] : [store.frameAtTime(a), Math.max(store.frameAtTime(a) + 1, store.frameAtTime(b))];
    };
    const back = speed < 0;
    const [a0, b0] = range();
    if (!back && (store.ui.playhead >= b0 - 1 || store.ui.playhead < a0)) store.seekFrame(a0);
    if (back && (store.ui.playhead <= a0 || store.ui.playhead >= b0)) store.seekFrame(b0 - 1);
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
      let f = f0 + Math.trunc(((now - t0) / 1000) * r.fps * speed);
      if (f >= b || f < a) {
        if (store.ui.loopOn) {
          f0 = f >= b ? a : b - 1;
          t0 = now;
          f = f0;
          store.seekFrame(f0);
          expected = f0;
          startAudio();
        } else {
          store.seekFrame(f >= b ? n - 1 : 0);
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
    if (store.duration <= 0) {
      store.ui.playing = false;
      return;
    }
    const back = speed < 0;
    {
      const [a, b] = timeRange();
      if (!back && (store.ui.time >= b - 0.05 || store.ui.time < a)) store.seek(a);
      if (back && (store.ui.time <= a + 0.05 || store.ui.time > b)) store.seek(b);
    }
    let t0 = store.ui.time;
    let n0 = performance.now();
    // sound only plays forwards at normal speed
    const startAudio = () => editAudio.start($state.snapshot(store.project) as Project, store.ui.time, mute || speed !== 1);
    startAudio();
    let expected = t0;
    let audioKey = soundSig;
    const tick = (now: number) => {
      if (Math.abs(store.ui.time - expected) > 1e-6) {
        // seeked while playing
        t0 = store.ui.time;
        n0 = now;
        startAudio();
      }
      const k = soundSig;
      if (k !== audioKey) {
        audioKey = k;
        t0 = store.ui.time;
        n0 = now;
        startAudio();
      }
      const [a, b] = timeRange();
      let t = t0 + ((now - n0) / 1000) * speed;
      if (t >= b || t < a) {
        if (store.ui.loopOn) {
          t = t >= b ? a : b;
          t0 = t;
          n0 = now;
          store.seek(t);
          startAudio();
        } else {
          store.seek(t >= b ? b : a);
          store.ui.playing = false;
          return;
        }
      }
      store.seek(t);
      expected = store.ui.time;
      // backwards: videos can't play in reverse, so each frame is a seek
      preview?.draw(store.project, t, !back, Math.abs(speed));
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
  // SMPTE-style timecode HH:MM:SS:FF of the playhead (the mosh keeps the timeline's timing)
  const timecode = $derived(tc(store.ui.time, store.project.encoder.fps));
  let tcEdit = $state<string | null>(null);
  /** Jump to a typed time: HH:MM:SS:FF, MM:SS, plain seconds, or +/- a relative amount ("+1:00", "-12" frames with an f). */
  function goTimecode(v: string) {
    tcEdit = null;
    const t = parseTimecode(v.trim(), store.project.encoder.fps, store.ui.time);
    if (t !== null) {
      store.ui.playing = false;
      store.seek(t);
    }
  }

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

  /** Pointer position as a share of the picture on screen (whichever canvas is shown). */
  function pictureUV(e: { clientX: number; clientY: number }): [number, number] {
    const shown = mosh ? canvas : editCanvas;
    const rc = shown.getBoundingClientRect();
    const k = Math.min(rc.width / shown.width, rc.height / shown.height);
    return [(e.clientX - (rc.left + (rc.width - shown.width * k) / 2)) / (shown.width * k), (e.clientY - (rc.top + (rc.height - shown.height * k) / 2)) / (shown.height * k)];
  }
  // ---- flow painting
  const paintFx = $derived(store.ui.paintEffect ? store.project.effects.find((x) => x.id === store.ui.paintEffect && (x.type === 'flowPaint' || x.type === 'mvedit' || (x.type === 'mask' && x.params.source === 'paint'))) : undefined);
  /** painting a Mosh Map (Subject Guard), not a flow */
  const paintMask = $derived(paintFx?.type === 'mask');
  /** the painted map so far, shown over the picture */
  const maskImage = $derived.by(() => {
    if (!paintFx || !paintMask) return '';
    const { w, h } = outputSize(store.project, store.project.encoder.previewWidth);
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.max(8, Math.round((160 * h) / w));
    drawMask(c.getContext('2d')!, (paintFx.data?.maskStrokes as MaskStroke[] | undefined) ?? [], c.width, c.height);
    return c.toDataURL();
  });
  let liveStroke = $state<[number, number][]>([]);
  /** The picture's box inside the stage, in stage pixels. */
  function pictureBox() {
    const shown = mosh ? canvas : editCanvas;
    const sr = wrap.getBoundingClientRect();
    const rc = shown.getBoundingClientRect();
    const k = Math.min(rc.width / shown.width, rc.height / shown.height);
    const w = shown.width * k;
    const h = shown.height * k;
    return { left: rc.left - sr.left + (rc.width - w) / 2, top: rc.top - sr.top + (rc.height - h) / 2, width: w, height: h };
  }
  function paintStroke(e: PointerEvent) {
    const fx = paintFx;
    if (!fx) return;
    const pts: [number, number][] = [pictureUV(e)];
    liveStroke = pts;
    const move = (ev: PointerEvent) => {
      const p = pictureUV(ev);
      const l = pts[pts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) <= 0.008) return;
      pts.push(p);
      liveStroke = [...pts];
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      liveStroke = [];
      if (ev.type === 'pointercancel') return;
      const b = store.ui.brush;
      const round = pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
      const id = fx.id;
      if (fx.type === 'mask') {
        const stroke: MaskStroke = { pts: round as [number, number][], radius: b.radius, ...(store.ui.maskErase ? { erase: true } : {}) };
        return store.edit((p) => {
          const x = p.effects.find((y) => y.id === id);
          if (x) x.data = { ...(x.data ?? {}), maskStrokes: [...((x.data?.maskStrokes as unknown[]) ?? []), stroke] };
        });
      }
      const stroke = { tool: b.tool, pts: round, radius: b.radius, strength: b.strength };
      store.edit((p) => {
        const x = p.effects.find((y) => y.id === id);
        if (x) x.data = { ...(x.data ?? {}), strokes: [...((x.data?.strokes as unknown[]) ?? []), stroke] };
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  /** Arrows showing the painted field. */
  const fieldArrows = $derived.by(() => {
    if (!paintFx || paintMask) return [];
    const strokes = (paintFx.data?.strokes as Stroke[] | undefined) ?? [];
    const { w, h } = outputSize(store.project, store.project.encoder.previewWidth);
    const gw = 24;
    const gh = Math.max(4, Math.round((24 * h) / w));
    const f = rasterizeField(strokes, gw, gh, w / h);
    // drawn to scale with each other, the strongest one grid cell long
    let max = 0;
    for (let k = 0; k < f.length; k += 2) max = Math.max(max, Math.hypot(f[k], f[k + 1]));
    const out: { x: number; y: number; dx: number; dy: number }[] = [];
    if (max < 1e-5) return out;
    const s = 0.9 / gw / max;
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const k = (j * gw + i) * 2;
        if (Math.hypot(f[k], f[k + 1]) < max * 0.05) continue;
        out.push({ x: (i + 0.5) / gw, y: (j + 0.5) / gh, dx: f[k] * s, dy: ((f[k + 1] * w) / h) * s });
      }
    return out;
  });

  /** bumped when the stage changes size, so overlays placed on the picture follow it */
  let stageSize = $state(0);
  /** the selected clip's tracked objects, on the timeline */
  const tracks = $derived.by(() => {
    const p = store.project;
    let c = store.selectedClip;
    let paths = c?.paths ?? [];
    // a Subject Guard on a tracked object: the object it follows
    const fx = store.ui.selectedEffect ? p.effects.find((e) => e.id === store.ui.selectedEffect) : undefined;
    if (!c && fx?.type === 'mask' && fx.params.source === 'track') {
      const gp = guardPath(p, fx.data);
      c = gp ? p.clips.find((x) => x.id === gp.clipId) : undefined;
      paths = (c?.paths ?? []).filter((x) => x.id === gp?.pathId);
    }
    if (!c || !paths.length) return [];
    const clip = c;
    return paths.map((path) => ({ id: path.id, name: path.name, pts: pathOnTimeline(p, clip, path.id), size: pathSize(p, clip, path.id) ?? [0.06, 0.06] })).filter((x) => x.pts.length);
  });
  /** where those boxes are at the playhead, and the picture they're drawn over (stage pixels) */
  const trackView = $derived.by(() => {
    if (!tracks.length || !wrap || store.ui.trackPick) return null;
    // re-place the boxes when the stage resizes or the other canvas shows
    void (stageSize + Number(mosh));
    const t = store.ui.time;
    const boxes = tracks.flatMap((tr) => {
      if (t < tr.pts[0][0] - 0.05 || t > tr.pts[tr.pts.length - 1][0] + 0.05) return [];
      const [x, y] = pathAt(tr.pts, t);
      return [{ id: tr.id, name: tr.name, x, y, w: tr.size[0], h: tr.size[1] }];
    });
    return boxes.length ? { pb: pictureBox(), boxes } : null;
  });

  /** where the handles go (the picture, stage pixels), or null while something else uses the picture */
  const gizmoBox = $derived.by(() => {
    // the stage's size first: it's what tells this the stage is there (and when it resizes)
    void stageSize;
    if (!wrap || !hasTimeline || store.ui.playing || store.ui.eyedropper || store.ui.trackPick || store.ui.pen || paintFx || store.ui.compare !== 'off') return null;
    // the frame letterboxed into the canvases' area (10 px in from the stage's edges), worked out
    // from its shape so it's right before the canvases have drawn anything
    const cw = wrap.clientWidth - 20;
    const ch = wrap.clientHeight - 20;
    const k = Math.min(cw / guideSize.w, ch / guideSize.h);
    return { left: 10 + (cw - guideSize.w * k) / 2, top: 10 + (ch - guideSize.h * k) / 2, width: guideSize.w * k, height: guideSize.h * k };
  });

  /** A freehand line being drawn with the pen, as shares of the frame. */
  let penLine = $state<[number, number][]>([]);
  function penStroke(e: PointerEvent) {
    store.ui.playing = false;
    penLine = [pictureUV(e)];
    const move = (ev: PointerEvent) => (penLine = [...penLine, pictureUV(ev)]);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const pts = penLine;
      penLine = [];
      if (ev.type === 'pointercancel') return;
      store.ui.pen = false;
      if (!addPen(pts)) store.toast('Drag on the picture to draw a line.', 'error');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** The box being drawn around something to track, in stage pixels. */
  let trackRect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  function drawTrackBox(e: PointerEvent) {
    const id = store.ui.trackPick;
    if (!id) return;
    const sr = wrap.getBoundingClientRect();
    const a = pictureUV(e);
    const x0 = e.clientX - sr.left;
    const y0 = e.clientY - sr.top;
    trackRect = { x: x0, y: y0, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - sr.left;
      const y1 = ev.clientY - sr.top;
      trackRect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      trackRect = null;
      // a cancelled touch: keep picking, draw the box again
      if (ev.type === 'pointercancel') return;
      const b = pictureUV(ev);
      store.ui.trackPick = null;
      const then = store.ui.trackThen;
      store.ui.trackThen = null;
      if (Math.abs(b[0] - a[0]) < 0.01 || Math.abs(b[1] - a[1]) < 0.01) return store.toast('Drag a box around the thing to follow.', 'error');
      trackClip(id, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], then).catch((err) => store.toast('Tracking failed: ' + (err as Error).message, 'error'));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Eyedropper: the colour under the pointer in the live edit picture (drawn without keys). */
  function pickKeyColour(e: PointerEvent) {
    const id = store.selectedClip?.id;
    store.ui.eyedropper = false;
    if (!id || !editCanvas) return;
    preview ??= new EditPreview(editCanvas);
    preview.noKey = true;
    preview.draw(store.project, store.ui.time, false);
    preview.noKey = false;
    // measure against whichever picture is on screen (same shape), then map into the edit canvas
    const shown = mosh ? canvas : editCanvas;
    const rc = shown.getBoundingClientRect();
    const k = Math.min(rc.width / shown.width, rc.height / shown.height);
    const u = (e.clientX - (rc.left + (rc.width - shown.width * k) / 2)) / (shown.width * k);
    const v = (e.clientY - (rc.top + (rc.height - shown.height * k) / 2)) / (shown.height * k);
    const x = Math.floor(u * editCanvas.width);
    const y = Math.floor(v * editCanvas.height);
    if (x < 0 || y < 0 || x >= editCanvas.width || y >= editCanvas.height) return;
    const [r, g, b] = editCanvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    store.edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) c.key = { ...(c.key ?? { similarity: 0.25, blend: 0.08, spill: true }), color: hex };
    });
    store.toast(`Key colour ${hex}`, 'ok', 1500);
  }

  let importInput = $state<HTMLInputElement>();
  let draggingSplit = false;
  let tapAt: { x: number; y: number; t: number } | null = null;
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
  const guideSize = $derived(outputSize(store.project, store.project.encoder.previewWidth));
  const totalTc = $derived(tc(store.duration, store.project.encoder.fps));
  const shortTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let pmenu = $state(false);
  const RES_LABEL = { full: 'Full', half: '1/2', quarter: '1/4' } as const;
  const RES_TIP = { full: 'full, exactly as it will export', half: 'half resolution, faster', quarter: 'quarter resolution, fastest' } as const;
  function cycleRes() {
    const order = ['full', 'half', 'quarter'] as const;
    store.setPref('previewRes', order[(order.indexOf(store.ui.previewRes) + 1) % 3]);
    store.toast(`Preview quality: ${RES_TIP[store.ui.previewRes]}`, 'info', 1800);
  }
  function fullscreen() {
    const el = wrap.parentElement!;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else (el.requestFullscreen?.() ?? Promise.reject()).catch(() => store.toast('Full screen is not available here.', 'error'));
  }
  const hasTimeline = $derived(store.project.clips.length > 0 || store.project.layers.length > 0);
</script>

<svelte:window onclick={() => (pmenu = false)} />

<div class="player">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    class:compact
    class:picking={store.ui.eyedropper || !!store.ui.trackPick || store.ui.pen || !!paintFx}
    bind:this={wrap}
    onpointerdown={(e) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (store.ui.eyedropper) return pickKeyColour(e);
      if (store.ui.trackPick) return drawTrackBox(e);
      if (store.ui.pen) return penStroke(e);
      if (paintFx) return paintStroke(e);
      if (compact && hasTimeline && store.ui.compare === 'off') {
        tapAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        return;
      }
      if (store.ui.compare === 'split') {
        draggingSplit = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        splitMove(e);
      }
    }}
    onpointermove={splitMove}
    onpointercancel={() => ((draggingSplit = false), (tapAt = null))}
    onpointerup={(e) => {
      draggingSplit = false;
      if (tapAt && Math.hypot(e.clientX - tapAt.x, e.clientY - tapAt.y) < 10 && performance.now() - tapAt.t < 400) store.ui.playing = !store.ui.playing;
      tapAt = null;
    }}
  >
    {#if store.status.busy}
      <div class="progress" style="width:{Math.max(2, Math.round(store.status.progress * 100))}%"></div>
    {/if}
    <canvas bind:this={canvas} class:hidden={!mosh} class:split={store.ui.compare === 'split'}></canvas>
    <canvas bind:this={editCanvas} class="edit" class:hidden={mosh || !hasTimeline}></canvas>
    {#if paintFx && hasTimeline}
      {@const pb = pictureBox()}
      <svg class="paintlayer" style="left:{pb.left}px;top:{pb.top}px;width:{pb.width}px;height:{pb.height}px" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {#each fieldArrows as a}
          <line x1={a.x} y1={a.y} x2={a.x + a.dx} y2={a.y + a.dy} class="arrow" />
        {/each}
        {#if paintMask && maskImage}<image href={maskImage} x="0" y="0" width="1" height="1" preserveAspectRatio="none" class="maskimg" />{/if}
        {#if liveStroke.length > 1}<polyline points={liveStroke.map(([x, y]) => `${x},${y}`).join(' ')} class="stroke" />{/if}
      </svg>
      <div class="stage-note mono picknote">{paintMask ? (store.ui.maskErase ? 'erasing the map' : 'painting where it stays clean') : `painting ${store.ui.brush.tool}`}: drag on the picture · Esc to stop</div>
    {/if}
    {#if trackRect}
      <div class="trackbox" style="left:{trackRect.x}px;top:{trackRect.y}px;width:{trackRect.w}px;height:{trackRect.h}px"></div>
    {/if}
    {#if store.ui.pen && hasTimeline}
      {@const pb = pictureBox()}
      <svg class="paintlayer" style="left:{pb.left}px;top:{pb.top}px;width:{pb.width}px;height:{pb.height}px" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {#if penLine.length > 1}<polyline points={penLine.map(([x, y]) => `${x},${y}`).join(' ')} class="stroke" />{/if}
      </svg>
      {#if !penLine.length}<div class="stage-note mono picknote">draw on the picture · Esc to cancel</div>{/if}
    {/if}
    {#if store.ui.trackPick && !trackRect}
      <div class="stage-note mono picknote">{store.ui.trackThen === 'mark' ? 'drag a box around what to mark (it is followed, then boxed, arrowed and labelled)' : 'drag a box snugly around what to follow (something with detail)'} · Esc to cancel</div>
    {/if}
    {#if trackView && hasTimeline}
      <div class="tracklayer" style="left:{trackView.pb.left}px;top:{trackView.pb.top}px;width:{trackView.pb.width}px;height:{trackView.pb.height}px" aria-hidden="true">
        {#each trackView.boxes as b (b.id)}
          <div class="tbox" style="left:{(b.x - b.w / 2) * 100}%;top:{(b.y - b.h / 2) * 100}%;width:{b.w * 100}%;height:{b.h * 100}%"><span class="mono">{b.name}</span></div>
        {/each}
      </div>
    {/if}
    {#if gizmoBox}
      <Gizmo W={guideSize.w} H={guideSize.h} box={gizmoBox} {compact} />
    {/if}
    {#if store.ui.scopes && hasTimeline}
      <Scopes source={() => (mosh ? canvas : editCanvas)} />
    {/if}
    {#if store.ui.guides && hasTimeline}
      {@const g = guideSize}
      <svg class="guides" viewBox="0 0 {g.w} {g.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {#if store.ui.guides === 'vertical'}
          <!-- where TikTok / Reels / Shorts put their buttons, captions and header -->
          <rect x={g.w * 0.06} y={g.h * 0.08} width={g.w * 0.78} height={g.h * 0.66} class="safe" />
          <rect x="0" y={g.h * 0.78} width={g.w} height={g.h * 0.22} class="cover" />
          <rect x={g.w * 0.86} y={g.h * 0.35} width={g.w * 0.14} height={g.h * 0.43} class="cover" />
          <text x={g.w * 0.07} y={g.h * 0.08 + g.h * 0.03} class="gt" font-size={g.h * 0.022}>safe for text</text>
        {:else}
          <!-- the profile grid shows the middle 3:4 of a feed post -->
          <rect x={(g.w - (g.h * 3) / 4) / 2} y="0" width={(g.h * 3) / 4} height={g.h} class="safe" />
          <text x={(g.w - (g.h * 3) / 4) / 2 + g.h * 0.02} y={g.h * 0.05} class="gt" font-size={g.h * 0.03}>profile grid</text>
        {/if}
      </svg>
    {/if}
    {#if hasTimeline}
      <div class="badge-view mono" class:live={!mosh} title={mosh ? 'Showing the rendered mosh' : 'Live edit preview: your cut as it is, before moshing'}>
        {#if mosh}mosh{:else}edit{#if store.status.busy || store.status.pending}<span class="faint"> · mosh rendering</span>{:else if store.render && !store.renderFresh && !store.ui.autoRender}<span class="faint"> · mosh out of date</span>{/if}{/if}
      </div>
    {/if}
    {#if !hasTimeline && !store.status.busy}
      <div class="empty">
        {#if store.project.media.length}
          <p class="et">The timeline is empty</p>
          <p class="muted small">{compact ? 'Tap + to put clips on the timeline.' : 'Drag clips from the Media panel onto the timeline, or press + on one.'}</p>
        {:else}
          <Logo size={44} />
          <p class="et">Make something melt</p>
          <ol class="steps small">
            <li><span><b>Add</b> two or more clips. Lots of motion melts best.</span></li>
            <li><span><b>Mosh</b>: put a <i>Melt</i> on a cut, or pick a preset.</span></li>
            <li><span><b>Export</b> when it looks right.</span></li>
          </ol>
          <div class="row">
            <button class="primary" onclick={() => importInput?.click()}><Icon name="import" />Import media</button>
            <button onclick={() => loadExample()}>Load example</button>
          </div>
          {#if !compact}<p class="faint small">or drop files anywhere</p>{/if}
          <input bind:this={importInput} type="file" multiple accept="video/*,image/*,audio/*,.mkv,.avi,.mov,.gif,.mp3,.wav,.m4a,.flac,.ogg" hidden onchange={(e) => (addFiles((e.target as HTMLInputElement).files!), ((e.target as HTMLInputElement).value = ''))} />
        {/if}
      </div>
    {/if}
    {#if store.status.busy}
      <div class="stage-note mono">{store.status.stage || 'Working'} {Math.round(store.status.progress * 100)}%{store.status.eta !== null ? ` · about ${formatSeconds(store.status.eta)} left` : ''}</div>
    {:else if store.ui.compare !== 'off' && mosh}
      <div class="stage-note mono">
        {#if loadingOrig}loading {cmpName}{:else if store.ui.compare === 'split' || store.ui.compare === 'side'}{cmpName} | mosh{:else}{cmpName}{/if}
      </div>
    {/if}
    {#if store.status.error}
      <div class="error small">
        <div class="row"><b class="grow">Render failed</b><button onclick={() => reportProblem('The mosh failed to render.')}>Report</button><button onclick={() => store.doRender(true)}>Retry</button></div>
        <div>{store.status.error.split('\n')[0]}</div>
        <details><summary class="faint">Details</summary><pre>{store.status.error}</pre></details>
      </div>
    {/if}
  </div>

  {#if compact}
    <div class="transport compact">
      <div class="left mono"><span class="ctime">{shortTime(store.ui.time)}</span><span class="total">/ {shortTime(store.duration)}</span></div>
      <button class="play" aria-label={store.ui.playing ? 'Pause' : 'Play'} disabled={!hasTimeline} onclick={() => (store.ui.playing = !store.ui.playing)}>
        <Icon name={store.ui.playing ? 'pause' : 'play'} size={18} />
      </button>
      <div class="right">
        <button class="icon ghost" aria-label="Undo" disabled={!store.historySize.undo} onclick={() => store.undo()}><Icon name="undo" size={18} /></button>
        <button class="icon ghost" aria-label="Redo" disabled={!store.historySize.redo} onclick={() => store.redo()}><Icon name="redo" size={18} /></button>
        <button class="icon ghost" aria-label="Full screen" disabled={!hasTimeline} onclick={fullscreen}><Icon name="fullscreen" size={18} /></button>
      </div>
    </div>
  {:else}
  <div class="transport">
    <div class="left">
      {#if tcEdit !== null}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="tc mono tcin"
          autofocus
          value={tcEdit}
          aria-label="Go to time"
          onkeydown={(e) => {
            if (e.key === 'Enter') goTimecode((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') tcEdit = null;
            e.stopPropagation();
          }}
          onblur={() => (tcEdit = null)}
        />
      {:else}
        <button class="tc mono" title="Playhead (hours:minutes:seconds:frames). Click to type a time: 1:30, 00:01:12:05, +2 (seconds later) or -10f (frames back)." onclick={() => (tcEdit = timecode)}>{timecode}</button>
      {/if}
      <span class="total mono">/ {totalTc}</span>
      <div class="frameinfo mono small">
        {#if mosh}<span class="faint" title="Output frame">{n ? store.ui.playhead + 1 : 0}/{n}</span>{/if}
        {#if cur}
          <span class="ftype" class:i={cur.type === 'I'} title="Frame type: I = full picture, P = motion only">{cur.type}</span>
          <span class="faint">{TAG_LABEL[cur.tag]}</span>
        {/if}
      </div>
    </div>

    <div class="buttons">
      <button class="icon ghost hide-s" title="Start  Home" aria-label="Start" onclick={toStart}><Icon name="start" /></button>
      <button class="icon ghost" title="Previous frame  ←" aria-label="Previous frame" onclick={() => step(-1)}><Icon name="prev" /></button>
      <button class="play" title="Play / pause  Space" aria-label={store.ui.playing ? 'Pause' : 'Play'} disabled={!hasTimeline} onclick={() => (store.ui.playing = !store.ui.playing)}>
        <Icon name={store.ui.playing ? 'pause' : 'play'} size={18} />
      </button>
      <button class="icon ghost" title="Next frame  →" aria-label="Next frame" onclick={() => step(1)}><Icon name="next" /></button>
      <button class="icon ghost hide-s" title="End  End" aria-label="End" onclick={toEnd}><Icon name="end" /></button>
    </div>

    <div class="right">
      <div class="seg view" role="group" aria-label="Preview">
        {#each VIEWS as [v, label, tip]}
          <button class:on={store.ui.view === v} title={tip} onclick={() => store.setPref('view', v)}>{label}</button>
        {/each}
      </div>
      <button class="ghost qual mono" title="Preview quality: {RES_TIP[store.ui.previewRes]}. Click to change." aria-label="Preview quality" onclick={cycleRes}>{RES_LABEL[store.ui.previewRes]}</button>
      <button class="icon ghost" class:on={store.ui.loopOn} title="Loop  /  (plays the In–Out range when one is marked with I and O)" aria-label="Loop" onclick={() => (store.ui.loopOn = !store.ui.loopOn)}><Icon name="loop" /></button>
      <button class="icon ghost" class:on={muted} title="Mute preview" aria-label="Mute" onclick={() => ((muted = !muted), muted && stopAudio())}><Icon name={muted ? 'mute' : 'sound'} /></button>
      <button class="icon ghost" title="Full screen" aria-label="Full screen" disabled={!hasTimeline} onclick={fullscreen}><Icon name="fullscreen" /></button>
      <div class="pmenu-wrap">
        <button class="icon ghost" class:on={store.ui.compare !== 'off' || store.ui.scopes || store.ui.speed !== 1} aria-label="More player options" title="Speed, compare, scopes, save frame" onclick={(e) => (e.stopPropagation(), (pmenu = !pmenu))}><Icon name="more" /></button>
        {#if pmenu}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="pmenu" onclick={(e) => e.stopPropagation()}>
            <div class="prow"><span class="label">Speed</span>
              <div class="seg">
                {#each [0.25, 0.5, 1, 2] as sp}<button class:on={store.ui.speed === sp} onclick={() => (store.ui.speed = sp)}>{sp}×</button>{/each}
              </div>
            </div>
            <div class="prow"><span class="label" title="Compare the mosh with the clean source  C">Compare</span>
              <div class="seg" role="group" aria-label="Compare with source  C">
                {#each COMPARE as [m, label]}
                  <button class:on={store.ui.compare === m} onclick={() => (store.ui.compare = m)}>{label}</button>
                {/each}
              </div>
            </div>
            {#if store.ui.advanced || store.ui.scopes}<button class="ghost mitem" class:on={store.ui.scopes} disabled={!hasTimeline} onclick={() => ((pmenu = false), (store.ui.scopes = !store.ui.scopes))}><Icon name="grid" />Scopes<span class="kbd">Shift S</span></button>{/if}
            <button class="ghost mitem" disabled={!hasTimeline} onclick={() => ((pmenu = false), snapshot())}><Icon name="still" />Save this frame as PNG</button>
            <button class="ghost mitem" disabled={!hasTimeline} onclick={() => ((pmenu = false), store.doRender(true))}><Icon name="render" />Render the mosh now<span class="kbd">Enter</span></button>
          </div>
        {/if}
      </div>
    </div>
  </div>
  {/if}
</div>

<style>
  .player {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* the transport fits itself to the player's width (the side panels can be dragged wide) */
    container-type: inline-size;
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
    inset: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 20px);
    object-fit: contain;
  }
  .guides {
    position: absolute;
    inset: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 20px);
    pointer-events: none;
    z-index: 1;
  }
  .guides .safe {
    fill: none;
    stroke: rgba(255, 255, 255, 0.75);
    stroke-width: 1.5px;
    stroke-dasharray: 6px 5px;
    vector-effect: non-scaling-stroke;
  }
  .guides .cover {
    fill: rgba(255, 60, 60, 0.18);
  }
  .guides .gt {
    fill: rgba(255, 255, 255, 0.8);
    font-family: var(--mono, monospace);
  }
  .paintlayer {
    position: absolute;
    pointer-events: none;
    z-index: 3;
    overflow: visible;
  }
  .paintlayer .arrow {
    stroke: rgba(126, 196, 224, 0.9);
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
  }
  .paintlayer .maskimg {
    opacity: 0.4;
    mix-blend-mode: screen;
  }
  .paintlayer .stroke {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3px;
    vector-effect: non-scaling-stroke;
  }
  .trackbox {
    position: absolute;
    border: 1.5px solid var(--accent);
    background: rgba(255, 255, 255, 0.06);
    pointer-events: none;
    z-index: 3;
  }
  .tracklayer {
    position: absolute;
    pointer-events: none;
    z-index: 2;
  }
  .tbox {
    position: absolute;
    border: 1.5px dashed var(--accent);
    border-radius: 2px;
  }
  .tbox span {
    position: absolute;
    left: -1.5px;
    bottom: 100%;
    padding: 0 4px;
    font-size: 10px;
    line-height: 15px;
    white-space: nowrap;
    color: #000;
    background: var(--accent);
  }
  .picknote {
    top: auto;
    bottom: 8px;
  }
  /* phones: a pinch on the picture would zoom the whole page (and stay zoomed) */
  .stage.compact {
    touch-action: pan-x pan-y;
  }
  .stage.picking {
    cursor: crosshair;
    /* a finger paints / draws the box instead of panning the page (which cancels the stroke) */
    touch-action: none;
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
    gap: 10px;
    text-align: center;
    padding: 24px;
    line-height: 1.5;
    z-index: 1;
  }
  .et {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .steps {
    margin: 0 0 6px;
    padding: 0;
    list-style: none;
    counter-reset: s;
    text-align: left;
    color: var(--text-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .steps li {
    counter-increment: s;
    display: flex;
    gap: 8px;
  }
  .steps li::before {
    content: counter(s);
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font: 600 10px var(--mono);
    background: var(--surface-3);
    color: var(--text);
  }
  .steps b {
    color: var(--text);
  }
  .empty .row button {
    height: 34px;
    padding: 0 16px;
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
    min-height: 46px;
  }
  .left {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .tc {
    font-size: 17px;
    letter-spacing: 0.02em;
    color: var(--text);
    background: none;
    border: none;
    padding: 0 2px;
    height: auto;
    cursor: text;
  }
  .tc:hover {
    color: var(--accent);
    background: none !important;
  }
  .tcin {
    width: 140px;
    border: 1px solid var(--accent);
    background: var(--bg);
  }
  .total {
    color: var(--text-3);
    font-size: 12px;
    white-space: nowrap;
  }
  .frameinfo {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-left: 6px;
  }
  .ftype {
    padding: 0 4px;
    border: 1px solid var(--line-2);
    border-radius: 3px;
    color: var(--text-2);
  }
  .ftype.i {
    color: var(--f-i);
    border-color: var(--f-i);
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .play {
    width: 38px;
    height: 38px;
    padding: 0;
    margin: 0 6px;
    border-radius: 50%;
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .play:hover:not(:disabled) {
    background: var(--accent) !important;
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .right {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .qual {
    font-size: 11px;
    min-width: 40px;
    padding: 0 6px;
    color: var(--text-2);
    border: 1px solid var(--line-2);
    margin: 0 4px;
  }
  .pmenu-wrap {
    position: relative;
  }
  .pmenu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    min-width: 250px;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
  }
  .prow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 2px 2px 6px;
  }
  .mitem {
    justify-content: flex-start;
    color: var(--text);
  }
  .mitem .kbd {
    margin-left: auto;
  }
  /* by the player's own width (the side panels decide it, not the window), so the time never runs under the buttons */
  @container (max-width: 800px) {
    .frameinfo {
      display: none;
    }
  }
  @container (max-width: 760px) {
    .hide-s,
    .transport:not(.compact) .total {
      display: none;
    }
  }
  /* too narrow for one row: timecode and play on top, the view settings below */
  @container (max-width: 620px) {
    .transport:not(.compact) {
      grid-template-columns: auto 1fr;
      row-gap: 4px;
    }
    .transport:not(.compact) .buttons {
      justify-self: end;
    }
    .transport:not(.compact) .right {
      grid-column: 1 / -1;
      justify-self: center;
    }
  }
  .transport.compact {
    grid-template-columns: 1fr auto 1fr;
    padding: 4px 8px;
    min-height: 48px;
    border-top: none;
    background: var(--bg);
  }
  .compact .left {
    align-items: baseline;
    font-size: 13px;
  }
  .compact .ctime {
    color: var(--text);
  }
  .compact .play {
    width: 42px;
    height: 42px;
  }
  .compact .right {
    gap: 4px;
  }
  .compact .right button {
    width: 36px;
    height: 36px;
  }
  @media (max-width: 860px), (max-height: 500px) and (pointer: coarse) {
    canvas,
    .guides {
      inset: 0;
      width: 100%;
      height: 100%;
    }
  }
</style>
