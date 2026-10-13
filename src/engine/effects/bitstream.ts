// Bitstream effects: each one rewrites the list of compressed frames.
import type { BitstreamEffect } from './types';
import type { Frame } from '../types';
import { bool, copy, inRange, isMotion, num, rangeRuns, str, tOf } from './util';

export const keyframeKiller: BitstreamEffect = {
  kind: 'bitstream',
  type: 'kill',
  name: 'Keyframe Killer',
  icon: '✂',
  color: '#ff4d6d',
  description:
    'Removes I-frames (full pictures). Motion that follows gets painted onto the previous image instead of a fresh one, so scenes melt into each other. This is the classic datamosh transition.',
  params: [
    {
      key: 'mode',
      label: 'Which keyframes',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All in range' },
        { value: 'cuts', label: 'Only at clip cuts' },
        { value: 'probability', label: 'Random chance' },
        { value: 'every', label: 'Every Nth keyframe' },
      ],
      help: 'Choose which I-frames inside the range get removed.',
    },
    { key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Chance that each keyframe is removed (Random mode).' },
    { key: 'every', label: 'Every Nth', type: 'int', min: 1, max: 20, default: 2, help: 'Remove every Nth keyframe (Every Nth mode).' },
    {
      key: 'replace',
      label: 'Fill gap with',
      type: 'select',
      default: 'drop',
      options: [
        { value: 'drop', label: 'Nothing (cut it out)' },
        { value: 'prev', label: 'Previous motion frame' },
        { value: 'next', label: 'Next motion frame' },
      ],
      help: 'Removing a frame shortens the video by one frame. Filling the gap keeps the timing and adds a tiny extra smear.',
      advanced: true,
    },
    { key: 'cutWindow', label: 'Cut tolerance', type: 'int', min: 0, max: 12, default: 2, unit: 'frames', help: 'How close to a clip cut a keyframe must be to count as "at the cut".', advanced: true },
  ],
  apply(frames, e, ctx) {
    const out: Frame[] = [];
    let iCount = 0;
    const mode = str(e, 'mode');
    frames.forEach((f, i) => {
      if (f.type !== 'I' || out.length === 0 || !inRange(f, e)) return void out.push(f);
      const t = tOf(f, e);
      let kill = false;
      if (mode === 'all') kill = true;
      else if (mode === 'cuts') {
        const w = num(e, 'cutWindow', t);
        kill = ctx.cuts.some((c) => Math.abs(f.src - c) <= w);
      } else if (mode === 'probability') kill = ctx.rng.chance(num(e, 'probability', t));
      else if (mode === 'every') kill = iCount++ % Math.max(1, Math.round(num(e, 'every', t))) === 0;
      if (!kill) return void out.push(f);
      const replace = str(e, 'replace');
      if (replace === 'prev') {
        const prev = [...out].reverse().find(isMotion);
        if (prev) out.push(copy(prev, 'replaced', f.src));
      } else if (replace === 'next') {
        const next = frames.slice(i + 1).find(isMotion);
        if (next) out.push(copy(next, 'replaced', f.src));
      }
    });
    return out;
  },
};

