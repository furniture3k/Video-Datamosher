// The canvas: the picture set in from the frame's edges like a card, on a colour, a gradient or a
// blurred copy of itself, with rounded corners, a border and a shadow (collage and scrapbook
// edits). This is the model and its geometry (pure): ../lib/canvas draws it, args.ts builds the
// same thing in FFmpeg.

export type BackdropKind = 'color' | 'gradient' | 'blur' | 'image';

export interface Canvas {
  /** what's behind the picture */
  bg: BackdropKind;
  color: string;
  /** gradient: from `color` to `color2`, at this angle (degrees, 0 = top to bottom) */
  color2?: string;
  angle?: number;
  /** image: the picture (an image in the media), filling the frame */
  image?: string;
  /** blur: how soft the copy is, 0..1 */
  blur?: number;
  /** space round the picture, as a share of the frame's shorter side */
  inset: number;
  /** moves the card down (+) or up (−), as a share of the frame height (room for a caption) */
  shift?: number;
  /** corner rounding, as a share of the card's shorter side (0.5: as round as it gets) */
  radius?: number;
  /** border width (share of the frame height) and colour */
  border?: number;
  borderColor?: string;
  /** drop shadow under the card, 0..1 */
  shadow?: number;
}

export const DEFAULT_CANVAS: Canvas = { bg: 'color', color: '#f4efe6', inset: 0.06, radius: 0.04, shadow: 0.4 };

/** Ready-made canvases (each a starting point; everything can be changed after). */
export const CANVAS_PRESETS: { id: string; name: string; canvas: Canvas }[] = [
  { id: 'card', name: 'Paper card', canvas: DEFAULT_CANVAS },
  { id: 'polaroid', name: 'Polaroid', canvas: { bg: 'color', color: '#1a1a1a', inset: 0.07, shift: -0.04, radius: 0, border: 0.025, borderColor: '#fbfaf5', shadow: 0.5 } },
  { id: 'blur', name: 'Blurred', canvas: { bg: 'blur', color: '#000000', blur: 0.6, inset: 0.08, radius: 0.06, shadow: 0.6 } },
  { id: 'pastel', name: 'Pastel', canvas: { bg: 'gradient', color: '#ffd1e8', color2: '#bde0ff', angle: 30, inset: 0.07, radius: 0.08, shadow: 0.3 } },
  { id: 'night', name: 'Night', canvas: { bg: 'gradient', color: '#0b1a3a', color2: '#000000', angle: 0, inset: 0.05, radius: 0.03, border: 0.004, borderColor: '#ffffff', shadow: 0 } },
];

export interface CardRect {
  /** where the card is in the frame (pixels) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** corner radius (pixels) */
  r: number;
  /** the part of the full picture shown on the card (pixels of the w×h picture): its middle, cropped to the card's shape */
  crop: { x: number; y: number; w: number; h: number };
}

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/** The card in a W×H frame. Sizes are whole, even pixels so FFmpeg and the preview agree. */
export function cardRect(c: Canvas, W: number, H: number): CardRect {
  const pad = Math.max(0, Math.min(0.45, c.inset)) * Math.min(W, H);
  const w = even(W - 2 * pad);
  const h = even(H - 2 * pad);
  const x = Math.round((W - w) / 2);
  const y = Math.round(Math.max(0, Math.min(H - h, (H - h) / 2 + (c.shift ?? 0) * H)));
  const r = Math.round(Math.max(0, Math.min(0.5, c.radius ?? 0)) * Math.min(w, h));
  // the picture, scaled to cover the card, its middle shown
  const k = Math.max(w / W, h / H);
  const cw = even(Math.min(W, w / k));
  const ch = even(Math.min(H, h / k));
  return { x, y, w, h, r, crop: { x: Math.round((W - cw) / 2), y: Math.round((H - ch) / 2), w: cw, h: ch } };
}

/** The blur radius (pixels) for a blurred backdrop in a frame H pixels high. */
export const blurRadius = (c: Canvas, H: number) => Math.max(1, Math.round((c.blur ?? 0.5) * H * 0.04));

/** Is the picture inset at all? (No canvas, or one with nothing set in, changes nothing.) */
export const hasCanvas = (c: Canvas | undefined): c is Canvas => !!c && c.inset > 0;

/** A point of the picture (shares of it) to where it shows in the frame (shares of the frame), with or without a canvas. */
export function onCard(c: Canvas | undefined, W: number, H: number, u: number, v: number): [number, number] {
  if (!hasCanvas(c)) return [u, v];
  const R = cardRect(c, W, H);
  return [(R.x + ((u * W - R.crop.x) * R.w) / R.crop.w) / W, (R.y + ((v * H - R.crop.y) * R.h) / R.crop.h) / H];
}

/** The other way: a point of the frame to the point of the picture shown there. */
export function offCard(c: Canvas | undefined, W: number, H: number, x: number, y: number): [number, number] {
  if (!hasCanvas(c)) return [x, y];
  const R = cardRect(c, W, H);
  return [(R.crop.x + ((x * W - R.x) * R.crop.w) / R.w) / W, (R.crop.y + ((y * H - R.y) * R.crop.h) / R.h) / H];
}

/** How much bigger things in the picture look on the card (across, down). */
export function cardScale(c: Canvas | undefined, W: number, H: number): [number, number] {
  if (!hasCanvas(c)) return [1, 1];
  const R = cardRect(c, W, H);
  return [R.w / R.crop.w, R.h / R.crop.h];
}
