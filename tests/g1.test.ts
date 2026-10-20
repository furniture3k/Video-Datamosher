import { describe, expect, it } from 'vitest';
import { gradientLine, layoutText, setColourRun, wordSpans } from '../src/engine/textlayout';
import { newShape, shapeStrokes, SHAPES } from '../src/engine/shapes';
import { calloutLayers } from '../src/engine/annotate';
import { applyShapeStyle, applyStyle, BUILTIN_SHAPE_STYLES, BUILTIN_STYLES, hasShapeStyle, shapeStyleOf, styleOf } from '../src/engine/styles';
import type { ShapeLayer, TextLayer } from '../src/engine/layers';

const text = (extra: Partial<TextLayer> = {}): TextLayer => ({ id: 't', kind: 'text', row: 'g1', text: 'AAAA\nBB', start: 0, duration: 2, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, ...extra });
const measure = (s: string) => s.length * 60;

describe('lines with looks of their own', () => {
  it('lays out a plain title as it always was', () => {
    const L = layoutText(text(), 1000, 500, measure);
    expect(L.lines.map((l) => l.size)).toEqual([50, 50]);
    // two lines of 1.2 × the size, centred
    expect(L.lines.map((l) => l.y)).toEqual([-30, 30]);
    expect(L.lines[0].width).toBeCloseTo(((measure('AAAA') * 50) / 100), 6);
  });
  it('gives a line its own size, with the lines after it pushed down', () => {
    const plain = layoutText(text(), 1000, 500, measure);
    const big = layoutText(text({ lines: [{ size: 2 }] }), 1000, 500, measure);
    expect(big.lines[0].size).toBe(100);
    expect(big.lines[1].size).toBe(50);
    expect(big.lines[0].width).toBeCloseTo(plain.lines[0].width * 2, 6);
    // the block is taller, and still centred: first line's middle above the centre, the second below
    expect(big.box.h).toBeCloseTo(100 * 1.2 + 50 * 1.2, 6);
    expect(big.lines[0].y).toBeLessThan(0);
    expect(big.lines[1].y).toBeGreaterThan(0);
    expect(big.lines[1].y - big.lines[0].y).toBeCloseTo((100 * 1.2) / 2 + (50 * 1.2) / 2, 6);
  });
  it('carries a line’s colour, typeface and weight, and measures it in them', () => {
    const seen: (string | undefined)[] = [];
    const L = layoutText(text({ lines: [{ color: '#f00', font: 'serif', bold: false }] }), 1000, 500, (s, line) => (seen.push(line?.font), s.length * 60));
    expect(L.lines[0]).toMatchObject({ color: '#f00', font: 'serif', bold: false });
    expect(L.lines[1].color).toBeUndefined();
    expect(seen).toContain('serif');
  });
  it('fits the widest line to the frame, whatever its size', () => {
    const L = layoutText(text({ fit: 'width', lines: [{}, { size: 3 }] }), 1000, 500, measure);
    const widest = Math.max(...L.lines.map((l) => l.width));
    expect(widest).toBeCloseTo(1000 * 0.94, 4);
    expect(L.lines[1].width).toBeGreaterThan(L.lines[0].width);
  });
  it('keeps letter spacing in step with the line’s size', () => {
    const L = layoutText(text({ spacing: 0.1, lines: [{ size: 2 }] }), 1000, 500, measure);
    expect(L.lines[0].spacing).toBeCloseTo(0.1 * 100, 6);
    expect(L.lines[1].spacing).toBeCloseTo(0.1 * 50, 6);
  });
});

describe('words and colours', () => {
  it('finds each word and the letters it covers, counting across lines', () => {
    expect(wordSpans('Hi there\nyou')).toEqual([{ word: 'Hi', from: 0, to: 2 }, { word: 'there', from: 3, to: 8 }, { word: 'you', from: 8, to: 11 }]);
    expect(wordSpans('   ')).toEqual([]);
    expect(wordSpans('a  b')).toEqual([{ word: 'a', from: 0, to: 1 }, { word: 'b', from: 3, to: 4 }]);
  });
  it('colours a stretch, replaces it, and takes it away', () => {
    let runs = setColourRun(undefined, 3, 8, '#f00');
    expect(runs).toEqual([{ from: 3, to: 8, color: '#f00' }]);
    runs = setColourRun(runs, 0, 2, '#0f0');
    expect(runs.map((r) => r.from)).toEqual([0, 3]);
    runs = setColourRun(runs, 3, 8, '#00f');
    expect(runs.find((r) => r.from === 3)!.color).toBe('#00f');
    expect(setColourRun(runs, 3, 8, null).length).toBe(1);
    // a new colour over a stretch that overlaps an old one drops the old one
    expect(setColourRun([{ from: 2, to: 6, color: '#f00' }], 4, 9, '#0f0')).toEqual([{ from: 4, to: 9, color: '#0f0' }]);
  });
  it('runs a gradient across the box at any angle', () => {
    const box = { x: -100, y: -20, w: 200, h: 40 };
    expect(gradientLine(box, 0)).toEqual([-100, 0, 100, 0]);
    const down = gradientLine(box, 90);
    expect(down[0]).toBeCloseTo(0, 6);
    expect(down[1]).toBeCloseTo(-20, 6);
    expect(down[3]).toBeCloseTo(20, 6);
    // at 45° the line is longer than the box is tall: it reaches the corners
    const d = gradientLine(box, 45);
    expect(Math.hypot(d[2] - d[0], d[3] - d[1])).toBeCloseTo(2 * (100 * Math.SQRT1_2 + 20 * Math.SQRT1_2), 6);
  });
});

