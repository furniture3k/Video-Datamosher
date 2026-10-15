// The Chaos dial: one knob that pushes every effect towards calm (0) or destroyed (2).
// 1 leaves the project exactly as authored.
import { EFFECTS, type ParamDef } from './effects';
import type { Automation, EffectInstance } from './types';

type NumDef = Extract<ParamDef, { type: 'number' | 'int' }>;

export const CHAOS_MIN = 0;
export const CHAOS_MAX = 2;

/** Scale one value of an intensity-tagged setting for dial position `c`. */
export function chaosValue(d: NumDef, v: number, c: number): number {
  if (c === 1 || !d.intensity) return v;
  const signed = d.min < 0;
  // "calm" end: no effect at all; "wild" end: the randomiser's upper range, else the setting's limit
  let calm: number;
  let wild: number;
  if (signed) {
    calm = 0;
    wild = v >= 0 ? d.max : d.min;
  } else if (d.intensity === 'up') {
    calm = d.min;
    wild = d.chaos ? Math.max(d.chaos[1], v) : d.max;
  } else {
    calm = d.max;
    wild = d.min;
  }
  let out = c < 1 ? calm + (v - calm) * c : v + (wild - v) * (c - 1);
  out = Math.min(d.max, Math.max(d.min, out));
  return d.type === 'int' ? Math.round(out) : out;
}

function chaosAuto(d: NumDef, a: Automation, c: number): Automation {
  if (a.kind === 'curve') return { ...a, points: a.points.map(([t, v]) => [t, chaosValue(d, v, c)] as [number, number]) };
  if (a.kind === 'lfo' || a.kind === 'audio') return { ...a, min: chaosValue(d, a.min, c), max: chaosValue(d, a.max, c) };
  return a;
}

/** The effect with its intensity settings (and their automation) pushed by the dial. */
export function withChaos(e: EffectInstance, c: number | undefined): EffectInstance {
  if (c === undefined || c === 1) return e;
  const def = EFFECTS[e.type];
  if (!def) return e;
  let params = e.params;
  let auto = e.auto;
  for (const d of def.params) {
    if ((d.type !== 'number' && d.type !== 'int') || !d.intensity) continue;
    const v = params[d.key];
    if (typeof v === 'number') {
      if (params === e.params) params = { ...params };
      params[d.key] = chaosValue(d, v, c);
    }
    const a = auto?.[d.key];
    if (a) {
      if (auto === e.auto) auto = { ...auto };
      auto[d.key] = chaosAuto(d, a, c);
    }
  }
  return params === e.params && auto === e.auto ? e : { ...e, params, auto };
}
