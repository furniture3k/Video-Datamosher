// Applies pixel/flow effects to decoded frames (JPEG in, JPEG out).
import { GL, COPY, type Target } from './gl';
import { FlowEngine, CHROMA, defaultFlow, type FlowParams } from './flow';
import { rasterizeField, encodeField, FIELD_MAX, type Stroke } from '../engine/flowfield';
import { personMask } from './segment';
import { paintedMask, mediaMap, depthMap, type MaskStroke } from './maps';
import { VHS, CRT, GRAIN, POSTERIZE } from './retro';

const RETRO: Record<string, string> = { vhs: VHS, crt: CRT, grain: GRAIN, posterize: POSTERIZE };
import { pathOnTimeline, pathSize, pathAt, guardPath } from './motion.svelte';
import { outputSize } from '../engine/args';
import { activeEffects, allEffects } from '../engine/mosh';
import { EFFECTS } from '../engine/effects';
import { paramAt } from '../engine/automation';
import { withChaos } from '../engine/chaos';
import { bend, type BendMode, type BendOptions } from '../engine/dsp';
import { bakeAudio, type MoshAudio } from '../engine/audiofx';
import { makeRng, hashSeed } from '../engine/rng';
import type { EffectInstance, Frame, Project } from '../engine/types';
import type { TextLayer } from '../engine/layers';
import { anyLayerAt, drawLayers } from './layers';
import { Cancelled } from './ffmpeg';

/** Pixel effects in the order they run: Subject Guards last, so what they keep clean stays clean. */
export function pixelEffectsOf(project: Project, audio?: MoshAudio): EffectInstance[] {
  const fx = activeEffects(allEffects(project))
    .filter((e) => EFFECTS[e.type].kind === 'pixel')
    .map((e) => bakeAudio(withChaos(e, project.chaos), audio, project));
  return [...fx.filter((e) => e.type !== 'mask'), ...fx.filter((e) => e.type === 'mask')];
}

const tOf = (src: number, e: EffectInstance) => (src - e.start) / Math.max(1, e.end - e.start - 1);

export function flowParamsAt(e: EffectInstance, t: number): FlowParams {
  const n = (k: string) => Number(paramAt(e, k, t));
  return {
    amplify: n('amplify'),
    rotate: n('rotate'),
    swap: Boolean(paramAt(e, 'swap', t)),
    drift: n('drift'),
    driftY: n('driftY'),
    turbulence: n('turbulence'),
    quantize: n('quantize'),
    threshold: n('threshold'),
    block: Number(e.params.block),
    search: n('search'),
    smooth: Boolean(paramAt(e, 'smooth', t)),
    residual: n('residual'),
    refresh: n('refresh'),
    mix: n('mix'),
  };
}

export function pixelSort(px: Uint8Array, w: number, h: number, low: number, high: number, vertical: boolean, reverse: boolean) {
  const len = vertical ? h : w;
  const lines = vertical ? w : h;
  const n = w * h;
  // whole pixels as one number each (copied when the bytes don't start on a 4-byte boundary)
  const aligned = px.byteOffset % 4 === 0;
  const u32 = aligned ? new Uint32Array(px.buffer, px.byteOffset, n) : new Uint32Array(px.slice(0, n * 4).buffer);
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  const ord = new Uint32Array(len);
  const key = new Float64Array(len);
  const pix = new Uint32Array(len);
  // stable: equal brightness keeps its order
  const cmp = reverse ? (a: number, b: number) => key[b] - key[a] || a - b : (a: number, b: number) => key[a] - key[b] || a - b;
  for (let line = 0; line < lines; line++) {
    const base = vertical ? line : line * w;
    const stride = vertical ? w : 1;
    let k = 0;
    while (k < len) {
      while (k < len && !(lum[base + k * stride] >= low && lum[base + k * stride] <= high)) k++;
      const s = k;
      while (k < len && lum[base + k * stride] >= low && lum[base + k * stride] <= high) k++;
      const m = k - s;
      if (m < 2) continue;
      for (let j = 0; j < m; j++) {
        const q = base + (s + j) * stride;
        ord[j] = j;
        key[j] = lum[q];
        pix[j] = u32[q];
      }
      const o = ord.subarray(0, m).sort(cmp);
      for (let j = 0; j < m; j++) u32[base + (s + j) * stride] = pix[o[j]];
    }
  }
  if (!aligned) px.set(new Uint8Array(u32.buffer));
}