describe('polygons and leader lines', () => {
  const base = { w: 0.4, h: 0.4, count: undefined, head: undefined, bend: undefined, points: undefined };
  it('draws a polygon with the sides asked for, round the middle', () => {
    for (const n of [3, 5, 6, 8]) {
      const [st] = shapeStrokes({ ...base, shape: 'polygon', sides: n }, 100, 100);
      expect(st.closed).toBe(true);
      expect(st.pts.length).toBe(n);
      // every corner is the same distance from the middle
      const r = st.pts.map(([x, y]) => Math.hypot(x, y));
      for (const v of r) expect(v).toBeCloseTo(20, 6);
    }
    // the first corner is at the top
    expect(shapeStrokes({ ...base, shape: 'polygon', sides: 4 }, 100, 100)[0].pts[0][1]).toBeCloseTo(-20, 6);
    // never fewer than three, never absurd
    expect(shapeStrokes({ ...base, shape: 'polygon', sides: 1 }, 100, 100)[0].pts.length).toBe(3);
    expect(shapeStrokes({ ...base, shape: 'polygon', sides: 99 }, 100, 100)[0].pts.length).toBe(24);
  });
  it('draws a leader line with a filled square at each end', () => {
    const s = shapeStrokes({ ...base, shape: 'leader', head: 0.1 }, 100, 100);
    expect(s.length).toBe(3);
    expect(s[0].closed).toBe(false);
    expect(s[1].closed && s[2].closed).toBe(true);
    // the squares are centred on the line's ends
    const centre = (st: (typeof s)[number]) => [st.pts.reduce((a, p) => a + p[0], 0) / 4, st.pts.reduce((a, p) => a + p[1], 0) / 4];
    expect(centre(s[1])).toEqual([-20, -20]);
    expect(centre(s[2])).toEqual([20, 20]);
    // a tenth of the line's length wide
    expect(s[1].pts[1][0] - s[1].pts[0][0]).toBeCloseTo(Math.hypot(40, 40) * 0.1, 6);
  });
  it('runs a line the other diagonal when flipped, and only the line kinds', () => {
    const [a] = shapeStrokes({ ...base, shape: 'line', flip: true }, 100, 100);
    expect(a.pts[0]).toEqual([20, -20]);
    expect(a.pts[a.pts.length - 1]).toEqual([-20, 20]);
    expect(shapeStrokes({ ...base, shape: 'rect', flip: true }, 100, 100)[0].pts[0]).toEqual([-20, -20]);
  });
  it('is in the shape list, with a leader that starts filled and a polygon with sides', () => {
    expect(SHAPES.some((s) => s.value === 'polygon') && SHAPES.some((s) => s.value === 'leader')).toBe(true);
    expect(newShape('polygon', 'p', 'g1', 0, 1.78).sides).toBe(6);
    const l = newShape('leader', 'l', 'g1', 0, 1.78);
    expect(l.fill).toBe(l.color);
  });
});

