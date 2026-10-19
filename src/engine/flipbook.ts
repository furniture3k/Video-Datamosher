// Flipbook: a run of pictures (or bits of clips) swapped on every beat or every few frames, laid
// on a track of their own. Pure: the caller gives the times and the media and adds the clips.

export type FlipOrder = 'order' | 'random' | 'pingpong';

/** One picture of the flipbook: which media, when, for how long, and from where in it. */
export interface Flip {
  media: string;
  start: number;
  duration: number;
  /** where in a video to start (each use of a video carries on from the last) */
  from: number;
}

/** Times to swap on, from `t0` to `t1`: on the given beat points, or every `frames` frames at `fps`. */
export function flipTimes(t0: number, t1: number, o: { beats?: number[]; frames?: number; fps: number }): number[] {
  if (o.beats) {
    const pts = o.beats.filter((b) => b >= t0 - 1e-6 && b < t1 - 1e-6);
    return pts[0] !== undefined && pts[0] - t0 < 1e-6 ? pts : [t0, ...pts];
  }
  const step = Math.max(1, Math.round(o.frames ?? 2)) / o.fps;
  const out: number[] = [];
  for (let t = t0; t < t1 - 1e-6; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

/** The order the media are used in, `n` times: in order, shuffled (never the same twice in a row) or back and forth. */
export function flipOrder(count: number, n: number, order: FlipOrder, rnd: () => number): number[] {
  if (count < 1) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (order === 'pingpong' && count > 1) {
      const period = 2 * count - 2;
      const k = i % period;
      out.push(k < count ? k : period - k);
    } else if (order === 'random' && count > 1) {
      let k = Math.floor(rnd() * count);
      if (k === out[i - 1]) k = (k + 1 + Math.floor(rnd() * (count - 1))) % count;
      out.push(k);
    } else out.push(i % count);
  }
  return out;
}

/**
 * The flipbook: one picture per slot between the swap times (the last ends at `t1`). Videos
 * carry on from where they were last left (wrapping round at `lengths`), stills start at 0.
 */
export function flipbook(media: string[], lengths: Record<string, number>, times: number[], t1: number, order: FlipOrder, rnd: () => number): Flip[] {
  const seq = flipOrder(media.length, times.length, order, rnd);
  const at: Record<string, number> = {};
  return times.map((start, i) => {
    const id = media[seq[i]];
    const duration = Math.max(1e-3, (times[i + 1] ?? t1) - start);
    const len = lengths[id] ?? 0;
    // stills (no length) always start at 0
    let from = len > 0 ? (at[id] ?? 0) : 0;
    if (from + duration > len) from = 0;
    at[id] = from + duration;
    return { media: id, start, duration, from: Math.round(from * 1e6) / 1e6 };
  });
}