/** Raw Bend: the RGB values of an RGBA image as one long signal through an audio effect (in place). */
export function rawBendPixels(px: Uint8Array, o: BendOptions) {
  const n = px.length / 4;
  const x = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) x[i * 3 + c] = (px[i * 4 + c] - 128) / 128;
  const y = bend(x, o);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.max(0, Math.min(255, Math.round(y[i * 3 + c] * 128 + 128)));
}

// ---------- Subject Guard shaders ----------

/**
 * The mask (white = subject) from the clean picture, a map (people, painted, a picture or video,
 * depth), an oval, or a gradient.
 */
const MASKGEN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D clean; uniform sampler2D person; uniform float mode; uniform float thr;
uniform vec2 center; uniform vec2 radius; uniform vec3 key; uniform vec2 dir; uniform float spread; uniform float aspect;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 c = texture(clean, uv).rgb;
  float m;
  if (mode < 0.5) m = texture(person, uv).r;
  else if (mode > 4.5 && mode < 5.5) m = clamp(0.5 - dot(uv - center, dir) / spread, 0., 1.);
  else if (mode > 5.5) m = 1. - smoothstep(0., spread, length((uv - center) * vec2(aspect, 1.)));
  else if (mode < 1.5) m = 1. - smoothstep(0.8, 1.0, length((uv - center) / radius));
  else if (mode < 2.5) m = smoothstep(thr - 0.05, thr + 0.05, lum(c));
  else if (mode < 3.5) m = 1. - smoothstep(thr - 0.05, thr + 0.05, lum(c));
  else m = 1. - smoothstep(thr * 0.6 - 0.04, thr * 0.6 + 0.04, distance(c, key) / 1.7320508);
  o = vec4(m, m, m, 1.);
}`;

/** One direction of a 9-tap Gaussian (`dir` = uv step per tap). */
const BLUR = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D src; uniform vec2 dir;
void main(){
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec4 s = texture(src, uv) * w[0];
  for (int i = 1; i < 5; i++) { s += texture(src, uv + dir * float(i)) * w[i]; s += texture(src, uv - dir * float(i)) * w[i]; }
  o = s;
}`;

