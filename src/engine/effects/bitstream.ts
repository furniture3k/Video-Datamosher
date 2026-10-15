// Bitstream effects: each one rewrites the list of compressed frames.
import type { BitstreamEffect, ParamDef } from './types';
import type { Frame } from '../types';
import { bool, copy, inRange, isMotion, num, posOf, rangeRuns, str, tOf, frameSize } from './util';
import { beatHits, beatParams, framesAtHits } from '../audiofx';

/** Shared setting of the effects that repeat or insert frames. */
export const TIMING: ParamDef = {
  key: 'timing',
  label: 'Timing',
  type: 'select',
  default: 'fit',
  options: [
    { value: 'fit', label: 'Keep length', hint: 'Repeated frames replace the frames after them, so the video stays exactly as long as the bar and in sync with the sound and the timeline.' },
    { value: 'stretch', label: 'Stretch', hint: 'Repeated frames are inserted, so this part of the video gets longer and everything after it starts later. Gives slow-motion, syrupy melts.' },
  ],
  help: 'Whether repeated frames replace footage (stays in sync) or are inserted (the video gets longer).',
};

export const keyframeKiller: BitstreamEffect = {
  kind: 'bitstream',
  type: 'kill',
  name: 'Keyframe Killer',
  icon: 'KEY',
  color: '#d8664f',
  description: 'Removes I-frames (full pictures). The motion after a missing keyframe lands on the previous image, so one shot melts into the next. This is the base of almost every mosh: put it under the other effects.',
  params: [
    {
      key: 'mode',
      label: 'Which keyframes',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All in range', hint: 'Every keyframe under the bar is removed. Nothing resets until the bar ends.' },
        { value: 'cuts', label: 'Only at clip cuts', hint: 'Only keyframes where one clip meets the next are removed, so each new shot melts out of the last one.' },
        { value: 'probability', label: 'Random chance', hint: 'Each keyframe is removed by chance. Some resets survive, giving bursts of melt.' },
        { value: 'every', label: 'Every Nth keyframe', hint: 'A regular pattern: remove one, keep the rest of each group of N.' },
      ],
      help: 'Choose which I-frames inside the range get removed.',
    },
    { show: (p) => p.mode === 'probability', key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, intensity: 'up', help: 'Chance that each keyframe is removed. 1 = all of them, 0 = none.' },
    { show: (p) => p.mode === 'every', key: 'every', label: 'Every Nth', type: 'int', min: 1, max: 20, default: 2, intensity: 'down', help: 'Remove every Nth keyframe. 1 removes all, 2 every other one, and so on.' },
    {
      key: 'replace',
      label: 'Fill gap with',
      type: 'select',
      default: 'prev',
      options: [
        { value: 'prev', label: 'Previous motion', hint: 'The removed keyframe is replaced by the motion frame before it, so timing stays the same and the smear gets a tiny push.' },
        { value: 'next', label: 'Next motion', hint: 'The removed keyframe is replaced by the motion frame after it.' },
        { value: 'drop', label: 'Nothing', hint: 'The keyframe is cut out: the video gets one frame shorter for each one removed.' },
      ],
      help: 'What goes where a removed keyframe was. Filling keeps the video in sync with the timeline.',
      advanced: true,
    },
    { show: (p) => p.mode === 'cuts', key: 'cutWindow', label: 'Cut tolerance', type: 'int', min: 0, max: 12, default: 2, unit: 'frames', help: 'How close to a clip cut a keyframe must be to count as "at the cut".', advanced: true },
  ],
  apply(frames, e, ctx) {
    const out: Frame[] = [];
    let iCount = 0;
    const mode = str(e, 'mode');
    let lastMotion: Frame | undefined;
    const push = (f: Frame) => {
      out.push(f);
      if (isMotion(f)) lastMotion = f;
    };
    frames.forEach((f, i) => {
      if (f.type !== 'I' || out.length === 0 || !inRange(f, e)) return void push(f);
      const t = tOf(f, e);
      let kill = false;
      if (mode === 'all') kill = true;
      else if (mode === 'cuts') {
        const w = num(e, 'cutWindow', t);
        kill = ctx.cuts.some((c) => Math.abs(posOf(f) - c) <= w);
      } else if (mode === 'probability') kill = ctx.rng.chance(num(e, 'probability', t));
      else if (mode === 'every') kill = iCount++ % Math.max(1, Math.round(num(e, 'every', t))) === 0;
      if (!kill) return void push(f);
      const replace = str(e, 'replace');
      if (replace === 'prev') {
        if (lastMotion) out.push(copy(lastMotion, 'replaced', posOf(f)));
      } else if (replace === 'next') {
        const next = frames.slice(i + 1).find(isMotion);
        if (next) out.push(copy(next, 'replaced', posOf(f)));
      }
    });
    return out;
  },
};

