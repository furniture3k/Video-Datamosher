// Any object in a picture, cut out from a tap or a box. Two models behind one interface: SlimSAM
// (a small "segment anything" model, through transformers.js, like the depth model in maps.ts)
// and MediaPipe's interactive segmenter (a single tap, much quicker). Libraries and models are
// downloaded on first use and cached by the browser; pictures never leave the device.
import type { ObjectPrompt } from '../engine/cutout';

const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const SAM = 'Xenova/slimsam-77-uniform';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MAGIC = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';

/** A mask: grey values, 255 = the object, `w` × `h`. */
export interface ObjectMask {
  w: number;
  h: number;
  data: Uint8Array;
}

/** A picture the model has already looked at, so several prompts on it are quick. */
export interface FrameSession {
  mask(prompt: ObjectPrompt): Promise<ObjectMask | null>;
  close(): void;
}

/** 'auto': the quick model for a tap, the precise one as soon as a point says "leave this out". */
export type ObjectBackend = 'auto' | 'sam' | 'mediapipe';
let backend: ObjectBackend = 'auto';
export const objectBackend = () => backend;
export function setObjectBackend(b: ObjectBackend) {
  backend = b;
}

/** Swap the model (tests use a fake one so they don't download anything). */
export type ObjectSegmenter = (img: ImageBitmap, prompt: ObjectPrompt) => Promise<ObjectMask | null>;
let override: ObjectSegmenter | null = null;
export function setObjectSegmenter(fn: ObjectSegmenter | null) {
  override = fn;
}

/** Timings of the last model work, for the Storage dialog and the benchmarks (ms). */
export const lastTimings = { load: 0, frame: 0, mask: 0 };

type Img = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/** Look at a picture once; ask for objects in it as often as needed. Close it when done. */
export async function openFrame(img: ImageBitmap): Promise<FrameSession> {
  if (override) return { mask: (p) => override!(img, p), close() {} };
  if (backend === 'mediapipe') return openMediaPipe(img);
  if (backend === 'sam') return openSam(img);
  // auto: each model looks at the picture only if it is asked
  let quick: FrameSession | undefined;
  let precise: FrameSession | undefined;
  return {
    async mask(p) {
      if (p.points.some((q) => q[2] === 0)) return (precise ??= await openSam(img)).mask(p);
      return (quick ??= await openMediaPipe(img)).mask(p);
    },
    close() {},
  };
}

/** One prompt on one picture. */
export async function segmentAt(img: ImageBitmap, prompt: ObjectPrompt): Promise<ObjectMask | null> {
  const s = await openFrame(img);
  try {
    return await s.mask(prompt);
  } finally {
    s.close();
  }
}

// ---------------------------------------------------------------------------------------------
// SlimSAM

