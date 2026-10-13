import { EFFECTS, defaultParams, type ParamDef } from './effects';
import type { EffectInstance, EncoderSettings, ParamValue, Project, Automation } from './types';
import { makeRng, randomSeed, type Rng } from './rng';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function makeEffect(type: string, start: number, end: number, params: Record<string, ParamValue> = {}, seed = randomSeed()): EffectInstance {
  const def = EFFECTS[type];
  return { id: uid(), type, enabled: true, solo: false, start, end, seed, params: { ...defaultParams(def.params), ...params }, auto: {}, locks: [] };
}

type Pos = number | { cut: number; offset: number };

export interface PresetEffect {
  type: string;
  start: Pos;
  end: Pos;
  params?: Record<string, ParamValue>;
  auto?: Record<string, Automation>;
}

export interface Preset {
  id: string;
  name: string;
  emoji: string;
  description: string;
  encoder?: Partial<EncoderSettings>;
  effects: PresetEffect[];
  user?: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'melt',
    name: 'Classic Melt',
    emoji: '🫠',
    description: 'All keyframes removed. Every cut melts into the next and nothing ever resets.',
    encoder: { gop: 600 },
    effects: [{ type: 'kill', start: 0, end: 1 }],
  },
  {
    id: 'transitions',
    name: 'Cut Transitions',
    emoji: '🎬',
    description: 'Only the keyframes at clip cuts are removed, so each new clip moves on top of the previous image. Add 2+ clips.',
    encoder: { keyAtCuts: true, gop: 600 },
    effects: [{ type: 'kill', start: 0, end: 1, params: { mode: 'cuts' } }],
  },
  {
    id: 'bloom',
    name: 'Bloom Explosion',
    emoji: '💥',
    description: 'The strongest motion frame repeats over and over, so pixels erupt outward.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'bloom', start: 0.3, end: 0.7, params: { target: 'strongest', repeats: 48 } },
    ],
  },
  {
    id: 'slowmelt',
    name: 'Slow Melt',
    emoji: '🕯',
    description: 'Every motion frame plays twice, so movement is amplified into a syrupy drift.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'bloom', start: 0, end: 1, params: { target: 'every', interval: 1, repeats: 1 } },
    ],
  },
  {
    id: 'pulse',
    name: 'Stutter Pulse',
    emoji: '💓',
    description: 'Rhythmic ping-pong loops that build up smear in beats.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'stutter', start: 0, end: 1, params: { group: 4, loops: 4, every: 24, pingpong: true } },
    ],
  },
  {
    id: 'echo',
    name: 'Liquid Echo',
    emoji: '🌊',
    description: 'Past motion keeps leaking back in, giving ghostly double movement.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'echo', start: 0, end: 1, params: { delay: 4, taps: 2, probability: 0.7 } },
    ],
  },
  {
    id: 'rain',
    name: 'Pixel Rain',
    emoji: '🌧',
    description: 'Glitched motion data sends macroblocks raining across the frame.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'glitch', start: 0, end: 1, params: { mode: 'replace', amount: 4, probability: 0.6, target: 'motion' } },
    ],
  },
  {
    id: 'storm',
    name: 'Datastorm',
    emoji: '⛈',
    description: 'Random keyframe loss, shuffled motion and heavy corruption. Chaotic.',
    encoder: { gop: 24 },
    effects: [
      { type: 'kill', start: 0, end: 1, params: { mode: 'probability', probability: 0.7 } },
      { type: 'shuffle', start: 0.2, end: 0.8, params: { window: 6, amount: 0.6 } },
      { type: 'glitch', start: 0, end: 1, params: { mode: 'run', amount: 2, probability: 0.4, runLength: 24 } },
    ],
  },
  {
    id: 'transfer',
    name: 'Motion Swap',
    emoji: '🔀',
    description: 'The first half of the video moves with the motion of the second half.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'splice', start: 0.05, end: 0.5, params: { from: -0.5, length: 120, mode: 'replace' } },
    ],
  },
  {
    id: 'ghost',
    name: 'Ghost Residue',
    emoji: '👻',
    description: 'Encodes with zero motion estimation, so scenes dissolve into each other as ghostly residue instead of moving.',
    encoder: { motionEst: 'zero', gop: 600 },
    effects: [{ type: 'kill', start: 0, end: 1 }],
  },
  {
    id: 'crunch',
    name: 'Crunch Core',
    emoji: '🧱',
    description: 'Very low quality, big chunky blocks and random blooms.',
    encoder: { quality: 22, motionEst: 'xone', mbd: 'simple' },
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'bloom', start: 0, end: 1, params: { target: 'random', probability: 0.08, repeats: 12, jitter: 0.6 } },
    ],
  },
  {
    id: 'vhs',
    name: 'VHS Death',
    emoji: '📼',
    description: 'Nudged bytes, chroma split and scanline tearing over an MPEG-2 base.',
    encoder: { codec: 'mpeg2', quality: 10, gop: 15 },
    effects: [
      { type: 'kill', start: 0, end: 1, params: { mode: 'probability', probability: 0.5 } },
      { type: 'glitch', start: 0, end: 1, params: { mode: 'nudge', amount: 2, probability: 0.3 } },
      { type: 'chroma', start: 0, end: 1, params: { offset: 5, wobble: 0.5, scanTear: 6 } },
    ],
  },
  {
    id: 'liquid',
    name: 'Liquid Flow',
    emoji: '💧',
    description: 'Flow-engine warp with amplified, smoothed vectors for silky liquid smears.',
    effects: [{ type: 'vectorWarp', start: 0, end: 1, params: { amplify: 2.5, smooth: true, residual: 0.08, block: '8' } }],
  },
  {
    id: 'gravity',
    name: 'Gravity Melt',
    emoji: '🍯',
    description: 'Everything drips downward while still following the motion.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'vectorWarp', start: 0, end: 1, params: { amplify: 1, driftY: 2.5, residual: 0.05, turbulence: 0.6, smooth: true } },
    ],
  },
  {
    id: 'vortex',
    name: 'Vortex',
    emoji: '🌀',
    description: 'Motion vectors rotated sideways so everything spins and curls.',
    effects: [{ type: 'vectorWarp', start: 0, end: 1, params: { amplify: 2, rotate: 90, residual: 0.1, block: '16' } }],
  },
  {
    id: 'sorted',
    name: 'Sorted Dreams',
    emoji: '🌅',
    description: 'A mosh with pixel-sorted streaks on top.',
    effects: [
      { type: 'kill', start: 0, end: 1 },
      { type: 'bloom', start: 0.4, end: 0.6, params: { target: 'strongest', repeats: 20 } },
      { type: 'pixelSort', start: 0, end: 1, params: { low: 0.3, high: 0.9 } },
    ],
  },
];