export const bloom: BitstreamEffect = {
  kind: 'bitstream',
  type: 'bloom',
  name: 'Bloom',
  icon: 'BLM',
  color: '#e0a046',
  description: 'Repeats a motion frame. The same movement is applied over and over, so pixels smear and bloom outward. Make the bar longer for a longer bloom.',
  retimes: true,
  span: 1.5,
  params: [
    {
      key: 'target',
      label: 'Which frame',
      type: 'select',
      default: 'first',
      options: [
        { value: 'first', label: 'First motion frame', hint: 'The first movement under the bar is repeated.' },
        { value: 'strongest', label: 'Strongest motion', hint: 'The frame with the most motion data under the bar. Usually the most dramatic bloom.' },
        { value: 'every', label: 'Every Nth frame', hint: 'A bloom every N motion frames, for rhythmic or slow-motion melts.' },
        { value: 'random', label: 'Random frames', hint: 'Motion frames bloom by chance. Unpredictable bursts.' },
        { value: 'beats', label: 'On the beat', hint: 'A bloom on each beat of the music, lasting until the next one. Needs music on the timeline.' },
      ],
      help: 'Which motion frame (or frames) gets repeated.',
    },
    ...beatParams((p) => p.target === 'beats'),
    { show: (p) => p.target === 'every', key: 'interval', label: 'Every Nth', type: 'int', min: 1, max: 300, default: 12, intensity: 'down', help: 'Bloom every N motion frames. With "Fill" each bloom lasts until the next one, so 2–4 gives a slow, stepped melt.' },
    { show: (p) => p.target === 'random', key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, intensity: 'up', help: 'Chance that each motion frame blooms.' },
    {
      key: 'length',
      label: 'Bloom length',
      type: 'select',
      default: 'fill',
      options: [
        { value: 'fill', label: 'Fill the bar', hint: 'Each bloom lasts until the next one, or until the end of the bar. Drag the bar longer or shorter to set how long it blooms.' },
        { value: 'count', label: 'Fixed repeats', hint: 'Each bloom repeats its frame a set number of times, whatever the length of the bar.' },
      ],
      help: 'How long each bloom lasts.',
    },
    { show: (p) => p.length === 'count', key: 'repeats', label: 'Repeats', type: 'int', min: 1, max: 600, default: 24, intensity: 'up', help: 'How many times the chosen frame is repeated. More repeats give a longer, wilder smear.', chaos: [4, 60] },
    { show: (p) => p.length === 'count', key: 'jitter', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.01, default: 0, intensity: 'up', help: 'Randomly varies the repeat count of each bloom (0 = exact, 1 = anywhere from none to double).', advanced: true },
    TIMING,
  ],
  apply(frames, e, ctx) {
    const target = str(e, 'target');
    const fill = str(e, 'length') !== 'count';
    const ranged = frames.filter((f) => inRange(f, e));
    const motion = ranged.filter(isMotion);
    let hits: Frame[] = [];
    if (target === 'first') hits = motion.slice(0, 1);
    else if (target === 'strongest') hits = motion.length ? [motion.reduce((a, f) => (frameSize(f) > frameSize(a) ? f : a))] : [];
    else if (target === 'every') hits = motion.filter((f, k) => k % Math.max(1, Math.round(num(e, 'interval', tOf(f, e)))) === 0);
    else if (target === 'beats') hits = [...framesAtHits(frames, e, beatHits(e, ctx.audio), isMotion)];
    else hits = motion.filter((f) => ctx.rng.chance(num(e, 'probability', tOf(f, e))));
    const hit = new Set(hits);
    const out: Frame[] = [];
    let k = -1;
    for (const f of frames) {
      out.push(f);
      if (!inRange(f, e)) continue;
      k++;
      if (!hit.has(f)) continue;
      let n: number;
      if (fill) {
        let j = k + 1;
        while (j < ranged.length && !hit.has(ranged[j])) j++;
        n = j - k - 1;
      } else {
        const t = tOf(f, e);
        const jitter = num(e, 'jitter', t);
        n = Math.max(0, Math.round(num(e, 'repeats', t) * (1 + jitter * (ctx.rng() * 2 - 1))));
      }
      for (let r = 0; r < n; r++) out.push(copy(f, 'dup'));
    }
    return out;
  },
};

