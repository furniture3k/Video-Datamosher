import { describe, expect, it } from 'vitest';
import { applyH, corners, homographyLS, inv3, mapQuad, mul3, quadAt, quadHomography, quadOk, ransacH, trackPlane, trackPlaneBoth, UNIT_QUAD, type Mat3, type Pt, type Quad } from '../src/engine/planar';
import { blur3, type Gray } from '../src/engine/track';

const W = 256;
const H = 160;
const TEX = 200;

/** Smooth-ish noise: random values blurred, stretched to the full range (like detailed footage). */
function noise(w: number, h: number, seed: number): Uint8Array {
  let a = seed;
  const r = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  let f = new Uint8Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = Math.floor(r() * 256);
  f = blur3(blur3(f, w, h), w, h);
  let lo = 255;
  let hi = 0;
  for (const v of f) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
  return f.map((v) => ((v - lo) * 255) / Math.max(1, hi - lo));
}

const tex = noise(TEX, TEX, 7);
const bg = noise(W, H, 99);

const sample = (f: Uint8Array, w: number, h: number, x: number, y: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const g = (xx: number, yy: number) => f[Math.max(0, Math.min(h - 1, yy)) * w + Math.max(0, Math.min(w - 1, xx))];
  return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
};

/** Where the surface's corners are at frame t: it slides, turns and leans out of the screen a little. */
function quadAtFrame(t: number): Quad {
  const cx = 128 + 18 * Math.sin(t / 14);
  const cy = 80 + 8 * Math.cos(t / 11);
  const a = 0.22 * Math.sin(t / 17);
  const s = 52 + 8 * Math.sin(t / 23);
  const lean = 5 * Math.sin(t / 9);
  const pts: Pt[] = [
    [-s, -s + lean],
    [s, -s - lean],
    [s, s + lean * 0.5],
    [-s, s - lean * 0.5],
  ];
  return pts.flatMap(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
}

interface Cover {
  from: number;
  to: number;
  /** the shape, in screen pixels */
  rect: [number, number, number, number];
}

/** The scene: the texture warped onto the quad over a static background, optionally covered. */
function scene(frames: number, cover?: Cover): { g: Gray; truth: Quad[] } {
  const truth: Quad[] = [];
  const out: Uint8Array[] = [];
  for (let t = 0; t < frames; t++) {
    const q = quadAtFrame(t);
    truth.push(q);
    // texture pixel (u, v) → screen; the screen pixel looks it up the other way
    const Hm = quadHomography([0, 0, TEX, 0, TEX, TEX, 0, TEX], q)!;
    const Hi = inv3(Hm)!;
    const f = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const [u, v] = applyH(Hi, x, y);
        f[y * W + x] = u >= 0 && v >= 0 && u <= TEX - 1 && v <= TEX - 1 ? sample(tex, TEX, TEX, u, v) : bg[y * W + x];
      }
    if (cover && t >= cover.from && t < cover.to) {
      const [x0, y0, x1, y1] = cover.rect;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f[y * W + x] = 30;
    }
    out.push(f);
  }
  return { g: { w: W, h: H, frames: out }, truth };
}

/** Largest distance (pixels) from any tracked corner to where it really was. */
function worst(track: { f: number; q: Quad }[], truth: Quad[]): number {
  let m = 0;
  for (const { f, q } of track) for (let i = 0; i < 4; i++) m = Math.max(m, Math.hypot(q[i * 2] - truth[f][i * 2], q[i * 2 + 1] - truth[f][i * 2 + 1]));
  return m;
}

