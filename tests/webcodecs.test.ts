import { describe, expect, it } from 'vitest';
import { bitrateForCrf, encodedSize } from '../src/lib/webcodecs';
import { centreAt } from '../src/engine/reframe';

describe('hardware encoding', () => {
  it('turns CRF into a bitrate that halves every 6 steps and suits the codec', () => {
    const at18 = bitrateForCrf(18, 1280, 720, 24, 'avc');
    expect(at18).toBeCloseTo(1280 * 720 * 24 * 0.25, -3);
    expect(bitrateForCrf(24, 1280, 720, 24, 'avc')).toBeCloseTo(at18 / 2, -3);
    expect(bitrateForCrf(18, 1280, 720, 24, 'vp9')).toBeLessThan(at18);
    // never silly low or silly high
    expect(bitrateForCrf(51, 160, 90, 12, 'vp9')).toBe(300e3);
    expect(bitrateForCrf(0, 1280, 720, 24, 'avc')).toBeCloseTo(1280 * 720 * 24 * 0.6, -3);
  });

  it('works out the size after the reframe crop and the scale, always even', () => {
    expect(encodedSize({ srcW: 1280, srcH: 720, width: 0 })).toEqual({ cw: 1280, ch: 720, w: 1280, h: 720 });
    expect(encodedSize({ srcW: 1280, srcH: 720, width: 641 })).toEqual({ cw: 1280, ch: 720, w: 642, h: 362 });
    // 16:9 reframed to 9:16 keeps the full height and a slice of the width
    const r = encodedSize({ srcW: 1280, srcH: 720, width: 0, reframe: { axis: 'x', size: (720 * 9) / 16 / 1280, pts: [[0, 0.5]] } });
    expect(r).toEqual({ cw: 404, ch: 720, w: 404, h: 720 });
    expect(encodedSize({ srcW: 1280, srcH: 720, width: 0, reframe: { axis: 'y', size: 0.5, pts: [[0, 0.5]] } }).h).toBe(360);
  });

  it('moves the crop along the same path ffmpeg follows', () => {
    const p = { axis: 'x' as const, size: 0.3, pts: [[1, 0.2], [3, 0.6]] as [number, number][] };
    expect(centreAt(p, 0)).toBe(0.2);
    expect(centreAt(p, 2)).toBeCloseTo(0.4, 6);
    expect(centreAt(p, 9)).toBe(0.6);
  });
});

describe('threads', () => {
  it('gives the output a set thread count, and leaves probes alone', async () => {
    const { withThreads, THREADS } = await import('../src/lib/ffmpeg');
    expect(withThreads(['-i', 'a.mp4', '-c:v', 'libx264', 'o.mp4'])).toEqual(['-i', 'a.mp4', '-c:v', 'libx264', '-threads', String(THREADS), 'o.mp4']);
    expect(withThreads(['-i', '/m/probe.mp4'])).toEqual(['-i', '/m/probe.mp4']);
    expect(withThreads(['-i', 'a', '-threads', '1', 'o'])).toEqual(['-i', 'a', '-threads', '1', 'o']);
    expect(THREADS).toBeGreaterThanOrEqual(1);
    expect(THREADS).toBeLessThanOrEqual(4);
  });
});
