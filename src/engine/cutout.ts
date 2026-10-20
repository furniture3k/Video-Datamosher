// Cutting a subject out through a clip (pure: the model is passed in). The person points at the
// subject on one frame; every other frame is asked for the subject with the previous frame's
// mask as the hint: its box and its middle. When the mask is lost, a box tracker's guess stands in.
import { maskBox, maskStats } from './matte';

/** Where to look on a frame: points to include (1) or leave out (0), and a box round the subject; all shares of the frame. */
export interface ObjectPrompt {
  points: [number, number, 0 | 1][];
  box?: [number, number, number, number];
}

/** The model: the mask (grey, w × h, white = subject) for frame `i` given a prompt; null if it found nothing. */
export type SegmentFrame = (i: number, prompt: ObjectPrompt) => Promise<Uint8Array | null>;

export interface CutoutOptions {
  /** frames in the clip, and the one the prompt is for */
  n: number;
  start: number;
  prompt: ObjectPrompt;
  w: number;
  h: number;
  segment: SegmentFrame;
  /** a box for frame i from another source (a tracker), used when the mask is lost */
  recover?: (i: number) => [number, number, number, number] | null;
  /** how many frames in a row may be lost before it gives up on the rest */
  maxLost?: number;
  onFrame?: (done: number, total: number) => void;
  cancelled?: () => boolean;
}

/** Less than this share of the frame is "lost": there's no subject worth a matte. */
export const LOST_AREA = 0.0004;

/** The pixel of the mask nearest (tx, ty) (shares of the frame), as shares: a tap that is sure to be on the subject. */
function onSubject(mask: Uint8Array, w: number, h: number, tx: number, ty: number): [number, number] | null {
  const x0 = tx * w;
  const y0 = ty * h;
  let best = -1;
  let bd = Infinity;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x] >= 128) {
        const d = (x + 0.5 - x0) ** 2 + (y + 0.5 - y0) ** 2;
        if (d < bd) ((bd = d), (best = y * w + x));
      }
  return best < 0 ? null : [((best % w) + 0.5) / w, (Math.floor(best / w) + 0.5) / h];
}

/**
 * The hint for the next frame from this frame's mask: its middle (moved onto the subject if the
 * middle is a hole), four more spots spread over it, which say which thing is meant, and its box a
 * little bigger.
 */
export function nextPrompt(mask: Uint8Array, w: number, h: number): ObjectPrompt | null {
  const box = maskBox(mask, w, h);
  const s = maskStats(mask, w, h);
  if (!box || !s || s.area < LOST_AREA) return null;
  const px = (box[2] - box[0]) * 0.12;
  const py = (box[3] - box[1]) * 0.12;
  const grown: [number, number, number, number] = [Math.max(0, box[0] - px), Math.max(0, box[1] - py), Math.min(1, box[2] + px), Math.min(1, box[3] + py)];
  const at = (u: number, v: number) => onSubject(mask, w, h, box[0] + (box[2] - box[0]) * u, box[1] + (box[3] - box[1]) * v);
  const points: [number, number, 0 | 1][] = [];
  for (const p of [onSubject(mask, w, h, s.cx, s.cy), at(0.3, 0.3), at(0.7, 0.3), at(0.3, 0.7), at(0.7, 0.7)]) if (p && !points.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5 / Math.min(w, h))) points.push([p[0], p[1], 1]);
  return { points, box: grown };
}

/** A matte for every frame 0..n-1: black where the subject wasn't found, and the run stops if it is lost for good. */
export async function cutOut(o: CutoutOptions): Promise<Uint8Array[]> {
  const out: Uint8Array[] = Array.from({ length: o.n }, () => new Uint8Array(o.w * o.h));
  const maxLost = o.maxLost ?? 12;
  let done = 0;
  const first = await o.segment(o.start, o.prompt);
  if (first) out[o.start] = first;
  o.onFrame?.(++done, o.n);
  for (const dir of [1, -1] as const) {
    let prev = first && nextPrompt(first, o.w, o.h) ? first : null;
    let lost = prev ? 0 : 1;
    for (let i = o.start + dir; i >= 0 && i < o.n; i += dir) {
      if (o.cancelled?.()) return out;
      let prompt = prev ? nextPrompt(prev, o.w, o.h) : null;
      if (!prompt) {
        // lost: ask the tracker where it was
        const b = o.recover?.(i);
        if (b) prompt = { points: [[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 1]], box: b };
      }
      let mask: Uint8Array | null = null;
      if (prompt) mask = await o.segment(i, prompt);
      const s = mask && maskStats(mask, o.w, o.h);
      if (mask && s && s.area >= LOST_AREA) {
        out[i] = mask;
        prev = mask;
        lost = 0;
      } else {
        prev = null;
        if (++lost > maxLost) {
          done += dir === 1 ? o.n - 1 - i : i;
          break;
        }
      }
      o.onFrame?.(++done, o.n);
    }
  }
  return out;
}
