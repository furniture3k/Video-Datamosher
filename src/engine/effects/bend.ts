// The frame sequencer (a step pattern of mosh moves) and databending (audio effects run over
// the compressed frame data).
import type { BitstreamEffect } from './types';
import type { EffectInstance, Frame } from '../types';
import { copy, defuseStartCodes, inRange, isMotion, num, posOf, str, tOf, bool } from './util';
import { BEND_MODES, bendBytes, type BendMode } from '../dsp';
import { parseVol, parsePVop, writePVop, clampField, type Vol } from '../mpeg4mv';
import { rasterizeField, type Stroke } from '../flowfield';

// ---------- sequencer ----------

export type SeqStep = 'keep' | 'bloom' | 'echo' | 'reverse' | 'melt' | 'glitch';

export const SEQ_STEPS: { id: SeqStep; label: string; short: string; color: string; hint: string }[] = [
  { id: 'bloom', label: 'Bloom', short: 'B', color: '#e0a046', hint: 'Repeat the last motion: the picture keeps moving the same way and smears.' },
  { id: 'echo', label: 'Echo', short: 'E', color: '#7fb3c9', hint: 'Play motion from a few frames back (Echo distance) over the present.' },
  { id: 'reverse', label: 'Reverse', short: 'R', color: '#c97fb0', hint: 'Play this step\'s motion backwards.' },
  { id: 'melt', label: 'Melt', short: 'M', color: '#d8664f', hint: 'Remove keyframes in this step, so a new shot melts out of the old picture.' },
  { id: 'glitch', label: 'Glitch', short: 'G', color: '#d8cf4a', hint: 'Damage the bytes of this step\'s frames.' },
];

export const DEFAULT_STEPS: SeqStep[] = ['bloom', 'keep', 'keep', 'keep', 'bloom', 'keep', 'echo', 'keep'];

/** A random pattern: mostly plain frames, a few moves. */
export function randomSteps(rng: { (): number; pick<T>(a: readonly T[]): T }, n = 8): SeqStep[] {
  return Array.from({ length: n }, () => (rng() < 0.55 ? 'keep' : rng.pick(SEQ_STEPS).id));
}

export const stepsOf = (e: Pick<EffectInstance, 'data'>): SeqStep[] => {
  const s = e.data?.steps;
  return Array.isArray(s) && s.length ? (s as SeqStep[]) : DEFAULT_STEPS;
};

export const sequencer: BitstreamEffect = {
  kind: 'bitstream',
  type: 'sequence',
  name: 'Frame Sequencer',
  icon: 'SEQ',
  color: '#5fc9a8',
  description: 'A drum machine for frames. Each step of the pattern does one move (bloom, echo, reverse, melt, glitch) for a few frames, and the pattern loops along the bar. Draw the pattern in the grid.',
  span: 4,
  params: [
    { key: 'stepLen', label: 'Step length', type: 'int', min: 1, max: 48, default: 3, unit: 'frames', help: 'How many frames each step lasts. At 24 fps, 6 frames = a sixteenth note at 120 BPM… roughly.' },
    { key: 'echoDist', label: 'Echo distance', type: 'int', min: 1, max: 96, default: 8, unit: 'frames', help: 'How far back Echo steps take their motion from.' },
    { key: 'glitchAmount', label: 'Glitch amount', type: 'number', min: 0, max: 40, step: 0.5, default: 4, intensity: 'up', help: 'Bytes damaged per frame on Glitch steps.', chaos: [1, 12] },
  ],
  apply(frames, e, ctx) {
    const steps = stepsOf(e);
    const len = Math.max(1, Math.round(Number(e.params.stepLen ?? 3)));
    const out: Frame[] = [];
    let lastMotion: Frame | undefined;
    let i = 0;
    while (i < frames.length) {
      const f = frames[i];
      if (!inRange(f, e) || i === 0) {
        out.push(f);
        if (isMotion(f)) lastMotion = f;
        i++;
        continue;
      }
      // one occurrence of a step: consecutive in-range frames in the same step slot
      const slot = Math.floor((posOf(f) - e.start) / len);
      const win: Frame[] = [];
      while (i < frames.length && inRange(frames[i], e) && Math.floor((posOf(frames[i]) - e.start) / len) === slot) win.push(frames[i++]);
      const op = steps[slot % steps.length];
      if (op === 'bloom' && lastMotion) {
        for (const w of win) out.push(w.type === 'I' ? w : copy(lastMotion, 'dup', posOf(w)));
      } else if (op === 'echo') {
        const back = Math.round(num(e, 'echoDist', tOf(win[0], e)));
        for (const w of win) {
          const s = ctx.source[w.src - back];
          out.push(s && isMotion(s) && isMotion(w) ? copy(s, 'moved', posOf(w)) : w);
        }
      } else if (op === 'reverse') {
        const motion = win.filter(isMotion).reverse();
        let k = 0;
        for (const w of win) out.push(isMotion(w) ? copy(motion[k++], 'moved', posOf(w)) : w);
      } else if (op === 'melt') {
        for (const w of win) out.push(w.type === 'I' && lastMotion ? copy(lastMotion, 'replaced', posOf(w)) : w);
      } else if (op === 'glitch') {
        for (const w of win) {
          const amount = num(e, 'glitchAmount', tOf(w, e));
          const lo = Math.min(w.data.length - 1, w.payloadStart + 4);
          if (w.data.length - lo < 4 || amount <= 0) {
            out.push(w);
            continue;
          }
          const d = w.data.slice();
          const ops = Math.floor(amount) + (ctx.rng.chance(amount % 1) ? 1 : 0);
          for (let k = 0; k < ops; k++) d[ctx.rng.int(lo, d.length - 1)] ^= 1 << ctx.rng.int(0, 7);
          defuseStartCodes(d, w.data, w.payloadStart);
          out.push({ ...w, data: d, tag: 'glitch' });
        }
      } else out.push(...win);
      for (let k = out.length - 1; k >= 0; k--)
        if (isMotion(out[k])) {
          lastMotion = out[k];
          break;
        }
    }
    return out;
  },
};