function resolvePos(p: Pos, total: number, cuts: number[]): number {
  if (typeof p === 'number') return Math.round(Math.max(0, Math.min(1, p)) * total);
  const c = cuts[p.cut] ?? Math.round(total / 2);
  return Math.max(0, Math.min(total, c + p.offset));
}

export function applyPreset(project: Project, preset: Preset, total: number, cuts: number[], mode: 'replace' | 'add' = 'replace'): Project {
  const effects = preset.effects.map((pe) => {
    const e = makeEffect(pe.type, resolvePos(pe.start, total, cuts), Math.max(1, resolvePos(pe.end, total, cuts)), pe.params);
    // Negative "from" on splice means fraction of the timeline
    if (pe.type === 'splice' && typeof pe.params?.from === 'number' && pe.params.from < 0) e.params.from = Math.round(-pe.params.from * total);
    if (pe.auto) e.auto = structuredClone(pe.auto);
    return e;
  });
  return {
    ...project,
    encoder: { ...project.encoder, ...(preset.encoder ?? {}) },
    effects: mode === 'replace' ? effects : [...project.effects, ...effects],
  };
}

/** Turn the current effect stack into a reusable preset (ranges become fractions). */
export function presetFromProject(project: Project, total: number, name: string): Preset {
  const t = Math.max(1, total);
  return {
    id: 'user-' + uid(),
    name,
    emoji: '⭐',
    description: 'Your saved preset',
    user: true,
    encoder: { ...project.encoder, keyMarkers: [] },
    effects: project.effects.map((e) => ({ type: e.type, start: e.start / t, end: Math.min(1, e.end / t), params: { ...e.params }, auto: structuredClone(e.auto) })),
  };
}

// ---------- randomisation ----------

export function randomParam(d: ParamDef, rng: Rng, total: number): ParamValue {
  switch (d.type) {
    case 'bool':
      return rng.chance(0.5);
    case 'select':
      return rng.pick(d.options).value;
    case 'frame':
      return rng.int(0, Math.max(0, total - 1));
    default: {
      const [lo, hi] = d.chaos ?? [d.min, d.max];
      const v = d.log && lo >= 0 ? Math.exp(rng.range(Math.log(lo + 1), Math.log(hi + 1))) - 1 : rng.range(lo, hi);
      return d.type === 'int' ? Math.round(v) : Math.round(v / (d.step ?? 0.01)) * (d.step ?? 0.01);
    }
  }
}

