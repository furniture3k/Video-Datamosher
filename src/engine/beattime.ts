// Beat subdivisions: the points between beats (halves, quarters) for the grid, snapping and
// auto-edit, worked out from the beats the music analysis found.

/**
 * The beats with `div - 1` evenly spaced points added after each one (the last beat's use the
 * gap before it), in the same units as `beats`.
 */
export function subdivide(beats: number[], div: number): number[] {
  const n = Math.max(1, Math.round(div));
  if (n === 1 || beats.length < 2) return [...beats];
  const out: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const a = beats[i];
    const gap = i + 1 < beats.length ? beats[i + 1] - a : a - beats[i - 1];
    for (let k = 0; k < n; k++) out.push(a + (gap * k) / n);
  }
  return out;
}

/**
 * Time (seconds) as a count of beats from the first beat: 0 on it, 1.5 half way between the second
 * and third. Follows the actual beats, so a tempo change is followed; before the first and after
 * the last beat the nearest gap carries on. Null if there are fewer than two beats.
 */
export function toBeats(beats: number[], t: number): number | null {
  if (beats.length < 2) return null;
  const last = beats.length - 1;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[last]) return last + (t - beats[last]) / (beats[last] - beats[last - 1]);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

/** The time (seconds) of a beat count: the other way round from `toBeats`. */
export function fromBeats(beats: number[], b: number): number | null {
  if (beats.length < 2) return null;
  const last = beats.length - 1;
  if (b <= 0) return beats[0] + b * (beats[1] - beats[0]);
  if (b >= last) return beats[last] + (b - last) * (beats[last] - beats[last - 1]);
  const i = Math.floor(b);
  return beats[i] + (b - i) * (beats[i + 1] - beats[i]);
}

/** A length in seconds starting at `from`, in beats (it can differ along the music if the tempo changes). */
export function lengthToBeats(beats: number[], from: number, seconds: number): number | null {
  const a = toBeats(beats, from);
  const b = toBeats(beats, from + seconds);
  return a === null || b === null ? null : b - a;
}

/** The length in seconds of `n` beats starting at `from`. */
export function lengthFromBeats(beats: number[], from: number, n: number): number | null {
  const a = toBeats(beats, from);
  if (a === null) return null;
  const t = fromBeats(beats, a + n);
  return t === null ? null : t - from;
}
