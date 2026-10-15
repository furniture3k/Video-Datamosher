// Applies pixel/flow effects to decoded frames (JPEG in, JPEG out).
import { GL, COPY, type Target } from './gl';
import { FlowEngine, CHROMA, defaultFlow, type FlowParams } from './flow';
import { rasterizeField, encodeField, FIELD_MAX, type Stroke } from '../engine/flowfield';
import { linearAt } from '../engine/track';
import { personMask } from './segment';
import { pathOnTimeline } from './motion.svelte';
import { activeEffects, allEffects } from '../engine/mosh';
import { EFFECTS } from '../engine/effects';
import { paramAt } from '../engine/automation';
import { withChaos } from '../engine/chaos';
import { bend, type BendMode, type BendOptions } from '../engine/dsp';
import { bakeAudio, type MoshAudio } from '../engine/audiofx';
import { makeRng, hashSeed } from '../engine/rng';
import type { EffectInstance, Frame, Project, TextClip } from '../engine/types';
import { drawTexts, textAlpha } from './text';
import { Cancelled } from './ffmpeg';

export function pixelEffectsOf(project: Project, audio?: MoshAudio): EffectInstance[] {
  return activeEffects(allEffects(project))
    .filter((e) => EFFECTS[e.type].kind === 'pixel')
    .map((e) => bakeAudio(withChaos(e, project.chaos), audio, project));
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
  const idx = (line: number, k: number) => (vertical ? (k * w + line) * 4 : (line * w + k) * 4);
  const lum = (i: number) => (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
  const buf: [number, number, number, number, number][] = [];
  for (let line = 0; line < lines; line++) {
    let k = 0;
    while (k < len) {
      while (k < len && !(lum(idx(line, k)) >= low && lum(idx(line, k)) <= high)) k++;
      const s = k;
      buf.length = 0;
      while (k < len && lum(idx(line, k)) >= low && lum(idx(line, k)) <= high) {
        const i = idx(line, k);
        buf.push([lum(i), px[i], px[i + 1], px[i + 2], px[i + 3]]);
        k++;
      }
      if (buf.length > 1) {
        buf.sort((a, b) => (reverse ? b[0] - a[0] : a[0] - b[0]));
        buf.forEach((p, j) => {
          const i = idx(line, s + j);
          px[i] = p[1];
          px[i + 1] = p[2];
          px[i + 2] = p[3];
          px[i + 3] = p[4];
        });
      }
    }
  }
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

/** The mask (white = subject) from the clean picture, a people mask, or an oval. */
const MASKGEN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D clean; uniform sampler2D person; uniform float mode; uniform float thr;
uniform vec2 center; uniform vec2 radius; uniform vec3 key;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 c = texture(clean, uv).rgb;
  float m;
  if (mode < 0.5) m = texture(person, uv).r;
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
uniform float expand; uniform float soft; uniform float keepBg; uniform float amt;
void main(){
  float m = smoothstep(0.5 - expand - soft, 0.5 - expand + soft, texture(mask, uv).r);
  if (keepBg > 0.5) m = 1. - m;
  o = vec4(mix(texture(cur, uv).rgb, texture(clean, uv).rgb, clamp(m * amt, 0., 1.)), 1.);
}`;

const MASK_MODES: Record<string, number> = { person: 0, track: 1, luma: 2, dark: 3, chroma: 4 };

/** What Subject Guard needs for one frame, worked out before it is processed. */
export interface FrameExtras {
  clean?: ImageBitmap | null;
  /** people mask of the clean frame (grayscale, white = person) */
  person?: CanvasImageSource | null;
  /** effect id → tracked point [x, y] (shares of the frame) */
  track?: Map<string, [number, number] | null>;
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
  constructor(public w: number, public h: number) {
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
    if (source === 'person' && !x.person) return false;
    const pt = source === 'track' ? x.track?.get(e.id) : null;
    if (source === 'track' && !pt) return false;
    this.cleanT ??= gl.target(this.w, this.h);
    gl.upload(this.cleanT, x.clean);
    const mw = Math.max(8, Math.ceil(this.w / 2));
    const mh = Math.max(8, Math.ceil(this.h / 2));
    this.maskA ??= gl.target(mw, mh);
    this.maskB ??= gl.target(mw, mh);
    if (source === 'person') {
      const pc = x.person as HTMLCanvasElement;
      if (!this.personT || this.personT.w !== pc.width || this.personT.h !== pc.height) {
        gl.dispose(this.personT);
        this.personT = gl.target(pc.width, pc.height);
      }
      gl.upload(this.personT, pc);
    }
    const size = Number(paramAt(e, 'size', t));
    const col = hexRgb(String(e.data?.color ?? '#00ff00'));
    gl.pass(MASKGEN, this.maskA, { clean: this.cleanT.tex, person: (this.personT ?? this.cleanT).tex }, {
      mode: MASK_MODES[source] ?? 2,
      thr: Number(paramAt(e, 'threshold', t)),
      center: pt ? [pt[0], 1 - pt[1]] : [0.5, 0.5],
      radius: [size, (size * this.w) / this.h],
      key: col,
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
  private texts: TextClip[];
  private fps: number;
  private c2d: HTMLCanvasElement | null = null;
  private paths = new Map<string, [number, number, number][]>();
  private personCache = new Map<number, HTMLCanvasElement>();
  /** withTexts: also draw clean (non-melting) titles into the frames, for exports */
  constructor(
    project: Project,
    private quality: number,
    withTexts = false,
    audio?: MoshAudio,
    private clean?: { get(pos: number): Promise<Uint8Array | null> },
  ) {
    this.effects = pixelEffectsOf(project, audio);
    // tracked objects for Subject Guard, as timeline paths
    for (const e of this.effects) {
      if (e.type !== 'mask' || e.params.source !== 'track') continue;
      const c = project.clips.find((x) => x.id === e.data?.clipId);
      if (c) this.paths.set(e.id, pathOnTimeline(project, c, String(e.data?.pathId)));
    }
    this.texts = withTexts ? (project.texts ?? []).filter((t) => !t.moshed && t.text.trim()) : [];
    this.fps = project.encoder.fps;
  }
  get active() {
    return this.effects.length > 0 || this.texts.length > 0;
  }

  /** jpegs[i] is output frame offset + i */
  async run(jpegs: Uint8Array[], frames: Pick<Frame, 'src' | 'at'>[], offset: number, onProgress?: (p: number) => void, signal?: { cancelled: boolean }): Promise<Uint8Array[]> {
    if (!this.active || !jpegs.length) return jpegs;
    const out: Uint8Array[] = [];
    for (let i = 0; i < jpegs.length; i++) {
      if (signal?.cancelled) throw new Cancelled();
      const bmp = await createImageBitmap(new Blob([jpegs[i] as BlobPart], { type: 'image/jpeg' }));
      const k = offset + i;
      const fr = frames[Math.min(k, frames.length - 1)] ?? { src: k };
      let src: CanvasImageSource = bmp;
      let extras: FrameExtras = {};
      if (this.effects.length) {
        this.pp ??= new PostProcessor(bmp.width, bmp.height);
        extras = await this.extrasFor(fr, bmp.width, bmp.height);
        this.pp.processFrame(bmp, fr, k, this.effects, extras);
        src = this.pp.canvas;
      }
      extras.clean?.close();
      if (this.texts.length) {
        const t = (fr.at ?? fr.src) / this.fps;
        if (this.texts.some((x) => textAlpha(x, t) > 0)) {
          this.c2d ??= document.createElement('canvas');
          this.c2d.width = bmp.width;
          this.c2d.height = bmp.height;
          const ctx = this.c2d.getContext('2d')!;
          ctx.drawImage(src, 0, 0);
          drawTexts(ctx, this.texts, t, bmp.width, bmp.height, 'clean');
          src = this.c2d;
        }
      }
      if (src === bmp) out.push(jpegs[i]);
      else out.push(await canvasJpeg(src as HTMLCanvasElement, this.quality));
      bmp.close();
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
    let person: HTMLCanvasElement | null = null;
    if (guards.some((e) => e.params.source === 'person')) {
      person = this.personCache.get(pos) ?? null;
      if (!person) {
        person = await personMask(clean);
        if (this.personCache.size > 240) this.personCache.clear();
        this.personCache.set(pos, person);
      }
    }
    const track = new Map<string, [number, number] | null>();
    const t = pos / this.fps;
    for (const [id, path] of this.paths) {
      const inside = path.length && t >= path[0][0] - 1e-6 && t <= path[path.length - 1][0] + 1e-6;
      track.set(id, inside ? [linearAt(path.map(([a, x]) => [a, x]), t), linearAt(path.map(([a, , y]) => [a, y]), t)] : null);
    }
    return { clean, person, track };
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
