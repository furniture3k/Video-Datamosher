import { describe, expect, it } from 'vitest';
import { boilStrokes, drawnShare, progressShare, fitPen, layerName, newShape, shapeStrokes, strokeLength, trimStrokes, SHAPES, type Stroke } from '../src/engine/shapes';
import { markLayers } from '../src/engine/annotate';
import { freeRow, isEmpty, isStill, type Layer, type ShapeLayer, type TextLayer } from '../src/engine/layers';
import { poseOf, setPose } from '../src/engine/gizmo';
import { describeChange } from '../src/engine/history';
import { newProject } from '../src/engine/types';

const shape = (o: Partial<ShapeLayer> = {}): ShapeLayer => ({ ...newShape('rect', 's', 'g1', 1, 16 / 9), ...o });
const round = (s: Stroke[]) => s.map((st) => st.pts.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]));

describe('shapes', () => {
  it('draws a box about its position, in pixels of the frame', () => {
    const s = shapeStrokes({ shape: 'rect', w: 0.5, h: 0.25 }, 200, 100);
    expect(s).toHaveLength(1);
    expect(s[0].closed).toBe(true);
    expect(round(s)).toEqual([[[-50, -12.5], [50, -12.5], [50, 12.5], [-50, 12.5]]]);
    expect(strokeLength(s[0])).toBeCloseTo(250);
  });

  it('makes every kind, and round things round in a wide frame', () => {
    for (const { value } of SHAPES) {
      const s = newShape(value, 'x', 'g1', 0, 16 / 9);
      if (value === 'pen') s.points = [[-0.5, -0.5], [0.5, 0.5]];
      const st = shapeStrokes(s, 1920, 1080);
      expect(st.length, value).toBeGreaterThan(0);
      for (const line of st) for (const [x, y] of line.pts) expect(Number.isFinite(x) && Number.isFinite(y), value).toBe(true);
    }
    const c = newShape('circle', 'c', 'g1', 0, 16 / 9);
    expect(c.w * 1920).toBeCloseTo(c.h * 1080);
    const ring = shapeStrokes(c, 1920, 1080)[0].pts;
    const r = ring.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...r) - Math.min(...r)).toBeLessThan(1e-6);
  });

  it('gives an arrow a shaft and a head at its tip, and bends lines into curves', () => {
    const [shaft, head] = shapeStrokes({ shape: 'arrow', w: 1, h: 1, head: 0.2 }, 100, 100);
    expect(shaft.pts).toEqual([[-50, -50], [50, 50]]);
    expect(head.pts[1]).toEqual([50, 50]);
    // the barbs come back from the tip, either side of the shaft
    for (const b of [head.pts[0], head.pts[2]]) expect(b[0] < 50 && b[1] < 50).toBe(true);
    const bent = shapeStrokes({ shape: 'line', w: 1, h: 0, bend: 0.5 }, 100, 100)[0].pts;
    expect(bent.length).toBeGreaterThan(2);
    // bowed off the straight line, ends where they were
    expect(bent[0]).toEqual([-50, 0]);
    expect(bent.at(-1)).toEqual([50, 0]);
    expect(Math.abs(bent[Math.floor(bent.length / 2)][1])).toBeGreaterThan(10);
  });

  it('nests tunnel boxes and draws corner marks', () => {
    const t = shapeStrokes({ shape: 'tunnel', w: 1, h: 1, count: 4 }, 100, 100);
    expect(t.map((s) => +strokeLength(s).toFixed(3))).toEqual([400, 300, 200, 100]);
    expect(shapeStrokes({ shape: 'bracket', w: 1, h: 1 }, 100, 100)).toHaveLength(4);
  });

  it('draws on along its length, line after line', () => {
    const s = shapeStrokes({ shape: 'rect', w: 1, h: 1 }, 100, 100);
    expect(trimStrokes(s, 1)).toBe(s);
    expect(trimStrokes(s, 0)).toEqual([]);
    const half = trimStrokes(s, 0.5);
    expect(half[0].closed).toBe(false);
    expect(strokeLength(half[0])).toBeCloseTo(200);
    expect(half[0].pts.at(-1)).toEqual([50, 50]);
    // two lines: the second only starts once the first is done
    const two: Stroke[] = [{ pts: [[0, 0], [10, 0]], closed: false }, { pts: [[0, 5], [10, 5]], closed: false }];
    expect(trimStrokes(two, 0.75).map((x) => x.pts)).toEqual([[[0, 0], [10, 0]], [[0, 5], [5, 5]]]);
    expect(drawnShare({ start: 1, drawOn: 0.5 }, 1.25)).toBeCloseTo(0.5);
    expect(drawnShare({ start: 1 }, 1)).toBe(1);
  });

  it('wobbles the same way at the same moment, in three drawings', () => {
    const s = shapeStrokes({ shape: 'rect', w: 1, h: 1 }, 100, 100);
    expect(boilStrokes(s, 0, 10, 0)).toBe(s);
    const a = boilStrokes(s, 1, 10, 0.01);
    expect(boilStrokes(s, 1, 10, 0.02)).toEqual(a);
    expect(boilStrokes(s, 1, 10, 0.2)).not.toEqual(a);
    // back to the first drawing three changes later
    expect(boilStrokes(s, 1, 10, 0.01 + 3 / 8)).toEqual(a);
    for (const [i, [x, y]] of a[0].pts.entries()) expect(Math.hypot(x - s[0].pts[i][0], y - s[0].pts[i][1])).toBeLessThan(10);
  });

  it('fits a hand-drawn stroke into its box', () => {
    const f = fitPen([[0.2, 0.2], [0.2, 0.2], [0.4, 0.3], [0.6, 0.6]])!;
    expect([f.x, f.y, +f.w.toFixed(6), +f.h.toFixed(6)]).toEqual([0.4, 0.4, 0.4, 0.4]);
    expect(f.points).toEqual([[-0.5, -0.5], [0, -0.25], [0.5, 0.5]]);
    expect(fitPen([[0.1, 0.1]])).toBeNull();
  });

  it('is still unless it draws on, wobbles or follows something', () => {
    expect(isStill(shape({ drawOn: undefined }))).toBe(true);
    expect(isStill(shape({ drawOn: 0.3 }))).toBe(false);
    expect(isStill(shape({ drawOn: undefined, boil: 0.5 }))).toBe(false);
    expect(isEmpty(shape({ shape: 'pen', points: [[0, 0]] }))).toBe(true);
    expect(layerName(shape({ shape: 'arrow' }))).toBe('Arrow');
  });

  it('scales with the handles keeping its shape', () => {
    const p = { clips: [], media: [], layers: [shape({ w: 0.2, h: 0.4 }) as Layer] };
    expect(poseOf(p, 's', 1)!.scale).toBe(0.4);
    setPose(p, 's', 1, { x: 0.5, y: 0.5, scale: 0.8, turn: 0 }, 0.02);
    const s = p.layers[0] as ShapeLayer;
    expect([+s.w.toFixed(6), +s.h.toFixed(6)]).toEqual([0.4, 0.8]);
  });

  it('names undo steps for shapes', () => {
    const a = newProject();
    const b = { ...a, layers: [shape()] };
    expect(describeChange(a, b)).toBe('Add a shape');
    expect(describeChange(b, { ...b, layers: [shape({ start: 2 })] })).toBe('Move a shape');
    expect(describeChange(b, a)).toBe('Delete a shape');
  });

  it('fills a loading bar while it is on screen, or over its draw-on time', () => {
    const bar = newShape('progress', 'p', 'g1', 1, 1);
    expect(progressShare(bar, 1)).toBe(0);
    expect(progressShare(bar, 1 + 2.7)).toBeCloseTo(1);
    expect(progressShare({ ...bar, drawOn: 1 }, 1.5)).toBeCloseTo(0.5);
    expect(isStill(bar)).toBe(false);
    // a cursor's tip is its box's top-left corner
    const cur = newShape('cursor', 'c', 'g1', 0, 1);
    expect(shapeStrokes(cur, 100, 100)[0].pts[0]).toEqual([-(cur.w * 100) / 2, -(cur.h * 100) / 2]);
  });

  it('puts a new layer on the lowest free row', () => {
    const a = shape({ id: 'a', row: 'g1', start: 0, duration: 2 });
    expect(freeRow([a], 1, 3)).toBe('g2');
    expect(freeRow([a], 2, 3)).toBe('g1');
  });
});

