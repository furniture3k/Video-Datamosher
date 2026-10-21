// Keyframes and speed ramps: evaluating them, and turning them into FFmpeg expressions so the
// render animates exactly what the live preview shows.

export const KEY_PROPS = ['x', 'y', 'zoom', 'rotate', 'opacity'] as const;
export type KeyProp = (typeof KEY_PROPS)[number];
/** [clip-local time in seconds, value], optionally 0 = straight line to the next key (no easing) */
export type KeyPoint = [number, number] | [number, number, 0];
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
    if (t < t1) {
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * (p[i][2] === 0 ? u : ease(u));
    }
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
    const shaped = p[i][2] === 0 ? u : `${u}*${u}*(3-2*${u})`;
    e = `if(lt(${T},${n6(t1)}),${n6(v0)}+${n6(v1 - v0)}*${shaped},${e})`;
  }
  return `if(lt(${T},${n6(p[0][0])}),${n6(p[0][1])},${e})`;
}

/** The keys with the one at time t set to v: a key within `tol` seconds of t is replaced. */
export const withKeyAt = (pts: KeyPoint[], t: number, v: number, tol: number): KeyPoint[] => [...pts.filter(([kt]) => Math.abs(kt - t) >= tol), [t, v] as KeyPoint].sort((a, b) => a[0] - b[0]);

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

// ---------- pop in on the beat ----------

export type PopMode = 'snap' | 'pop' | 'slide';

export interface PopOptions {
  mode: PopMode;
  /** how long it takes to settle (seconds) */
  dur: number;
  /** false: straight lines, no easing (hard, mechanical) */
  ease: boolean;
  /** slide: which side it comes from */
  from?: 'left' | 'right' | 'top' | 'bottom';
}

/**
 * The keys that make a clip pop in at its start, from where it settles (`rest`: its zoom, x and y
 * when it is in place). snap: it is just there, with no move; pop: grows past its size and settles
 * back; slide: comes in from one side. A step is a key with no easing (the third number is 0).
 */
export function popKeys(rest: { zoom: number; x: number; y: number }, o: PopOptions): Keys {
  const lin = (v: [number, number][]): KeyPoint[] => v.map(([t, x]) => (o.ease ? ([t, x] as KeyPoint) : ([t, x, 0] as KeyPoint)));
  const d = Math.max(0.04, o.dur);
  if (o.mode === 'snap') return { opacity: [[0, 1, 0]] };
  if (o.mode === 'pop') {
    return {
      zoom: lin([
        [0, rest.zoom * 0.2],
        [d * 0.6, rest.zoom * 1.12],
        [d, rest.zoom],
      ]),
      opacity: lin([
        [0, 0],
        [d * 0.25, 1],
      ]),
    };
  }
  const from = o.from ?? 'left';
  const dx = from === 'left' ? -0.7 : from === 'right' ? 0.7 : 0;
  const dy = from === 'top' ? -0.7 : from === 'bottom' ? 0.7 : 0;
  return {
    ...(dx ? { x: lin([[0, rest.x + dx], [d, rest.x]]) } : {}),
    ...(dy ? { y: lin([[0, rest.y + dy], [d, rest.y]]) } : {}),
    opacity: lin([
      [0, 0],
      [d * 0.3, 1],
    ]),
  };
}

// ---------- swapping places on the beat ----------

/**
 * Step keys that move clips between places on the beat: clip `i` sits at place `(i + k) mod n` after
 * the k-th time in `times` (clip-local seconds, one list for all, the first is where it starts to
 * swap). A move is a jump: held until a frame before, then there. `places`: the (zoom, x, y) of each place.
 */
export function swapKeys(places: { zoom: number; x: number; y: number }[], clip: number, times: number[], frame: number): Keys {
  const n = places.length;
  const out: Record<'zoom' | 'x' | 'y', KeyPoint[]> = { zoom: [], x: [], y: [] };
  const at = (k: number) => places[(((clip + k) % n) + n) % n];
  const props = ['zoom', 'x', 'y'] as const;
  for (const p of props) out[p].push([0, at(0)[p], 0]);
  times.forEach((t, k) => {
    for (const p of props) {
      // held until a frame before, then the new place
      out[p].push([Math.max(0.001, t - frame), at(k)[p], 0], [t, at(k + 1)[p], 0]);
    }
  });
  return out;
}

// ---------- hits on the beat ----------

export interface BeatHitOptions {
  /** zoom punch: how much bigger it jumps on the hit (0.08 = 8 %), 0 for none */
  punch: number;
  /** shake: how far it is knocked sideways and up, as a share of the frame, 0 for none */
  shake: number;
  /** how long a hit takes to settle (s); shorter when the next beat comes first */
  decay: number;
  /** most hits made (each is a few keys) */
  max?: number;
}

/**
 * Keys that hit a clip on each of `beats` (clip-local seconds, inside 0..len): it jumps to a zoom
 * punch and/or is knocked off its place in a frame, then eases back to `rest` before the next beat.
 * The jump is a straight line (the third number is 0) so it lands on the beat; the settle is eased.
 */
export function beatHitKeys(rest: { zoom: number; x: number; y: number }, beats: number[], len: number, frame: number, o: BeatHitOptions): Keys {
  // hits closer than three frames apart would overlap: the later ones are left out
  const hits: number[] = [];
  for (const b of beats.map((x) => Math.round(x * 1000) / 1000).sort((a, b) => a - b)) if (b >= 0 && b < len - frame && (!hits.length || b - hits[hits.length - 1] >= frame * 3 - 1e-6)) hits.push(b);
  hits.splice(o.max ?? 96);
  const out: Record<'zoom' | 'x' | 'y', KeyPoint[]> = { zoom: [], x: [], y: [] };
  hits.forEach((b, i) => {
    const next = hits[i + 1] ?? len;
    // settled again a little before the next hit, so each one reads as its own
    const settle = Math.max(frame * 2, Math.min(o.decay, (next - b) * 0.85));
    const peak = b + frame;
    if (o.punch > 0) out.zoom.push([b, rest.zoom, 0], [peak, rest.zoom * (1 + o.punch)], [b + settle, rest.zoom]);
    if (o.shake > 0) {
      // knocked one way, swings back past where it was, settles; the way alternates hit to hit
      const s = i % 2 ? -1 : 1;
      const k = o.shake;
      out.x.push([b, rest.x, 0], [peak, rest.x + s * k, 0], [b + settle * 0.35, rest.x - s * k * 0.5], [b + settle, rest.x]);
      out.y.push([b, rest.y, 0], [peak, rest.y - k * 0.6, 0], [b + settle * 0.35, rest.y + k * 0.3], [b + settle, rest.y]);
    }
  });
  const keys: Keys = {};
  for (const p of ['zoom', 'x', 'y'] as const) if (out[p].length) keys[p] = out[p];
  return keys;
}