describe('homography maths', () => {
  const sq: Quad = [10, 10, 90, 20, 100, 80, 5, 70];
  it('maps a quad onto another exactly', () => {
    const to: Quad = [30, 40, 120, 30, 130, 100, 20, 110];
    const Hm = quadHomography(sq, to)!;
    const got = mapQuad(Hm, sq);
    got.forEach((v, i) => expect(v).toBeCloseTo(to[i], 6));
  });
  it('inverts and composes', () => {
    const Hm = quadHomography(UNIT_QUAD, sq)!;
    const I = mul3(Hm, inv3(Hm)!);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(I[i]).toBeCloseTo(v, 6));
    const [x, y] = applyH(inv3(Hm)!, ...applyH(Hm, 0.3, 0.7));
    expect(x).toBeCloseTo(0.3, 6);
    expect(y).toBeCloseTo(0.7, 6);
  });
  it('fits many noisy points to under a pixel and shrugs off wrong ones', () => {
    const Hm = quadHomography(UNIT_QUAD.map((v) => v * 100), sq)!;
    const src: Pt[] = [];
    const dst: Pt[] = [];
    let a = 3;
    const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 80; i++) {
      const p: Pt = [r() * 100, r() * 100];
      const [x, y] = applyH(Hm, ...p);
      src.push(p);
      dst.push(i % 5 === 0 ? [r() * 200, r() * 200] : [x + (r() - 0.5) * 0.4, y + (r() - 0.5) * 0.4]);
    }
    expect(homographyLS(src.filter((_, i) => i % 5), dst.filter((_, i) => i % 5))).not.toBeNull();
    const fit = ransacH(src, dst, 1)!;
    expect(fit.inliers.length).toBeGreaterThanOrEqual(60);
    const g = mapQuad(fit.H, UNIT_QUAD.map((v) => v * 100));
    g.forEach((v, i) => expect(Math.abs(v - sq[i])).toBeLessThan(0.5));
  });
  it('refuses a quad that folds over itself', () => {
    expect(quadOk(sq)).toBe(true);
    expect(quadOk([0, 0, 10, 10, 10, 0, 0, 10])).toBe(false);
    expect(quadOk([0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
  });
  it('reads a stored track at any time', () => {
    const keys = [
      [0, 0, 0, 1, 0, 1, 1, 0, 1],
      [2, 0.2, 0, 1.2, 0, 1.2, 1, 0.2, 1],
    ];
    expect(quadAt(keys, -1)![0]).toBe(0);
    expect(quadAt(keys, 1)![0]).toBeCloseTo(0.1, 9);
    expect(quadAt(keys, 5)![0]).toBeCloseTo(0.2, 9);
    expect(quadAt([], 1)).toBeNull();
  });
});

describe('corners', () => {
  it('finds corners only inside the shape, spaced apart', () => {
    const poly: Pt[] = [
      [60, 40],
      [200, 40],
      [200, 120],
      [60, 120],
    ];
    const c = corners(bg, W, H, poly, 80, 6);
    expect(c.length).toBeGreaterThan(30);
    expect(c.every(([x, y]) => x >= 60 && x <= 200 && y >= 40 && y <= 120)).toBe(true);
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1])).toBeGreaterThanOrEqual(6);
  });
  it('finds none on a flat patch', () => {
    const flat = new Uint8Array(W * H).fill(90);
    expect(corners(flat, W, H, [[20, 20], [100, 20], [100, 100], [20, 100]])).toEqual([]);
  });
});

describe('plane tracker', () => {
  const N = 60;

  it('follows a moving, turning, leaning surface to under a pixel for 60 frames', () => {
    const { g, truth } = scene(N);
    const track = trackPlane(g, 0, truth[0]);
    expect(track.length).toBe(N);
    expect(worst(track, truth)).toBeLessThan(1);
  });

  it('tracks backwards from a frame in the middle, and both ways at once', () => {
    const { g, truth } = scene(N);
    const back = trackPlane(g, 40, truth[40], -1);
    expect(back.length).toBe(41);
    expect(back[back.length - 1].f).toBe(0);
    expect(worst(back, truth)).toBeLessThan(1);
    const both = trackPlaneBoth(g, 30, truth[30]);
    expect(both.map((p) => p.f)).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(worst(both, truth)).toBeLessThan(1);
  });

  it('keeps going while 30% of the surface is covered, and recovers afterwards', () => {
    // a grey block over the left third of the surface for a second or so, fixed on the screen
    const probe = scene(N);
    const q = probe.truth[0];
    const xs = [q[0], q[2], q[4], q[6]];
    const x0 = Math.min(...xs);
    const wide = Math.max(...xs) - x0;
    const { g, truth } = scene(N, { from: 18, to: 38, rect: [Math.floor(x0 - 20), 10, Math.ceil(x0 + wide * 0.3), H - 10] });
    const track = trackPlane(g, 0, truth[0]);
    expect(track.length).toBe(N);
    expect(worst(track, truth)).toBeLessThan(1);
    // the stretch after the cover has gone is as good as the start
    expect(worst(track.filter((p) => p.f >= 45), truth)).toBeLessThan(0.7);
  });

  it('gives up cleanly when the surface is hidden for good', () => {
    const { g, truth } = scene(N, { from: 20, to: N, rect: [0, 0, W, H] });
    const track = trackPlane(g, 0, truth[0]);
    expect(track.length).toBeGreaterThan(15);
    expect(track.length).toBeLessThan(35);
    expect(worst(track.filter((p) => p.f < 20), truth)).toBeLessThan(1);
  });

  it('finds nothing to follow on a flat patch', () => {
    const flat: Gray = { w: W, h: H, frames: Array.from({ length: 5 }, () => new Uint8Array(W * H).fill(120)) };
    expect(trackPlane(flat, 0, [60, 40, 200, 40, 200, 120, 60, 120])).toEqual([]);
  });

  it('gives the same answer every time', () => {
    const { g, truth } = scene(20);
    const a = trackPlane(g, 0, truth[0]);
    const b = trackPlane(g, 0, truth[0]);
    expect(a).toEqual(b);
  });
});

