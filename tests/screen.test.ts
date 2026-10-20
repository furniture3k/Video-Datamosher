import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir } from './helpers';
import { screenCorners, screenFilters, screenFromPlane } from '../src/engine/screen';
import { applyH, quadHomography } from '../src/engine/planar';

const W = 160;
const H = 90;
// the surface over two seconds: it slides right and tilts (shares of the frame, clockwise from the top left)
const plane = [
  [0, 0.25, 0.2, 0.55, 0.2, 0.55, 0.7, 0.25, 0.7],
  [2, 0.4, 0.15, 0.75, 0.25, 0.75, 0.75, 0.4, 0.65],
];

describe('screen from a surface', () => {
  // a surface 80 px across and 72 px down on a 160×90 frame
  const still = [
    [0, 0.25, 0.1, 0.75, 0.1, 0.75, 0.9, 0.25, 0.9],
    [1, 0.25, 0.1, 0.75, 0.1, 0.75, 0.9, 0.25, 0.9],
  ];
  it('fills a surface of the same shape exactly, with the picture left whole', () => {
    const s = screenFromPlane(still, 0, W, H, 80 / 72, 0)!;
    const c = screenCorners(s, 0, W, H)!;
    [40, 9, 120, 9, 120, 81, 40, 81].forEach((v, i) => expect(c[i]).toBeCloseTo(v, 2));
  });
  it('crops a wide picture to a squarer surface instead of squashing it', () => {
    // a 2:1 picture is wider than the surface (80:72), so its sides are cut off
    const s = screenFromPlane(still, 0, W, H, 2, 0)!;
    const c = screenCorners(s, 0, W, H)!;
    // the whole picture is wider than the surface: its corners sit outside it, left and right
    expect(c[0]).toBeLessThan(0.25 * W);
    expect(c[2]).toBeGreaterThan(0.75 * W);
    // the middle of the picture is the middle of the surface
    expect((c[0] + c[2] + c[4] + c[6]) / 4).toBeCloseTo(0.5 * W, 3);
    expect((c[1] + c[3] + c[5] + c[7]) / 4).toBeCloseTo(0.5 * H, 3);
    // the part that shows (its share of the width is want / aspect) is exactly as wide as the surface
    const shown = 80 / 72 / 2;
    expect((c[2] - c[0]) * shown).toBeCloseTo(80, 2);
    // and the picture isn't squashed: its height is the surface's
    expect(c[7] - c[1]).toBeCloseTo(72, 2);
  });
  it('crops a tall picture to a wider surface the other way', () => {
    const s = screenFromPlane(still, 0, W, H, 0.5, 0)!;
    const c = screenCorners(s, 0, W, H)!;
    expect(c[2] - c[0]).toBeCloseTo(80, 2);
    expect(c[7] - c[1]).toBeGreaterThan(72);
  });
  it('turns surface times into the clip’s own time', () => {
    const s = screenFromPlane(plane, 1.5, W, H, 16 / 9, 1)!;
    expect(s.quads[0][0]).toBeCloseTo(-1.5, 5);
    expect(s.quads.at(-1)![0]).toBeCloseTo(0.5, 5);
  });
  it('is null without a surface', () => {
    expect(screenFromPlane([], 0, W, H, 1.7, 0)).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)('screen filters on real pixels', () => {
  it('put the picture on the surface, transparent elsewhere, frame by frame', () => {
    const dir = tmpdir();
    // a picture of four colours, one in each quarter: red top left, green top right, blue bottom left, yellow bottom right
    ff(dir, ['-f', 'lavfi', '-i', `color=c=red:s=${W / 2}x${H / 2}:d=1`, '-f', 'lavfi', '-i', `color=c=green:s=${W / 2}x${H / 2}:d=1`, '-f', 'lavfi', '-i', `color=c=blue:s=${W / 2}x${H / 2}:d=1`, '-f', 'lavfi', '-i', `color=c=yellow:s=${W / 2}x${H / 2}:d=1`, '-filter_complex', '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack,format=rgba', '-frames:v', '1', 'pic.png']);
    // the picture is the same shape as the surface at 0 s (so no crop): 16:9 on a 16:9 surface
    const flat = [
      [0, 0.25, 0.2, 0.75, 0.2, 0.75, 0.8, 0.25, 0.8],
      [2, 0.25, 0.2, 0.75, 0.2, 0.75, 0.8, 0.25, 0.8],
    ];
    const s = { quads: [[0, ...flat[0].slice(1)], [2, 0.4, 0.15, 0.8, 0.25, 0.8, 0.75, 0.4, 0.65]] };
    const fps = 10;
    const f = screenFilters(s, W, H, fps, 0, 'black@0');
    const raw = path.join(dir, 'out.rgba');
    // a second of the picture held still (the filter reads each frame's number as its time)
    ff(dir, ['-loop', '1', '-framerate', String(fps), '-t', '2', '-i', 'pic.png', '-vf', `format=rgba,${f.join(',')}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'out.rgba']);
    const bytes = fs.readFileSync(raw);
    expect(bytes.length).toBe(W * H * 4 * 2 * fps);
    const at = (frame: number, x: number, y: number) => [...bytes.subarray(((frame * H + Math.round(y)) * W + Math.round(x)) * 4, ((frame * H + Math.round(y)) * W + Math.round(x)) * 4 + 4)];
    // frame 0 (0 s): the picture sits on the first surface; its four quarters are at the surface's quarters
    const q0 = screenCorners(s, 0, W, H)!;
    const H0 = quadHomography([0, 0, W, 0, W, H, 0, H], q0)!;
    const on = (frame: number, hh: number[], u: number, v: number) => {
      const [x, y] = applyH(hh, u * W, v * H);
      return at(frame, x, y);
    };
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 24);
    expect(near(on(0, H0, 0.25, 0.25), [255, 0, 0, 255])).toBe(true);
    expect(near(on(0, H0, 0.75, 0.25), [0, 128, 0, 255])).toBe(true);
    expect(near(on(0, H0, 0.25, 0.75), [0, 0, 255, 255])).toBe(true);
    expect(near(on(0, H0, 0.75, 0.75), [255, 255, 0, 255])).toBe(true);
    // outside the surface the picture isn't there (transparent)
    expect(at(0, 4, 4)[3]).toBe(0);
    expect(at(0, W - 4, H - 4)[3]).toBe(0);
    // and 1.5 s on, the picture is where the surface has got to (checked at the true time of that frame)
    const frame = 15;
    const t = frame / fps;
    const qt = screenCorners(s, t, W, H)!;
    const Ht = quadHomography([0, 0, W, 0, W, H, 0, H], qt)!;
    expect(near(on(frame, Ht, 0.25, 0.25), [255, 0, 0, 255])).toBe(true);
    expect(near(on(frame, Ht, 0.75, 0.75), [255, 255, 0, 255])).toBe(true);
    expect(at(frame, 4, 4)[3]).toBe(0);
  });
});