interface Tensor {
  data: ArrayLike<number> | BigInt64Array;
  dims: number[];
}
interface SamParts {
  tf: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  model: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  processor: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
let sam: Promise<SamParts> | null = null;

function loadSam(): Promise<SamParts> {
  sam ??= (async () => {
    const t0 = performance.now();
    const tf = await import(/* @vite-ignore */ TF);
    const webgpu = !!(navigator as unknown as { gpu?: unknown }).gpu;
    const make = (device: string) => tf.SamModel.from_pretrained(SAM, { device, dtype: device === 'webgpu' ? 'fp32' : 'q8' });
    const model = await (webgpu ? make('webgpu').catch(() => make('wasm')) : make('wasm'));
    const processor = await tf.AutoProcessor.from_pretrained(SAM);
    lastTimings.load = performance.now() - t0;
    return { tf, model, processor };
  })();
  sam.catch(() => (sam = null));
  return sam;
}

async function openSam(img: Img): Promise<FrameSession> {
  const { tf, model, processor } = await loadSam();
  const t0 = performance.now();
  const cv = toCanvas(img);
  const raw = tf.RawImage.fromCanvas(cv);
  const inputs = await processor(raw);
  const embeddings = await model.get_image_embeddings(inputs);
  lastTimings.frame = performance.now() - t0;
  const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number];
  return {
    async mask(prompt) {
      const t1 = performance.now();
      // taps: 1 include, 0 leave out (a box is no use to this model: the points are what it follows)
      const all: [number, number, number][] = [...prompt.points];
      if (!all.length && prompt.box) all.push([(prompt.box[0] + prompt.box[2]) / 2, (prompt.box[1] + prompt.box[3]) / 2, 1]);
      if (!all.length) return null;
      const args: Record<string, unknown> = {
        ...embeddings,
        input_points: new tf.Tensor('float32', all.flatMap(([x, y]) => [x * rw, y * rh]), [1, 1, all.length, 2]),
        input_labels: new tf.Tensor('int64', BigInt64Array.from(all.map((p) => BigInt(p[2]))), [1, 1, all.length]),
      };
      const out = await model(args);
      const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
      // three candidate masks; the model's own score picks one (a lone tap can land on a part:
      // several taps on the subject say which thing is meant)
      const scores = Array.from(out.iou_scores.data as ArrayLike<number>);
      const m = masks[0] as Tensor;
      const [, , H, W] = m.dims;
      const src = m.data as ArrayLike<number>;
      // the best-scored candidate that has every tap on the subject in it, none of the "leave out" taps, and isn't most of the picture
      const fits = (k: number) => {
        let on = 0;
        for (let i = 0; i < W * H; i++) if (src[k * W * H + i]) on++;
        if (on > 0.8 * W * H) return false;
        return prompt.points.every(([x, y, label]) => !!src[k * W * H + Math.min(H - 1, Math.floor(y * H)) * W + Math.min(W - 1, Math.floor(x * W))] === (label === 1));
      };
      let best = -1;
      scores.forEach((s, i) => fits(i) && (best < 0 || s > scores[best]) && (best = i));
      if (best < 0) {
        best = 0;
        scores.forEach((s, i) => s > scores[best] && (best = i));
      }
      const data = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) data[i] = src[best * W * H + i] ? 255 : 0;
      lastTimings.mask = performance.now() - t1;
      return { w: W, h: H, data };
    },
    close() {},
  };
}

// ---------------------------------------------------------------------------------------------
// MediaPipe interactive segmenter

interface MPMask {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
}
interface MPInteractive {
  segment(img: TexImageSource, roi: { keypoint: { x: number; y: number } }): { confidenceMasks?: MPMask[]; close(): void };
}
let mp: Promise<MPInteractive> | null = null;

function loadMediaPipe(): Promise<MPInteractive> {
  mp ??= (async () => {
    const t0 = performance.now();
    const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = (delegate: 'GPU' | 'CPU') => vision.InteractiveSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: MAGIC, delegate }, outputCategoryMask: false, outputConfidenceMasks: true });
    const s = await make('GPU').catch(() => make('CPU'));
    lastTimings.load = performance.now() - t0;
    return s as MPInteractive;
  })();
  mp.catch(() => (mp = null));
  return mp;
}

async function openMediaPipe(img: Img): Promise<FrameSession> {
  const seg = await loadMediaPipe();
  const cv = toCanvas(img);
  return {
    async mask(prompt) {
      // one tap only: the first point to include, or the middle of the box
      const p = prompt.points.find((q) => q[2] === 1);
      const b = prompt.box;
      const x = p ? p[0] : b ? (b[0] + b[2]) / 2 : 0.5;
      const y = p ? p[1] : b ? (b[1] + b[3]) / 2 : 0.5;
      const t1 = performance.now();
      const res = seg.segment(cv, { keypoint: { x, y } });
      try {
        const m = res.confidenceMasks?.[0];
        if (!m) return null;
        const f = m.getAsFloat32Array();
        const data = new Uint8Array(f.length);
        for (let i = 0; i < f.length; i++) data[i] = f[i] > 0.5 ? 255 : 0;
        lastTimings.mask = performance.now() - t1;
        return { w: m.width, h: m.height, data };
      } finally {
        res.close();
      }
    },
    close() {},
  };
}

function toCanvas(img: Img): HTMLCanvasElement {
  if (img instanceof HTMLCanvasElement) return img;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

/** A mask taken to another size (nearest neighbour is fine for a matte that is blurred when drawn). */
export function resizeMask(m: ObjectMask, w: number, h: number): Uint8Array {
  if (m.w === w && m.h === h) return m.data;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.h - 1, Math.floor(((y + 0.5) * m.h) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = m.data[sy * m.w + Math.min(m.w - 1, Math.floor(((x + 0.5) * m.w) / w))];
  }
  return out;
}
