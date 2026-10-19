import { describe, expect, it } from 'vitest';
import { flipTimes, flipOrder, flipbook } from '../src/engine/flipbook';

describe('flipbook', () => {
  it('swaps on the beats from the start, or every few frames', () => {
    expect(flipTimes(1, 3, { beats: [0.5, 1.5, 2, 2.5, 3.5], fps: 24 })).toEqual([1, 1.5, 2, 2.5]);
    expect(flipTimes(1.5, 3, { beats: [1.5, 2.5], fps: 24 })).toEqual([1.5, 2.5]);
    expect(flipTimes(0, 0.5, { frames: 3, fps: 24 })).toEqual([0, 0.125, 0.25, 0.375]);
  });

  it('uses the pictures in order, back and forth, or shuffled without repeats', () => {
    expect(flipOrder(3, 7, 'order', Math.random)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(flipOrder(3, 7, 'pingpong', Math.random)).toEqual([0, 1, 2, 1, 0, 1, 2]);
    const r = flipOrder(3, 200, 'random', Math.random);
    for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1]);
    expect(new Set(r).size).toBe(3);
    expect(flipOrder(1, 3, 'random', Math.random)).toEqual([0, 0, 0]);
  });

  it('fills the time, a video carrying on where it was left', () => {
    const f = flipbook(['a', 'v'], { a: 0, v: 1 }, [0, 0.5, 1, 1.5], 2, 'order', Math.random);
    expect(f.map((x) => [x.media, x.start, x.duration, x.from])).toEqual([
      ['a', 0, 0.5, 0],
      ['v', 0.5, 0.5, 0],
      ['a', 1, 0.5, 0],
      ['v', 1.5, 0.5, 0.5],
    ]);
    // a video too short to carry on starts again
    const g = flipbook(['v'], { v: 0.6 }, [0, 0.5], 1, 'order', Math.random);
    expect(g.map((x) => x.from)).toEqual([0, 0]);
  });
});
