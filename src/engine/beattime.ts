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
