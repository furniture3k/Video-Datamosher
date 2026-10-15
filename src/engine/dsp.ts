// Audio effects for databending: run sound processing over data that isn't sound (compressed
// video bytes, raw pixels). Samples are floats in -1..1; every effect keeps the length.

export type BendMode = 'echo' | 'reverb' | 'phaser' | 'crush' | 'reverse' | 'gain';

export interface BendOptions {
  mode: BendMode;
  /** echo delay / reverb size / phaser rate period / reverse chunk, in samples */
  delay: number;
  /** echo feedback, reverb decay, phaser depth (0..0.98) */
  feedback: number;
  /** dry/wet 0..1 */
  mix: number;
  /** crush: bits kept (1..8); gain: amount (1..16) */
  amount: number;
  /** gain: overflow wraps around (classic Audacity "amplify" damage) instead of clipping */
  wrap: boolean;
}

export const defaultBend = (): BendOptions => ({ mode: 'echo', delay: 400, feedback: 0.5, mix: 0.6, amount: 4, wrap: true });

function echo(x: Float32Array, delay: number, fb: number): Float32Array {
  const y = new Float32Array(x.length);
  const d = Math.max(1, Math.round(delay));
  for (let i = 0; i < x.length; i++) y[i] = x[i] + (i >= d ? y[i - d] * fb : 0);
  return y;
}

/** Schroeder reverb: four parallel feedback combs into two allpasses. */
function reverb(x: Float32Array, size: number, decay: number): Float32Array {
  const base = Math.max(8, Math.round(size));
  const combs = [1, 1.137, 1.283, 1.419].map((k) => Math.round(base * k));
  const out = new Float32Array(x.length);
  for (const d of combs) {
    const y = echo(x, d, decay);
    for (let i = 0; i < x.length; i++) out[i] += y[i] / combs.length;
  }
  let cur = out;
  for (const d of [Math.round(base * 0.13) + 1, Math.round(base * 0.047) + 1]) {
    const y = new Float32Array(cur.length);
    const g = 0.7;
    for (let i = 0; i < cur.length; i++) {
      const xd = i >= d ? cur[i - d] : 0;
      const yd = i >= d ? y[i - d] : 0;
      y[i] = -g * cur[i] + xd + g * yd;
    }
    cur = y;
  }
  return cur;
}

/** Four allpass stages whose corner sweeps with an LFO (period = `period` samples). */
function phaser(x: Float32Array, period: number, depth: number): Float32Array {
  const y = new Float32Array(x.length);
  const st = new Float64Array(4);
  const per = Math.max(16, period);
  let last = 0;
  for (let i = 0; i < x.length; i++) {
    const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / per);
    const a = 0.1 + 0.85 * lfo;
    let v = x[i] + last * depth;
    for (let s = 0; s < 4; s++) {
      const o = -a * v + st[s];
      st[s] = v + a * o;
      v = o;
    }
    last = v;
    y[i] = v;
  }
  return y;
}

function crush(x: Float32Array, bits: number): Float32Array {
  const levels = Math.pow(2, Math.max(1, Math.min(8, Math.round(bits)))) / 2;
  return x.map((v) => Math.round(v * levels) / levels);
}

function reverse(x: Float32Array, chunk: number): Float32Array {
  const y = new Float32Array(x.length);
  const c = Math.max(2, Math.round(chunk));
  for (let a = 0; a < x.length; a += c) {
    const b = Math.min(x.length, a + c);
    for (let i = a; i < b; i++) y[i] = x[b - 1 - (i - a)];
  }
  return y;
}

const wrap = (v: number) => ((((v + 1) % 2) + 2) % 2) - 1;

/** Run one effect over the samples (a new array). */
export function bend(x: Float32Array, o: BendOptions): Float32Array {
  let wet: Float32Array;
  switch (o.mode) {
    case 'echo':
      wet = echo(x, o.delay, Math.min(0.98, Math.max(0, o.feedback)));
      break;
    case 'reverb':
      wet = reverb(x, o.delay, Math.min(0.98, Math.max(0, o.feedback)));
      break;
    case 'phaser':
      wet = phaser(x, o.delay * 8, Math.min(0.95, Math.max(0, o.feedback)));
      break;
    case 'crush':
      wet = crush(x, o.amount);
      break;
    case 'reverse':
      wet = reverse(x, o.delay);
      break;
    case 'gain':
      wet = x.map((v) => v * Math.max(1, o.amount));
      break;
  }
  const m = Math.min(1, Math.max(0, o.mix));
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * (1 - m) + wet[i] * m;
    out[i] = o.wrap ? wrap(v) : Math.max(-1, Math.min(1, v));
  }
  return out;
}

/** Bend bytes as unsigned 8-bit samples (a new array of the same length). */
export function bendBytes(bytes: Uint8Array, o: BendOptions): Uint8Array {
  const x = Float32Array.from(bytes, (b) => (b - 128) / 128);
  const y = bend(x, o);
  return Uint8Array.from(y, (v) => Math.max(0, Math.min(255, Math.round(v * 128 + 128))));
}

export const BEND_MODES: { value: BendMode; label: string; hint: string }[] = [
  { value: 'echo', label: 'Echo', hint: 'Each byte is mixed with one Delay before it, again and again: ghost copies and smears.' },
  { value: 'reverb', label: 'Reverb', hint: 'Many echoes blurred together: soft, washed-out repeats.' },
  { value: 'phaser', label: 'Phaser', hint: 'A sweeping filter: bands and wavy colour shifts.' },
  { value: 'crush', label: 'Bitcrush', hint: 'Fewer levels per byte: posterised, blocky damage.' },
  { value: 'reverse', label: 'Reverse', hint: 'Runs of bytes are played backwards (each run is Delay long).' },
  { value: 'gain', label: 'Amplify', hint: 'Turns the data up so it overflows and wraps around: harsh, saturated tears.' },
];
