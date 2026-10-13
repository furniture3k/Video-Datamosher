import type { Automation, EffectInstance, ParamValue } from './types';
import { hashSeed, makeRng } from './rng';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** deterministic value-noise in [0,1] */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const r = (n: number) => makeRng(hashSeed(seed, n))();
  const u = f * f * (3 - 2 * f);
  return r(i) * (1 - u) + r(i + 1) * u;
}

/** Evaluate an automation at normalised time t (0..1 across the effect range). */
export function evalAutomation(a: Automation, t: number, seed = 0): number {
  t = clamp01(t);
  if (a.kind === 'curve') {
    const pts = [...a.points].sort((p, q) => p[0] - q[0]);
    if (pts.length === 0) return 0;
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [t0, v0] = pts[i];
      const [t1, v1] = pts[i + 1];
      if (t >= t0 && t <= t1) {
        if (a.interp === 'step') return v0;
        let u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        if (a.interp === 'smooth') u = u * u * (3 - 2 * u);
        return v0 + (v1 - v0) * u;
      }
    }
    return pts[pts.length - 1][1];
  }
  const x = t * a.rate + a.phase;
  const frac = x - Math.floor(x);
  let w: number; // 0..1
  switch (a.shape) {
    case 'sine':
      w = 0.5 - 0.5 * Math.cos(frac * Math.PI * 2);
      break;
    case 'triangle':
      w = frac < 0.5 ? frac * 2 : 2 - frac * 2;
      break;
    case 'square':
      w = frac < 0.5 ? 1 : 0;
      break;
    case 'saw':
      w = frac;
      break;
    case 'random':
      w = makeRng(hashSeed(seed, Math.floor(x)))();
      break;
    case 'noise':
    default:
      w = noise1(x, seed);
  }
  return a.min + (a.max - a.min) * w;
}

/** Read a parameter of an effect instance at time t, honouring automation. */
export function paramAt(e: EffectInstance, key: string, t: number): ParamValue {
  const a = e.auto?.[key];
  const base = e.params[key];
  if (a && typeof base === 'number') return evalAutomation(a, t, hashSeed(e.seed, key));
  if (a && typeof base === 'boolean') return evalAutomation(a, t, hashSeed(e.seed, key)) >= 0.5;
  return base;
}
