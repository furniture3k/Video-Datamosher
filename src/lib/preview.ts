// Live edit preview: plays the timeline straight from the source files (no rendering), with
// transitions, titles and the mixed sound. The mosh itself is shown once it has been rendered.
import { getFile } from './storage';
import { mediaState } from './mediastate.svelte';
import { getPcm } from './media';
import { proxyKey } from './renderer';
import { drawTexts } from './text';
import { layoutVideo, sourceTime, speedAt, audioSources, layers, baseHidden, BLEND_TRANSITIONS, type Placed } from '../engine/timeline';
import { keyedValue } from '../engine/keys';
import { linearAt } from '../engine/track';
import { lutApplier } from '../engine/lut';
import { lutNow } from './luts.svelte';
import { gradeCurve, gradeMatrix } from '../engine/args';
import { outputSize } from '../engine/args';
import { SAMPLE_RATE } from '../engine/audio';
import { audioCtx } from './audioctx';
import { clipOn, gradeOf, isIdentityGrade, isIdentityTransform, transformOf, type Clip, type MediaItem, type Project } from '../engine/types';

const COMPOSITE: Record<string, GlobalCompositeOperation> = { normal: 'source-over', screen: 'screen', add: 'lighter', multiply: 'multiply', difference: 'difference' };

/** Opacity of a clip's picture at local time `local` (its opacity and video fades). */
export function clipAlpha(c: Clip, local: number, len: number): number {
  let a = Math.max(0, Math.min(1, keyedValue(c.keys, 'opacity', local, c.opacity ?? 1)));
  const fi = Math.min(c.vfadeIn ?? 0, len / 2);
  const fo = Math.min(c.vfadeOut ?? 0, len / 2);
  if (fi > 0.01) a *= Math.max(0, Math.min(1, local / fi));
  if (fo > 0.01) a *= Math.max(0, Math.min(1, (len - local) / fo));
  return a;
}

type Src = { url: string; proxy: boolean };

/** Colour correction on RGBA pixels: the curve, the colour matrix, then the LUT (as the render does). */
export function gradePixels(d: Uint8ClampedArray, G: ReturnType<typeof gradeOf>) {
  const colour = G.brightness || G.contrast !== 1 || G.gamma !== 1 || G.saturation !== 1 || G.hue;
  if (colour) {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.round(gradeCurve(G, i / 255) * 255);
    const m = gradeMatrix(G);
    const ident = G.saturation === 1 && !G.hue;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = lut[d[i]];
      const g = lut[d[i + 1]];
      const b = lut[d[i + 2]];
      if (ident) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      } else {
        d[i] = m[0] * r + m[1] * g + m[2] * b;
        d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
        d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
      }
    }
  }
  if (G.lut && (G.lutAmount ?? 1) > 0) {
    const l = lutNow(G.lut);
    if (l) lutApplier(l, G.lutAmount ?? 1)(d);
  }
}

/**
 * Chroma key on RGBA pixels, like FFmpeg's colorkey: distance from the key colour (0..1) below
 * `similarity` is transparent, with a soft `blend` edge; spill pulls the key channel down.
 */
export function chromaKeyPixels(d: Uint8ClampedArray, k: NonNullable<Clip['key']>) {
  const hex = k.color.replace('#', '').padEnd(6, '0');
  const kr = parseInt(hex.slice(0, 2), 16);
  const kg = parseInt(hex.slice(2, 4), 16);
  const kb = parseInt(hex.slice(4, 6), 16);
  const sim = Math.max(0.01, k.similarity);
  const blend = Math.max(0, k.blend);
  const green = kg >= kr && kg >= kb;
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - kr;
    const dg = d[i + 1] - kg;
    const db = d[i + 2] - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) / (255 * Math.sqrt(3));
    let a = 1;
    if (dist < sim) a = 0;
    else if (blend > 0 && dist < sim + blend) a = (dist - sim) / blend;
    d[i + 3] = d[i + 3] * a;
    if (k.spill && a > 0) {
      if (green) d[i + 1] = Math.min(d[i + 1], (d[i] + d[i + 2]) / 2 + 8);
      else d[i + 2] = Math.min(d[i + 2], (d[i] + d[i + 1]) / 2 + 8);
    }
  }
}

export class EditPreview {
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();
  private urls = new Map<string, Promise<Src | null>>();
  private resolved = new Map<string, Src | null>();
  private thumbs = new Map<string, HTMLImageElement>();
  /** called when something finished loading/seeking and the frame should be redrawn */
  onDirty: () => void = () => {};
  /** draw chroma-keyed clips without their key (for picking the key colour) */
  noKey = false;
  private scratch = document.createElement('canvas');
  private graded = document.createElement('canvas');