export const bloom: BitstreamEffect = {
  kind: 'bitstream',
  type: 'bloom',
  name: 'Bloom',
  icon: '✿',
  color: '#ffb84d',
  description:
    'Repeats a motion (P) frame many times. The same movement keeps being applied, so pixels stretch, swirl and bloom outward.',
  params: [
    { key: 'repeats', label: 'Repeats', type: 'int', min: 1, max: 240, default: 24, help: 'How many times the chosen frame is repeated. More repeats give a longer, wilder smear.', chaos: [4, 60] },
    {
      key: 'target',
      label: 'Which frame',
      type: 'select',
      default: 'first',
      options: [
        { value: 'first', label: 'First motion frame in range' },
        { value: 'strongest', label: 'Strongest motion in range' },
        { value: 'every', label: 'Every Nth frame' },
        { value: 'random', label: 'Random frames' },
      ],
      help: '"Strongest" picks the frame with the most motion data, which usually gives the most dramatic bloom.',
    },
    { key: 'interval', label: 'Every Nth', type: 'int', min: 1, max: 300, default: 12, help: 'For "Every Nth": bloom every N motion frames. Set to 1 for a slow-motion melt.' },
    { key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, help: 'For "Random": chance that each motion frame blooms.' },
    { key: 'jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 0, help: 'Randomly varies the repeat count for each bloom.', advanced: true },
  ],
  apply(frames, e, ctx) {
    const target = str(e, 'target');
    let chosen: Frame | null = null;
    if (target === 'first') chosen = frames.find((f) => inRange(f, e) && isMotion(f)) ?? null;
    if (target === 'strongest')
      chosen = frames.filter((f) => inRange(f, e) && isMotion(f)).reduce<Frame | null>((a, f) => (!a || f.data.length > a.data.length ? f : a), null);
    const out: Frame[] = [];
    let motionCount = 0;
    for (const f of frames) {
      out.push(f);
      if (!inRange(f, e) || !isMotion(f)) continue;
      const t = tOf(f, e);
      let hit = false;
      if (target === 'first' || target === 'strongest') hit = f === chosen;
      else if (target === 'every') hit = motionCount % Math.max(1, Math.round(num(e, 'interval', t))) === 0;
      else hit = ctx.rng.chance(num(e, 'probability', t));
      motionCount++;
      if (!hit) continue;
      const jitter = num(e, 'jitter', t);
      const n = Math.max(0, Math.round(num(e, 'repeats', t) * (1 + jitter * (ctx.rng() * 2 - 1))));
      for (let k = 0; k < n; k++) out.push(copy(f, 'dup'));
    }
    return out;
  },
};

export const stutter: BitstreamEffect = {
  kind: 'bitstream',
  type: 'stutter',
  name: 'Stutter Loop',
  icon: '↻',
  color: '#c77dff',
  description: 'Loops a short group of motion frames, so the movement rocks back and forth and builds up in rhythmic pulses.',
  params: [
    { key: 'group', label: 'Group size', type: 'int', min: 2, max: 60, default: 6, unit: 'frames', help: 'How many frames are in each loop.' },
    { key: 'loops', label: 'Loops', type: 'int', min: 1, max: 30, default: 3, help: 'How many times each group plays.' },
    { key: 'every', label: 'Repeat every', type: 'int', min: 0, max: 300, default: 0, unit: 'frames', help: '0 = loop once at the start of the range; otherwise start a new loop every N frames.' },
    { key: 'pingpong', label: 'Ping-pong', type: 'bool', default: false, help: 'Every other loop plays backwards.' },
  ],
  apply(frames, e) {
    const out: Frame[] = [];
    let sinceTrigger = Infinity;
    let i = 0;
    while (i < frames.length) {
      const f = frames[i];
      if (!inRange(f, e)) {
        out.push(f);
        sinceTrigger = Infinity;
        i++;
        continue;
      }
      const t = tOf(f, e);
      const every = Math.round(num(e, 'every', t));
      const trigger = sinceTrigger === Infinity || (every > 0 && sinceTrigger >= every);
      if (!trigger) {
        out.push(f);
        sinceTrigger++;
        i++;
        continue;
      }
      const group = Math.max(1, Math.round(num(e, 'group', t)));
      const win: Frame[] = [];
      let j = i;
      while (j < frames.length && win.length < group && inRange(frames[j], e)) win.push(frames[j++]);
      out.push(...win);
      const motion = win.filter(isMotion);
      const loops = Math.round(num(e, 'loops', t));
      for (let k = 1; k < loops; k++) {
        const seq = bool(e, 'pingpong', t) && k % 2 === 1 ? [...motion].reverse() : motion;
        out.push(...seq.map((m) => copy(m, 'dup')));
      }
      sinceTrigger = win.length;
      i = j;
    }
    return out;
  },
};

function permuteRuns(frames: Frame[], e: Parameters<BitstreamEffect['apply']>[1], window: (t: number) => number, perm: (idx: number[], t: number) => number[] | null, keepKeys: boolean): Frame[] {
  const out = frames.slice();
  for (const [s, end] of rangeRuns(frames, e)) {
    let a = s;
    while (a < end) {
      const t = tOf(frames[a], e);
      const w = window(t) <= 0 ? end - a : Math.max(2, Math.round(window(t)));
      const b = Math.min(end, a + w);
      const idx: number[] = [];
      for (let k = a; k < b; k++) if (!keepKeys || isMotion(frames[k])) idx.push(k);
      const p = perm(idx, t);
      if (p) idx.forEach((dst, n) => (out[dst] = p[n] === dst ? frames[dst] : copy(frames[p[n]], 'moved')));
      a = b;
    }
  }
  return out;
}

export const shuffle: BitstreamEffect = {
  kind: 'bitstream',
  type: 'shuffle',
  name: 'Shuffle',
  icon: '⤨',
  color: '#4dd8ff',
  description: 'Scrambles the order of motion frames in small windows. Movement jerks and jitters chaotically.',
  params: [
    { key: 'window', label: 'Window', type: 'int', min: 2, max: 120, default: 8, unit: 'frames', help: 'Frames are only shuffled within windows of this size.' },
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 1, help: 'Chance that each window gets shuffled.' },
    { key: 'keepKeys', label: 'Keep keyframes in place', type: 'bool', default: true, help: 'Only move motion frames and leave I-frames where they are.', advanced: true },
  ],
  apply(frames, e, ctx) {
    return permuteRuns(
      frames,
      e,
      (t) => num(e, 'window', t),
      (idx, t) => {
        if (!ctx.rng.chance(num(e, 'amount', t))) return null;
        const p = idx.slice();
        for (let k = p.length - 1; k > 0; k--) {
          const r = Math.floor(ctx.rng() * (k + 1));
          [p[k], p[r]] = [p[r], p[k]];
        }
        return p;
      },
      bool(e, 'keepKeys', 0),
    );
  },
};

