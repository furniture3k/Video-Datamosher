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
  /** a device drawn round the picture: a phone, a browser or app window, a laptop (generic ones, no brands) */
  device?: 'phone' | 'browser' | 'window' | 'laptop' | 'music' | 'chat';
  /** a camera move: from `at` (timeline seconds) it zooms in over `dur` seconds, towards the card, and stays there (`to`: how far; the card filling the frame if not given) */
  zoomIn?: { at: number; dur: number; to?: number };
}

/** Anything drawn round the card on top of it (a border or a device)? */
export const hasChrome = (c: Canvas) => (c.border ?? 0) > 0 || !!c.device;

export const DEFAULT_CANVAS: Canvas = { bg: 'color', color: '#f4efe6', inset: 0.06, radius: 0.04, shadow: 0.4 };

/** Ready-made canvases (each a starting point; everything can be changed after). */
export const CANVAS_PRESETS: { id: string; name: string; canvas: Canvas }[] = [
  { id: 'card', name: 'Paper card', canvas: DEFAULT_CANVAS },
  { id: 'polaroid', name: 'Polaroid', canvas: { bg: 'color', color: '#1a1a1a', inset: 0.07, shift: -0.04, radius: 0, border: 0.025, borderColor: '#fbfaf5', shadow: 0.5 } },
  { id: 'blur', name: 'Blurred', canvas: { bg: 'blur', color: '#000000', blur: 0.6, inset: 0.08, radius: 0.06, shadow: 0.6 } },
  { id: 'pastel', name: 'Pastel', canvas: { bg: 'gradient', color: '#ffd1e8', color2: '#bde0ff', angle: 30, inset: 0.07, radius: 0.08, shadow: 0.3 } },
  { id: 'phone', name: 'Phone', canvas: { bg: 'gradient', color: '#ffd6a5', color2: '#ff7eb6', angle: 20, inset: 0.12, radius: 0.09, shadow: 0.6, device: 'phone' } },
  { id: 'browser', name: 'Browser', canvas: { bg: 'color', color: '#dfe6f0', inset: 0.07, shift: 0.025, radius: 0.012, shadow: 0.4, device: 'browser' } },
  { id: 'window', name: 'App window', canvas: { bg: 'gradient', color: '#2a2d6e', color2: '#0b0b14', angle: 0, inset: 0.07, shift: 0.025, radius: 0.012, shadow: 0.6, device: 'window' } },
  { id: 'laptop', name: 'Laptop', canvas: { bg: 'color', color: '#f2f2f2', inset: 0.13, shift: -0.03, radius: 0.01, shadow: 0.3, device: 'laptop' } },
  { id: 'music', name: 'Music player', canvas: { bg: 'gradient', color: '#3a1c71', color2: '#d76d77', angle: 20, inset: 0.17, shift: -0.1, radius: 0.05, shadow: 0.5, device: 'music' } },
  { id: 'chat', name: 'Chat bubble', canvas: { bg: 'color', color: '#eef1f6', inset: 0.15, shift: -0.04, radius: 0.05, shadow: 0.3, device: 'chat' } },
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

/** How far the camera is zoomed in at timeline time t (1: not at all), and the card's middle it zooms towards (shares of the frame). */
export function canvasZoomAt(c: Canvas | undefined, W: number, H: number, t: number): { z: number; cx: number; cy: number } {
  if (!hasCanvas(c) || !c.zoomIn) return { z: 1, cx: 0.5, cy: 0.5 };
  const R = cardRect(c, W, H);
  const to = Math.max(1, Math.min(8, c.zoomIn.to ?? Math.max(W / R.w, H / R.h)));
  const u = Math.max(0, Math.min(1, (t - c.zoomIn.at) / Math.max(0.04, c.zoomIn.dur)));
  const e = u * u * (3 - 2 * u);
  return { z: 1 + (to - 1) * e, cx: (R.x + R.w / 2) / W, cy: (R.y + R.h / 2) / H };
}

/**
 * The zoom as keys for FFmpeg's perspective filter over a stretch of the timeline [t0, t1] (key times
 * relative to t0): a key every frame while it moves, one at each end otherwise. Null if the camera
 * doesn't move or is still in the start position the whole stretch.
 */
export function canvasZoomKeys(c: Canvas | undefined, W: number, H: number, fps: number, t0: number, t1: number): { zoom: [number, number, 0][]; x: [number, number, 0][]; y: [number, number, 0][] } | null {
  if (!hasCanvas(c) || !c.zoomIn || t1 <= c.zoomIn.at) return null;
  const end = c.zoomIn.at + Math.max(0.04, c.zoomIn.dur);
  const times = [0];
  for (let t = Math.max(t0, c.zoomIn.at); t < Math.min(t1, end); t += 1 / fps) times.push(t - t0);
  times.push(t1 - t0);
  const ts = [...new Set(times.map((v) => Math.round(Math.max(0, v) * 1000) / 1000))].sort((a, b) => a - b);
  const zoom: [number, number, 0][] = [];
  const x: [number, number, 0][] = [];
  const y: [number, number, 0][] = [];
  for (const k of ts) {
    const { z, cx, cy } = canvasZoomAt(c, W, H, t0 + k);
    zoom.push([k, Math.round(z * 1e5) / 1e5, 0]);
    // zooming towards a point other than the middle moves the picture the other way
    x.push([k, Math.round((cx - 0.5) * (1 - z) * 1e5) / 1e5, 0]);
    y.push([k, Math.round((cy - 0.5) * (1 - z) * 1e5) / 1e5, 0]);
  }
  return { zoom, x, y };
}
