// Layers: everything drawn over the picture. Titles today; shapes, stickers and more join as new
// kinds. This file is the model and its timing (pure: no canvas), so it runs in tests and workers.

export type TextAnim = 'none' | 'type' | 'words' | 'glitch' | 'slide' | 'pop' | 'slam' | 'stamp' | 'drop';

export type LayerKind = 'text' | 'shape';

export type BuiltinFont = 'sans' | 'serif' | 'mono' | 'impact';

/** The id of the added font a title uses, if it uses one. */
export const fontId = (font: string) => (font.startsWith('font:') ? font.slice(5) : null);

interface LayerBase {
  id: string;
  kind: LayerKind;
  /** graphics row on the timeline: 'g1' is the lowest, higher rows draw on top */
  row: string;
  start: number;
  duration: number;
  /** burn into the video before moshing so it melts too */
  moshed: boolean;
  /** its position (centre), 0..1 of the frame */
  x: number;
  y: number;
  /** degrees clockwise, about its position */
  rotate?: number;
  /** fade in and out (s) */
  fade: number;
  /** follow a tracked object: [timeline seconds, x 0..1, y 0..1] */
  follow?: [number, number, number][];
  /** a drop shadow and an outer stroke round the whole layer, whatever it is */
  fx?: LayerFx;
  /** layers that share a group move, copy and delete together (the box, arrow and label of a mark) */
  group?: string;
  /** 'behind': under the subject cut out of the footage below (the layer is hidden where the matte is white); 'inside': a track matte, shown only on the subject */
  depth?: 'front' | 'behind' | 'inside';
  /** leaned back or to the side in perspective: degrees about the horizontal and the vertical axis through its position */
  tilt?: [number, number];
  /** pinned to a tracked surface: it is drawn where it is on `refT`, then carried along with the surface */
  surface?: Surface;
  /** stamp trail: every `every` seconds it steps on by (dx, dy) (shares of the frame), leaving a copy behind, `count` times */
  trail?: Trail;
  /** many copies rising, falling or bursting out from it */
  particles?: Particles;
}

import type { Particles } from './particles';
import { mul3, quadAt, quadHomography, type Mat3 } from './planar';
import { tiltMatrix } from './warp';

/** A tracked surface a layer is pinned to: [timeline seconds, the four corners as shares of the frame] and the moment the layer's own position is for. */
export interface Surface {
  quads: number[][];
  refT: number;
}

/**
 * How a pinned layer is carried at timeline time t: the homography (in pixels of a w×h frame)
 * taking the surface as it was on `refT` to the surface now. Null for a layer that isn't pinned.
 */
export function surfaceMatrix(l: Pick<LayerBase, 'surface'>, t: number, w: number, h: number): Mat3 | null {
  const s = l.surface;
  if (!s?.quads.length) return null;
  const a = quadAt(s.quads, s.refT);
  const b = quadAt(s.quads, t);
  if (!a || !b) return null;
  const px = (q: number[]) => q.map((v, i) => v * (i % 2 ? h : w));
  return quadHomography(px(a), px(b));
}

/** A drop shadow and an outer stroke for any layer (offsets and blur as shares of the frame height). */
export interface LayerFx {
  shadow?: { dx: number; dy: number; blur: number; color: string };
  outline?: { width: number; color: string };
}

export interface Trail {
  every: number;
  count: number;
  dx: number;
  dy: number;
}

/** Where the copies of a stamp trail are at timeline time t: offsets (shares of the frame), oldest first, the layer itself last. */
export function trailSteps(l: Pick<LayerBase, 'start' | 'trail'>, t: number): [number, number][] {
  const tr = l.trail;
  if (!tr || tr.count < 1 || tr.every <= 0) return [[0, 0]];
  const n = Math.max(0, Math.min(tr.count, Math.floor((t - l.start) / tr.every + 1e-6)));
  return Array.from({ length: n + 1 }, (_, k) => [k * tr.dx, k * tr.dy]);
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  /** font size as a fraction of frame height */
  size: number;
  color: string;
  /** a built-in typeface, or a font added to the project ("font:" and its id) */
  font: BuiltinFont | `font:${string}`;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  shadow: boolean;
  box: boolean;
  /** made by auto captions */
  caption?: boolean;
  /** word timings (seconds from the title's start), for word-by-word highlighting */
  words?: { t0: number; t1: number; text: string }[];
  /** colour of the word being spoken */
  highlight?: string;
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
  /** letters filled with a colour that runs from `color` to `to`, at this angle (0: left to right, 90: top to bottom) */
  gradient?: { to: string; angle: number };
  /** how each line differs from the rest (the first entry is the first line): its own colour, size (a multiple), typeface, weight */
  lines?: LineStyle[];
  /** colours for stretches of the words: letter numbers (counting every letter of the whole text) from–to, and the colour */
  colourRuns?: { from: number; to: number; color: string }[];
  /** the baseline bent into an arc, −1 (a smile) to 1 (an arch): the letters follow it, turned to suit */
  curve?: number;
}

