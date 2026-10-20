import { describe, expect, it } from 'vitest';
import { breedGraphics, chaosGraphics, mutateGraphics } from '../src/engine/graphicschaos';
import type { Layer, ShapeLayer, TextLayer } from '../src/engine/layers';

const text = (id: string, extra: Partial<TextLayer> = {}): TextLayer => ({ id, kind: 'text', row: 'g1', text: 'Hello ' + id, start: 1, duration: 2, size: 0.1, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, ...extra });
const shape = (id: string, extra: Partial<ShapeLayer> = {}): ShapeLayer => ({ id, kind: 'shape', row: 'g2', shape: 'rect', start: 0.5, duration: 2, x: 0.4, y: 0.4, w: 0.2, h: 0.1, color: '#ff0000', width: 0.006, fade: 0, moshed: false, ...extra });
const project = (layers: Layer[]) => ({ layers, canvas: undefined });
const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);

describe('rolling the graphics', () => {
  const p = project([text('a'), text('b', { x: 0.2, y: 0.8 }), shape('c')]);
  it('gives the same roll for the same seed, and another for another', () => {
    expect(chaosGraphics(p, 7, 0.6, beats)).toEqual(chaosGraphics(p, 7, 0.6, beats));
    expect(chaosGraphics(p, 7, 0.6, beats)).not.toEqual(chaosGraphics(p, 8, 0.6, beats));
  });
  it('does not touch the project it was given', () => {
    const before = JSON.stringify(p);
    chaosGraphics(p, 3, 1, beats);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('keeps the words, the ids and the order', () => {
    const r = chaosGraphics(p, 11, 1, beats);
    expect(r.layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(r.layers.filter((l): l is TextLayer => l.kind === 'text').map((l) => l.text)).toEqual(['Hello a', 'Hello b']);
    expect(r.layers.map((l) => l.kind)).toEqual(['text', 'text', 'shape']);
  });
  it('changes the look: over a few seeds fonts, colours and entrances all vary', () => {
    const rolls = Array.from({ length: 12 }, (_, i) => chaosGraphics(p, i + 1, 0.8, beats).layers[0] as TextLayer);
    expect(new Set(rolls.map((l) => l.font)).size).toBeGreaterThan(1);
    expect(new Set(rolls.map((l) => l.color)).size).toBeGreaterThan(1);
    expect(new Set(rolls.map((l) => l.anim)).size).toBeGreaterThan(2);
  });
  it('leaves what follows something or is pinned where it is', () => {
    const fixed = project([text('f', { follow: [[0, 0.3, 0.3], [2, 0.6, 0.6]], x: 0.3, y: 0.3 }), shape('s', { surface: { quads: [[0, 0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9], [2, 0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9]], refT: 0 }, x: 0.45, y: 0.55 })]);
    for (let s = 1; s <= 10; s++) {
      const r = chaosGraphics(fixed, s, 1, beats);
      expect([r.layers[0].x, r.layers[0].y]).toEqual([0.3, 0.3]);
      expect([r.layers[1].x, r.layers[1].y]).toEqual([0.45, 0.55]);
    }
  });
  it('puts starts on the beat grid (a few beats off where they were)', () => {
    for (let s = 1; s <= 10; s++) {
      const r = chaosGraphics(project([text('a', { start: 1.2 })]), s, 1, beats);
      const st = r.layers[0].start;
      expect(beats.some((b) => Math.abs(b - st) < 1e-6) || st === 1.2).toBe(true);
    }
  });
  it('does not touch an added font, a width fitted to the frame, or a subject effect', () => {
    const q = project([text('a', { font: 'font:abc', fit: 'width', size: 0.2 }), shape('x', { shape: 'subject', subject: { effect: 'fill', amount: 0.5 } })]);
    for (let s = 1; s <= 10; s++) {
      const r = chaosGraphics(q, s, 1, beats);
      expect((r.layers[0] as TextLayer).font).toBe('font:abc');
      expect((r.layers[0] as TextLayer).size).toBe(0.2);
      expect((r.layers[1] as ShapeLayer).color).toBe('#ff0000');
    }
  });
  it('sometimes gives the picture a new canvas, more as the roll gets wilder', () => {
    const sets = (i: number) => Array.from({ length: 40 }, (_, s) => chaosGraphics(p, s + 1, i, beats).canvas).filter(Boolean).length;
    expect(sets(1)).toBeGreaterThan(sets(0));
    expect(sets(0)).toBeLessThan(15);
  });
});

describe('nudging the graphics', () => {
  const p = project([text('a', { size: 0.1 }), shape('c')]);
  it('moves things only a little, and only as far as asked', () => {
    const r = mutateGraphics(p, 5, 0.2);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(r.layers[i].x - p.layers[i].x)).toBeLessThan(0.03);
      expect(Math.abs(r.layers[i].y - p.layers[i].y)).toBeLessThan(0.03);
      expect(Math.abs(r.layers[i].start - p.layers[i].start)).toBeLessThan(0.1);
    }
    expect((r.layers[0] as TextLayer).size).toBeGreaterThan(0.09);
    expect((r.layers[0] as TextLayer).size).toBeLessThan(0.11);
    expect(mutateGraphics(p, 5, 0).layers.map((l) => [l.x, l.y, l.start])).toEqual(p.layers.map((l) => [l.x, l.y, l.start]));
  });
  it('is repeatable', () => {
    expect(mutateGraphics(p, 9, 0.5)).toEqual(mutateGraphics(p, 9, 0.5));
  });
});

describe('breeding the graphics', () => {
  const a = project([text('a', { color: '#ff0000', font: 'serif', anim: 'pop' })]);
  const b = project([text('a', { color: '#0000ff', font: 'mono', anim: 'slam' })]);
  it('takes the first parent’s layers with looks from the parents', () => {
    const kids = Array.from({ length: 30 }, (_, i) => breedGraphics([a, b], i + 1, 0).layers[0] as TextLayer);
    expect(kids.every((k) => k.id === 'a' && k.text === 'Hello a')).toBe(true);
    // both parents' fonts and colours turn up
    expect(new Set(kids.map((k) => k.font))).toEqual(new Set(['serif', 'mono']));
    expect(new Set(kids.map((k) => k.anim))).toEqual(new Set(['pop', 'slam']));
  });
  it('is repeatable, and a lone parent is only nudged', () => {
    expect(breedGraphics([a, b], 4)).toEqual(breedGraphics([a, b], 4));
    expect((breedGraphics([a], 4, 0).layers[0] as TextLayer).font).toBe('serif');
  });
});
