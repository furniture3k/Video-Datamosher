import { describe, expect, it } from 'vitest';
import { fromBeats, lengthFromBeats, lengthToBeats, toBeats } from '../src/engine/beattime';

// 120 bpm for four beats, then the tempo halves (a beat every second)
const beats = [0, 0.5, 1, 1.5, 2, 3, 4, 5];

describe('beat units', () => {
  it('counts time in beats and back, following a tempo change', () => {
    expect(toBeats(beats, 1)).toBe(2);
    expect(toBeats(beats, 1.25)).toBeCloseTo(2.5);
    expect(toBeats(beats, 2.5)).toBeCloseTo(4.5);
    for (const t of [0, 0.3, 1.9, 2.5, 4.7]) expect(fromBeats(beats, toBeats(beats, t)!)).toBeCloseTo(t, 9);
  });
  it('carries on past the ends with the nearest gap', () => {
    expect(toBeats(beats, 6)).toBeCloseTo(8);
    expect(toBeats(beats, -0.5)).toBeCloseTo(-1);
    expect(fromBeats(beats, 9)).toBeCloseTo(7);
  });
  it('measures a length from where it starts', () => {
    // a second long: two beats at the quick tempo, one at the slow
    expect(lengthToBeats(beats, 0, 1)).toBeCloseTo(2);
    expect(lengthToBeats(beats, 3, 1)).toBeCloseTo(1);
    expect(lengthFromBeats(beats, 0, 2)).toBeCloseTo(1);
    expect(lengthFromBeats(beats, 3, 1)).toBeCloseTo(1);
    expect(lengthFromBeats(beats, 1, 2)).toBeCloseTo(1);
    expect(lengthFromBeats(beats, 1, 4)).toBeCloseTo(3);
  });
  it('says nothing without a tempo', () => {
    expect(toBeats([], 1)).toBeNull();
    expect(toBeats([1], 1)).toBeNull();
    expect(lengthFromBeats([0], 0, 1)).toBeNull();
  });
});
