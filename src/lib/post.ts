// Applies pixel/flow effects to decoded frames (JPEG in, JPEG out).
import { GL, COPY, type Target } from './gl';
import { FlowEngine, CHROMA, type FlowParams } from './flow';
import { activeEffects } from '../engine/mosh';
import { EFFECTS } from '../engine/effects';
import { paramAt } from '../engine/automation';
import { makeRng, hashSeed } from '../engine/rng';
import type { EffectInstance, Frame, Project } from '../engine/types';

export function pixelEffectsOf(project: Project): EffectInstance[] {
  return activeEffects(project.effects).filter((e) => EFFECTS[e.type].kind === 'pixel');
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

export class PostProcessor {
  gl: GL;
  canvas: HTMLCanvasElement;
  private input: Target;
  private a: Target;
  private b: Target;
  private flows = new Map<string, FlowEngine>();
  private wasActive = new Map<string, boolean>();
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
  processFrame(bmp: ImageBitmap, frame: Pick<Frame, 'src'>, index: number, effects: EffectInstance[]) {
    const gl = this.gl;
    gl.upload(this.input, bmp);
    gl.pass(COPY, this.a, { src: this.input.tex });
    let cur = this.a;
    let other = this.b;
    for (const e of effects) {
      const active = frame.src >= e.start && frame.src < e.end;
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
        const out = fe.step(cur, flowParamsAt(e, tOf(frame.src, e)));
        gl.pass(COPY, other, { src: out.tex });
        [cur, other] = [other, cur];
        continue;
      }
      if (!active) continue;
      const t = tOf(frame.src, e);
      if (e.type === 'chroma') {
        const rng = makeRng(hashSeed(e.seed, index));
        const wob = Number(paramAt(e, 'wobble', t));
        const off = Number(paramAt(e, 'offset', t)) * (1 + wob * (rng() * 2 - 1));
        const ang = ((Number(paramAt(e, 'angle', t)) + wob * 90 * (rng() * 2 - 1)) * Math.PI) / 180;
        gl.pass(CHROMA, other, { src: cur.tex }, { size: [this.w, this.h], off: [Math.cos(ang) * off, Math.sin(ang) * off], tear: Number(paramAt(e, 'scanTear', t)), seed: index % 997 });
        [cur, other] = [other, cur];
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
    this.gl.dispose(this.input, this.a, this.b);
    this.gl.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export async function runPost(
  jpegs: Uint8Array[],
  frames: Pick<Frame, 'src'>[],
  project: Project,
  quality: number,
  onProgress?: (p: number) => void,
  signal?: { cancelled: boolean },
): Promise<Uint8Array[]> {
  const effects = pixelEffectsOf(project);
  if (!effects.length || !jpegs.length) return jpegs;
  const first = await createImageBitmap(new Blob([jpegs[0] as BlobPart], { type: 'image/jpeg' }));
  const pp = new PostProcessor(first.width, first.height);
  first.close();
  const out: Uint8Array[] = [];
  try {
    for (let i = 0; i < jpegs.length; i++) {
      if (signal?.cancelled) throw new Error('cancelled');
      const bmp = await createImageBitmap(new Blob([jpegs[i] as BlobPart], { type: 'image/jpeg' }));
      pp.processFrame(bmp, frames[Math.min(i, frames.length - 1)] ?? { src: i }, i, effects);
      bmp.close();
      out.push(await pp.toJpeg(quality));
      if (i % 4 === 0) onProgress?.(i / jpegs.length);
    }
  } finally {
    pp.dispose();
  }
  return out;
}