describe('a callout', () => {
  let n = 0;
  const id = () => 'c' + ++n;
  const look = { color: '#ff2d2d', width: 0.008 };
  it('is a box, a leader line, a title and small print, one group', () => {
    const c = calloutLayers([0.3, 0.6], 16 / 9, look, [], id, 1, 3);
    expect(c.map((l) => (l.kind === 'shape' ? l.shape : 'text'))).toEqual(['rect', 'leader', 'text', 'text']);
    expect(new Set(c.map((l) => l.group)).size).toBe(1);
    expect(c[0].group).toBeTruthy();
    expect(c.every((l) => l.start === 1 && l.duration === 3)).toBe(true);
    // each on a row of its own where they overlap in time
    expect(new Set(c.map((l) => l.row)).size).toBe(4);
  });
  it('puts the title on the side with room, running the leader the right way', () => {
    const left = calloutLayers([0.2, 0.8], 16 / 9, look, [], id, 0, 2);
    const right = calloutLayers([0.8, 0.8], 16 / 9, look, [], id, 0, 2);
    const t = (c: typeof left) => c[2] as TextLayer;
    expect(t(left).x).toBeGreaterThan(0.2);
    expect(t(left).align).toBe('left');
    expect(t(right).x).toBeLessThan(0.8);
    expect(t(right).align).toBe('right');
    // up and to the right (from low on the left) needs the other diagonal; up and to the left too
    expect((left[1] as ShapeLayer).flip).toBe(true);
    expect((right[1] as ShapeLayer).flip).toBe(false);
    // the title sits above the point when the point is low in the frame, below when it is high
    expect(t(left).y).toBeLessThan(0.8);
    expect(t(calloutLayers([0.2, 0.1], 16 / 9, look, [], id, 0, 2)).y).toBeGreaterThan(0.1);
  });
});

describe('styles for shapes, stickers and titles', () => {
  const shape = (extra: Partial<ShapeLayer> = {}): ShapeLayer => ({ id: 's', kind: 'shape', row: 'g1', shape: 'rect', start: 0, duration: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.2, color: '#00ff00', width: 0.02, fade: 0, moshed: false, glow: 0.5, ...extra });
  it('puts a look on a shape and keeps its kind, size and place', () => {
    const s = shape();
    applyShapeStyle(s, BUILTIN_SHAPE_STYLES.find((x) => x.id === 'notes')!);
    expect(s).toMatchObject({ color: '#ff1f1f', width: 0.006, boil: 0.6, drawOn: 0.4, shape: 'rect', w: 0.2, x: 0.5 });
    // what the style leaves out goes back to plain
    expect(s.glow).toBeUndefined();
  });
  it('gives a filled shape the new colour as its fill, and an empty one none', () => {
    const filled = shape({ fill: '#00ff00' });
    applyShapeStyle(filled, BUILTIN_SHAPE_STYLES.find((x) => x.id === 'neon')!);
    expect(filled.fill).toBe('#22d3ee');
    const empty = shape();
    applyShapeStyle(empty, BUILTIN_SHAPE_STYLES.find((x) => x.id === 'neon')!);
    expect(empty.fill).toBeUndefined();
  });
  it('knows when a shape looks like a style, and can keep its own look as a style', () => {
    const s = shape();
    const st = BUILTIN_SHAPE_STYLES.find((x) => x.id === 'chalk')!;
    expect(hasShapeStyle(s, st)).toBe(false);
    applyShapeStyle(s, st);
    expect(hasShapeStyle(s, st)).toBe(true);
    const mine = shapeStyleOf(s, 'mine', 'Mine');
    expect(mine).toMatchObject({ id: 'mine', name: 'Mine', color: '#f5f0e6', boil: 0.9 });
    // keeping it copies: changing the shape afterwards does not change the style
    s.color = '#000000';
    expect(mine.color).toBe('#f5f0e6');
  });
  it('carries shadows and outlines in a style, copied', () => {
    const s = shape();
    applyShapeStyle(s, BUILTIN_SHAPE_STYLES.find((x) => x.id === 'sticker')!);
    expect(s.fx?.outline?.width).toBe(0.006);
    s.fx!.outline!.width = 0.1;
    expect(BUILTIN_SHAPE_STYLES.find((x) => x.id === 'sticker')!.fx!.outline!.width).toBe(0.006);
  });
  it('has title styles with a gradient and with an outline and shadow, that clear when another is put on', () => {
    const t = text();
    applyStyle(t, BUILTIN_STYLES.find((x) => x.id === 'sunset')!);
    expect(t.gradient).toEqual({ to: '#ff2a6d', angle: 90 });
    applyStyle(t, BUILTIN_STYLES.find((x) => x.id === 'sticker')!);
    expect(t.fx?.outline).toBeTruthy();
    expect(t.gradient).toBeUndefined();
    applyStyle(t, BUILTIN_STYLES.find((x) => x.id === 'clean')!);
    expect(t.fx).toBeUndefined();
    // a title's own look is kept as a style with these too
    const s = styleOf(text({ gradient: { to: '#000', angle: 0 }, fx: { outline: { width: 0.01, color: '#fff' } } }), 'x', 'X');
    expect(s.gradient).toBeTruthy();
    expect(s.fx).toBeTruthy();
  });
});
