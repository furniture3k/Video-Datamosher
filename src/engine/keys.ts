// Keyframes and speed ramps: evaluating them, and turning them into FFmpeg expressions so the
// render animates exactly what the live preview shows.

export const KEY_PROPS = ['x', 'y', 'zoom', 'rotate', 'opacity'] as const;
export type KeyProp = (typeof KEY_PROPS)[number];
/** [clip-local time in seconds, value] */
export type KeyPoint = [number, number];
export type Keys = Partial<Record<KeyProp, KeyPoint[]>>;

const ease = (u: number) => u * u * (3 - 2 * u);
const n6 = (x: number) => String(Math.round(x * 1e6) / 1e6);
const sorted = (pts: KeyPoint[]) => [...pts].sort((a, b) => a[0] - b[0]);

/** Value at time t: held before the first and after the last key, eased in between. */
export function evalKeys(pts: KeyPoint[], t: number): number {
  const p = sorted(pts);
  if (!p.length) return 0;
  if (t <= p[0][0]) return p[0][1];
  for (let i = 0; i < p.length - 1; i++) {
    const [t0, v0] = p[i];
    const [t1, v1] = p[i + 1];
    if (t < t1) return v0 + (v1 - v0) * ease(t1 > t0 ? (t - t0) / (t1 - t0) : 1);
  }
  return p[p.length - 1][1];
}

/** The same curve as an FFmpeg expression of the time expression `T`. */
export function keysExpr(pts: KeyPoint[], T: string): string {
  const p = sorted(pts);
  if (!p.length) return '0';
  let e = n6(p[p.length - 1][1]);
  for (let i = p.length - 2; i >= 0; i--) {
    const [t0, v0] = p[i];
    const [t1, v1] = p[i + 1];
    const d = Math.max(1e-6, t1 - t0);
    const u = `((${T}-${n6(t0)})/${n6(d)})`;
    e = `if(lt(${T},${n6(t1)}),${n6(v0)}+${n6(v1 - v0)}*${u}*${u}*(3-2*${u}),${e})`;
  }
  return `if(lt(${T},${n6(p[0][0])}),${n6(p[0][1])},${e})`;
}

/** A property's value at local time t: its keys if it has any, else `fallback`. */
export const keyedValue = (keys: Keys | undefined, prop: KeyProp, t: number, fallback: number) => (keys?.[prop]?.length ? evalKeys(keys[prop]!, t) : fallback);
export const hasKeys = (keys: Keys | undefined, props: readonly KeyProp[] = KEY_PROPS) => !!keys && props.some((k) => (keys[k]?.length ?? 0) > 0);

// ---------- speed ramps ----------

/** [position in the clip 0..1, speed], straight lines in between. */
export type Ramp = [number, number][];

const MIN_SPEED = 0.05;

function rampPoints(r: Ramp): Ramp {
  const p = [...r].sort((a, b) => a[0] - b[0]).map(([x, s]) => [Math.min(1, Math.max(0, x)), Math.max(MIN_SPEED, s)] as [number, number]);
  if (!p.length) return [[0, 1], [1, 1]];
  if (p[0][0] > 0) p.unshift([0, p[0][1]]);
  if (p[p.length - 1][0] < 1) p.push([1, p[p.length - 1][1]]);
  return p;
}

export function rampSpeedAt(r: Ramp, x: number): number {
  const p = rampPoints(r);
  x = Math.min(1, Math.max(0, x));
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, s0] = p[i];
    const [x1, s1] = p[i + 1];
    if (x <= x1) return x1 > x0 ? s0 + ((s1 - s0) * (x - x0)) / (x1 - x0) : s1;
  }
  return p[p.length - 1][1];
}

/** ∫₀ˣ speed: how much source has played (in clip lengths) by position x. */
export function rampIntegral(r: Ramp, x: number): number {
  const p = rampPoints(r);
  x = Math.min(1, Math.max(0, x));
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, s0] = p[i];
    const [x1, s1] = p[i + 1];
    if (x1 <= x0) continue;
    const b = Math.min(x, x1);
    if (b <= x0) break;
    const dx = b - x0;
    acc += s0 * dx + ((s1 - s0) * dx * dx) / (2 * (x1 - x0));
    if (x <= x1) break;
  }
  return acc;
}

/** Inverse of rampIntegral (the position where `y` clip lengths of source have played). */
export function rampInverse(r: Ramp, y: number): number {
  const total = rampIntegral(r, 1);
  y = Math.min(total, Math.max(0, y));
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (rampIntegral(r, m) < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Timeline length of a source span (seconds) played through the ramp. */
export const rampLength = (r: Ramp, span: number) => span / rampIntegral(r, 1);

/**
 * FFmpeg setpts expression: input time T (seconds of source since the clip's in point) to
 * output time, through the ramp. Piecewise straight between `n` samples of the inverse.
 */
export function rampSetpts(r: Ramp, span: number, n = 40): string {
  const len = rampLength(r, span);
  const total = rampIntegral(r, 1);
  // sample points (source seconds, output seconds)
  const pts: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const x = rampInverse(r, (total * k) / n);
    pts.push([(span * k) / n, len * x]);
  }
  let e = n6(pts[n][1]);
  for (let k = n - 1; k >= 0; k--) {
    const [a0, b0] = pts[k];
    const [a1, b1] = pts[k + 1];
    e = `if(lt(T,${n6(a1)}),${n6(b0)}+(T-${n6(a0)})*${n6((b1 - b0) / Math.max(1e-9, a1 - a0))},${e})`;
  }
  return `(${e})/TB`;
}

/**
 * Split a ramp at position x: the two halves, each over its own 0..1, so the pieces of a split
 * clip play exactly as the whole did.
 */
export function splitRamp(r: Ramp, x: number): [Ramp, Ramp] {
  const p = rampPoints(r);
  const s = rampSpeedAt(r, x);
  const left: Ramp = [...p.filter(([px]) => px < x).map(([px, v]) => [px / x, v] as [number, number]), [1, s]];
  const right: Ramp = [[0, s], ...p.filter(([px]) => px > x).map(([px, v]) => [(px - x) / (1 - x), v] as [number, number])];
  return [left, right];
}

export const RAMP_PRESETS: { id: string; name: string; make: (a: number, b: number) => Ramp }[] = [
  { id: 'up', name: 'Speed up', make: (a, b) => [[0, a], [1, b]] },
  { id: 'down', name: 'Slow down', make: (a, b) => [[0, b], [1, a]] },
  { id: 'dip', name: 'Slow-mo in the middle', make: (a, b) => [[0, b], [0.4, a], [0.6, a], [1, b]] },
  { id: 'peak', name: 'Rush in the middle', make: (a, b) => [[0, a], [0.45, b], [0.55, b], [1, a]] },
  { id: 'montage', name: 'Montage (bursts)', make: (a, b) => [[0, a], [0.2, a], [0.25, b], [0.45, b], [0.5, a], [0.7, a], [0.75, b], [1, b]] },
];
