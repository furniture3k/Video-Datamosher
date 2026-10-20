// Laying out a title and working out how it looks at a moment of its animation (pure: text is
// measured through a function the caller passes, so this runs anywhere, tests included).
import { layerEnd, type TextAnim, type TextLayer } from './layers';

/** Width of a string drawn at 100 px in the title's font (widths scale with the size). */
export type Measure = (s: string) => number;

export interface TextLine {
  text: string;
  /** left edge and middle, relative to the title's position (pixels) */
  x: number;
  y: number;
  width: number;
  /** left edge of each letter (code point), relative to the line's left edge */
  letters: number[];
}

export interface TextLayout {
  /** letter size in pixels, after fitting */
  size: number;
  lineHeight: number;
  /** extra space after each letter (pixels) */
  spacing: number;
  lines: TextLine[];
  /** the box around it all (with the background box's padding), relative to the position */
  box: { x: number; y: number; w: number; h: number };
}

/** How much of the frame width a title fitted to it fills. */
export const FIT_WIDTH = 0.94;

/** Lay out a title in a W×H frame. */
export function layoutText(tx: TextLayer, W: number, H: number, measure: Measure): TextLayout {
  const lines = tx.text.split('\n');
  const widthAt = (s: string, size: number) => (measure(s) * size) / 100 + Math.max(0, [...s].length - 1) * (tx.spacing ?? 0) * size;
  let size = Math.max(4, tx.size * H);
  if (tx.fit === 'width') {
    const widest = Math.max(...lines.map((l) => widthAt(l, size)));
    if (widest > 0) size *= (W * FIT_WIDTH) / widest;
  }
  const spacing = (tx.spacing ?? 0) * size;
  const lineHeight = size * (tx.lineHeight ?? 1.2);
  const n = lines.length;
  const out: TextLine[] = lines.map((text, i) => {
    const width = widthAt(text, size);
    const x = tx.align === 'left' ? 0 : tx.align === 'right' ? -width : -width / 2;
    const chars = [...text];
    const letters = chars.map((_, k) => (measure(chars.slice(0, k).join('')) * size) / 100 + k * spacing);
    return { text, x, y: (i - (n - 1) / 2) * lineHeight, width, letters };
  });
  const pad = tx.box ? size * 0.4 : 0;
  const x0 = Math.min(...out.map((l) => l.x)) - pad;
  const x1 = Math.max(...out.map((l) => l.x + l.width)) + pad;
  const h = n * lineHeight + (tx.box ? size * 0.4 : 0);
  return { size, lineHeight, spacing, lines: out, box: { x: x0, y: -h / 2, w: x1 - x0, h } };
}

// ---------- how it looks at a moment ----------

/** Everything about a title's animation at one moment, as the drawing needs it. */
export interface TextLook {
  /** drawn at all (strobe and the gaps of a typewriter can hide it) */
  visible: boolean;
  /** multiplies the fades */
  alpha: number;
  /** about its position */
  scale: number;
  /** moved by this many letter sizes */
  dx: number;
  dy: number;
  /** extra turn (degrees) */
  turn: number;
  /** share of the letters shown (typewriter, word by word) */
  letters: number;
  /** show whole words only (word by word) */
  wholeWords: boolean;
  /** how scrambled the letters are, 0..1 */
  glitch: number;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
const bounce = (p: number) => {
  // a fall that lands with two small bounces
  if (p < 0.6) return (p / 0.6) ** 2;
  if (p < 0.85) return 1 - 0.12 * Math.sin(((p - 0.6) / 0.25) * Math.PI);
  return 1 - 0.04 * Math.sin(((p - 0.85) / 0.15) * Math.PI);
};
/** repeatable noise: the same inputs give the same jump */
export const noise = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** How one animation looks `p` of the way in (p = 1: settled), folded into `look`. */
function animate(look: TextLook, a: TextAnim, p: number) {
  if (p >= 1 || a === 'none') return;
  switch (a) {
    case 'type':
      look.letters = Math.min(look.letters, p);
      break;
    case 'words':
      look.letters = Math.min(look.letters, p);
      look.wholeWords = true;
      break;
    case 'glitch':
      look.glitch = Math.max(look.glitch, 1 - easeOut(p));
      break;
    case 'slide':
      look.alpha *= easeOut(p);
      look.dy += (1 - easeOut(p)) * 1.2;
      break;
    case 'pop':
      look.alpha *= Math.min(1, p * 3);
      look.scale *= 0.4 + 0.6 * easeOutBack(p);
      break;
    case 'slam':
      // from big and close, hard into place
      look.scale *= 1 + 1.4 * (1 - easeOut(p)) ** 2;
      break;
    case 'stamp':
      // slightly too big and turned, then set down in one go
      if (p < 0.5) {
        look.scale *= 1.18;
        look.turn += -4;
      }
      break;
    case 'drop':
      look.dy -= (1 - bounce(p)) * 2.2;
      break;
  }
}

/**
 * How a title looks at timeline time t: its entrance (`anim` over `animIn` s), exit (`exit` over
 * `animOut` s, played backwards), strobe (blinks `strobe` times a second) and boil (a hand-drawn
 * wobble, a few drawings a second).
 */
export function textLookAt(tx: TextLayer, t: number): TextLook {
  const look: TextLook = { visible: true, alpha: 1, scale: 1, dx: 0, dy: 0, turn: 0, letters: 1, wholeWords: false, glitch: 0 };
  const into = t - tx.start;
  const left = layerEnd(tx) - t;
  if (tx.anim && tx.anim !== 'none') animate(look, tx.anim, Math.max(0, Math.min(1, into / Math.max(0.02, tx.animIn ?? 0.6))));
  if (tx.exit && tx.exit !== 'none') animate(look, tx.exit, Math.max(0, Math.min(1, left / Math.max(0.02, tx.animOut ?? 0.4))));
  if (tx.strobe && tx.strobe > 0) look.visible = Math.floor(into * tx.strobe * 2) % 2 === 0;
  if (tx.boil && tx.boil > 0) {
    // three drawings, eight a second, like hand-drawn animation "on twos"
    const d = Math.floor(into * 8) % 3;
    look.dx += (noise(d, 1.3) - 0.5) * 0.08 * tx.boil;
    look.dy += (noise(d, 2.7) - 0.5) * 0.08 * tx.boil;
    look.turn += (noise(d, 4.1) - 0.5) * 3 * tx.boil;
  }
  return look;
}

/** How many of a line's letters show when `share` of all `total` letters do, so far `before`. */
export function lettersShown(line: string, before: number, total: number, share: number, wholeWords: boolean): number {
  const chars = [...line];
  const upTo = Math.floor(share * total) - before;
  if (upTo <= 0) return 0;
  if (upTo >= chars.length) return chars.length;
  if (!wholeWords) return upTo;
  // back to the end of the last whole word
  let k = upTo;
  while (k > 0 && chars[k] && chars[k].trim()) k--;
  return k;
}
