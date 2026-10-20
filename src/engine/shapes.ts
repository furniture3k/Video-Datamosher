// Shapes as lines of points: boxes, circles, arrows, brackets, a freehand stroke… Everything is
// a polyline, so drawing on (a share of the length) and the hand-drawn wobble work the same for
// every shape. Pure (no canvas): ../lib/shapes draws what this makes.
import type { Layer, ShapeKind, ShapeLayer } from './layers';
import { noise } from './textlayout';

export type Pt = [number, number];

/** One line of the shape. Closed lines join back to their start (and can be filled). */
export interface Stroke {
  pts: Pt[];
  closed: boolean;
}

export const SHAPES: { value: ShapeKind; label: string; hint: string }[] = [
  { value: 'rect', label: 'Box', hint: 'A box around something.' },
  { value: 'round', label: 'Rounded box', hint: 'A box with soft corners.' },
  { value: 'circle', label: 'Circle', hint: 'A ring or a dot.' },
  { value: 'triangle', label: 'Triangle', hint: 'Points up.' },
  { value: 'star', label: 'Star', hint: 'Five points.' },
  { value: 'line', label: 'Line', hint: 'From one corner to the other; bend it into a curve.' },
  { value: 'arrow', label: 'Arrow', hint: 'Points at something; bend it into a curve.' },
  { value: 'bracket', label: 'Corners', hint: 'Four corner marks, like a camera focusing.' },
  { value: 'underline', label: 'Underline', hint: 'A hand-drawn line under a word.' },
  { value: 'highlight', label: 'Highlighter', hint: 'A see-through marker stripe.' },
  { value: 'tunnel', label: 'Tunnel', hint: 'Boxes inside boxes.' },
  { value: 'cursor', label: 'Cursor', hint: 'A mouse pointer (move it with keyframes or a tracked path).' },
  { value: 'progress', label: 'Loading bar', hint: 'Fills up while it is on screen (or over its draw-on time).' },
  { value: 'pen', label: 'Pen', hint: 'Drawn by hand on the player.' },
];

/** What a layer is called on the timeline: a title's words, a shape's kind. */
export const layerName = (l: Layer) => (l.kind === 'text' ? l.text.trim() || 'Text' : (SHAPES.find((s) => s.value === l.shape)?.label ?? 'Shape'));

const CURSOR: Pt[] = [[0, 0], [0, 0.82], [0.23, 0.63], [0.38, 0.97], [0.53, 0.9], [0.38, 0.57], [0.66, 0.57]];

/** How full a loading bar is at timeline time t: over its draw-on time if it has one, else while it's on screen. */
export const progressShare = (s: Pick<ShapeLayer, 'start' | 'duration' | 'drawOn'>, t: number) => Math.max(0, Math.min(1, (t - s.start) / Math.max(0.05, s.drawOn || s.duration * 0.9)));

const ring = (n: number, f: (a: number) => Pt): Pt[] => Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2));

/** a quadratic curve from a to b, bowed out sideways by `bend` (share of its length) */
function bow(a: Pt, b: Pt, bend: number, n = 24): Pt[] {
  if (!bend) return [a, b];
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  // the control point sits off the middle, square to the line
  const c: Pt = [mx - dy * bend, my + dx * bend];
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const v = 1 - u;
    return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
  });
}

function rounded(w: number, h: number, r: number): Pt[] {
  r = Math.min(r, w / 2, h / 2);
  const out: Pt[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 6; i++) out.push([cx + r * Math.cos(a0 + (i / 6) * (Math.PI / 2)), cy + r * Math.sin(a0 + (i / 6) * (Math.PI / 2))]);
  return out;
}

const box = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/**
 * The shape's lines in a W×H frame, in pixels about its position (before turning). `w` and `h`
 * are the shape's box; lines and arrows go from its top-left corner to its bottom-right one.
 */