export const reverse: BitstreamEffect = {
  kind: 'bitstream',
  type: 'reverse',
  name: 'Reverse Motion',
  icon: '⇆',
  color: '#7dffb3',
  description: 'Plays motion frames backwards. The motion vectors no longer match the picture, so things un-melt in strange ways.',
  params: [
    { key: 'window', label: 'Window', type: 'int', min: 0, max: 300, default: 0, unit: 'frames', help: '0 = reverse the whole range; otherwise reverse it in chunks of this size.' },
    { key: 'keepKeys', label: 'Keep keyframes in place', type: 'bool', default: true, help: 'Leave I-frames where they are.', advanced: true },
  ],
  apply(frames, e) {
    return permuteRuns(frames, e, (t) => num(e, 'window', t), (idx) => idx.slice().reverse(), bool(e, 'keepKeys', 0));
  },
};

export const drop: BitstreamEffect = {
  kind: 'bitstream',
  type: 'drop',
  name: 'Frame Drop',
  icon: '⌫',
  color: '#a0a0b8',
  description: 'Deletes frames. Dropping motion frames makes the picture stutter and skip; the next frames then apply onto the "wrong" picture.',
  params: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'every',
      options: [
        { value: 'every', label: 'Every Nth' },
        { value: 'probability', label: 'Random chance' },
      ],
      help: 'How frames are picked for deletion.',
    },
    { key: 'every', label: 'Every Nth', type: 'int', min: 2, max: 30, default: 3, help: 'Delete every Nth frame.' },
    { key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.25, help: 'Chance each frame is deleted.' },
    {
      key: 'types',
      label: 'Frame types',
      type: 'select',
      default: 'motion',
      options: [
        { value: 'motion', label: 'Motion frames only' },
        { value: 'all', label: 'Any frame' },
      ],
      help: 'Which kinds of frames can be dropped.',
      advanced: true,
    },
  ],
  apply(frames, e, ctx) {
    let n = 0;
    return frames.filter((f, i) => {
      if (i === 0 || !inRange(f, e)) return true;
      if (str(e, 'types') === 'motion' && !isMotion(f)) return true;
      const t = tOf(f, e);
      const del = str(e, 'mode') === 'every' ? ++n % Math.max(2, Math.round(num(e, 'every', t))) === 0 : ctx.rng.chance(num(e, 'probability', t));
      return !del;
    });
  },
};

export const echo: BitstreamEffect = {
  kind: 'bitstream',
  type: 'echo',
  name: 'Echo',
  icon: '◎',
  color: '#ff7de9',
  description: 'Re-inserts motion from a few frames ago, like an echo. Past movement leaks into the present as ghostly double-motion.',
  params: [
    { key: 'delay', label: 'Delay', type: 'int', min: 1, max: 120, default: 6, unit: 'frames', help: 'How far back the echoed motion comes from.' },
    { key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, help: 'Chance that each frame echoes.' },
    { key: 'taps', label: 'Taps', type: 'int', min: 1, max: 8, default: 1, help: 'Number of echoes (each one a further Delay back).' },
  ],
  apply(frames, e, ctx) {
    const out: Frame[] = [];
    frames.forEach((f, i) => {
      out.push(f);
      if (!inRange(f, e)) return;
      const t = tOf(f, e);
      if (!ctx.rng.chance(num(e, 'probability', t))) return;
      const d = Math.max(1, Math.round(num(e, 'delay', t)));
      const taps = Math.round(num(e, 'taps', t));
      for (let k = 1; k <= taps; k++) {
        const g = frames[i - k * d];
        if (g && isMotion(g)) out.push(copy(g, 'dup', f.src));
      }
    });
    return out;
  },
};

