// Milestone 6: flow painting fields.
import { describe, expect, it } from 'vitest';
import { rasterizeField, encodeField, FIELD_MAX, type Stroke } from '../src/engine/flowfield';

const at = (f: Float32Array, gw: number, i: number, j: number): [number, number] => [f[(j * gw + i) * 2], f[(j * gw + i) * 2 + 1]];
const stroke = (tool: Stroke['tool'], pts: [number, number][], radius = 0.1, strength = 0.01): Stroke => ({ tool, pts, radius, strength });

describe('flow painting', () => {
  const gw = 32;
  const gh = 18;
  const aspect = 16 / 9;
  it('push flows along the stroke and fades with distance', () => {
    const f = rasterizeField([stroke('push', [[0.2, 0.5], [0.8, 0.5]])], gw, gh, aspect);
    const [vx, vy] = at(f, gw, 16, 9);
    expect(vx).toBeGreaterThan(0.008);
    expect(Math.abs(vy)).toBeLessThan(1e-6);
    expect(at(f, gw, 16, 1)[0]).toBeLessThan(vx * 0.2);
    // a stroke drawn upwards flows up (negative y on screen)
    const up = rasterizeField([stroke('push', [[0.5, 0.8], [0.5, 0.2]])], gw, gh, aspect);
    expect(at(up, gw, 16, 9)[1]).toBeLessThan(-0.005);
  });
  it('swirl turns around the stroke, pinch pulls in, bulge pushes out', () => {
    const dot: [number, number][] = [[0.5, 0.5]];
    const sw = rasterizeField([stroke('swirl', dot, 0.2)], gw, gh, aspect);
    // right of the centre, a clockwise swirl (y down) flows downwards
    expect(at(sw, gw, 20, 9)[1]).toBeGreaterThan(0);
    const un = rasterizeField([stroke('unswirl', dot, 0.2)], gw, gh, aspect);
    expect(at(un, gw, 20, 9)[1]).toBeLessThan(0);
    const pinch = rasterizeField([stroke('pinch', dot, 0.2)], gw, gh, aspect);
    expect(at(pinch, gw, 20, 9)[0]).toBeLessThan(0);
    const bulge = rasterizeField([stroke('bulge', dot, 0.2)], gw, gh, aspect);
    expect(at(bulge, gw, 20, 9)[0]).toBeGreaterThan(0);
  });
  it('erase removes flow under the brush only', () => {
    const f = rasterizeField([stroke('push', [[0.1, 0.5], [0.9, 0.5]]), stroke('erase', [[0.5, 0.5]], 0.08)], gw, gh, aspect);
    expect(Math.abs(at(f, gw, 16, 9)[0])).toBeLessThan(0.002);
    expect(at(f, gw, 4, 9)[0]).toBeGreaterThan(0.008);
  });
  it('encodes into bytes around 128, clamped at the maximum', () => {
    const f = new Float32Array([FIELD_MAX, -FIELD_MAX / 2, 0, 9]);
    const e = encodeField(f, 2, 1);
    expect([...e]).toEqual([255, 65, 128, 255, 128, 255, 128, 255]);
  });
});
