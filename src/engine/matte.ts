// Mattes: a grey picture per frame saying where a subject is (white = the subject), kept with a
// media item in source time. This file is the format and the maths (pure: no canvas, no model).

/** What the matte was made from: where the person pointed on one frame (0..1 of the picture; 1 = include, 0 = leave out). */
export interface MattePrompt {
  /** source seconds */
  t: number;
  points: [number, number, 0 | 1][];
  /** a box round the subject: x0, y0, x1, y1 */
  box?: [number, number, number, number];
}

/** A matte kept with a media item. The frames are in the stored file `matte:<id>`. */
export interface MatteRef {
  id: string;
  name: string;
  /** the stored file holding the frames (see packMatte) */
  fileId: string;
  /** size of each frame (pixels) */
  w: number;
  h: number;
  /** frames a second (the matte is interpolated between them) */
  fps: number;
  /** source seconds the first and last frames are for */
  from: number;
  to: number;
  prompts: MattePrompt[];
  /** bumped when the frames change, so cached pictures that used them are made again */
  version: number;
}

export const matteKey = (id: string) => 'matte:' + id;

/** How many frames a matte has. */
export const matteFrames = (m: Pick<MatteRef, 'from' | 'to' | 'fps'>) => Math.max(1, Math.round((m.to - m.from) * m.fps) + 1);

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

/** The frames end to end, squeezed (a matte is mostly flat black and white, so it shrinks a lot). */
export async function packMatte(frames: Uint8Array[]): Promise<Uint8Array> {
  const n = frames[0]?.length ?? 0;
  const all = new Uint8Array(n * frames.length);
  frames.forEach((f, i) => all.set(f, i * n));
  return through(all, new CompressionStream('deflate'));
}

/** The frames back out of what packMatte made. */
export async function unpackMatte(bytes: Uint8Array, w: number, h: number): Promise<Uint8Array[]> {
  const all = await through(bytes, new DecompressionStream('deflate'));
  const n = w * h;
  return Array.from({ length: Math.floor(all.length / n) }, (_, i) => all.subarray(i * n, (i + 1) * n));
}

/**
 * The matte at source time t: the two frames either side of it blended (so a matte made at 12
 * frames a second is smooth at any frame rate). Null outside the seconds it covers.
 */
export function matteAt(m: Pick<MatteRef, 'from' | 'to' | 'fps'>, frames: Uint8Array[], t: number): Uint8Array | null {
  if (!frames.length || t < m.from - 0.5 / m.fps || t > m.to + 0.5 / m.fps) return null;
  const pos = Math.max(0, Math.min(frames.length - 1, (t - m.from) * m.fps));
  const i = Math.floor(pos);
  const k = pos - i;
  const a = frames[i];
  const b = frames[Math.min(frames.length - 1, i + 1)];
  if (k < 1e-6 || a === b) return a;
  if (k > 1 - 1e-6) return b;
  const out = new Uint8Array(a.length);
  for (let p = 0; p < a.length; p++) out[p] = a[p] + (b[p] - a[p]) * k;
  return out;
}

/** The box round the subject (x0, y0, x1, y1 as shares of the frame), or null when there is none. */
export function maskBox(a: Uint8Array, w: number, h: number, threshold = 128): [number, number, number, number] | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a[y * w + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
}

/** The middle of the subject (as shares of the frame) and how much of the frame it fills (0..1). */
export function maskStats(a: Uint8Array, w: number, h: number, threshold = 128): { cx: number; cy: number; area: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a[y * w + x] >= threshold) {
        sx += x;
        sy += y;
        n++;
      }
  return n ? { cx: (sx / n + 0.5) / w, cy: (sy / n + 0.5) / h, area: n / (w * h) } : null;
}

/** How much two masks agree: shared subject over everything either calls subject (1 = identical). */
export function iou(a: Uint8Array, b: Uint8Array, threshold = 128): number {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] >= threshold;
    const q = b[i] >= threshold;
    if (p && q) inter++;
    if (p || q) uni++;
  }
  return uni ? inter / uni : 1;
}
