import { describe, expect, it } from 'vitest';
import { subdivide } from '../src/engine/beattime';

describe('beat subdivisions', () => {
  it('add evenly spaced points between beats', () => {
    expect(subdivide([0, 1, 3], 2)).toEqual([0, 0.5, 1, 2, 3, 4]);
    expect(subdivide([0, 4], 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('leave the beats alone for whole beats or too few beats', () => {
    expect(subdivide([0, 1], 1)).toEqual([0, 1]);
    expect(subdivide([2], 4)).toEqual([2]);
    expect(subdivide([], 2)).toEqual([]);
  });
});