export function shapeStrokes(s: Pick<ShapeLayer, 'shape' | 'w' | 'h' | 'count' | 'head' | 'bend' | 'points'>, W: number, H: number): Stroke[] {
  const w = s.w * W;
  const h = s.h * H;
  switch (s.shape) {
    case 'rect':
      return [{ pts: box(w, h), closed: true }];
    case 'round':
      return [{ pts: rounded(w, h, Math.min(w, h) * 0.22), closed: true }];
    case 'circle':
      return [{ pts: ring(72, (a) => [(Math.sin(a) * w) / 2, (-Math.cos(a) * h) / 2]), closed: true }];
    case 'triangle':
      return [{ pts: [[0, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], closed: true }];
    case 'star':
      return [{ pts: ring(10, (a) => { const k = Math.round((a / (Math.PI * 2)) * 10) % 2 ? 0.42 : 1; return [(Math.sin(a) * w * k) / 2, (-Math.cos(a) * h * k) / 2]; }), closed: true }];
    case 'line':
      return [{ pts: bow([-w / 2, -h / 2], [w / 2, h / 2], s.bend ?? 0), closed: false }];
    case 'arrow': {
      const shaft = bow([-w / 2, -h / 2], [w / 2, h / 2], s.bend ?? 0);
      const tip = shaft[shaft.length - 1];
      const from = shaft[shaft.length - 2];
      const len = Math.hypot(w, h);
      const size = Math.max(6, len * (s.head ?? 0.22));
      const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
      const barb = (d: number): Pt => [tip[0] - size * Math.cos(a + d), tip[1] - size * Math.sin(a + d)];
      return [{ pts: shaft, closed: false }, { pts: [barb(0.5), tip, barb(-0.5)], closed: false }];
    }
    case 'bracket': {
      const arm = Math.min(w, h) * 0.28;
      return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy]) => ({
        pts: [
          [(sx * w) / 2, (sy * h) / 2 - sy * arm],
          [(sx * w) / 2, (sy * h) / 2],
          [(sx * w) / 2 - sx * arm, (sy * h) / 2],
        ] as Pt[],
        closed: false,
      }));
    }
    case 'underline':
      // a quick stroke of the pen: slightly bowed, ending a little higher
      return [{ pts: bow([-w / 2, h * 0.08], [w / 2, -h * 0.08], 0.04), closed: false }];
    case 'highlight':
      return [{ pts: [[-w / 2, 0], [w / 2, 0]], closed: false }];
    case 'tunnel': {
      const n = Math.max(1, Math.round(s.count ?? 6));
      return Array.from({ length: n }, (_, i) => ({ pts: box(w * (1 - i / n), h * (1 - i / n)), closed: true }));
    }
    case 'pen':
      return [{ pts: (s.points ?? []).map(([x, y]) => [x * w, y * h] as Pt), closed: false }];
    case 'cursor':
      // an arrow pointer, its tip at the box's top-left corner
      return [{ pts: CURSOR.map(([x, y]) => [(x - 0.5) * w, (y - 0.5) * h] as Pt), closed: true }];
    case 'progress':
      return [{ pts: rounded(w, h, h / 2), closed: true }];
  }
}

/** How long a line is (pixels). */
export function strokeLength(st: Stroke): number {
  let n = 0;
  const p = st.pts;
  for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  if (st.closed && p.length > 1) n += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
  return n;
}

/** The first `frac` (0..1) of the shape's total length, line after line: the shape drawing itself on. */
export function trimStrokes(strokes: Stroke[], frac: number): Stroke[] {
  if (frac >= 1) return strokes;
  const total = strokes.reduce((n, s) => n + strokeLength(s), 0);
  let left = Math.max(0, frac) * total;
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (left <= 0) break;
    const len = strokeLength(s);
    if (len <= left) {
      out.push(s);
      left -= len;
      continue;
    }
    // part of this line: walk along it (closed lines come back to the start)
    const pts = s.closed ? [...s.pts, s.pts[0]] : s.pts;
    const part: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length && left > 0; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= left) part.push(b);
      else part.push([a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d]);
      left -= d;
    }
    out.push({ pts: part, closed: false });
    break;
  }
  return out;
}

