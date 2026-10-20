import { describe, expect, it } from 'vitest';
import { cellTransform, inset, GRID_LAYOUTS, type Cell } from '../src/engine/grid';
import { pictureMatrix } from '../src/engine/placement';
import { pictureQuad } from '../src/engine/gizmo';
import type { Clip } from '../src/engine/types';

/** where the clip's (cropped) picture ends up in the frame, as shares of it */
function shown(cell: Cell, fit: Clip['fit'], iw: number, ih: number, W: number, H: number) {
  const T = cellTransform(cell, fit, iw, ih, W, H);
  const c = { transform: T, fit } as Clip;
  const q = pictureQuad(pictureMatrix(c, 0, iw, ih, W, H), W, H, T.cropL, T.cropT, 1 - T.cropR, 1 - T.cropB);
  return [q[0][0] / W, q[0][1] / H, (q[2][0] - q[0][0]) / W, (q[2][1] - q[0][1]) / H].map((v) => +v.toFixed(4) + 0);
}

describe('split screens', () => {
  it('puts each picture exactly over its cell, whatever its shape and fit', () => {
    for (const [iw, ih] of [[1920, 1080], [1080, 1920], [640, 640]])
      for (const fit of ['fit', 'fill', 'stretch'] as Clip['fit'][])
        for (const L of GRID_LAYOUTS)
          for (const cell of L.cells) expect(shown(cell, fit, iw, ih, 1080, 1920), `${L.id} ${fit} ${iw}x${ih}`).toEqual(cell.map((v) => +v.toFixed(4) + 0));
  });

  it('covers the cell without stretching (crops instead)', () => {
    const T = cellTransform([0, 0, 1, 0.5], 'fit', 1920, 1080, 1080, 1920);
    // a wide picture in a half-height cell of a tall frame: cropped at the sides only
    expect(T.cropT).toBe(0);
    expect(T.cropL).toBeGreaterThan(0);
    expect(T.cropL).toBe(T.cropR);
  });

  it('leaves gaps between cells', () => {
    const c = inset([0, 0, 0.5, 0.5], 0.02, 1000, 2000);
    expect(c.map((v) => +v.toFixed(4))).toEqual([0.01, 0.005, 0.48, 0.49]);
  });

  it('every layout fills the frame', () => {
    for (const L of GRID_LAYOUTS) expect(L.cells.reduce((a, [, , w, h]) => a + w * h, 0), L.id).toBeCloseTo(1);
  });
});

import { trailSteps, isStill } from '../src/engine/layers';
import { newShape } from '../src/engine/shapes';

describe('stamp trail', () => {
  const s = { ...newShape('rect', 's', 'g1', 1, 1), drawOn: undefined, trail: { every: 0.5, count: 3, dx: 0.1, dy: 0 } };
  it('steps on every beat, leaving copies, up to the count', () => {
    expect(trailSteps(s, 1.2)).toEqual([[0, 0]]);
    expect(trailSteps(s, 1.5)).toEqual([[0, 0], [0.1, 0]]);
    expect(trailSteps(s, 2.6).map(([x]) => +x.toFixed(6))).toEqual([0, 0.1, 0.2, 0.3]);
    expect(trailSteps(s, 9)).toHaveLength(4);
    expect(trailSteps({ ...s, trail: undefined }, 9)).toEqual([[0, 0]]);
  });
  it('makes the layer change over time', () => {
    expect(isStill(s)).toBe(false);
    expect(isStill({ ...s, trail: undefined })).toBe(true);
  });
});