describe('matrix helpers', () => {
  it('leave a point alone under the identity', () => {
    const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(applyH(I, 3, 4)).toEqual([3, 4]);
  });
});

describe('surface matrix and warp triangles', async () => {
  const { surfaceMatrix } = await import('../src/engine/layers');
  const { warpTriangles, affineBetween, growTri } = await import('../src/engine/warp');
  const quads = [
    [0, 0.2, 0.2, 0.6, 0.2, 0.6, 0.6, 0.2, 0.6],
    [2, 0.3, 0.2, 0.7, 0.25, 0.7, 0.65, 0.3, 0.6],
  ];
  it('is nothing for a layer that is not pinned, and the identity at its own moment', () => {
    expect(surfaceMatrix({}, 1, 100, 50)).toBeNull();
    const m = surfaceMatrix({ surface: { quads, refT: 1 } }, 1, 100, 50)!;
    const p = applyH(m, 30, 20);
    expect(p[0]).toBeCloseTo(30, 6);
    expect(p[1]).toBeCloseTo(20, 6);
  });
  it('carries the surface as it was onto the surface as it is, in pixels', () => {
    const m = surfaceMatrix({ surface: { quads, refT: 0 } }, 2, 100, 50)!;
    // the top left corner went from (20, 10) to (30, 10); the bottom right from (60, 30) to (70, 32.5)
    const a = applyH(m, 20, 10);
    const b = applyH(m, 60, 30);
    expect(a[0]).toBeCloseTo(30, 6);
    expect(a[1]).toBeCloseTo(10, 6);
    expect(b[0]).toBeCloseTo(70, 6);
    expect(b[1]).toBeCloseTo(32.5, 6);
  });
  it('splits a rectangle into triangles that tile it and land on the warped corners', () => {
    const m = surfaceMatrix({ surface: { quads, refT: 0 } }, 2, 100, 50)!;
    const tris = warpTriangles(m, 20, 10, 60, 30, 4, 3);
    expect(tris.length).toBe(4 * 3 * 2);
    const area = (t: [number, number][]) => Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
    expect(tris.reduce((s, t) => s + area(t.src), 0)).toBeCloseTo(40 * 20, 6);
    // every triangle's affine takes its source corners exactly to its destination corners
    for (const t of tris) {
      const [a, b, c, d, e, f] = affineBetween(t.src, t.dst)!;
      t.src.forEach(([x, y], i) => {
        expect(a * x + c * y + e).toBeCloseTo(t.dst[i][0], 6);
        expect(b * x + d * y + f).toBeCloseTo(t.dst[i][1], 6);
      });
    }
  });
  it('has no transform for a flat triangle, and grows a triangle outwards', () => {
    expect(affineBetween([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 0], [0, 1]])).toBeNull();
    const g = growTri([[0, 0], [10, 0], [0, 10]], 1);
    expect(g[0][0]).toBeLessThan(0);
    expect(g[1][0]).toBeGreaterThan(10);
  });
});

describe('simplifying keys', async () => {
  const { simplifyKeys } = await import('../src/engine/planar');
  it('keeps a straight run to its two ends and a bend in the middle', () => {
    const line = Array.from({ length: 20 }, (_, i) => [i, i * 2, 5 - i]);
    expect(simplifyKeys(line, 0.01)).toEqual([line[0], line[19]]);
    const bent = Array.from({ length: 21 }, (_, i) => [i, i < 10 ? i : 20 - i]);
    const s = simplifyKeys(bent, 0.01);
    expect(s.map((k) => k[0])).toEqual([0, 10, 20]);
  });
});