/** How much of the shape is drawn at timeline time t (1 once it's fully on). */
export const drawnShare = (s: Pick<ShapeLayer, 'start' | 'drawOn'>, t: number) => (s.drawOn && s.drawOn > 0 ? Math.max(0, Math.min(1, (t - s.start) / s.drawOn)) : 1);

/** Hand-drawn wobble changes this many times a second (cycling through three drawings). */
export const BOIL_RATE = 8;

/**
 * The lines nudged about as if drawn again by hand, `amount` (0..1) of `size` pixels at most.
 * There are three drawings, cycled through at BOIL_RATE, so it looks animated, not noisy.
 */
export function boilStrokes(strokes: Stroke[], amount: number, size: number, t: number): Stroke[] {
  if (!amount) return strokes;
  const v = Math.floor(t * BOIL_RATE) % 3;
  const j = amount * size;
  let k = 0;
  return strokes.map((s) => ({
    closed: s.closed,
    pts: s.pts.map(([x, y]) => {
      k++;
      return [x + (noise(k, v + 0.1) - 0.5) * j, y + (noise(k, v + 0.6) - 0.5) * j] as Pt;
    }),
  }));
}

/** Smooth out a hand-drawn stroke and fit it into a box: returns its centre, size and points in −0.5..0.5. */
export function fitPen(raw: Pt[]): { x: number; y: number; w: number; h: number; points: Pt[] } | null {
  // drop points too close to the one before
  const pts: Pt[] = [];
  for (const p of raw) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.002) pts.push(p);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(0.01, x1 - x0);
  const h = Math.max(0.01, y1 - y0);
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x, y, w, h, points: pts.map(([px, py]) => [r((px - x) / w), r((py - y) / h)]) };
}

/** How new shapes look (the last look used is remembered for the next). */
export type ShapeLook = Pick<ShapeLayer, 'color' | 'width'> & Partial<Pick<ShapeLayer, 'fill' | 'glow' | 'drawOn' | 'boil'>>;

/** Annotation red, a fine line, drawn on quickly. */
export const DEFAULT_LOOK: ShapeLook = { color: '#ff2d2d', width: 0.008, drawOn: 0.35 };

/**
 * A new shape of this kind, `aspect` (frame width / height) used so round things come out round,
 * in the middle of the frame for 3 seconds from `start`.
 */
export function newShape(shape: ShapeKind, id: string, row: string, start: number, aspect: number, look: ShapeLook = DEFAULT_LOOK): ShapeLayer {
  // a side of `k` frame heights, as shares of the width and the height
  const sq = (k: number): [number, number] => [Math.min(0.9, k / aspect), k];
  const [w, h] =
    shape === 'underline' ? [0.4, 0.03] : shape === 'highlight' ? [0.4, 0.06] : shape === 'line' || shape === 'arrow' ? sq(0.22) : shape === 'tunnel' ? sq(0.6) : sq(0.3);
  const s: ShapeLayer = { id, kind: 'shape', row, shape, start, duration: 3, x: 0.5, y: 0.5, fade: 0, moshed: false, w, h, ...look };
  if (shape === 'tunnel') s.count = 6;
  if (shape === 'cursor') Object.assign(s, { w: sq(0.06)[0], h: 0.06 * 1.4, color: '#000000', fill: '#ffffff', width: 0.003, drawOn: undefined });
  if (shape === 'progress') Object.assign(s, { w: 0.5, h: 0.035, color: '#ffffff', width: 0.004, drawOn: undefined });
  if (shape === 'arrow') s.head = 0.22;
  if (shape === 'highlight') {
    s.color = look.color === DEFAULT_LOOK.color ? '#ffe600' : look.color;
    delete s.fill;
  }
  return s;
}