// ---------- databending ----------

export const databend: BitstreamEffect = {
  kind: 'bitstream',
  type: 'databend',
  name: 'Databend',
  icon: 'DBD',
  color: '#b0d45a',
  description: 'Runs an audio effect over the compressed video data, the old Audacity trick: echo, reverb, phaser, bitcrush, reverse or amplify the bytes. Frame headers are left alone so the video still plays.',
  span: 2,
  params: [
    { key: 'mode', label: 'Effect', type: 'select', default: 'echo', options: BEND_MODES, help: 'Which audio effect the bytes go through.' },
    { show: (p) => p.mode !== 'crush' && p.mode !== 'gain', key: 'delay', label: 'Delay', type: 'int', min: 1, max: 8192, default: 400, unit: 'bytes', log: true, help: 'Echo delay, reverb size, phaser speed or reverse chunk, in bytes. Small values smear locally; big ones copy far-off blocks.' },
    { show: (p) => ['echo', 'reverb', 'phaser'].includes(String(p.mode)), key: 'feedback', label: 'Feedback', type: 'number', min: 0, max: 0.98, step: 0.01, default: 0.5, intensity: 'up', help: 'How much of the effect feeds back into itself. High values pile up.' },
    { show: (p) => p.mode === 'crush', key: 'bits', label: 'Bits', type: 'int', min: 1, max: 8, default: 4, intensity: 'down', help: 'Bits kept per byte. Fewer = harsher.' },
    { show: (p) => p.mode === 'gain', key: 'gain', label: 'Gain', type: 'number', min: 1, max: 16, step: 0.1, default: 2, intensity: 'up', help: 'How far the data is turned up.' },
    { show: (p) => p.mode === 'gain', key: 'wrap', label: 'Wrap around', type: 'bool', default: true, help: 'Overflowing values wrap to the other end (classic tearing) instead of clipping.' },
    { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, intensity: 'up', help: 'Dry/wet: how much of the effected data replaces the original.' },
    { key: 'probability', label: 'Frame chance', type: 'number', min: 0, max: 1, step: 0.01, default: 1, intensity: 'up', help: 'Chance each frame is bent.' },
    {
      key: 'target',
      label: 'Target frames',
      type: 'select',
      default: 'motion',
      options: [
        { value: 'motion', label: 'Motion frames (P)', hint: 'Bent motion throws blocks around and the damage travels with the movement.' },
        { value: 'keys', label: 'Keyframes (I)', hint: 'Bent pictures: colour bands and texture echoes that the motion then carries.' },
        { value: 'all', label: 'All frames', hint: 'Both.' },
      ],
      help: 'Which frame types are bent.',
    },
    { key: 'protect', label: 'Protect bytes', type: 'int', min: 0, max: 512, default: 8, help: 'Bytes after the frame header that are never touched. Raise it if frames break completely.', advanced: true },
  ],
  apply(frames, e, ctx) {
    const mode = str(e, 'mode') as BendMode;
    const target = str(e, 'target');
    return frames.map((f, i) => {
      if (i === 0 || !inRange(f, e)) return f;
      if (target === 'motion' && !isMotion(f)) return f;
      if (target === 'keys' && f.type !== 'I') return f;
      const t = tOf(f, e);
      if (!ctx.rng.chance(num(e, 'probability', t))) return f;
      const lo = Math.min(f.data.length, f.payloadStart + Math.round(num(e, 'protect', t)));
      if (f.data.length - lo < 8) return f;
      const d = f.data.slice();
      const bent = bendBytes(d.subarray(lo), {
        mode,
        delay: num(e, 'delay', t),
        feedback: num(e, 'feedback', t),
        mix: num(e, 'mix', t),
        amount: mode === 'crush' ? num(e, 'bits', t) : num(e, 'gain', t),
        wrap: bool(e, 'wrap', t),
      });
      d.set(bent, lo);
      defuseStartCodes(d, f.data, f.payloadStart);
      return { ...f, data: d, tag: 'glitch' as const };
    });
  },
};



