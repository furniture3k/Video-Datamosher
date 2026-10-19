import { describe, expect, it } from 'vitest';
import { linkFaces, type FaceBox } from '../src/engine/faces';
import { particlesAt } from '../src/engine/particles';

const box = (x: number, y: number, s = 0.1): FaceBox => ({ x: x - s / 2, y: y - s / 2, w: s, h: s });

describe('faces', () => {
  it('follows two faces moving side by side without swapping them', () => {
    const frames = Array.from({ length: 10 }, (_, f) => [box(0.3 + f * 0.01, 0.5), box(0.7 - f * 0.01, 0.5)]);
    const t = linkFaces(frames);
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.pts.length)).toEqual([10, 10]);
    const xs = t.map((x) => x.pts[9][1]).sort();
    expect(xs.map((v) => +v.toFixed(3))).toEqual([0.39, 0.61]);
    expect(t[0].size).toEqual([0.1, 0.1]);
  });

  it('carries a face over a few missed frames, drops one-frame false finds', () => {
    const frames: FaceBox[][] = [[box(0.5, 0.5)], [box(0.51, 0.5)], [], [], [box(0.53, 0.5)], [box(0.54, 0.5), box(0.1, 0.1)], [box(0.55, 0.5)]];
    const t = linkFaces(frames);
    expect(t).toHaveLength(1);
    expect(t[0].pts.map(([f]) => f)).toEqual([0, 1, 4, 5, 6]);
  });

  it('starts a new track for a face lost too long', () => {
    const frames: FaceBox[][] = [[box(0.5, 0.5)], [box(0.5, 0.5)], [box(0.5, 0.5)], ...Array.from({ length: 10 }, () => []), [box(0.5, 0.5)], [box(0.5, 0.5)], [box(0.5, 0.5)]];
    expect(linkFaces(frames, 6)).toHaveLength(2);
  });
});

describe('particles', () => {
  it('rise one after another and come round again, within their spread', () => {
    const p = { kind: 'rise' as const, count: 8, speed: 0.4, spread: 0.5 };
    expect(particlesAt(p, 0)).toHaveLength(1);
    const later = particlesAt(p, 5);
    expect(later).toHaveLength(8);
    for (const q of later) {
      expect(q.dy).toBeLessThanOrEqual(0);
      expect(Math.abs(q.dx)).toBeLessThan(0.3);
      expect(q.alpha).toBeGreaterThanOrEqual(0);
    }
    // the same moment looks the same
    expect(particlesAt(p, 2.5)).toEqual(particlesAt(p, 2.5));
  });

  it('burst once, then are gone', () => {
    const p = { kind: 'burst' as const, count: 10, speed: 0.6, spread: 0.5 };
    expect(particlesAt(p, 0.5)).toHaveLength(10);
    expect(particlesAt(p, 3)).toHaveLength(0);
  });
});
