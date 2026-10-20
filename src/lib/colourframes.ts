// Colour frames of footage, a few seconds at a time, for the models that look at pictures (cut-outs).
// `analysis.ts` has the small grey frames the trackers use; this is the same idea in colour.
import { ffmpeg, MOUNT } from './ffmpeg';
import { getFile } from './storage';
import { even } from '../engine/args';
import type { MediaItem } from '../engine/types';

export interface ColourFrames {
  w: number;
  h: number;
  /** frames from `from` to `to` (source seconds) at `fps`: frame i is `from + i / fps` */
  n: number;
  /** a picture of frame i (the caller closes it) */
  get(i: number): Promise<ImageBitmap>;
}

/** Frames a chunk holds: a few seconds, so a long clip is never all in memory at once. */
const CHUNK_SECONDS = 4;

export function colourFrames(m: MediaItem, from: number, to: number, fps: number, w: number): ColourFrames {
  if (m.source.kind !== 'file' || m.source.isImage) throw new Error('Only video clips can be cut out.');
  const src = m.source;
  const h = even((w * (m.height || 9)) / (m.width || 16));
  const n = Math.max(1, Math.round((to - from) * fps) + 1);
  const per = Math.max(1, Math.round(CHUNK_SECONDS * fps));
  const chunks = new Map<number, Promise<Uint8Array>>();
  const load = (c: number) => {
    let p = chunks.get(c);
    if (!p) {
      p = (async () => {
        const blob = await getFile(src.fileId);
        if (!blob) throw new Error(`Media for "${src.name}" is missing.`);
        const name = `cf_${m.id}.${src.ext}`;
        const count = Math.min(per, n - c * per);
        const r = await ffmpeg.run(['-ss', String(from + (c * per) / fps), '-i', MOUNT + name, '-an', '-vf', `fps=${fps},scale=${w}:${h},format=rgb24`, '-frames:v', String(count), '-f', 'rawvideo', 'cf.rgb'], { mounts: { [name]: blob }, outputs: ['cf.rgb'] });
        return r.out['cf.rgb'];
      })();
      p.catch(() => chunks.delete(c));
      chunks.set(c, p);
      // only the chunks being worked on stay in memory
      while (chunks.size > 2) chunks.delete(chunks.keys().next().value!);
    }
    return p;
  };
  return {
    w,
    h,
    n,
    async get(i) {
      const c = Math.floor(i / per);
      const raw = await load(c);
      const k = Math.min(i - c * per, Math.floor(raw.length / (w * h * 3)) - 1);
      if (k < 0) throw new Error('That frame could not be read.');
      const px = new Uint8ClampedArray(w * h * 4);
      const o = k * w * h * 3;
      for (let p = 0; p < w * h; p++) {
        px[p * 4] = raw[o + p * 3];
        px[p * 4 + 1] = raw[o + p * 3 + 1];
        px[p * 4 + 2] = raw[o + p * 3 + 2];
        px[p * 4 + 3] = 255;
      }
      return createImageBitmap(new ImageData(px, w, h));
    },
  };
}