// ---------- motion-vector editing ----------

const vols = new WeakMap<Uint8Array, Vol | null>();
/** The stream's VOL header (in the first prepared frame), parsed once. */
function volOf(source: Frame[]): Vol | null {
  const d = source[0]?.data;
  if (!d) return null;
  if (!vols.has(d)) {
    try {
      vols.set(d, parseVol(d));
    } catch {
      vols.set(d, null);
    }
  }
  return vols.get(d) ?? null;
}

export const vectorEdit: BitstreamEffect = {
  kind: 'bitstream',
  type: 'mvedit',
  name: 'Vector Edit',
  icon: 'MVX',
  color: '#6fd0c8',
  description: 'Rewrites the motion vectors inside the compressed frames: amplify, turn, swap or drift the motion, or paint it with the brush. The real datamosh vectors, not an imitation. Needs the Xvid (MPEG-4) codec with 4MV and quarter-pel off (the defaults).',
  span: 3,
  params: [
    { key: 'amplify', label: 'Amplify', type: 'number', min: -4, max: 4, step: 0.05, default: 2, intensity: 'up', help: 'Multiplies every vector. Negative values reverse the motion.' },
    { key: 'rotate', label: 'Turn', type: 'number', min: -180, max: 180, step: 1, default: 0, unit: '°', help: 'Turns every vector, so things move sideways to how they really moved.' },
    { key: 'swap', label: 'Swap X / Y', type: 'bool', default: false, help: 'Sideways motion becomes up-and-down and the other way round.' },
    { key: 'driftX', label: 'Drift X', type: 'number', min: -32, max: 32, step: 0.5, default: 0, unit: 'px', help: 'Constant sideways motion added to every block.' },
    { key: 'driftY', label: 'Drift Y', type: 'number', min: -32, max: 32, step: 0.5, default: 0, unit: 'px', help: 'Constant vertical motion added to every block (positive = down).' },
    { key: 'jitter', label: 'Jitter', type: 'number', min: 0, max: 16, step: 0.5, default: 0, intensity: 'up', unit: 'px', help: 'Random motion added to each block.' },
    { key: 'quantize', label: 'Quantise', type: 'number', min: 0, max: 16, step: 0.5, default: 0, unit: 'px', help: 'Snaps vectors to a grid: stepped, blocky motion.', advanced: true },
    { key: 'paint', label: 'Painted flow', type: 'number', min: 0, max: 4, step: 0.05, default: 1, help: 'How much the strokes painted with the brush add (paint on the player like Flow Paint).' },
  ],
  apply(frames, e, ctx) {
    const vol = volOf(ctx.source);
    if (!vol) return frames;
    const strokes = (e.data?.strokes as Stroke[] | undefined) ?? [];
    const mbw = Math.ceil(vol.width / 16);
    const mbh = Math.ceil(vol.height / 16);
    // the painted field, sampled at macroblock centres (in half pixels per frame)
    const painted = strokes.length ? rasterizeField(strokes, mbw, mbh, vol.width / vol.height) : null;
    return frames.map((f) => {
      if (f.type !== 'P' || !inRange(f, e)) return f;
      const t = tOf(f, e);
      try {
        const p = parsePVop(f.data, vol);
        const amp = num(e, 'amplify', t);
        const a = (num(e, 'rotate', t) * Math.PI) / 180;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        const swap = bool(e, 'swap', t);
        const dx = num(e, 'driftX', t) * 2;
        const dy = num(e, 'driftY', t) * 2;
        const jit = num(e, 'jitter', t) * 2;
        const q = num(e, 'quantize', t) * 2;
        const pk = num(e, 'paint', t);
        const mv = p.field.mv.map((v, i) => {
          if (!v) return null;
          let x = amp * (c * v[0] - s * v[1]);
          let y = amp * (s * v[0] + c * v[1]);
          if (swap) [x, y] = [y, x];
          x += dx + (jit ? (ctx.rng() * 2 - 1) * jit : 0);
          y += dy + (jit ? (ctx.rng() * 2 - 1) * jit : 0);
          if (painted) {
            x += painted[i * 2] * vol.width * 2 * pk;
            y += painted[i * 2 + 1] * vol.width * 2 * pk;
          }
          if (q > 0) ((x = Math.round(x / q) * q), (y = Math.round(y / q) * q));
          return [x, y] as [number, number];
        });
        return { ...f, data: writePVop(f.data, p, clampField(mv, p.field.fcode)), tag: 'glitch' as const };
      } catch {
        // a frame this can't read (other codec settings) stays as it was
        return f;
      }
    });
  },
};

export const moreBitstreamEffects: BitstreamEffect[] = [sequencer, databend, vectorEdit];