describe('marking something moving', () => {
  const path: [number, number, number][] = [
    [1, 0.3, 0.6],
    [2, 0.4, 0.6],
  ];
  const look = { color: '#ff0000', width: 0.008, drawOn: 0.3 };
  let n = 0;
  const marks = markLayers(path, 0.1, 0.2, 16 / 9, look, [], () => 'm' + n++, 'This');
  const [box, arrow, label] = marks as [ShapeLayer, ShapeLayer, TextLayer];

  it('boxes it, points an arrow at it and labels it, all following it', () => {
    expect(marks.map((l) => (l.kind === 'text' ? 'text' : l.shape))).toEqual(['rect', 'arrow', 'text']);
    expect(label.text).toBe('This');
    expect(box.follow).toEqual(path);
    for (const l of marks) {
      expect(l.follow).toHaveLength(2);
      // everything moves together
      expect(+(l.follow![1][1] - l.follow![0][1]).toFixed(6)).toBe(0.1);
      expect(l.start + l.duration).toBeCloseTo(2);
    }
    expect(box.w).toBeGreaterThan(0.1);
    expect(box.h).toBeGreaterThan(0.2);
    // each on its own row, coming in one after another
    expect(new Set(marks.map((l) => l.row)).size).toBe(3);
    expect(box.start < arrow.start && arrow.start < label.start).toBe(true);
  });

  it('comes from the side with more room and points at the box', () => {
    // the object is left of middle: the arrow and label are to its right, above it
    expect(arrow.x).toBeGreaterThan(box.x);
    expect(arrow.y).toBeLessThan(box.y);
    expect(label.x).toBeGreaterThan(arrow.x);
    // the arrow points down-left (from tail to tip): turned a quarter turn from down-right
    expect(arrow.rotate).toBe(90);
  });
});