export function randomizeEffect(e: EffectInstance, rng: Rng, total: number): EffectInstance {
  const def = EFFECTS[e.type];
  const params = { ...e.params };
  for (const d of def.params) if (!e.locks.includes(d.key)) params[d.key] = randomParam(d, rng, total);
  return { ...e, params, seed: e.locks.includes('__seed') ? e.seed : rng.int(0, 1e9) };
}

const CHAOS_WEIGHTS: [string, number][] = [
  ['bloom', 5],
  ['glitch', 3],
  ['stutter', 2],
  ['echo', 2],
  ['shuffle', 2],
  ['reverse', 1],
  ['splice', 2],
  ['drop', 1],
  ['vectorWarp', 2],
  ['chroma', 1],
  ['pixelSort', 0.5],
];

function weightedPick(rng: Rng): string {
  const sum = CHAOS_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * sum;
  for (const [t, w] of CHAOS_WEIGHTS) if ((r -= w) <= 0) return t;
  return 'bloom';
}

/** Roll a fresh random effect stack. Locked effects (all params locked) are kept. */
export function chaos(project: Project, total: number, seed = randomSeed(), intensity = 0.5): Project {
  const rng = makeRng(seed);
  const kept = project.effects.filter((e) => e.locks.includes('__keep'));
  const effects: EffectInstance[] = [...kept];
  if (!kept.some((e) => e.type === 'kill') && rng.chance(0.85)) {
    const mode = rng.pick(['all', 'all', 'all', 'probability', 'cuts']);
    effects.push(makeEffect('kill', 0, total, { mode, probability: rng.range(0.4, 1) }, rng.int(0, 1e9)));
  }
  const n = 1 + Math.round(rng.range(0, 1 + intensity * 3));
  for (let i = 0; i < n; i++) {
    const type = weightedPick(rng);
    const len = Math.max(2, Math.round(total * rng.range(0.15, 0.9)));
    const start = rng.int(0, Math.max(0, total - len));
    let e = makeEffect(type, start, start + len, {}, rng.int(0, 1e9));
    e = randomizeEffect(e, rng, total);
    if (type === 'glitch') e.params.amount = Math.round(rng.range(0.5, 2 + intensity * 8) * 10) / 10;
    if (type === 'bloom' && rng.chance(0.3)) e.auto.repeats = { kind: 'lfo', shape: rng.pick(['sine', 'random', 'triangle'] as const), rate: rng.int(1, 6), min: 1, max: Math.round(10 + 50 * intensity), phase: rng() };
    effects.push(e);
  }
  return { ...project, effects };
}

/** Small random variations of unlocked params. amount 0..1 */
export function mutate(project: Project, total: number, amount = 0.2, seed = randomSeed()): Project {
  const rng = makeRng(seed);
  const effects = project.effects.map((e) => {
    const def = EFFECTS[e.type];
    if (!def || e.locks.includes('__keep')) return e;
    const params = { ...e.params };
    for (const d of def.params) {
      if (e.locks.includes(d.key)) continue;
      const v = params[d.key];
      if (d.type === 'number' || d.type === 'int') {
        const span = (d.max - d.min) * amount;
        let nv = Math.min(d.max, Math.max(d.min, Number(v) + rng.range(-span, span) * 0.5));
        nv = d.type === 'int' ? Math.round(nv) : Math.round(nv / (d.step ?? 0.01)) * (d.step ?? 0.01);
        params[d.key] = nv;
      } else if (d.type === 'bool' && rng.chance(amount * 0.3)) params[d.key] = !v;
      else if (d.type === 'select' && rng.chance(amount * 0.25)) params[d.key] = rng.pick(d.options).value;
    }
    let { start, end } = e;
    if (!e.locks.includes('__range')) {
      const shift = Math.round(rng.range(-1, 1) * amount * total * 0.15);
      start = Math.max(0, Math.min(total - 1, start + shift));
      end = Math.max(start + 1, Math.min(total, end + shift + Math.round(rng.range(-1, 1) * amount * total * 0.1)));
    }
    return { ...e, params, start, end, seed: e.locks.includes('__seed') ? e.seed : rng.int(0, 1e9) };
  });
  return { ...project, effects };
}
