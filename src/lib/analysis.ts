// Small grayscale frames of footage, for tracking, stabilization and auto-reframe.
import { ffmpeg, MOUNT } from './ffmpeg';
import { getFile } from './storage';
import { even } from '../engine/args';
import type { Gray } from '../engine/track';
import type { Clip, MediaItem } from '../engine/types';

const cache = new Map<string, Promise<Gray>>();
/** bytes of frames each finished entry holds */
const sizes = new Map<string, number>();
const BUDGET = 96e6;

/** Let the oldest entries go (never `keep`, the one just made) until there are at most 6 and they fit the budget. */
async function trim(keep: string) {
  const g = await cache.get(keep)?.catch(() => null);
  if (g) sizes.set(keep, g.w * g.h * g.frames.length);
  const total = () => [...cache.keys()].reduce((n, k) => n + (sizes.get(k) ?? 0), 0);
  for (const k of [...cache.keys()]) {
    if (k === keep || (cache.size <= 6 && total() <= BUDGET)) continue;
    cache.delete(k);
    sizes.delete(k);
  }
}

/**
 * A clip's source between its in and out points at `fps`, as `w`-pixel-wide gray frames.
 * Frame k is source time `clip.in + k / fps`.
 */
export function clipFrames(c: Pick<Clip, 'in' | 'out'>, m: MediaItem, fps: number, w = 256): Promise<Gray> {
  if (m.source.kind !== 'file' || m.source.isImage) return Promise.reject(new Error('Only video clips can be analysed.'));
  const h = even((w * (m.height || 9)) / (m.width || 16));
  const key = JSON.stringify([m.id, c.in, c.out, fps, w]);
  let hit = cache.get(key);
  if (!hit) {
    const src = m.source;
    hit = (async () => {
      const blob = await getFile(src.fileId);
      if (!blob) throw new Error(`Media for "${src.name}" is missing.`);
      const name = `an_${m.id}.${src.ext}`;
      const r = await ffmpeg.run(['-ss', String(c.in), '-t', String(Math.max(0.05, c.out - c.in)), '-i', MOUNT + name, '-an', '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', 'an.gray'], { mounts: { [name]: blob }, outputs: ['an.gray'] });
      return grayFrames(r.out['an.gray'], w, h);
    })();
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
    // the oldest go once there are more than a few, or more than the memory budget (long clips are big)
    hit.then(() => trim(key), () => {});
  }
  return hit;
}

export function grayFrames(raw: Uint8Array, w: number, h: number): Gray {
  const n = Math.floor(raw.length / (w * h));
  return { w, h, frames: Array.from({ length: n }, (_, i) => raw.subarray(i * w * h, (i + 1) * w * h)) };
}