/** What is different about one line of a title. */
export interface LineStyle {
  color?: string;
  size?: number;
  font?: BuiltinFont | `font:${string}`;
  bold?: boolean;
}

export type ShapeKind = 'rect' | 'round' | 'circle' | 'triangle' | 'star' | 'line' | 'arrow' | 'bracket' | 'underline' | 'highlight' | 'pen' | 'tunnel' | 'cursor' | 'progress' | 'heart' | 'sparkle' | 'burst' | 'subject' | 'polygon' | 'leader' | 'ripple' | 'handle';

/** What a subject effect does to the subject cut out of the footage (or, for blur and grade, to everything but it). */
export interface SubjectFx {
  effect: 'fill' | 'outline' | 'glow' | 'echo' | 'blur' | 'grade' | 'blurFaces' | 'pixelFaces';
  /** how much: thickness of an outline, size of a glow or blur (0..1) */
  amount: number;
  /** blur and grade: the subject, or everything else */
  part?: 'subject' | 'background';
  /** echo: how far each copy steps (shares of the frame) and how many there are */
  dx?: number;
  dy?: number;
  copies?: number;
  /** blurFaces, pixelFaces: where each face is, over the timeline: [timeline seconds, x, y (shares of the frame)] and the size of its box (shares) */
  faces?: { pts: [number, number, number][]; size: [number, number] }[];
  /** grade: brightness, saturation and contrast (1 = as it is) */
  brightness?: number;
  saturation?: number;
  contrast?: number;
}

/** A drawn shape: boxes, circles, arrows, lines, a freehand stroke… for marking things up. */
export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  shape: ShapeKind;
  /** size, as shares of the frame's width and height (lines and arrows go corner to corner) */
  w: number;
  h: number;
  /** line colour and width (a share of the frame height) */
  color: string;
  width: number;
  /** filled inside, in this colour */
  fill?: string;
  /** a soft glow in the line colour, 0..1 */
  glow?: number;
  /** draws itself on over this many seconds */
  drawOn?: number;
  /** a hand-drawn wobble, 0..1 */
  boil?: number;
  /** tunnel: how many boxes, one inside another */
  count?: number;
  /** arrow: size of its head, as a share of its length */
  head?: number;
  /** arrow and line: how much it bows out to one side (−1..1) */
  bend?: number;
  /** pen: the stroke, in the shape's box (−0.5..0.5 each way) */
  points?: [number, number][];
  /** subject: what it does to the subject cut out of the footage below */
  subject?: SubjectFx;
  /** polygon: how many sides (3 or more) */
  sides?: number;
  /** lines, arrows and leader lines: run from the top right to the bottom left instead */
  flip?: boolean;
}

export type Layer = TextLayer | ShapeLayer;

export const FIRST_ROW = 'g1';

export const isText = (l: Layer): l is TextLayer => l.kind === 'text';

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

/**
 * Everything that bends a layer's flat picture at timeline time t, as one homography in pixels of
 * a w×h frame: its tilt (about its position, seen from about a frame-width away), then the
 * surface it's pinned to. Null for a layer drawn flat.
 */
