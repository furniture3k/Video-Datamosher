import { describe, expect, it } from 'vitest';
import { BLEND_TRANSITIONS, motionSide, xfadeOf } from '../src/engine/timeline';
import type { Clip } from '../src/engine/types';

const clip = (extra: Partial<Clip> = {}): Clip => ({ id: 'c', track: 'v1', media: 'm', start: 0, in: 0, out: 4, speed: 1, ...extra }) as Clip;

describe('whip with the motion', () => {
  it('goes the way a tracked object is moving at the cut', () => {
    const right = clip({ paths: [{ id: 'p', name: 'p', pts: [0, 1, 2, 3, 4].map((t) => [t, 0.2 + t * 0.1, 0.5] as [number, number, number]) }] });
    const left = clip({ paths: [{ id: 'p', name: 'p', pts: [0, 1, 2, 3, 4].map((t) => [t, 0.8 - t * 0.1, 0.5] as [number, number, number]) }] });
    expect(motionSide(right, true)).toBe(1);
    expect(motionSide(left, true)).toBe(-1);
    expect(xfadeOf('whip', right, clip())).toBe('smoothright');
    expect(xfadeOf('whip', left, clip())).toBe('smoothleft');
  });
  it('reads a keyframed move, and falls back to the next clip, then to left', () => {
    const moving = clip({ keys: { x: [[0, 0], [4, 0.3]] } });
    expect(motionSide(moving, true)).toBe(1);
    expect(xfadeOf('whip', clip(), moving)).toBe('smoothright');
    expect(xfadeOf('whip', clip(), clip())).toBe('smoothleft');
  });
  it('leaves the fixed whips and the others alone', () => {
    expect(xfadeOf('whipright')).toBe('smoothright');
    expect(xfadeOf('dissolve')).toBe('fade');
    for (const t of ['circlecrop', 'rectcrop', 'doors', 'dipgrey', 'grainy']) expect(BLEND_TRANSITIONS[t].xfade).toBeTruthy();
  });
});