export const stutter: BitstreamEffect = {
  kind: 'bitstream',
  type: 'stutter',
  name: 'Stutter Loop',
  icon: 'STU',
  color: '#a98bd4',
  description: 'Loops short runs of motion frames. Movement rocks back and forth and builds up in pulses.',
  retimes: true,
  span: 2,
  params: [
    {
      key: 'mode',
      label: 'Loop when',
      type: 'select',
      default: 'repeat',
      options: [
        { value: 'repeat', label: 'All the way', hint: 'Loops one after another for the whole length of the bar.' },
        { value: 'once', label: 'Once', hint: 'A single loop at the start of the bar.' },
        { value: 'every', label: 'Every N frames', hint: 'A new loop starts every N frames (rhythmic pulses).' },
        { value: 'beats', label: 'On the beat', hint: 'A new loop starts on each beat of the music. Needs music on the timeline.' },
      ],
      help: 'When loops are triggered inside the bar.',
    },
    ...beatParams((p) => p.mode === 'beats'),
    { key: 'group', label: 'Group size', type: 'int', min: 2, max: 60, default: 6, unit: 'frames', help: 'How many frames are in each loop. Small groups jitter, big groups rock slowly.' },
    { key: 'loops', label: 'Loops', type: 'int', min: 1, max: 30, default: 3, intensity: 'up', help: 'How many times each group plays (1 = no repeat).' },
    { show: (p) => p.mode === 'every', key: 'every', label: 'Repeat every', type: 'int', min: 1, max: 300, default: 24, intensity: 'down', unit: 'frames', help: 'Start a new loop every N frames. 24 at 24 fps = one pulse per second.' },
    { key: 'pingpong', label: 'Ping-pong', type: 'bool', default: false, help: 'Every other loop plays backwards, so motion rocks to and fro instead of jumping.' },
    TIMING,
  ],
  apply(frames, e, ctx) {
    const out: Frame[] = [];
    let sinceTrigger = Infinity;
    let i = 0;
    const hits = str(e, 'mode') === 'beats' ? beatHits(e, ctx.audio) : [];
    let nextHit = 0;
    while (i < frames.length) {
      const f = frames[i];
      if (!inRange(f, e)) {
        out.push(f);
        sinceTrigger = Infinity;
        i++;
        continue;
      }
      const t = tOf(f, e);
      const mode = str(e, 'mode');
      const every = Math.max(1, Math.round(num(e, 'every', t)));
      let onBeat = false;
      if (mode === 'beats') {
        // every beat at or before this frame that hasn't fired yet fires now
        while (nextHit < hits.length && hits[nextHit] <= posOf(f)) ((nextHit++), (onBeat = true));
      }
      const trigger = mode === 'beats' ? onBeat : sinceTrigger === Infinity || mode === 'repeat' || (mode === 'every' && sinceTrigger >= every);
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
      if (p) idx.forEach((dst, n) => (out[dst] = p[n] === dst ? frames[dst] : copy(frames[p[n]], 'moved', posOf(frames[dst]))));
      a = b;
    }
  }
  return out;
}

