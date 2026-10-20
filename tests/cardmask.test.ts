import { describe, expect, it } from 'vitest';
import { captionHeight, maskAnimated, maskGeometry, maskPoints, paperRect, type ClipCard, type ClipMask } from '../src/engine/cardmask';

const R: [number, number, number, number] = [100, 50, 400, 300];
const card: ClipCard = { border: 0.02, borderColor: '#fff', radius: 0.1, shadow: 0.4 };

describe('a card round a picture', () => {
  it('grows its rectangle by the border all round', () => {
    expect(paperRect(card, R, 400)).toEqual([92, 42, 416, 316]);
  });
  it('adds a caption strip under the picture only when there is a caption', () => {
    expect(captionHeight(card, 400)).toBe(0);
    const pol = { ...card, border: 0.03, caption: 'Summer' };
    const strip = captionHeight(pol, 400);
    expect(strip).toBeGreaterThan(0.03 * 400 * 2);
    const p = paperRect(pol, R, 400);
    expect(p[3]).toBeCloseTo(300 + 2 * 12 + strip, 6);
    // an empty caption is still a strip (type into it afterwards)
    expect(captionHeight({ ...card, caption: '' }, 400)).toBeGreaterThan(0);
  });
});

describe('a mask over time', () => {
  const m: ClipMask = { shape: 'circle', size: 1, x: 0.5, y: 0.5 };
  it('sits in the middle of the picture at its size', () => {
    const g = maskGeometry(m, 0, R);
    expect(g.cx).toBe(300);
    expect(g.cy).toBe(200);
    // half the picture's shorter side
    expect(g.rx).toBe(150);
    expect(g.ry).toBe(150);
    expect(maskGeometry({ ...m, x: 0.25, y: 0.75, size: 0.5 }, 0, R)).toMatchObject({ cx: 200, cy: 275, rx: 75 });
  });
  it('grows from nothing over its time, past halfway quickly (eased), and stays', () => {
    const g = { ...m, grow: 1 };
    expect(maskGeometry(g, 0, R).rx).toBe(0);
    expect(maskGeometry(g, 0.5, R).rx).toBeGreaterThan(150 * 0.8);
    expect(maskGeometry(g, 1, R).rx).toBeCloseTo(150, 6);
    expect(maskGeometry(g, 5, R).rx).toBeCloseTo(150, 6);
  });
  it('spins at its speed on top of its own turn, and breathes', () => {
    expect(maskGeometry({ ...m, rotate: 10, spin: 90 }, 2, R).rot).toBe(190);
    const sizes = [0, 0.125, 0.25, 0.375].map((t) => maskGeometry({ ...m, pulse: 0.4 }, t, R).rx);
    expect(Math.max(...sizes)).toBeGreaterThan(150);
    expect(Math.min(...sizes)).toBeLessThan(150);
  });
  it('knows whether it needs a picture for every frame', () => {
    expect(maskAnimated(m)).toBe(false);
    expect(maskAnimated({ ...m, spin: 30 })).toBe(true);
    expect(maskAnimated({ ...m, grow: 0.5 })).toBe(true);
    expect(maskAnimated({ ...m, pulse: 0.2 })).toBe(true);
  });
  it('gives the corners of the polygon shapes, turned about the middle, and none for round ones', () => {
    expect(maskPoints('circle', 0, 0, 10, 10, 0)).toBeNull();
    expect(maskPoints('text', 0, 0, 10, 10, 0)).toBeNull();
    const rect = maskPoints('rect', 0, 0, 10, 5, 0)!;
    expect(rect).toEqual([[-10, -5], [10, -5], [10, 5], [-10, 5]]);
    const tri = maskPoints('triangle', 0, 0, 10, 10, 0)!;
    expect(tri.length).toBe(3);
    expect(tri[0][0]).toBeCloseTo(0, 6);
    expect(tri[0][1]).toBeCloseTo(-10, 6);
    expect(maskPoints('star', 0, 0, 10, 10, 0)!.length).toBe(10);
    // a quarter turn takes the top corner to the right
    const turned = maskPoints('triangle', 0, 0, 10, 10, 90)!;
    expect(turned[0][0]).toBeCloseTo(10, 6);
    expect(turned[0][1]).toBeCloseTo(0, 6);
    // the star's inner points are nearer the middle than its outer ones
    const star = maskPoints('star', 0, 0, 10, 10, 0)!;
    expect(Math.hypot(...star[1])).toBeLessThan(Math.hypot(...star[0]));
  });
});