/** Mosh where the mask says, clean picture elsewhere (or the other way round). */
const MASKMIX = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D cur; uniform sampler2D clean; uniform sampler2D mask;
uniform float expand; uniform float soft; uniform float keepBg; uniform float amt; uniform float cont;
void main(){
  float v = texture(mask, uv).r;
  // maps blend (grey moshes half way); the other sources are a cut-out
  float m = cont > 0.5 ? clamp(v + expand * 2., 0., 1.) : smoothstep(0.5 - expand - soft, 0.5 - expand + soft, v);
  if (keepBg > 0.5) m = 1. - m;
  o = vec4(mix(texture(cur, uv).rgb, texture(clean, uv).rgb, clamp(m * amt, 0., 1.)), 1.);
}`;

const MASK_MODES: Record<string, number> = { person: 0, paint: 0, media: 0, depth: 0, track: 1, luma: 2, dark: 3, chroma: 4, gradient: 5 };
/** Sources whose mask is a picture of its own (drawn into the `person` texture). */
const PICTURE_SOURCES = new Set(['person', 'paint', 'media', 'depth']);
/** Sources that blend by their grey level instead of cutting out. */
const MAP_SOURCES = new Set(['gradient', 'paint', 'media', 'depth']);

/** What Subject Guard needs for one frame, worked out before it is processed. */
export interface FrameExtras {
  clean?: ImageBitmap | null;
  /** people mask of the clean frame (grayscale, white = person) */
  person?: CanvasImageSource | null;
  /** effect id → tracked box [centre x, centre y, width, height] (shares of the frame) */
  track?: Map<string, [number, number, number, number] | null>;
  /** effect id → its map (painted, from media, depth) */
  maps?: Map<string, CanvasImageSource | null>;
}

const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '').padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};

export class PostProcessor {
  gl: GL;
  canvas: HTMLCanvasElement;
  private input: Target;
  private a: Target;
  private b: Target;
  private flows = new Map<string, FlowEngine>();
  private wasActive = new Map<string, boolean>();
  private cleanT: Target | null = null;
  private personT: Target | null = null;
  private maskA: Target | null = null;
  private maskB: Target | null = null;
  private fields = new Map<string, { key: string; t: Target }>();
  private scratch = document.createElement('canvas');
  constructor(public w: number, public h: number, public fps = 24) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl = new GL(this.canvas);
    this.input = this.gl.target(w, h);
    this.a = this.gl.target(w, h);
    this.b = this.gl.target(w, h);
  }

  /** process one frame bitmap through the active effects; result is drawn on this.canvas */
  /** Flow Paint's field as a texture (rebuilt when the strokes change). */
  private field(e: EffectInstance): Target {
    const strokes = (e.data?.strokes as Stroke[] | undefined) ?? [];
    const key = JSON.stringify(strokes);
    const hit = this.fields.get(e.id);
    if (hit && hit.key === key) return hit.t;
    const gw = 64;
    const gh = Math.max(4, Math.round((64 * this.h) / this.w));
    const enc = encodeField(rasterizeField(strokes, gw, gh, this.w / this.h), gw, gh);
    this.scratch.width = gw;
    this.scratch.height = gh;
    this.scratch.getContext('2d')!.putImageData(new ImageData(enc, gw, gh), 0, 0);
    const t = hit && hit.t.w === gw && hit.t.h === gh ? hit.t : this.gl.target(gw, gh);
    this.gl.upload(t, this.scratch);
    this.fields.set(e.id, { key, t });
    return t;
  }

  /** Subject Guard: build the mask, soften it, and bring the clean picture back through it. */
  private guard(e: EffectInstance, t: number, cur: Target, other: Target, x: FrameExtras): boolean {
    const gl = this.gl;
    if (!x.clean) return false;
    const source = String(e.params.source);
    const picture = source === 'person' ? x.person : PICTURE_SOURCES.has(source) ? x.maps?.get(e.id) : null;
    if (PICTURE_SOURCES.has(source) && !picture) return false;
    const pt = source === 'track' ? x.track?.get(e.id) : null;
    if (source === 'track' && !pt) return false;
    this.cleanT ??= gl.target(this.w, this.h);
    gl.upload(this.cleanT, x.clean);
    const mw = Math.max(8, Math.ceil(this.w / 2));
    const mh = Math.max(8, Math.ceil(this.h / 2));
    this.maskA ??= gl.target(mw, mh);
    this.maskB ??= gl.target(mw, mh);
    if (picture) {
      const pc = picture as HTMLCanvasElement;
      if (!this.personT || this.personT.w !== pc.width || this.personT.h !== pc.height) {
        gl.dispose(this.personT);
        this.personT = gl.target(pc.width, pc.height);
      }
      gl.upload(this.personT, pc);
    }
    const ang = (Number(paramAt(e, 'angle', t)) * Math.PI) / 180;
    // the oval's half-axes: the tracked box, scaled
    const scale = Number(paramAt(e, 'scale', t) ?? 1.4) || 1.4;
    const col = hexRgb(String(e.data?.color ?? '#00ff00'));
    gl.pass(MASKGEN, this.maskA, { clean: this.cleanT.tex, person: (this.personT ?? this.cleanT).tex }, {
      mode: source === 'gradient' && e.params.shape === 'radial' ? 6 : (MASK_MODES[source] ?? 2),
      thr: Number(paramAt(e, 'threshold', t)),
      center: pt ? [pt[0], 1 - pt[1]] : source === 'gradient' ? [Number(paramAt(e, 'gx', t)), 1 - Number(paramAt(e, 'gy', t))] : [0.5, 0.5],
      radius: pt ? [Math.max(0.005, (pt[2] / 2) * scale), Math.max(0.005, (pt[3] / 2) * scale)] : [0.2, 0.2],
      key: col,
      dir: [Math.cos(ang), -Math.sin(ang)],
      spread: Math.max(0.01, Number(paramAt(e, 'spread', t))),
      aspect: this.w / this.h,
    });
    const feather = Number(paramAt(e, 'feather', t));
    if (feather > 0) {
      const step = feather / 4;
      gl.pass(BLUR, this.maskB, { src: this.maskA.tex }, { dir: [step, 0] });
      gl.pass(BLUR, this.maskA, { src: this.maskB.tex }, { dir: [0, (step * this.w) / this.h] });
    }
    gl.pass(MASKMIX, other, { cur: cur.tex, clean: this.cleanT.tex, mask: this.maskA.tex }, {
      expand: Number(paramAt(e, 'expand', t)) * 0.5,
      soft: 0.04 + feather * 2,
      keepBg: e.params.keep === 'background' ? 1 : 0,
      amt: Number(paramAt(e, 'mix', t)),
      cont: MAP_SOURCES.has(source) ? 1 : 0,
    });
    return true;
  }

  processFrame(bmp: ImageBitmap, frame: Pick<Frame, 'src' | 'at'>, index: number, effects: EffectInstance[], extras: FrameExtras = {}) {
    const gl = this.gl;
    gl.upload(this.input, bmp);
    gl.pass(COPY, this.a, { src: this.input.tex });
    let cur = this.a;
    let other = this.b;
    for (const e of effects) {
      const pos = frame.at ?? frame.src;
      const active = pos >= e.start && pos < e.end;
      const was = this.wasActive.get(e.id);
      this.wasActive.set(e.id, active);
      if (e.type === 'vectorWarp') {
        let fe = this.flows.get(e.id);
        if (!fe) this.flows.set(e.id, (fe = new FlowEngine(gl, this.w, this.h)));
        if (!active) {
          fe.reset();
          continue;
        }
        if (!was) fe.reset();
        const out = fe.step(cur, flowParamsAt(e, tOf(pos, e)));
        gl.pass(COPY, other, { src: out.tex });
        [cur, other] = [other, cur];
        continue;
      }
      if (e.type === 'flowPaint') {
        let fe = this.flows.get(e.id);
        if (!fe) this.flows.set(e.id, (fe = new FlowEngine(gl, this.w, this.h)));
        if (!active) {
          fe.reset();
          continue;
        }
        if (!was) fe.reset();
        const tt = tOf(pos, e);
        const n = (k: string) => Number(paramAt(e, k, tt));
        const out = fe.step(cur, { ...defaultFlow(), amplify: n('follow'), threshold: 0.3, residual: n('residual'), refresh: n('refresh'), turbulence: n('turbulence'), mix: 1, smooth: true }, { field: this.field(e), amount: n('strength'), max: FIELD_MAX });
        gl.pass(COPY, other, { src: out.tex });
        [cur, other] = [other, cur];
        continue;
      }
      if (!active) continue;
      const t = tOf(pos, e);
      if (e.type === 'mask') {
        if (this.guard(e, t, cur, other, extras)) [cur, other] = [other, cur];
        continue;
      }
      if (e.type === 'chroma') {
        const rng = makeRng(hashSeed(e.seed, index));
        const wob = Number(paramAt(e, 'wobble', t));
        const off = Number(paramAt(e, 'offset', t)) * (1 + wob * (rng() * 2 - 1));
        const ang = ((Number(paramAt(e, 'angle', t)) + wob * 90 * (rng() * 2 - 1)) * Math.PI) / 180;
        gl.pass(CHROMA, other, { src: cur.tex }, { size: [this.w, this.h], off: [Math.cos(ang) * off, Math.sin(ang) * off], tear: Number(paramAt(e, 'scanTear', t)), seed: index % 997 });
        [cur, other] = [other, cur];
      } else if (RETRO[e.type]) {
        const n = (k: string) => Number(paramAt(e, k, t));
        const common = { size: [this.w, this.h], time: index / this.fps, seed: (e.seed % 997) + (index % 101) };
        const u: Record<string, Record<string, number | number[]>> = {
          vhs: { tracking: n('tracking'), bleed: n('bleed'), noise: n('noise'), wobble: n('wobble'), colour: n('colour') },
          crt: { curve: n('curve'), scan: n('scan'), mask: n('mask'), glow: n('glow'), vignette: n('vignette') },
          grain: { amount: n('amount'), grain: n('grain'), colour: paramAt(e, 'colour', t) ? 1 : 0, fade: n('fade') },
          posterize: { levels: n('levels'), dither: ({ none: 0, bayer: 1, noise: 2 } as Record<string, number>)[String(e.params.dither)] ?? 1, pixel: n('pixel'), mixAmt: n('mix') },
        };
        gl.pass(RETRO[e.type], other, { src: cur.tex }, { ...common, ...u[e.type] });
        [cur, other] = [other, cur];
      } else if (e.type === 'rawbend') {
        const px = gl.read(cur);
        rawBendPixels(px, {
          mode: String(e.params.mode) as BendMode,
          delay: Number(paramAt(e, 'delay', t)) * 3,
          feedback: Number(paramAt(e, 'feedback', t)),
          mix: Number(paramAt(e, 'mix', t)),
          amount: e.params.mode === 'crush' ? Number(paramAt(e, 'bits', t)) : Number(paramAt(e, 'gain', t)),
          wrap: Boolean(paramAt(e, 'wrap', t)),
        });
        gl.uploadPixels(cur, px);
      } else if (e.type === 'pixelSort') {
        const px = gl.read(cur);
        pixelSort(px, this.w, this.h, Number(paramAt(e, 'low', t)), Number(paramAt(e, 'high', t)), e.params.direction === 'vertical', Boolean(paramAt(e, 'reverse', t)));
        gl.uploadPixels(cur, px);
      }
    }
    gl.pass(COPY, null, { src: cur.tex });
  }

  toJpeg(quality = 0.9): Promise<Uint8Array> {
    return new Promise((res, rej) =>
      this.canvas.toBlob(
        (b) => (b ? b.arrayBuffer().then((x) => res(new Uint8Array(x))) : rej(new Error('encode failed'))),
        'image/jpeg',
        quality,
      ),
    );
  }

  dispose() {
    this.flows.forEach((f) => f.dispose());
    this.fields.forEach((f) => this.gl.dispose(f.t));
    this.gl.dispose(this.input, this.a, this.b, this.cleanT, this.personT, this.maskA, this.maskB);
    this.gl.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Runs pixel effects over decoded frames in chunks, keeping effect state (flow) between chunks. */
export class PostRunner {
  private pp: PostProcessor | null = null;
  private effects: EffectInstance[];
  private layers: TextLayer[];
  private fps: number;
  private c2d: HTMLCanvasElement | null = null;
  /** Subject Guards on a tracked object: its path on the timeline and the box's size */
  private paths = new Map<string, { pts: [number, number, number][]; size: [number, number] }>();
  private personCache = new Map<number, HTMLCanvasElement>();
  private depthCache = new Map<number, HTMLCanvasElement>();
  private project: Project;
  /** withTexts: also draw clean (non-melting) titles into the frames, for exports */
  constructor(
    project: Project,
    private quality: number,
    withTexts = false,
    audio?: MoshAudio,
    private clean?: { get(pos: number): Promise<Uint8Array | null> },
  ) {
    this.project = project;
    this.effects = pixelEffectsOf(project, audio);
    // tracked objects for Subject Guard, as timeline paths
    for (const e of this.effects) {
      if (e.type !== 'mask' || e.params.source !== 'track') continue;
      const gp = guardPath(project, e.data);
      const c = gp && project.clips.find((x) => x.id === gp.clipId);
      if (!c) continue;
      const pts = pathOnTimeline(project, c, gp.pathId);
      const { w, h } = outputSize(project, project.encoder.previewWidth);
      // tracks from before boxes were kept: the oval the guard's old Oval size gave (its radius
      // was a share of the frame width), at the default scale
      const old = Number(e.params.size) > 0 ? Number(e.params.size) : 0.18;
      const legacy: [number, number] = [(2 * old) / 1.4, (2 * old * w) / h / 1.4];
      if (pts.length) this.paths.set(e.id, { pts, size: pathSize(project, c, gp.pathId) ?? legacy });
    }
    this.layers = withTexts ? (project.layers ?? []).filter((t) => !t.moshed && t.text.trim()) : [];
    this.fps = project.encoder.fps;
  }
  get active() {
    return this.effects.length > 0 || this.layers.length > 0;
  }

  /** jpegs[i] is output frame offset + i */
  async run(jpegs: Uint8Array[], frames: Pick<Frame, 'src' | 'at'>[], offset: number, onProgress?: (p: number) => void, signal?: { cancelled: boolean }): Promise<Uint8Array[]> {
    if (!this.active || !jpegs.length) return jpegs;
    const out: Uint8Array[] = [];
    for (let i = 0; i < jpegs.length; i++) {
      if (signal?.cancelled) throw new Cancelled();
      const bmp = await createImageBitmap(new Blob([jpegs[i] as BlobPart], { type: 'image/jpeg' }));
      let extras: FrameExtras = {};
      // bitmaps hold decoded pixels (often GPU memory) until closed: also when a frame fails
      try {
        const k = offset + i;
        const fr = frames[Math.min(k, frames.length - 1)] ?? { src: k };
        let src: CanvasImageSource = bmp;
        if (this.effects.length) {
          this.pp ??= new PostProcessor(bmp.width, bmp.height, this.fps);
          extras = await this.extrasFor(fr, bmp.width, bmp.height);
          this.pp.processFrame(bmp, fr, k, this.effects, extras);
          src = this.pp.canvas;
        }
        if (this.layers.length) {
          const t = (fr.at ?? fr.src) / this.fps;
          if (anyLayerAt(this.layers, t, 'clean')) {
            this.c2d ??= document.createElement('canvas');
            this.c2d.width = bmp.width;
            this.c2d.height = bmp.height;
            const ctx = this.c2d.getContext('2d')!;
            ctx.drawImage(src, 0, 0);
            drawLayers(ctx, this.layers, t, bmp.width, bmp.height, 'clean');
            src = this.c2d;
          }
        }
        if (src === bmp) out.push(jpegs[i]);
        else out.push(await canvasJpeg(src as HTMLCanvasElement, this.quality));
      } finally {
        extras.clean?.close();
        bmp.close();
      }
      if (i % 4 === 0) onProgress?.(i / jpegs.length);
    }
    return out;
  }

  /** Clean picture, people mask and tracked points for a frame, if a Subject Guard covers it. */
  private async extrasFor(fr: Pick<Frame, 'src' | 'at'>, w: number, h: number): Promise<FrameExtras> {
    const pos = fr.at ?? fr.src;
    const guards = this.effects.filter((e) => e.type === 'mask' && pos >= e.start && pos < e.end);
    if (!guards.length || !this.clean) return {};
    const jpeg = await this.clean.get(pos);
    if (!jpeg) return {};
    const blob = new Blob([jpeg as BlobPart], { type: 'image/jpeg' });
    const clean = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h });
    try {
      return await this.guardExtras(pos, guards, clean, w, h);
    } catch (e) {
      clean.close();
      throw e;
    }
  }

  private async guardExtras(pos: number, guards: EffectInstance[], clean: ImageBitmap, w: number, h: number): Promise<FrameExtras> {
    let person: HTMLCanvasElement | null = null;
    if (guards.some((e) => e.params.source === 'person')) {
      person = this.personCache.get(pos) ?? null;
      if (!person) {
        person = await personMask(clean);
        if (this.personCache.size > 240) this.personCache.clear();
        this.personCache.set(pos, person);
      }
    }
    const maps = new Map<string, CanvasImageSource | null>();
    for (const e of guards) {
      const src = e.params.source;
      if (src === 'paint') maps.set(e.id, paintedMask(e.id, (e.data?.maskStrokes as MaskStroke[] | undefined) ?? [], 256, Math.max(8, Math.round((256 * h) / w))));
      else if (src === 'media') maps.set(e.id, await mediaMap(this.project, e.data?.mediaId as string | undefined, pos - e.start));
      else if (src === 'depth') {
        let d = this.depthCache.get(pos);
        if (!d) {
          d = await depthMap(clean);
          if (this.depthCache.size > 240) this.depthCache.clear();
          this.depthCache.set(pos, d);
        }
        maps.set(e.id, d);
      }
    }
    const track = new Map<string, [number, number, number, number] | null>();
    const t = pos / this.fps;
    // a few frames' grace at the ends, so a track that stops a frame short doesn't flash the mosh over the subject
    const grace = 3 / this.fps;
    for (const [id, { pts, size }] of this.paths) {
      const inside = t >= pts[0][0] - grace && t <= pts[pts.length - 1][0] + grace;
      track.set(id, inside ? [...pathAt(pts, t), size[0], size[1]] : null);
    }
    return { clean, person, track, maps };
  }

  dispose() {
    this.pp?.dispose();
    this.pp = null;
  }
}

function canvasJpeg(c: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((x) => res(new Uint8Array(x))) : rej(new Error('encode failed'))), 'image/jpeg', quality));
}

export async function runPost(
  jpegs: Uint8Array[],
  frames: Pick<Frame, 'src' | 'at'>[],
  project: Project,
  quality: number,
  onProgress?: (p: number) => void,
  signal?: { cancelled: boolean },
): Promise<Uint8Array[]> {
  const r = new PostRunner(project, quality);
  try {
    return await r.run(jpegs, frames, 0, onProgress, signal);
  } finally {
    r.dispose();
  }
}