export const shuffle: BitstreamEffect = {
  kind: 'bitstream',
  type: 'shuffle',
  name: 'Shuffle',
  icon: 'SHF',
  color: '#5fa8c8',
  description: 'Reorders motion frames inside small windows. Movement jerks and jitters, and the smear gets scrambled.',
  params: [
    { key: 'window', label: 'Window', type: 'int', min: 2, max: 120, default: 8, intensity: 'up', unit: 'frames', help: 'Frames only swap places with others in the same window. Small = jitter, large = chaos.' },
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 1, intensity: 'up', help: 'Chance that each window gets shuffled (1 = every window).' },
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
  icon: 'REV',
  color: '#6cc0a0',
  description: 'Plays motion frames backwards. The vectors no longer match the picture, so things un-melt and fold back on themselves.',
  params: [
    { key: 'window', label: 'Window', type: 'int', min: 0, max: 300, default: 0, unit: 'frames', help: '0 = reverse the whole bar in one go; otherwise reverse it in chunks of this many frames.' },
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
  icon: 'DRP',
  color: '#8d8a84',
  description: 'Throws frames away. Later frames then move the wrong picture, which reads as skips, judder and stutter.',
  params: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'every',
      options: [
        { value: 'every', label: 'Every Nth', hint: 'A regular pattern of drops.' },
        { value: 'probability', label: 'Random chance', hint: 'Frames are dropped by chance.' },
        { value: 'beats', label: 'On the beat', hint: 'A frame is dropped on each beat, so the picture skips in time with the music.' },
      ],
      help: 'How frames are picked for dropping.',
    },
    ...beatParams((p) => p.mode === 'beats'),
    { show: (p) => p.mode === 'every', key: 'every', label: 'Every Nth', type: 'int', min: 2, max: 30, default: 3, intensity: 'down', help: 'Drop every Nth frame. 2 drops every other frame.' },
    { show: (p) => p.mode === 'probability', key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.25, intensity: 'up', help: 'Chance each frame is dropped.' },
    {
      key: 'types',
      label: 'Frame types',
      type: 'select',
      default: 'motion',
      options: [
        { value: 'motion', label: 'Motion frames only', hint: 'Keyframes are never dropped.' },
        { value: 'all', label: 'Any frame', hint: 'Keyframes can be dropped too, which also stops the picture resetting.' },
      ],
      help: 'Which kinds of frames can be dropped.',
      advanced: true,
    },
    {
      ...TIMING,
      options: [
        { value: 'fit', label: 'Keep length', hint: 'A dropped frame is replaced by the motion before it, so the video stays in sync with the timeline.' },
        { value: 'stretch', label: 'Shorten', hint: 'Dropped frames are cut out, so the video gets shorter and everything after starts earlier.' },
      ],
      help: 'Whether dropped frames are filled (stays in sync) or cut out (the video gets shorter).',
    },
  ],
  apply(frames, e, ctx) {
    let n = 0;
    const fit = str(e, 'timing') !== 'stretch';
    const out: Frame[] = [];
    let lastMotion: Frame | undefined;
    const push = (f: Frame) => {
      out.push(f);
      if (isMotion(f)) lastMotion = f;
    };
    const mode = str(e, 'mode');
    const onBeat = mode === 'beats' ? framesAtHits(frames, e, beatHits(e, ctx.audio), (f) => str(e, 'types') !== 'motion' || isMotion(f)) : null;
    frames.forEach((f, i) => {
      if (i === 0 || !inRange(f, e) || (str(e, 'types') === 'motion' && !isMotion(f))) return void push(f);
      const t = tOf(f, e);
      const del = onBeat ? onBeat.has(f) : mode === 'every' ? ++n % Math.max(2, Math.round(num(e, 'every', t))) === 0 : ctx.rng.chance(num(e, 'probability', t));
      if (!del) return void push(f);
      if (fit && lastMotion) out.push(copy(lastMotion, 'dup', posOf(f)));
    });
    return out;
  },
};

