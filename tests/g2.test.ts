import { describe, expect, it } from 'vitest';
import { evalKeys, keysExpr, popKeys, swapKeys } from '../src/engine/keys';

const rest = { zoom: 0.5, x: 0.25, y: -0.1 };

describe('popping in', () => {
  it('snap has no move at all, only that it is there', () => {
    const k = popKeys(rest, { mode: 'snap', dur: 0.3, ease: true });
    expect(k.zoom).toBeUndefined();
    expect(evalKeys(k.opacity!, 0)).toBe(1);
  });
  it('pop grows past its size and settles back to it', () => {
    const k = popKeys(rest, { mode: 'pop', dur: 0.4, ease: true });
    expect(evalKeys(k.zoom!, 0)).toBeCloseTo(0.1, 6);
    expect(evalKeys(k.zoom!, 0.24)).toBeCloseTo(0.56, 6);
    expect(evalKeys(k.zoom!, 0.4)).toBeCloseTo(0.5, 6);
    expect(evalKeys(k.zoom!, 3)).toBeCloseTo(0.5, 6);
    // fades in over the first quarter
    expect(evalKeys(k.opacity!, 0)).toBe(0);
    expect(evalKeys(k.opacity!, 0.4)).toBe(1);
  });
  it('slide comes in from the side it is told to and ends where it rests', () => {
    for (const [from, prop, sign] of [['left', 'x', -1], ['right', 'x', 1], ['top', 'y', -1], ['bottom', 'y', 1]] as const) {
      const k = popKeys(rest, { mode: 'slide', dur: 0.3, ease: true, from });
      const base = prop === 'x' ? rest.x : rest.y;
      expect(Math.sign(evalKeys(k[prop]!, 0) - base)).toBe(sign);
      expect(evalKeys(k[prop]!, 0.3)).toBeCloseTo(base, 6);
      // the other direction is not moved
      expect(k[prop === 'x' ? 'y' : 'x']).toBeUndefined();
    }
  });
  it('without easing the keys are straight lines (and the FFmpeg expression has no curve in it)', () => {
    const eased = popKeys(rest, { mode: 'pop', dur: 0.4, ease: true });
    const hard = popKeys(rest, { mode: 'pop', dur: 0.4, ease: false });
    expect(hard.zoom!.every((p) => p[2] === 0)).toBe(true);
    expect(eased.zoom!.every((p) => p.length === 2)).toBe(true);
    // halfway between two keys: eased and straight differ off the middle
    const u = 0.1;
    expect(evalKeys(hard.zoom!, u)).not.toBeCloseTo(evalKeys(eased.zoom!, u), 3);
    expect(keysExpr(hard.zoom!, 'T')).not.toContain('3-2*');
    expect(keysExpr(eased.zoom!, 'T')).toContain('3-2*');
  });
  it('takes at least a few frames, however short it is asked to be', () => {
    const k = popKeys(rest, { mode: 'pop', dur: 0, ease: true });
    expect(k.zoom![2][0]).toBeGreaterThanOrEqual(0.04);
  });
});

describe('swapping places on the beat', () => {
  const places = [{ zoom: 1, x: -0.25, y: 0 }, { zoom: 1, x: 0.25, y: 0 }];
  const times = [1, 2, 3];
  it('puts each clip in its own place to start with', () => {
    expect(evalKeys(swapKeys(places, 0, times, 0.04).x!, 0.5)).toBe(-0.25);
    expect(evalKeys(swapKeys(places, 1, times, 0.04).x!, 0.5)).toBe(0.25);
  });
  it('jumps to the other place on each beat, and back on the next', () => {
    const a = swapKeys(places, 0, times, 0.04).x!;
    expect(evalKeys(a, 0.95)).toBe(-0.25);
    expect(evalKeys(a, 1.0)).toBeCloseTo(0.25, 6);
    expect(evalKeys(a, 1.5)).toBe(0.25);
    expect(evalKeys(a, 2.0)).toBeCloseTo(-0.25, 6);
    expect(evalKeys(a, 3.01)).toBeCloseTo(0.25, 6);
    // the other clip is the mirror of it
    const b = swapKeys(places, 1, times, 0.04).x!;
    for (const t of [0.5, 1.5, 2.5, 3.5]) expect(evalKeys(b, t)).toBeCloseTo(-evalKeys(a, t), 6);
  });
  it('is a hard step: nothing is in between the places a frame after a beat', () => {
    const a = swapKeys(places, 0, times, 0.04).x!;
    expect(evalKeys(a, 1.02)).toBeCloseTo(0.25, 1);
    expect(a.every((p) => p[2] === 0)).toBe(true);
  });
  it('works for any number of places, going round', () => {
    const three = [{ zoom: 1, x: -0.3, y: 0 }, { zoom: 1, x: 0, y: 0 }, { zoom: 1, x: 0.3, y: 0 }];
    const c = swapKeys(three, 2, [1, 2, 3], 0.04).x!;
    expect(evalKeys(c, 0.5)).toBe(0.3);
    expect(evalKeys(c, 1.5)).toBe(-0.3);
    expect(evalKeys(c, 2.5)).toBe(0);
    expect(evalKeys(c, 3.5)).toBe(0.3);
  });
});