export const splice: BitstreamEffect = {
  kind: 'bitstream',
  type: 'splice',
  name: 'Motion Transfer',
  icon: '⇢',
  color: '#5cff5c',
  description:
    'Takes the movement (motion frames) from another part of the timeline and applies it here. The image in this range starts moving with borrowed motion, for example a still face moving with a dancer.',
  params: [
    { key: 'from', label: 'Motion source frame', type: 'frame', default: 0, help: 'First frame of the motion to borrow. Use the timeline to pick it.' },
    { key: 'length', label: 'Source length', type: 'int', min: 1, max: 900, default: 48, unit: 'frames', help: 'How many frames of motion to borrow.' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'replace',
      options: [
        { value: 'replace', label: 'Replace frames in range' },
        { value: 'insert', label: 'Insert at range start' },
      ],
      help: 'Replace: the range is filled (looping) with the borrowed motion. Insert: the borrowed motion is added at the start of the range.',
    },
    { key: 'loops', label: 'Loops (insert)', type: 'int', min: 1, max: 20, default: 1, help: 'For Insert: how many times the borrowed motion is inserted.' },
    { key: 'speed', label: 'Speed', type: 'number', min: 0.25, max: 4, step: 0.05, default: 1, help: 'Playback speed of the borrowed motion (frames are skipped or repeated).', advanced: true },
  ],
  apply(frames, e, ctx) {
    const from = Math.round(Number(e.params.from));
    const len = Math.round(Number(e.params.length));
    const speed = Math.max(0.05, Number(e.params.speed ?? 1));
    const pool = ctx.source.filter((f) => f.src >= from && f.src < from + len && isMotion(f));
    if (pool.length === 0) return frames;
    const at = (k: number) => pool[Math.floor(k * speed) % pool.length];
    const out: Frame[] = [];
    if (str(e, 'mode') === 'insert') {
      let done = false;
      for (const f of frames) {
        if (!done && inRange(f, e)) {
          done = true;
          out.push(f);
          const n = Math.round((pool.length / speed) * Math.round(num(e, 'loops', 0)));
          for (let k = 0; k < n; k++) out.push(copy(at(k), 'spliced', f.src));
          continue;
        }
        out.push(f);
      }
      return out;
    }
    let k = 0;
    frames.forEach((f, i) => {
      if (inRange(f, e) && i > 0) out.push(copy(at(k++), 'spliced', f.src));
      else out.push(f);
    });
    return out;
  },
};

const GLITCH_MODES = [
  { value: 'flip', label: 'Bit flip' },
  { value: 'replace', label: 'Random byte' },
  { value: 'nudge', label: 'Nudge bytes ±' },
  { value: 'zero', label: 'Zero out' },
  { value: 'max', label: 'Max out (0xFF)' },
  { value: 'run', label: 'Random run' },
  { value: 'repeat', label: 'Copy run' },
  { value: 'swap', label: 'Swap runs' },
  { value: 'shift', label: 'Bit-shift tail' },
  { value: 'insert', label: 'Insert bytes' },
  { value: 'delete', label: 'Delete bytes' },
];

