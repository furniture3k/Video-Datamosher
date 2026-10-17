// Auto-reframe: export in another shape (9:16 from 16:9…) with the crop following the action.
import { simplify, linearExpr, linearAt, type Gray } from './track';

/** Width / height of an aspect like "9:16". */
export const aspectRatio = (a: string): number => {
  const m = /^(\d+):(\d+)$/.exec(a);
  return m ? +m[1] / +m[2] : 0;
};

export interface ReframePath {
  /** which way the crop moves */
  axis: 'x' | 'y';
  /** crop size as a share of the frame along that axis */
  size: number;
  /** [seconds, crop centre 0..1 along the axis] */
  pts: [number, number][];
}

/**
 * Where the action is in each frame (motion between frames, weighted towards detail), smoothed
 * so the crop glides instead of jittering, and kept inside the frame.
 */
export function reframePath(g: Gray, fps: number, srcAspect: number, dstAspect: number, smoothSeconds = 0.8): ReframePath | null {
  if (!g.frames.length || !srcAspect || !dstAspect || Math.abs(srcAspect - dstAspect) < 0.01) return null;
  const axis = dstAspect < srcAspect ? 'x' : 'y';
  const size = axis === 'x' ? dstAspect / srcAspect : srcAspect / dstAspect;
  const n = g.frames.length;
  const raw: number[] = [];
  let last = 0.5;
  for (let k = 0; k < n; k++) {
    const f = g.frames[k];
    const p = g.frames[Math.max(0, k - 1)];
    // motion per column (or row): change since the last frame, above a noise floor
    const len = axis === 'x' ? g.w : g.h;
    const e = new Float64Array(len);
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        const i = y * g.w + x;
        const v = Math.abs(f[i] - p[i]) - 8;
        if (v > 0) e[axis === 'x' ? x : y] += v;
      }
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < len; i++) ((sum += e[i] * i), (wsum += e[i]));
    // a still frame keeps the last framing
    if (wsum > g.w * g.h * 0.05) last = sum / wsum / (len - 1);
    raw.push(last);
  }
  // Gaussian smoothing over time
  const r = Math.max(1, Math.round(smoothSeconds * fps));
  const sigma = r / 2;
  const half = size / 2;
  const pts: [number, number][] = raw.map((_, i) => {
    let s = 0;
    let w = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
      const wt = Math.exp(-((k - i) ** 2) / (2 * sigma * sigma));
      s += raw[k] * wt;
      w += wt;
    }
    return [i / fps, Math.min(1 - half, Math.max(half, s / w))];
  });
  return { axis, size, pts: simplify(pts, 0.004) };
}

/** FFmpeg crop that cuts the new shape out along the path (time `t` of the filter, plus `offset`). */
export function reframeFilter(p: ReframePath, offset = 0): string {
  const c = linearExpr(p.pts, offset ? `(t+${offset.toFixed(4)})` : 't');
  return p.axis === 'x'
    ? `crop=w='trunc(iw*${p.size.toFixed(5)}/2)*2':h=ih:x='(${c})*iw-ow/2':y=0`
    : `crop=w=iw:h='trunc(ih*${p.size.toFixed(5)}/2)*2':x=0:y='(${c})*ih-oh/2'`;
}

/** Where the crop's centre is at time `t` (s): the same line `reframeFilter` gives ffmpeg. */
export const centreAt = (p: ReframePath, t: number): number => linearAt(p.pts, t);
