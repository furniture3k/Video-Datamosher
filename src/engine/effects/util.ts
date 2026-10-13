import type { EffectInstance, Frame } from '../types';
import { paramAt } from '../automation';

export const inRange = (f: Frame, e: EffectInstance) => f.src >= e.start && f.src < e.end;
export const tOf = (f: Frame, e: EffectInstance) => (f.src - e.start) / Math.max(1, e.end - e.start - 1);
export const isMotion = (f: Frame) => f.type === 'P' || f.type === 'S';
export const num = (e: EffectInstance, key: string, t: number) => Number(paramAt(e, key, t));
export const bool = (e: EffectInstance, key: string, t: number) => Boolean(paramAt(e, key, t));
export const str = (e: EffectInstance, key: string) => String(e.params[key]);
export const copy = (f: Frame, tag: Frame['tag'], src = f.src): Frame => ({ ...f, tag, src });

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