  constructor(private canvas: HTMLCanvasElement) {}

  /** The best playable URL for a media item (original if the browser can play it, else its proxy). */
  private source(m: MediaItem): Src | null {
    const st = mediaState[m.id];
    // the preview copy seeks much faster (a keyframe every 12 frames), so scrubbing keeps up
    const wantProxy = st?.proxy === 'ready';
    const key = m.id + (wantProxy ? ':p' : '');
    if (this.resolved.has(key)) return this.resolved.get(key)!;
    if (!this.urls.has(key)) {
      const p = (async () => {
        if (m.source.kind !== 'file') return null;
        if (st && st.playable === false && !wantProxy) return null;
        const blob = await getFile(wantProxy ? proxyKey(m.id) : m.source.fileId);
        return blob ? { url: URL.createObjectURL(blob), proxy: wantProxy } : null;
      })();
      this.urls.set(key, p);
      p.then((s) => {
        this.resolved.set(key, s);
        this.onDirty();
      });
    }
    return null;
  }

  private video(m: MediaItem, slot: number | string): HTMLVideoElement | null {
    const src = this.source(m);
    if (!src) return null;
    const key = `${m.id}#${slot}#${src.proxy ? 'p' : 'o'}`;
    let v = this.videos.get(key);
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      v.src = src.url;
      v.addEventListener('loadeddata', () => this.onDirty());
      v.addEventListener('seeked', () => this.onDirty());
      this.videos.set(key, v);
    }
    return v;
  }

  private image(m: MediaItem): HTMLImageElement | null {
    const src = this.source(m);
    if (!src) return null;
    let im = this.images.get(m.id);
    if (!im) {
      im = new Image();
      im.onload = () => this.onDirty();
      im.src = src.url;
      this.images.set(m.id, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  private thumb(m: MediaItem): HTMLImageElement | null {
    if (!m.thumb) return null;
    let im = this.thumbs.get(m.id);
    if (!im) {
      im = new Image();
      im.onload = () => this.onDirty();
      im.src = m.thumb;
      this.thumbs.set(m.id, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  size(p: Project) {
    return outputSize(p, Math.max(640, Math.min(1280, p.encoder.previewWidth * 2)));
  }

  /** Draw the timeline at time t. While playing, video elements run on their own and are kept in sync. */
  draw(p: Project, t: number, playing: boolean, speed = 1) {
    const { w, h } = this.size(p);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const placed = layoutVideo(p);
    const fps = p.encoder.fps;
    // at the very end of the video show its last frame, not black
    const vEnd = placed.at(-1)?.end ?? 0;
    const tv = t >= vEnd - 1e-3 && t <= vEnd + 1e-3 ? Math.max(0, vEnd - 0.5 / fps) : t;
    const visible = baseHidden(p) ? [] : placed.filter((pl) => tv >= pl.start - 1e-6 && tv < pl.end && clipOn(pl.clip));
    const used = new Set<HTMLVideoElement>();
    let waiting = false;
    let unavailable = false;

    /** The picture of a clip at timeline time tt (a playing / seeking video, an image or a thumbnail). */
    const source = (c: Clip, m: MediaItem, start: number, slot: number | string, tt: number): CanvasImageSource | null => {
      if (m.source.kind === 'file' && m.source.isImage) return this.image(m) ?? this.thumb(m);
      const v = this.video(m, slot);
      if (!v || v.readyState < 2) {
        const st = mediaState[m.id];
        // old projects' generated clips have no file; neither do files the browser can't play without a preview copy
        if (m.source.kind === 'generator' || (st?.playable === false && st.proxy === 'failed')) unavailable = true;
        else waiting = true;
        if (v) used.add(v);
        return this.thumb(m);
      }
      used.add(v);
      const target = sourceTime(c, tt - start);
      const rate = speedAt(c, tt - start) * speed;
      if (playing && !c.reverse && !c.freeze && rate >= 0.0625 && rate <= 16) {
        if (Math.abs(v.playbackRate - rate) > 1e-3) v.playbackRate = rate;
        if (v.paused) {
          v.currentTime = target;
          v.play().catch(() => {});
        } else if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.5 / fps && !v.seeking) v.currentTime = target;
      }
      return v;
    };
    const layer = (pl: Placed) => source(pl.clip, pl.media, pl.start, pl.index % 2, tv);

    if (visible.length) {
      const a = visible[0];
      const b = visible[1];
      const imgA = layer(a);
      if (b && b.overlap > 0) {
        const imgB = layer(b);
        const prog = Math.max(0, Math.min(1, (tv - b.start) / b.overlap));
        this.blend(ctx, w, h, a, imgA, b, imgB, prog, tv);
      } else if (imgA) this.paint(ctx, imgA, a.clip, w, h, clipAlpha(a.clip, tv - a.start, a.end - a.start), 'source-over', 0, tv - a.start);
    }

    // clips on the upper video tracks, bottom track first
    for (const l of layers(p)) {
      if (t < l.start - 1e-6 || t >= l.end) continue;
      if (l.media.source.kind === 'adjust') {
        this.adjust(ctx, l.clip, w, h, clipAlpha(l.clip, t - l.start, l.end - l.start));
        continue;
      }
      const img = source(l.clip, l.media, l.start, 'L' + l.clip.id, t);
      if (img) this.paint(ctx, img, l.clip, w, h, clipAlpha(l.clip, t - l.start, l.end - l.start), COMPOSITE[l.clip.blend ?? 'normal'], 0, t - l.start);
    }

    // get the next clip ready so cuts don't stall
    const next = placed.find((pl) => pl.start > t && pl.start - t < 1.5);
    if (next && !(next.media.source.kind === 'file' && next.media.source.isImage)) {
      const v = this.video(next.media, next.index % 2);
      if (v) {
        used.add(v);
        if (!v.paused) v.pause();
        const target = sourceTime(next.clip, 0);
        if (v.readyState >= 1 && Math.abs(v.currentTime - target) > 0.1 && !v.seeking) v.currentTime = target;
      }
    }
    for (const v of this.videos.values()) if (!used.has(v) && !v.paused) v.pause();

    drawTexts(ctx, p.texts, t, w, h, 'all');
    if (waiting || unavailable) {
      const msg = unavailable ? "this browser can't preview this file live (the mosh view works)" : 'preparing preview…';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, h - 22, ctx.measureText(msg).width + 16, 22);
      ctx.fillStyle = '#ccc';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, 8, h - 11);
    }
  }

  private rect(img: CanvasImageSource, fit: string, w: number, h: number): [number, number, number, number] {
    const iw = (img as HTMLVideoElement).videoWidth || (img as HTMLImageElement).naturalWidth || w;
    const ih = (img as HTMLVideoElement).videoHeight || (img as HTMLImageElement).naturalHeight || h;
    if (fit === 'stretch') return [0, 0, w, h];
    const s = fit === 'fill' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * s;
    const dh = ih * s;
    return [(w - dw) / 2, (h - dh) / 2, dw, dh];
  }

  /**
   * Draw a clip's picture: fitted to the frame, then cropped, flipped, zoomed, rotated and moved
   * (its Transform), colour corrected (its Grade), at opacity `alpha`. Same order as the render.
   */
  private paint(ctx: CanvasRenderingContext2D, img: CanvasImageSource, c: Clip, w: number, h: number, alpha = 1, op: GlobalCompositeOperation = 'source-over', dx = 0, local = 0) {
    if (alpha <= 0) return;
    const T0 = transformOf(c);
    // keyframed properties at this moment
    const T = { ...T0, x: keyedValue(c.keys, 'x', local, T0.x), y: keyedValue(c.keys, 'y', local, T0.y), zoom: keyedValue(c.keys, 'zoom', local, T0.zoom), rotate: keyedValue(c.keys, 'rotate', local, T0.rotate) };
    const G = gradeOf(c);
    const keyed = !!c.key && c.track !== 'v1' && !this.noKey;
    const graded = !isIdentityGrade(G) || keyed;
    let target = ctx;
    if (graded) {
      if (this.graded.width !== w || this.graded.height !== h) {
        this.graded.width = w;
        this.graded.height = h;
      }
      target = this.graded.getContext('2d', { willReadFrequently: true })!;
      target.clearRect(0, 0, w, h);
    } else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = op;
    }
    const [x, y, dw, dh] = this.rect(img, c.fit, w, h);
    target.save();
    if (dx) target.translate(dx, 0);
    if (!isIdentityTransform(T)) {
      target.translate(w / 2 + T.x * w, h / 2 + T.y * h);
      target.rotate((T.rotate * Math.PI) / 180);
      target.scale(T.zoom * (T.flipH ? -1 : 1), T.zoom * (T.flipV ? -1 : 1));
      target.translate(-w / 2, -h / 2);
      if (T.cropL || T.cropR || T.cropT || T.cropB) {
        target.beginPath();
        target.rect(w * T.cropL, h * T.cropT, w * Math.max(0, 1 - T.cropL - T.cropR), h * Math.max(0, 1 - T.cropT - T.cropB));
        target.clip();
      }
    }
    if (c.stab && !c.freeze) {
      // stabilization: zoom in, then shift and turn by the correction at this source time
      const st = sourceTime(c, local);
      const z = Math.max(1, Math.min(1.5, c.stab.zoom));
      target.beginPath();
      target.rect(x, y, dw, dh);
      target.clip();
      target.translate(x + dw / 2 + linearAt(c.stab.x, st) * dw * z, y + dh / 2 + linearAt(c.stab.y, st) * dh * z);
      target.rotate((linearAt(c.stab.r, st) * Math.PI) / 180);
      target.scale(z, z);
      target.translate(-(x + dw / 2), -(y + dh / 2));
    }
    try {
      target.drawImage(img, x, y, dw, dh);
    } catch {
      /* not ready */
    }
    target.restore();
    if (!graded) return ctx.restore();
    // colour correction on the pixels: a curve, then a colour matrix (as the render does)
    let px: ImageData;
    try {
      px = target.getImageData(0, 0, w, h);
    } catch {
      return;
    }
    if (keyed) chromaKeyPixels(px.data, c.key!);
    gradePixels(px.data, G);
    target.putImageData(px, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(this.graded, 0, 0);
    ctx.restore();
  }

  /** Adjustment layer: re-grade everything drawn so far, mixed in at `alpha`. */
  private adjust(ctx: CanvasRenderingContext2D, c: Clip, w: number, h: number, alpha: number) {
    const G = gradeOf(c);
    if (alpha <= 0 || isIdentityGrade(G)) return;
    let px: ImageData;
    try {
      px = ctx.getImageData(0, 0, w, h);
    } catch {
      return;
    }
    gradePixels(px.data, G);
    if (this.graded.width !== w || this.graded.height !== h) {
      this.graded.width = w;
      this.graded.height = h;
    }
    this.graded.getContext('2d')!.putImageData(px, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.graded, 0, 0);
    ctx.restore();
  }

  private blend(ctx: CanvasRenderingContext2D, w: number, h: number, a: Placed, imgA: CanvasImageSource | null, b: Placed, imgB: CanvasImageSource | null, p: number, tv: number) {
    const type = b.clip.transition?.type ?? 'dissolve';
    const xf = BLEND_TRANSITIONS[type]?.xfade ?? 'fade';
    const alA = clipAlpha(a.clip, tv - a.start, a.end - a.start);
    const alB = clipAlpha(b.clip, tv - b.start, b.end - b.start);
    const drawA = (dx = 0) => imgA && this.paint(ctx, imgA, a.clip, w, h, alA * ctx.globalAlpha, 'source-over', dx, tv - a.start);
    const drawB = (dx = 0) => imgB && this.paint(ctx, imgB, b.clip, w, h, alB * ctx.globalAlpha, 'source-over', dx, tv - b.start);
    const clipped = (r: () => void, fn: () => void) => {
      ctx.save();
      ctx.beginPath();
      r();
      ctx.clip();
      fn();
      ctx.restore();
    };
    switch (xf) {
      case 'fadeblack':
      case 'fadewhite': {
        const col = xf === 'fadeblack' ? '#000' : '#fff';
        if (p < 0.5) drawA();
        else drawB();
        ctx.globalAlpha = p < 0.5 ? p * 2 : (1 - p) * 2;
        ctx.fillStyle = col;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        break;
      }
      case 'wipeleft':
        drawA();
        clipped(() => ctx.rect(w * (1 - p), 0, w * p, h), drawB);
        break;
      case 'wiperight':
        drawA();
        clipped(() => ctx.rect(0, 0, w * p, h), drawB);
        break;
      case 'wipeup':
        drawA();
        clipped(() => ctx.rect(0, h * (1 - p), w, h * p), drawB);
        break;
      case 'wipedown':
        drawA();
        clipped(() => ctx.rect(0, 0, w, h * p), drawB);
        break;
      case 'slideleft':
        drawA(-w * p);
        drawB(w * (1 - p));
        break;
      case 'slideright':
        drawA(w * p);
        drawB(-w * (1 - p));
        break;
      case 'circleopen':
        drawA();
        clipped(() => ctx.arc(w / 2, h / 2, (p * Math.hypot(w, h)) / 2, 0, Math.PI * 2), drawB);
        break;
      case 'pixelize': {
        const block = 1 + Math.sin(p * Math.PI) * 40;
        const sw = Math.max(1, Math.round(w / block));
        const sh = Math.max(1, Math.round(h / block));
        this.scratch.width = sw;
        this.scratch.height = sh;
        const sc = this.scratch.getContext('2d')!;
        sc.fillStyle = '#000';
        sc.fillRect(0, 0, sw, sh);
        const img = p < 0.5 ? imgA : imgB;
        const pl = p < 0.5 ? a : b;
        if (img) {
          const [x, y, dw, dh] = this.rect(img, pl.clip.fit, sw, sh);
          try {
            sc.drawImage(img, x, y, dw, dh);
          } catch {
            /* not ready */
          }
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.scratch, 0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        break;
      }
      default:
        drawA();
        ctx.globalAlpha = p;
        drawB();
        ctx.globalAlpha = 1;
    }
  }

  pauseAll() {
    for (const v of this.videos.values()) if (!v.paused) v.pause();
  }

  dispose() {
    this.pauseAll();
    for (const v of this.videos.values()) {
      v.removeAttribute('src');
      v.load();
    }
    this.videos.clear();
    for (const p of this.urls.values()) p.then((s) => s && URL.revokeObjectURL(s.url));
    this.urls.clear();
    this.resolved.clear();
  }
}

/** Sound for the edit preview: every clip scheduled with Web Audio from its decoded samples. */
export class EditAudio {
  private ctx: AudioContext | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private buffers = new Map<string, AudioBuffer>();

  private buffer(m: MediaItem, pcm: Int16Array, reverse: boolean): AudioBuffer {
    const key = m.id + (reverse ? ':r' : '');
    let b = this.buffers.get(key);
    if (b) return b;
    const n = Math.floor(pcm.length / 2);
    b = this.ctx!.createBuffer(2, Math.max(1, n), SAMPLE_RATE);
    const L = b.getChannelData(0);
    const R = b.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const k = reverse ? n - 1 - i : i;
      L[i] = pcm[k * 2] / 32768;
      R[i] = pcm[k * 2 + 1] / 32768;
    }
    this.buffers.set(key, b);
    return b;
  }

  /** Start playing the mix from timeline time t. Clips whose sound is still decoding stay silent. */
  async start(p: Project, t: number, muted: boolean) {
    this.stop();
    if (muted) return;
    this.ctx ??= audioCtx();
    const ctx = this.ctx;
    ctx.resume();
    const gen = ++this.gen;
    const srcs = audioSources(p).filter((s) => s.start + s.len > t);
    // decoded sound that is ready now (anything still decoding stays silent this time)
    const pcms = await Promise.all(srcs.map((s) => Promise.race([getPcm(s.media), new Promise<null>((r) => setTimeout(() => r(null), 25))])));
    if (gen !== this.gen) return;
    const bufs = srcs.map((s, i) => (pcms[i] ? this.buffer(s.media, pcms[i]!, s.clip.reverse) : null));
    const base = ctx.currentTime + 0.03;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      const buf = bufs[i];
      if (!buf) continue;
      const c = s.clip;
      const local = Math.max(0, t - s.start);
      const offset = c.reverse ? buf.duration - c.out + local * c.speed : c.in + local * c.speed;
      const when = base + Math.max(0, s.start - t);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = c.speed;
      const g = ctx.createGain();
      const vol = s.gain * p.audio.volume;
      // fades, in timeline time converted to audio-clock time
      const ct = (tt: number) => when + (tt - Math.max(t, s.start));
      const gainAt = (tt: number) => {
        let k = 1;
        if (s.fadeIn > 0) k = Math.min(k, (tt - s.start) / s.fadeIn);
        if (s.fadeOut > 0) k = Math.min(k, (s.start + s.len - tt) / s.fadeOut);
        return Math.max(0, Math.min(1, k)) * vol;
      };
      const t0 = Math.max(t, s.start);
      g.gain.setValueAtTime(gainAt(t0), when);
      const fiEnd = s.start + s.fadeIn;
      if (s.fadeIn > 0 && fiEnd > t0) g.gain.linearRampToValueAtTime(gainAt(fiEnd), ct(fiEnd));
      const foStart = s.start + s.len - s.fadeOut;
      if (s.fadeOut > 0) {
        if (foStart > t0) g.gain.setValueAtTime(gainAt(foStart), ct(foStart));
        g.gain.linearRampToValueAtTime(0, ct(s.start + s.len));
      }
      node.connect(g).connect(ctx.destination);
      const dur = Math.max(0, (s.len - local) * c.speed);
      if (offset >= 0 && offset < buf.duration && dur > 0) {
        node.start(when, offset, dur);
        this.nodes.push(node);
      }
    }
  }
  private gen = 0;

  stop() {
    this.gen++;
    for (const n of this.nodes)
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    this.nodes = [];
  }

  dispose() {
    this.stop();
    this.buffers.clear();
    this.ctx = null;
  }
}
