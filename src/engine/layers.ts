// Layers: everything drawn over the picture. Titles today; shapes, stickers and more join as new
// kinds. This file is the model and its timing (pure: no canvas), so it runs in tests and workers.

export type TextAnim = 'none' | 'type' | 'words' | 'glitch' | 'slide' | 'pop' | 'slam' | 'stamp' | 'drop';

export type LayerKind = 'text';

interface LayerBase {
  id: string;
  kind: LayerKind;
  /** graphics row on the timeline: 'g1' is the lowest, higher rows draw on top */
  row: string;
  start: number;
  duration: number;
  /** burn into the video before moshing so it melts too */
  moshed: boolean;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  /** font size as a fraction of frame height */
  size: number;
  color: string;
  font: 'sans' | 'serif' | 'mono' | 'impact';
  bold: boolean;
  /** position of the text centre, 0..1 */
  x: number;
  y: number;
  /** degrees clockwise, about its position */
  rotate?: number;
  align: 'left' | 'center' | 'right';
  shadow: boolean;
  box: boolean;
  fade: number;
  /** made by auto captions */
  caption?: boolean;
  /** word timings (seconds from the title's start), for word-by-word highlighting */
  words?: { t0: number; t1: number; text: string }[];
  /** colour of the word being spoken */
  highlight?: string;
  /** follow a tracked object: [timeline seconds, x 0..1, y 0..1] */
  follow?: [number, number, number][];
  /** how it comes in */
  anim?: TextAnim;
  /** how long it takes to come in (s) */
  animIn?: number;
  /** how it goes out (the entrance played backwards), and how long that takes (s) */
  exit?: TextAnim;
  animOut?: number;
  /** extra space between letters, as a share of the letter size */
  spacing?: number;
  /** line spacing, as a multiple of the letter size (1.2 when missing) */
  lineHeight?: number;
  /** an outline: its width as a share of the letter size, its colour, and whether the letters are only outlined */
  stroke?: number;
  strokeColor?: string;
  strokeOnly?: boolean;
  /** 'width': as big as fits across the frame (`size` is then ignored) */
  fit?: 'width';
  /** copies side by side, one above another, or both, filling the frame */
  repeat?: 'across' | 'down' | 'both';
  /** space between copies, as a share of the letter size */
  repeatGap?: number;
  /** the copies scroll (a marquee): frame widths (or heights) a second, negative the other way */
  scroll?: number;
  /** blinks on and off this many times a second */
  strobe?: number;
  /** a hand-drawn wobble, 0..1 */
  boil?: number;
}

export type Layer = TextLayer;

export const FIRST_ROW = 'g1';

/** Row number of a row id ('g3' → 3); unknown ids sort first. */
export const rowIndex = (row: string) => Number(/^g(\d+)$/.exec(row)?.[1] ?? 0);

/** The rows in use, bottom first (always at least the first one). */
export function layerRows(layers: Pick<Layer, 'row'>[]): string[] {
  const rows = new Set([FIRST_ROW, ...layers.map((l) => l.row)]);
  return [...rows].sort((a, b) => rowIndex(a) - rowIndex(b));
}

/** The id of a new row above every row in use. */
export const nextRow = (layers: Pick<Layer, 'row'>[]) => 'g' + (Math.max(0, ...layerRows(layers).map(rowIndex)) + 1);

/** Layers in drawing order: lower rows first, then in list order within a row. */
export function drawOrder<L extends Pick<Layer, 'row'>>(layers: L[]): L[] {
  return layers.map((l, i) => [l, i] as const).sort((a, b) => rowIndex(a[0].row) - rowIndex(b[0].row) || a[1] - b[1]).map(([l]) => l);
}

export const layerEnd = (l: Pick<Layer, 'start' | 'duration'>) => l.start + l.duration;

/** Opacity of a layer at timeline time t from its fades (0 when not on screen). */
export function layerAlpha(l: Layer, t: number): number {
  if (t < l.start || t >= layerEnd(l)) return 0;
  const f = Math.min(l.fade, l.duration / 2);
  if (f <= 0) return 1;
  return Math.max(0, Math.min(1, (t - l.start) / f, (layerEnd(l) - t) / f));
}

/** Where a layer sits at timeline time t (following a tracked object if it has one). */
export function layerPos(l: Layer, t: number): [number, number] {
  if (!l.follow?.length) return [l.x, l.y];
  const f = l.follow;
  if (t <= f[0][0]) return [f[0][1], f[0][2]];
  for (let i = 0; i < f.length - 1; i++) {
    const [a, ax, ay] = f[i];
    const [b, bx, by] = f[i + 1];
    if (t <= b) {
      const u = b > a ? (t - a) / (b - a) : 1;
      return [ax + (bx - ax) * u, ay + (by - ay) * u];
    }
  }
  const last = f[f.length - 1];
  return [last[1], last[2]];
}

/** A layer that has nothing to draw. */
export const isEmpty = (l: Layer) => !l.text.trim();

/**
 * True when the layer looks the same at every moment it's on screen apart from its fades, so a
 * single picture of it can stand in for every frame (fades are applied on top of that picture).
 */
export const isStill = (l: Layer) =>
  !l.follow?.length && (!l.anim || l.anim === 'none') && (!l.exit || l.exit === 'none') && !(l.words?.length && l.highlight) && !l.strobe && !l.boil && !(l.repeat && l.scroll);

/** Layers on screen at some point in [t0, t1). */
export const layersIn = <L extends Pick<Layer, 'start' | 'duration'>>(layers: L[], t0: number, t1: number) => layers.filter((l) => l.start < t1 && layerEnd(l) > t0);