export const echo: BitstreamEffect = {
  kind: 'bitstream',
  type: 'echo',
  name: 'Echo',
  icon: 'ECH',
  color: '#c97fae',
  description: 'Re-plays motion from a few frames back, so past movement doubles up with the present like a ghost.',
  retimes: true,
  params: [
    { key: 'delay', label: 'Delay', type: 'int', min: 1, max: 120, default: 6, unit: 'frames', help: 'How far back the echoed motion comes from.' },
    { key: 'probability', label: 'Chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, intensity: 'up', help: 'Chance that each frame echoes.' },
    { key: 'taps', label: 'Taps', type: 'int', min: 1, max: 8, default: 1, intensity: 'up', help: 'Number of echoes per frame, each one a further Delay back.' },
    TIMING,
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
        if (g && isMotion(g)) out.push(copy(g, 'dup', posOf(f)));
      }
    });
    return out;
  },
};

export const splice: BitstreamEffect = {
  kind: 'bitstream',
  type: 'splice',
  name: 'Motion Transfer',
  icon: 'XFR',
  color: '#86c766',
  description: 'Takes the motion from another part of the timeline and applies it here, e.g. a still face moving with a dancer. Put a Keyframe Killer under it so the picture doesn\'t reset.',
  retimes: true,
  span: 3,
  params: [
    { key: 'from', label: 'Motion source frame', type: 'frame', default: 0, help: 'First frame of the motion to borrow. Move the playhead there and press the arrow button.' },
    { key: 'length', label: 'Source length', type: 'int', min: 0, max: 3600, default: 0, unit: 'frames', help: 'How many frames of motion to borrow. 0 = as long as this bar.' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'replace',
      options: [
        { value: 'replace', label: 'Replace frames in range', hint: 'Every frame under the bar is replaced by borrowed motion (looping if the source is shorter).' },
        { value: 'insert', label: 'Insert at range start', hint: 'The borrowed motion plays at the start of the bar, then the footage continues.' },
      ],
      help: 'How the borrowed motion is placed.',
    },
    { show: (p) => p.mode === 'insert', key: 'loops', label: 'Loops', type: 'int', min: 1, max: 20, default: 1, help: 'For Insert: how many times the borrowed motion plays.' },
    { key: 'speed', label: 'Speed', type: 'number', min: 0.25, max: 4, step: 0.05, default: 1, help: 'Playback speed of the borrowed motion (frames are skipped or repeated).', advanced: true },
    { ...TIMING, show: (p) => p.mode === 'insert' },
  ],
  apply(frames, e, ctx) {
    const from = Math.round(Number(e.params.from));
    const len = Math.round(Number(e.params.length)) || Math.max(1, e.end - e.start);
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
          for (let k = 0; k < n; k++) out.push(copy(at(k), 'spliced', posOf(f)));
          continue;
        }
        out.push(f);
      }
      return out;
    }
    let k = 0;
    frames.forEach((f, i) => {
      if (inRange(f, e) && i > 0) out.push(copy(at(k++), 'spliced', posOf(f)));
      else out.push(f);
    });
    return out;
  },
};

const GLITCH_MODES = [
  { value: 'flip', label: 'Bit flip', hint: 'Flips single bits. Subtle: small colour shifts and the odd misplaced block.' },
  { value: 'replace', label: 'Random byte', hint: 'Overwrites bytes with random values. Blocks jump and smear: the classic macroblock rain.' },
  { value: 'nudge', label: 'Nudge bytes ±', hint: 'Changes bytes by a tiny amount. Gentle colour and texture drift, rarely breaks the frame.' },
  { value: 'zero', label: 'Zero out', hint: 'Blanks runs of bytes. Areas freeze or go flat.' },
  { value: 'max', label: 'Max out (0xFF)', hint: 'Fills runs with 0xFF. Harsh streaks and bright blocks.' },
  { value: 'run', label: 'Random run', hint: 'Fills runs with noise. Heavy tearing from that point down.' },
  { value: 'repeat', label: 'Copy run', hint: 'Copies one run of data over another. Repeated texture patches.' },
  { value: 'swap', label: 'Swap runs', hint: 'Swaps two runs of data. Pieces of the picture trade places.' },
  { value: 'shift', label: 'Bit-shift tail', hint: 'Shifts all bits after a point. Everything below it turns to garbage: very destructive.' },
  { value: 'insert', label: 'Insert bytes', hint: 'Inserts noise, pushing the rest of the frame along. Slanted, shifted tears.' },
  { value: 'delete', label: 'Delete bytes', hint: 'Removes bytes, pulling the rest of the frame back. Tears the other way.' },
];