export const byteGlitch: BitstreamEffect = {
  kind: 'bitstream',
  type: 'glitch',
  name: 'Byte Glitch',
  icon: '▦',
  color: '#ffe14d',
  description:
    'Corrupts the compressed data itself. Gives broken macroblocks, colour bleeds, tearing and pixel rain. Glitching keyframes changes colours and textures; glitching motion frames sends blocks flying.',
  params: [
    { key: 'mode', label: 'Corruption', type: 'select', default: 'flip', options: GLITCH_MODES, help: 'How the bytes are damaged.' },
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, step: 0.5, default: 3, help: 'Corruption operations per frame.', chaos: [1, 12], log: true },
    { key: 'probability', label: 'Frame chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, help: 'Chance each frame gets glitched.' },
    {
      key: 'target',
      label: 'Target frames',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All frames' },
        { value: 'motion', label: 'Motion frames (P)' },
        { value: 'keys', label: 'Keyframes (I)' },
      ],
      help: 'Which frame types to corrupt.',
    },
    { key: 'runLength', label: 'Run length', type: 'int', min: 1, max: 512, default: 16, unit: 'bytes', help: 'Size of runs for the run/copy/swap/insert/delete modes.', log: true },
    { key: 'regionStart', label: 'Region start', type: 'number', min: 0, max: 1, step: 0.01, default: 0, help: 'Only corrupt from this point of each frame (0 = top of the image, roughly).', advanced: true },
    { key: 'regionEnd', label: 'Region end', type: 'number', min: 0, max: 1, step: 0.01, default: 1, help: 'Only corrupt up to this point of each frame (1 = bottom).', advanced: true },
    { key: 'protect', label: 'Protect bytes', type: 'int', min: 0, max: 256, default: 4, help: 'Extra bytes after the frame header that are never touched. Raise this if the video breaks too badly.', advanced: true },
    { key: 'safe', label: 'Avoid start codes', type: 'bool', default: true, help: 'Stops corruption from creating fake "new frame" markers, which keeps glitches contained.', advanced: true },
  ],
  apply(frames, e, ctx) {
    const rng = ctx.rng;
    return frames.map((f, i) => {
      if (i === 0 || !inRange(f, e)) return f;
      const target = str(e, 'target');
      if (target === 'motion' && !isMotion(f)) return f;
      if (target === 'keys' && f.type !== 'I') return f;
      const t = tOf(f, e);
      if (!rng.chance(num(e, 'probability', t))) return f;
      let d = f.data.slice();
      const amount = num(e, 'amount', t);
      const ops = Math.floor(amount) + (rng.chance(amount % 1) ? 1 : 0);
      const run = Math.max(1, Math.round(num(e, 'runLength', t)));
      const mode = str(e, 'mode');
      const lo0 = Math.min(d.length - 1, f.payloadStart + Math.round(num(e, 'protect', t)));
      const rs = num(e, 'regionStart', t);
      const re = Math.max(rs, num(e, 'regionEnd', t));
      for (let k = 0; k < ops; k++) {
        const lo = lo0 + Math.floor((d.length - lo0) * rs);
        const hi = lo0 + Math.floor((d.length - lo0) * re);
        if (hi - lo < 2) break;
        const pos = rng.int(lo, hi - 1);
        const len = Math.min(run, hi - pos);
        switch (mode) {
          case 'flip':
            d[pos] ^= 1 << rng.int(0, 7);
            break;
          case 'replace':
            d[pos] = rng.int(0, 255);
            break;
          case 'nudge':
            d[pos] = (d[pos] + rng.pick([-4, -3, -2, -1, 1, 2, 3, 4]) + 256) & 255;
            break;
          case 'zero':
            d.fill(0, pos, pos + len);
            break;
          case 'max':
            d.fill(255, pos, pos + len);
            break;
          case 'run':
            for (let q = 0; q < len; q++) d[pos + q] = rng.int(0, 255);
            break;
          case 'repeat': {
            const p2 = rng.int(lo, Math.max(lo, hi - len));
            d.copyWithin(p2, pos, pos + len);
            break;
          }
          case 'swap': {
            const p2 = rng.int(lo, Math.max(lo, hi - len));
            const a = d.slice(pos, pos + len);
            const l2 = Math.min(len, d.length - p2);
            d.copyWithin(pos, p2, p2 + l2);
            d.set(a.subarray(0, l2), p2);
            break;
          }
          case 'shift': {
            const s = rng.int(1, 7);
            for (let q = d.length - 1; q > pos; q--) d[q] = ((d[q] >> s) | (d[q - 1] << (8 - s))) & 255;
            break;
          }
          case 'insert': {
            const ins = new Uint8Array(len).map(() => rng.int(0, 255));
            const nd = new Uint8Array(d.length + len);
            nd.set(d.subarray(0, pos));
            nd.set(ins, pos);
            nd.set(d.subarray(pos), pos + len);
            d = nd;
            break;
          }
          case 'delete': {
            const nd = new Uint8Array(d.length - len);
            nd.set(d.subarray(0, pos));
            nd.set(d.subarray(pos + len), pos);
            if (nd.length > lo0 + 4) d = nd;
            break;
          }
        }
      }
      if (bool(e, 'safe', t)) {
        const o = f.data;
        for (let q = f.payloadStart; q + 2 < d.length; q++)
          if (d[q] === 0 && d[q + 1] === 0 && d[q + 2] <= 1 && !(o[q] === 0 && o[q + 1] === 0 && o[q + 2] === 1)) d[q + 2] = 2;
      }
      return { ...f, data: d, tag: 'glitch' as const };
    });
  },
};

export const bitstreamEffects: BitstreamEffect[] = [keyframeKiller, bloom, splice, stutter, shuffle, reverse, echo, drop, byteGlitch];
