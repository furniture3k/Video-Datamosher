import { describe, expect, it } from 'vitest';
import { cardRect, hasCanvas, CANVAS_PRESETS, DEFAULT_CANVAS } from '../src/engine/canvas';

describe('canvas', () => {
  it('sets the card in by the same space on every side, in even pixels', () => {
    const R = cardRect({ ...DEFAULT_CANVAS, inset: 0.1, radius: 0.1 }, 1080, 1920);
    expect([R.x, R.y, R.w, R.h]).toEqual([108, 108, 864, 1704]);
    expect(R.r).toBe(86);
    for (const v of [R.w, R.h, R.crop.w, R.crop.h]) expect(v % 2).toBe(0);
  });

  it('shows the middle of the picture, cropped to the card’s shape', () => {
    const R = cardRect({ ...DEFAULT_CANVAS, inset: 0.1 }, 1920, 1080);
    // the card is wider than the frame's shape: the picture is cropped top and bottom
    expect(R.crop.w).toBe(1920);
    expect(R.crop.h).toBeLessThan(1080);
    expect(R.crop.y).toBe((1080 - R.crop.h) / 2);
    expect(R.crop.w / R.crop.h).toBeCloseTo(R.w / R.h, 2);
  });

  it('moves the card up or down, never out of the frame', () => {
    const up = cardRect({ ...DEFAULT_CANVAS, inset: 0.1, shift: -0.03 }, 1000, 1000);
    expect(up.y).toBe(70);
    expect(cardRect({ ...DEFAULT_CANVAS, inset: 0.1, shift: -1 }, 1000, 1000).y).toBe(0);
  });

  it('changes nothing with nothing set in', () => {
    expect(hasCanvas(undefined)).toBe(false);
    expect(hasCanvas({ ...DEFAULT_CANVAS, inset: 0 })).toBe(false);
    for (const p of CANVAS_PRESETS) expect(hasCanvas(p.canvas)).toBe(true);
  });
});