export const byteGlitch: BitstreamEffect = {
  kind: 'bitstream',
  type: 'glitch',
  name: 'Byte Glitch',
  icon: 'GLT',
  color: '#d8cf4a',
  description: 'Damages the compressed data. On keyframes it shifts colour and texture; on motion frames it throws blocks around. Start with a low Amount: a little goes a long way.',
  span: 2,
  params: [
    { key: 'mode', label: 'Corruption', type: 'select', default: 'flip', options: GLITCH_MODES, help: 'How the bytes are damaged.' },
    { key: 'amount', label: 'Amount', type: 'number', min: 0, max: 100, step: 0.5, default: 3, intensity: 'up', help: 'Corruption operations per frame. 1–5 is usually plenty; high values can break frames completely.', chaos: [1, 12], log: true },
    { key: 'probability', label: 'Frame chance', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, intensity: 'up', help: 'Chance each frame gets glitched.' },
    {
      key: 'gate',
      label: 'When',
      type: 'select',
      default: 'always',
      options: [
        { value: 'always', label: 'All the time', hint: 'Anywhere under the bar (with the Frame chance).' },
        { value: 'beats', label: 'On the beat', hint: 'Only for a few frames from each beat of the music, so the damage hits in time. Needs music on the timeline.' },
      ],
      help: 'Glitch all the time, or only on the beat.',
    },
    ...beatParams((p) => p.gate === 'beats'),
    { show: (p) => p.gate === 'beats', key: 'beatHold', label: 'Hold', type: 'int', min: 1, max: 48, default: 3, intensity: 'up', unit: 'frames', help: 'How many frames from each beat get glitched.' },
    {
      key: 'target',
      label: 'Target frames',
      type: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All frames', hint: 'Keyframes and motion frames.' },
        { value: 'motion', label: 'Motion frames (P)', hint: 'Damaged motion makes blocks fly around and the damage spreads into later frames.' },
        { value: 'keys', label: 'Keyframes (I)', hint: 'Damaged full pictures: colour shifts and texture tears that the motion then carries along.' },
      ],
      help: 'Which frame types to corrupt.',
    },
    { show: (p) => ['zero', 'max', 'run', 'repeat', 'swap', 'insert', 'delete'].includes(String(p.mode)), key: 'runLength', label: 'Run length', type: 'int', min: 1, max: 512, default: 16, unit: 'bytes', help: 'Size of runs for the run/copy/swap/insert/delete modes.', log: true },
    { key: 'regionStart', label: 'Region start', type: 'number', min: 0, max: 1, step: 0.01, default: 0, help: 'Only corrupt from this point of each frame (0 = top of the image, roughly).', advanced: true },
    { key: 'regionEnd', label: 'Region end', type: 'number', min: 0, max: 1, step: 0.01, default: 1, help: 'Only corrupt up to this point of each frame (1 = bottom).', advanced: true },
    { key: 'protect', label: 'Protect bytes', type: 'int', min: 0, max: 256, default: 4, help: 'Extra bytes after the frame header that are never touched. Raise this if the video breaks too badly.', advanced: true },
    { key: 'safe', label: 'Avoid start codes', type: 'bool', default: true, help: 'Stops corruption from creating fake "new frame" markers, which keeps glitches contained.', advanced: true },
  ],
  apply(frames, e, ctx) {
    const rng = ctx.rng;
    const hits = str(e, 'gate') === 'beats' ? beatHits(e, ctx.audio) : null;
    const hold = Math.max(1, Math.round(Number(e.params.beatHold ?? 3)));
    const gated = (pos: number) => {
      if (!hits) return true;
      for (const h of hits) if (pos >= h && pos < h + hold) return true;
      return false;
    };
    return frames.map((f, i) => {
      if (i === 0 || !inRange(f, e) || !gated(posOf(f))) return f;
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
