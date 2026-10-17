import type { EffectInstance, Frame } from '../types';
import { paramAt } from '../automation';

/** Timeline frame a frame is shown at (copies keep their content's `src` for the sound). */
export const posOf = (f: Pick<Frame, 'src' | 'at'>) => f.at ?? f.src;
export const inRange = (f: Frame, e: Pick<EffectInstance, 'start' | 'end'>) => posOf(f) >= e.start && posOf(f) < e.end;
export const tOf = (f: Frame, e: EffectInstance) => (posOf(f) - e.start) / Math.max(1, e.end - e.start - 1);
export const isMotion = (f: Frame) => f.type === 'P' || f.type === 'S';
/** Payload size, also for disk-backed frames whose `data` is only the header bytes. */
export const frameSize = (f: Frame) => f.size ?? f.data.length;
export const num = (e: EffectInstance, key: string, t: number) => Number(paramAt(e, key, t));
export const bool = (e: EffectInstance, key: string, t: number) => Boolean(paramAt(e, key, t));
export const str = (e: EffectInstance, key: string) => String(e.params[key]);
/** A copy of a frame's data shown at timeline position `at`. */
export const copy = (f: Frame, tag: Frame['tag'], at = posOf(f)): Frame => ({ ...f, tag, at });

/** Return maximal runs of consecutive in-range frames: [startIdx, endIdx) */
export function rangeRuns(frames: Frame[], e: EffectInstance): [number, number][] {
  const runs: [number, number][] = [];
  let s = -1;
  frames.forEach((f, i) => {
    const r = inRange(f, e);
    if (r && s < 0) s = i;
    if (!r && s >= 0) {
      runs.push([s, i]);
      s = -1;
    }
  });
  if (s >= 0) runs.push([s, frames.length]);
  return runs;
}

/**
 * After editing a frame's bytes: break any new "00 00 01" start code (which would read as the
 * start of another frame) that wasn't in the original data.
 */
export function defuseStartCodes(d: Uint8Array, orig: Uint8Array, from: number) {
  for (let q = from; q + 2 < d.length; q++)
    if (d[q] === 0 && d[q + 1] === 0 && d[q + 2] <= 1 && !(orig[q] === 0 && orig[q + 1] === 0 && orig[q + 2] === d[q + 2])) d[q + 2] = 2;
}
