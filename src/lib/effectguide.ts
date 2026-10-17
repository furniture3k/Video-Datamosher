// Plain-language guide to the effects: what each one looks like, which family it belongs to,
// and a little frame diagram of what it does to the video. Used by the effect picker.

/**
 * One cell of a frame diagram. `k` is the kind of frame (I = full picture, P = motion only),
 * `n` its original position, and `m` what the effect did to it.
 */
export interface Cell {
  k: 'I' | 'P';
  n?: number;
  m?: 'removed' | 'repeat' | 'moved' | 'from' | 'glitch' | 'vector';
}

export interface Family {
  id: string;
  title: string;
  /** what the effects in this family have in common */
  note: string;
}

export interface Guide {
  family: string;
  /** what you see, in a sentence */
  looks: string;
  /** shown in Simple mode; the rest are behind "More effects" */
  essential?: boolean;
  diagram?: Cell[];
}

export const FAMILIES: Family[] = [
  { id: 'melt', title: 'Melts', note: 'The heart of datamoshing. Without a clean frame to reset it, one picture keeps moving with the wrong motion.' },
  { id: 'smear', title: 'Smears', note: 'Motion piles up on itself, so pixels stretch and pour.' },
  {
    id: 'rhythm',
    title: 'Rhythm',
    note: 'These all reorder the same motion frames, so on calm footage they can look alike. They come apart on footage with strong, one-direction movement, and on the beat.',
  },
  { id: 'damage', title: 'Damage', note: 'Corrupts the compressed data itself: blocks, tears and colour bursts.' },
  { id: 'colour', title: 'Colour & pixels', note: 'Works on the finished picture, so it looks the same on any footage.' },
  { id: 'retro', title: 'Retro looks', note: 'Old tape, old screens, film and cheap colour, on top of the finished picture.' },
  { id: 'protect', title: 'Protect', note: 'Decides where the mosh is allowed to happen.' },
];

const P = (n: number, m?: Cell['m']): Cell => ({ k: 'P', n, m });
const I = (m?: Cell['m']): Cell => ({ k: 'I', m });

export const GUIDE: Record<string, Guide> = {
  kill: {
    family: 'melt',
    essential: true,
    looks: 'One shot melts into the next: the new motion paints over the old picture. Start most moshes with this.',
    diagram: [P(1), P(2), I('removed'), P(3), P(4), P(5)],
  },
  splice: {
    family: 'melt',
    essential: true,
    looks: "One shot's picture moves with another shot's motion, like a still face that starts to dance.",
    diagram: [P(1), P(2), P(7, 'from'), P(8, 'from'), P(9, 'from'), P(10, 'from')],
  },
  bloom: {
    family: 'smear',
    essential: true,
    looks: 'Pixels swell and pour outward in the direction things were already moving.',
    diagram: [P(1), P(2), P(2, 'repeat'), P(2, 'repeat'), P(2, 'repeat'), P(2, 'repeat')],
  },
  echo: {
    family: 'smear',
    looks: 'Movement doubles up with what happened a moment ago, like a ghost trailing behind.',
    diagram: [P(1), P(2), P(3), P(1, 'repeat'), P(4), P(2, 'repeat')],
  },
  vectorWarp: {
    family: 'smear',
    essential: true,
    looks: 'Smooth, liquid flow you can steer: swirl, push, amplify. Works on any footage, even still shots.',
  },
  flowPaint: { family: 'smear', looks: 'Draw on the player where the picture should smear: push, swirl, pinch or bulge.' },
  mvedit: {
    family: 'smear',
    looks: "Bends the codec's own motion arrows: turn, flip or amplify them. Blockier and more 'real' than Vector Warp.",
    diagram: [P(1), P(2, 'vector'), P(3, 'vector'), P(4, 'vector'), P(5, 'vector'), P(6, 'vector')],
  },
  stutter: {
    family: 'rhythm',
    essential: true,
    looks: 'Motion rocks back and forth in pulses. Best on the beat.',
    diagram: [P(1), P(2), P(1, 'moved'), P(2, 'moved'), P(1, 'moved'), P(2, 'moved')],
  },
  shuffle: { family: 'rhythm', looks: 'Twitchy, scrambled motion: jitter rather than flow.', diagram: [P(3, 'moved'), P(1, 'moved'), P(2, 'moved'), P(6, 'moved'), P(4, 'moved'), P(5, 'moved')] },
  reverse: { family: 'rhythm', looks: 'Things fold back into themselves and un-melt.', diagram: [P(6, 'moved'), P(5, 'moved'), P(4, 'moved'), P(3, 'moved'), P(2, 'moved'), P(1, 'moved')] },
  drop: { family: 'rhythm', looks: 'Skips and judders, like a bad video call.', diagram: [P(1), P(2, 'removed'), P(3), P(4, 'removed'), P(5), P(6, 'removed')] },
  sequence: { family: 'rhythm', looks: 'A looping step pattern of blooms, echoes, reverses and glitches, like a drum machine.', diagram: [P(1), P(1, 'repeat'), P(4, 'moved'), P(3, 'moved'), P(5, 'glitch'), P(6, 'removed')] },
  glitch: { family: 'damage', essential: true, looks: 'Torn blocks, colour bursts and macroblock rain. A little goes a long way.', diagram: [P(1), P(2, 'glitch'), P(3), P(4), P(5, 'glitch'), P(6)] },
  databend: { family: 'damage', looks: 'Smeared colour and repeating texture: audio effects run over the video data.', diagram: [P(1, 'glitch'), P(2, 'glitch'), P(3, 'glitch'), P(4, 'glitch'), P(5, 'glitch'), P(6, 'glitch')] },
  chroma: { family: 'colour', essential: true, looks: 'Red, green and blue split apart, with VHS-style tearing.' },
  pixelSort: { family: 'colour', essential: true, looks: 'Streaks of sorted pixels pour across the bright or dark parts.' },
  rawbend: { family: 'colour', looks: 'Diagonal ghosts, colour smears and posterised bands.' },
  vhs: { family: 'retro', essential: true, looks: 'A worn tape: wobbling lines, a rolling tracking band, bleeding colour and hiss.' },
  crt: { family: 'retro', looks: 'An old TV: curved glass, scanlines and glowing stripes.' },
  grain: { family: 'retro', looks: 'Dancing film grain, and a faded print if you like.' },
  posterize: { family: 'retro', looks: 'A handful of colours with a retro dither, and chunky pixels.' },
  mask: { family: 'protect', essential: true, looks: 'Keeps a person, a tracked object or a colour clean while everything else moshes, or follows a map you paint, a gradient, a video or the depth of the scene.' },
};

export const guideOf = (type: string): Guide => GUIDE[type] ?? { family: 'damage', looks: '' };