export function layerMatrix(l: Layer, t: number, w: number, h: number): Mat3 | null {
  const surface = surfaceMatrix(l, t, w, h);
  const [ax, ay] = l.tilt ?? [0, 0];
  if (!ax && !ay) return surface;
  const [px, py] = layerPos(l, t);
  const tilt = tiltMatrix(ax, ay, px * w, py * h, Math.max(w, h) * 1.2);
  return surface ? mul3(surface, tilt) : tilt;
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
export const isEmpty = (l: Layer) => (l.kind === 'text' ? !l.text.trim() : l.shape === 'pen' && (l.points?.length ?? 0) < 2);

/**
 * True when the layer looks the same at every moment it's on screen apart from its fades, so a
 * single picture of it can stand in for every frame (fades are applied on top of that picture).
 */
export function isStill(l: Layer): boolean {
  // (behind the subject changes with the footage's matte from frame to frame)
  if (l.follow?.length || l.surface || l.trail || l.particles || (l.depth && l.depth !== 'front')) return false;
  // (a subject effect follows the footage's matte from frame to frame)
  if (l.kind === 'shape') return !l.drawOn && !l.boil && l.shape !== 'progress' && l.shape !== 'subject' && l.shape !== 'ripple';
  return (!l.anim || l.anim === 'none') && (!l.exit || l.exit === 'none') && !(l.words?.length && l.highlight) && !l.strobe && !l.boil && !(l.repeat && l.scroll);
}

/** Layers on screen at some point in [t0, t1). */
export const layersIn = <L extends Pick<Layer, 'start' | 'duration'>>(layers: L[], t0: number, t1: number) => layers.filter((l) => l.start < t1 && layerEnd(l) > t0);

/** The lowest row with nothing on it between t0 and t1 (a new row on top when every row is busy). */
export function freeRow(layers: Layer[], t0: number, t1: number): string {
  for (const row of layerRows(layers)) if (!layersIn(layers.filter((l) => l.row === row), t0, t1).length) return row;
  return nextRow(layers);
}

/** The ids with those of everything grouped with them: what is moved, copied or deleted together. */
export function withGroups(layers: Pick<Layer, 'id' | 'group'>[], ids: string[]): string[] {
  const groups = new Set(layers.filter((l) => ids.includes(l.id) && l.group).map((l) => l.group));
  return layers.filter((l) => ids.includes(l.id) || (l.group && groups.has(l.group))).map((l) => l.id);
}

/** Give each group among `copies` a new id, so a copy of a group is a group of its own. */
export function regroup<L extends Pick<Layer, 'group'>>(copies: L[], newId: () => string): L[] {
  const ids = new Map<string, string>();
  return copies.map((l) => {
    if (!l.group) return l;
    if (!ids.has(l.group)) ids.set(l.group, newId());
    return { ...l, group: ids.get(l.group) };
  });
}

/**
 * Where the layers of a group are after the one named `id` moves by (dx, dy): the others move with
 * it (and what they follow). The layer itself is the caller's to move.
 */
export function moveGroupMates(layers: Layer[], id: string, dx: number, dy: number) {
  const me = layers.find((l) => l.id === id);
  if (!me?.group) return;
  for (const l of layers) {
    if (l.id === id || l.group !== me.group) continue;
    l.x += dx;
    l.y += dy;
    if (l.follow) l.follow = l.follow.map(([t, x, y]) => [t, x + dx, y + dy]);
  }
}

/** The layers on screen at timeline time t, split by which side of the subject they are drawn on, each side in drawing order (back to front). */
export function depthStack<L extends Pick<Layer, 'row' | 'start' | 'duration' | 'depth'>>(layers: L[], t: number): { behind: L[]; front: L[] } {
  const on = drawOrder(layers).filter((l) => t >= l.start && t < layerEnd(l));
  return { behind: on.filter((l) => l.depth === 'behind' || l.depth === 'inside'), front: on.filter((l) => l.depth !== 'behind' && l.depth !== 'inside') };
}

/**
 * Swap where two layers are drawn: if they are on different rows the rows swap, otherwise they
 * trade places in the list (a lower place is drawn first, so under the other).
 */
export function swapDrawOrder(layers: Layer[], a: string, b: string) {
  const la = layers.find((l) => l.id === a);
  const lb = layers.find((l) => l.id === b);
  if (!la || !lb || la === lb) return;
  if (la.row !== lb.row) [la.row, lb.row] = [lb.row, la.row];
  else {
    const i = layers.indexOf(la);
    const j = layers.indexOf(lb);
    [layers[i], layers[j]] = [layers[j], layers[i]];
  }
}
