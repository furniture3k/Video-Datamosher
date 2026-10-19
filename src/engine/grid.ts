// Split screens: clips arranged in cells (side by side, stacked, 2×2, 3×3…). Each clip is zoomed
// to cover its cell, moved into it and cropped to it, with the clip's own transform, so the
// preview and FFmpeg draw it with what they already have. Pure.
import { fitRect } from './placement';
import type { Clip, Transform } from './types';

/** A cell, as shares of the frame: left, top, width, height. */
export type Cell = [number, number, number, number];

export interface GridLayout {
  id: string;
  name: string;
  cells: Cell[];
}

const rows = (n: number): Cell[] => Array.from({ length: n }, (_, i) => [0, i / n, 1, 1 / n]);
const cols = (n: number): Cell[] => Array.from({ length: n }, (_, i) => [i / n, 0, 1 / n, 1]);
const grid = (c: number, r: number): Cell[] => Array.from({ length: c * r }, (_, i) => [(i % c) / c, Math.floor(i / c) / r, 1 / c, 1 / r]);

export const GRID_LAYOUTS: GridLayout[] = [
  { id: 'side', name: 'Side by side', cells: cols(2) },
  { id: 'stack', name: 'Stacked', cells: rows(2) },
  { id: 'stack3', name: 'Three stacked', cells: rows(3) },
  { id: 'cols3', name: 'Three across', cells: cols(3) },
  { id: 'big2', name: 'One big, two small', cells: [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: 'g2', name: '2 × 2', cells: grid(2, 2) },
  { id: 'g3', name: '3 × 3', cells: grid(3, 3) },
];

/** A cell made smaller by a gap (share of the frame's shorter side) all round, half at the edges between cells. */
export function inset(c: Cell, gap: number, W: number, H: number): Cell {
  if (!gap) return c;
  const g = gap * Math.min(W, H);
  const gx = g / W;
  const gy = g / H;
  return [c[0] + gx / 2, c[1] + gy / 2, Math.max(0.01, c[2] - gx), Math.max(0.01, c[3] - gy)];
}

/**
 * The transform that puts a clip's picture (`iw`×`ih`, fitted to the W×H frame its way) over a
 * cell, covering it and cropped to it.
 */
export function cellTransform(cell: Cell, fit: Clip['fit'], iw: number, ih: number, W: number, H: number): Transform {
  const [x, y, dw, dh] = fitRect(fit, iw, ih, W, H);
  const [cx, cy, cw, ch] = cell;
  const z = Math.max((cw * W) / dw, (ch * H) / dh);
  // where the picture's middle lands after zooming about the frame's middle, then moved to the cell's
  const mx = W / 2 + (x + dw / 2 - W / 2) * z;
  const my = H / 2 + (y + dh / 2 - H / 2) * z;
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  const ex = Math.max(0, 1 - (cw * W) / (dw * z)) / 2;
  const ey = Math.max(0, 1 - (ch * H) / (dh * z)) / 2;
  return { zoom: r(z), x: r(((cx + cw / 2) * W - mx) / W), y: r(((cy + ch / 2) * H - my) / H), rotate: 0, flipH: false, flipV: false, cropL: r(ex), cropR: r(ex), cropT: r(ey), cropB: r(ey) };
}