describe('bent text and tilt', async () => {
  const { onCurve, sagOf, layoutText } = await import('../src/engine/textlayout');
  const { tiltMatrix } = await import('../src/engine/warp');
  const tx = { id: 't', kind: 'text', row: 'g1', text: 'HELLO', start: 0, duration: 1, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false } as const;
  const measure = (s: string) => s.length * 60;

  it('keeps straight text where it was with no curve', () => {
    const p = onCurve(200, 50, 0);
    expect(p).toEqual({ x: -50, y: 0, a: 0 });
    expect(sagOf(200, 0)).toBe(0);
  });
  it('puts the middle of an arch on the line and its ends lower and turned outwards', () => {
    const mid = onCurve(200, 100, 0.5);
    expect(mid.x).toBeCloseTo(0, 6);
    expect(mid.y).toBeCloseTo(0, 6);
    expect(mid.a).toBeCloseTo(0, 6);
    const left = onCurve(200, 0, 0.5);
    const right = onCurve(200, 200, 0.5);
    expect(left.y).toBeGreaterThan(0);
    expect(left.y).toBeCloseTo(right.y, 6);
    expect(left.x).toBeCloseTo(-right.x, 6);
    // a rising baseline on the left (anticlockwise), a falling one on the right
    expect(left.a).toBeLessThan(0);
    expect(right.a).toBeGreaterThan(0);
    expect(right.a).toBeCloseTo(-left.a, 6);
  });
  it('is a smile when negative: the same, flipped', () => {
    const arch = onCurve(200, 20, 0.6);
    const smile = onCurve(200, 20, -0.6);
    expect(smile.x).toBeCloseTo(arch.x, 6);
    expect(smile.y).toBeCloseTo(-arch.y, 6);
    expect(smile.a).toBeCloseTo(-arch.a, 6);
  });
  it('keeps the length along the arc: half a circle of a 200 px line is 200 px of arc', () => {
    // sample the points of a semicircle and add up the steps
    let len = 0;
    let prev = onCurve(200, 0, 1);
    for (let d = 1; d <= 200; d++) {
      const p = onCurve(200, d, 1);
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    expect(len).toBeGreaterThan(198);
    expect(len).toBeLessThan(201);
    // the ends of a semicircle are R below the top: R = 200/π
    expect(sagOf(200, 1)).toBeCloseTo(200 / Math.PI, 6);
  });
  it('grows the title’s box to hold a bent line', () => {
    const flat = layoutText({ ...tx }, 1000, 500, measure);
    const arch = layoutText({ ...tx, curve: 0.5 }, 1000, 500, measure);
    expect(arch.box.h).toBeGreaterThan(flat.box.h);
    expect(arch.box.y).toBeCloseTo(flat.box.y, 6);
    const smile = layoutText({ ...tx, curve: -0.5 }, 1000, 500, measure);
    expect(smile.box.y).toBeLessThan(flat.box.y);
    expect(smile.box.y + smile.box.h).toBeCloseTo(flat.box.y + flat.box.h, 6);
  });

  it('tilts nothing for zero degrees, and about the point it is given', () => {
    const I = tiltMatrix(0, 0, 100, 50, 300);
    const p = applyH(I, 140, 20);
    expect(p[0]).toBeCloseTo(140, 6);
    expect(p[1]).toBeCloseTo(20, 6);
    const T = tiltMatrix(25, -20, 100, 50, 300);
    const c = applyH(T, 100, 50);
    expect(c[0]).toBeCloseTo(100, 6);
    expect(c[1]).toBeCloseTo(50, 6);
  });
  it('leans the top away (smaller and closer to the middle) and the right away', () => {
    // top edge points are at y < centre: tilting back narrows them
    const T = tiltMatrix(30, 0, 100, 100, 300);
    const topL = applyH(T, 0, 0);
    const topR = applyH(T, 200, 0);
    const botL = applyH(T, 0, 200);
    const botR = applyH(T, 200, 200);
    expect(topR[0] - topL[0]).toBeLessThan(botR[0] - botL[0]);
    expect(topL[1]).toBeGreaterThan(0);
    const S = tiltMatrix(0, 30, 100, 100, 300);
    const tl = applyH(S, 0, 0);
    const bl = applyH(S, 0, 200);
    const tr = applyH(S, 200, 0);
    const br = applyH(S, 200, 200);
    // the right edge is further away: shorter than the left
    expect(br[1] - tr[1]).toBeLessThan(bl[1] - tl[1]);
  });
});
