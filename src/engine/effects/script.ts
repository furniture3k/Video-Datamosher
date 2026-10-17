// Script: an effect you write. Your function gets the frames under the effect's bar (their type,
// where they come from and how big they are) and returns the new order: any frame any number of
// times, in any order, left out, or with some bytes damaged. It runs in a sandbox, away from the
// editor and the network (src/lib/scripts.svelte.ts), before the render; the render then uses its
// answer, which is kept here (`plans`).
import type { BitstreamEffect } from './types';
import type { EffectInstance, Frame } from '../types';
import { copy, inRange, posOf, defuseStartCodes } from './util';
import { TIMING } from './bitstream';
import { hashSeed, makeRng } from '../rng';

/** What a script sees of a frame. */
export interface ScriptFrame {
  /** 'I' full picture, 'P' motion, 'B' two-way motion */
  type: string;
  /** the frame of the clean video it comes from */
  src: number;
  /** where it is on the timeline */
  pos: number;
  /** compressed size in bytes */
  size: number;
}

/** A script's answer: indexes into the frames it was given, or { i, glitch } to also damage some bytes. */
export type PlanEntry = number | { i: number; glitch?: number };

/** At most this many frames out per frame in (a runaway loop can't fill the memory). */
export const MAX_GROWTH = 8;

/** Check a script's answer: a list of whole numbers in range (and glitch counts), or an error. */
export function checkPlan(plan: unknown, n: number): PlanEntry[] {
  if (!Array.isArray(plan)) throw new Error('mosh() must return an array of frame numbers');
  if (plan.length > Math.max(1, n) * MAX_GROWTH + 64) throw new Error(`too many frames (${plan.length} for ${n})`);
  return plan.map((x, k): PlanEntry => {
    const i = typeof x === 'number' ? x : x && typeof x === 'object' ? (x as { i: unknown }).i : NaN;
    if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= n) throw new Error(`item ${k}: ${JSON.stringify(x)} is not a frame number from 0 to ${n - 1}`);
    if (typeof x === 'number') return x;
    const g = Number((x as { glitch?: unknown }).glitch ?? 0);
    return { i: i as number, glitch: Number.isFinite(g) ? Math.max(0, Math.min(64, Math.round(g))) : 0 };
  });
}

/** The frames a script is given (the ones under its bar). */
export const scriptInput = (frames: Frame[], e: Pick<EffectInstance, 'start' | 'end'>): ScriptFrame[] =>
  frames.filter((f) => inRange(f, e)).map((f) => ({ type: f.type, src: f.src, pos: posOf(f), size: f.size ?? f.data.length }));

/** A short, stable hash (FNV-1a) as text. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/** Identity of a script run: its code, settings and seed, and the frames it gets. */
export const planKey = (e: EffectInstance, input: ScriptFrame[]) =>
  hashText(JSON.stringify([String(e.data?.code ?? ''), e.params, e.seed, e.start, e.end, input.map((f) => [f.type, f.src, f.pos, f.size])]));

/** Answers of scripts that have run, by planKey. Filled before the render (see prepareScripts in mosh.ts). */
export const plans = new Map<string, PlanEntry[] | { error: string }>();

export const script: BitstreamEffect = {
  kind: 'bitstream',
  type: 'script',
  name: 'Script',
  icon: 'SCR',
  color: '#b0b0b0',
  description: 'An effect you write in JavaScript: put the frames under the bar in any order, repeat them, leave them out or damage them. Runs in a sandbox with no access to the network or your files.',
  retimes: true,
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, intensity: 'up', help: 'A number your script can read as ctx.amount (automate it, or map a knob to it).' },
    { ...TIMING },
  ],
  apply(frames, e) {
    if (!String(e.data?.code ?? '').trim()) return frames;
    const plan = plans.get(planKey(e, scriptInput(frames, e)));
    // not run yet (or failed): the frames go through as they are
    if (!plan || !Array.isArray(plan)) return frames;
    const inside = frames.filter((f) => inRange(f, e));
    const first = frames.findIndex((f) => inRange(f, e));
    if (first < 0) return frames;
    const before = frames.slice(0, first);
    const after = frames.slice(first).filter((f) => !inRange(f, e));
    const rng = makeRng(hashSeed(e.seed, 7));
    const out: Frame[] = plan.map((p, k) => {
      const i = typeof p === 'number' ? p : p.i;
      const f = inside[i];
      const at = posOf(inside[Math.min(inside.length - 1, k)] ?? f);
      if (typeof p === 'number' || !p.glitch) return k === i ? f : copy(f, 'moved', at);
      // damage some bytes after the header (never making new start codes)
      const d = f.data.slice();
      const lo = Math.min(d.length - 1, f.payloadStart + 8);
      for (let g = 0; g < (p.glitch ?? 0); g++) d[lo + Math.floor(rng() * Math.max(1, d.length - lo))] ^= 1 << Math.floor(rng() * 8);
      defuseStartCodes(d, f.data, f.payloadStart);
      return { ...copy(f, 'glitch', at), data: d };
    });
    return [...before, ...out, ...after];
  },
};

/** Scripts to start from (Examples in the editor). */
export const SCRIPT_EXAMPLES: { name: string; code: string }[] = [
  {
    name: 'Bloom every fourth frame',
    code: `// Every 4th motion frame is played 2 to 8 times (more with Amount).
function mosh(frames, ctx) {
  const out = [];
  frames.forEach((f, i) => {
    const times = f.type === 'P' && i % 4 === 0 ? 2 + Math.round(ctx.amount * 6) : 1;
    for (let k = 0; k < times; k++) out.push(i);
  });
  return out;
}`,
  },
  {
    name: 'No keyframes, then backwards',
    code: `// Keyframes go (the picture melts), and the second half plays backwards.
function mosh(frames, ctx) {
  const keep = frames.map((f, i) => i).filter((i) => i === 0 || frames[i].type !== 'I');
  const half = Math.floor(keep.length / 2);
  return [...keep.slice(0, half), ...keep.slice(half).reverse()];
}`,
  },
  {
    name: 'Stutter on the big frames',
    code: `// Frames bigger than most (lots of movement) stutter: the frame before them repeats.
function mosh(frames, ctx) {
  const sizes = frames.map((f) => f.size).sort((a, b) => a - b);
  const big = sizes[Math.floor(sizes.length * (1 - ctx.amount * 0.5))] ?? Infinity;
  const out = [];
  frames.forEach((f, i) => {
    if (f.type === 'P' && f.size >= big && i > 0) out.push(i - 1, i - 1, i - 1);
    out.push(i);
  });
  return out;
}`,
  },
  {
    name: 'Random glitches',
    code: `// Some motion frames get a few damaged bytes. ctx.random() is the effect's seeded randomness.
function mosh(frames, ctx) {
  return frames.map((f, i) => (f.type === 'P' && ctx.random() < ctx.amount * 0.3 ? { i, glitch: 1 + Math.floor(ctx.random() * 6) } : i));
}`,
  },
];
