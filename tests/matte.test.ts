import { describe, expect, it } from 'vitest';
import { iou, matteAt, matteFrames, maskBox, maskStats, packMatte, unpackMatte } from '../src/engine/matte';
import { cutOut, nextPrompt, type ObjectPrompt } from '../src/engine/cutout';
import { trackBox, type Gray } from '../src/engine/track';

const W = 120;
const H = 80;

/** A grey frame with a white square of side `s` whose top left is at (x, y). */
function square(x: number, y: number, s = 20, w = W, h = H): Uint8Array {
  const f = new Uint8Array(w * h);
  for (let j = y; j < y + s; j++) for (let i = x; i < x + s; i++) if (i >= 0 && j >= 0 && i < w && j < h) f[j * w + i] = 255;
  return f;
}

describe('matte codec', () => {
  it('packs frames small and gives them back exactly', async () => {
    const frames = Array.from({ length: 24 }, (_, i) => square(5 + i * 3, 30));
    const packed = await packMatte(frames);
    // flat black and white squeezes to a sliver of its size
    expect(packed.length).toBeLessThan((W * H * 24) / 20);
    const back = await unpackMatte(packed, W, H);
    expect(back.length).toBe(24);
    back.forEach((f, i) => expect(Buffer.compare(Buffer.from(f), Buffer.from(frames[i]))).toBe(0));
  });
  it('counts frames from the seconds it covers', () => {
    expect(matteFrames({ from: 1, to: 3, fps: 12 })).toBe(25);
    expect(matteFrames({ from: 0, to: 0, fps: 12 })).toBe(1);
  });
  it('is nothing for an empty file', async () => {
    expect(await unpackMatte(await packMatte([]), W, H)).toEqual([]);
  });
});

describe('matte over time', () => {
  const m = { from: 2, to: 3, fps: 4 };
  const f = [0, 100, 200, 250, 50].map((v) => new Uint8Array(4).fill(v));
  it('gives the frame on a frame, and a blend between two', () => {
    expect(matteAt(m, f, 2)![0]).toBe(0);
    expect(matteAt(m, f, 2.25)![0]).toBe(100);
    expect(matteAt(m, f, 2.125)![0]).toBe(50);
    expect(matteAt(m, f, 2.875)![0]).toBeCloseTo(150, 0);
    expect(matteAt(m, f, 3)![0]).toBe(50);
  });
  it('is null well outside the seconds it covers, and holds the end frames just beyond', () => {
    expect(matteAt(m, f, 1)).toBeNull();
    expect(matteAt(m, f, 4)).toBeNull();
    expect(matteAt(m, f, 3.05)![0]).toBe(50);
    expect(matteAt(m, [], 2)).toBeNull();
  });
});

describe('what a mask says about the subject', () => {
  it('finds its box, middle and size', () => {
    const a = square(30, 20, 20);
    expect(maskBox(a, W, H)).toEqual([30 / W, 20 / H, 50 / W, 40 / H]);
    const s = maskStats(a, W, H)!;
    expect(s.cx).toBeCloseTo(40 / W, 6);
    expect(s.cy).toBeCloseTo(30 / H, 6);
    expect(s.area).toBeCloseTo(400 / (W * H), 6);
    expect(maskBox(new Uint8Array(W * H), W, H)).toBeNull();
    expect(maskStats(new Uint8Array(W * H), W, H)).toBeNull();
  });
  it('scores overlap', () => {
    expect(iou(square(10, 10), square(10, 10))).toBe(1);
    expect(iou(square(10, 10), square(60, 40))).toBe(0);
    expect(iou(square(10, 10, 20), square(20, 10, 20))).toBeCloseTo(1 / 3, 6);
  });
  it('hints the next frame with a slightly larger box and the middle, and gives up on nothing', () => {
    const p = nextPrompt(square(30, 20, 20), W, H)!;
    // the middle comes first, and the other spots are all on the subject too
    expect(Math.abs(p.points[0][0] - 40 / W)).toBeLessThan(1.5 / W);
    expect(Math.abs(p.points[0][1] - 30 / H)).toBeLessThan(1.5 / H);
    expect(p.points[0][2]).toBe(1);
    expect(p.points.length).toBeGreaterThanOrEqual(3);
    expect(p.points.every(([x, y]) => x * W >= 30 && x * W < 50 && y * H >= 20 && y * H < 40)).toBe(true);
    expect(p.box![0]).toBeLessThan(30 / W);
    expect(p.box![2]).toBeGreaterThan(50 / W);
    expect(nextPrompt(new Uint8Array(W * H), W, H)).toBeNull();
  });
});

describe('cutting out through a clip', () => {
  const N = 40;
  /** where the square is on frame i: moving right 2 px a frame */
  const at = (i: number): [number, number] => [4 + i * 2, 30];
  const truth = (i: number) => square(...at(i));
  /** a fake model: finds the square if the prompt's point is near it, otherwise nothing */
  const model = (hidden: (i: number) => boolean = () => false, calls?: ObjectPrompt[]) => async (i: number, prompt: ObjectPrompt) => {
    calls?.push(prompt);
    if (hidden(i)) return null;
    const [x, y] = at(i);
    const [px, py] = prompt.points.find((p) => p[2] === 1) ?? [-1, -1];
    const near = Math.abs(px * W - (x + 10)) < 22 && Math.abs(py * H - (y + 10)) < 22;
    return near ? truth(i) : null;
  };

  it('follows a moving subject both ways from the frame it was shown on', async () => {
    const calls: ObjectPrompt[] = [];
    const first = at(20);
    const masks = await cutOut({ n: N, start: 20, prompt: { points: [[(first[0] + 10) / W, (first[1] + 10) / H, 1]] }, w: W, h: H, segment: model(() => false, calls) });
    expect(masks.length).toBe(N);
    for (let i = 0; i < N; i++) expect(iou(masks[i], truth(i))).toBeGreaterThan(0.95);
    // each frame after the first was given the one before it as a hint (its box and its middle)
    expect(calls.slice(1).every((c) => c.box && c.points.length >= 1)).toBe(true);
  });

  it('reports progress and stops when asked', async () => {
    const seen: number[] = [];
    let stop = false;
    const first = at(0);
    const masks = await cutOut({ n: N, start: 0, prompt: { points: [[(first[0] + 10) / W, (first[1] + 10) / H, 1]] }, w: W, h: H, segment: model(), onFrame: (d) => (seen.push(d), d >= 10 && (stop = true)), cancelled: () => stop });
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBeLessThan(N);
    // what was reached is kept, the rest is black
    expect(iou(masks[5], truth(5))).toBeGreaterThan(0.95);
    expect(masks[N - 1].every((v) => v === 0)).toBe(true);
  });

  it('gets the subject back after it is lost for a few frames, with the box tracker as the hint', async () => {
    // a textured square on a plain background, so the tracker has something to follow
    const frames: Uint8Array[] = [];
    for (let i = 0; i < N; i++) {
      const f = new Uint8Array(W * H).fill(40);
      const [x, y] = at(i);
      for (let j = 0; j < 20; j++) for (let k = 0; k < 20; k++) f[(y + j) * W + x + k] = 120 + (((j * 7 + k * 13) ^ (j * k)) % 120);
      frames.push(f);
    }
    const g: Gray = { w: W, h: H, frames };
    const [x0, y0] = at(0);
    const path = trackBox(g, 0, x0 + 10, y0 + 10, 20, 20, 1);
    expect(path.length).toBeGreaterThan(N - 3);
    const recover = (i: number): [number, number, number, number] | null => {
      const p = path.find((q) => q[0] === i);
      return p ? [(p[1] - 10) / W, (p[2] - 10) / H, (p[1] + 10) / W, (p[2] + 10) / H] : null;
    };
    // frames 12..16 the model finds nothing (something is in the way)
    const hidden = (i: number) => i >= 12 && i <= 16;
    const masks = await cutOut({ n: N, start: 0, prompt: { points: [[(x0 + 10) / W, (y0 + 10) / H, 1]] }, w: W, h: H, segment: model(hidden), recover });
    for (let i = 0; i < N; i++) {
      if (hidden(i)) expect(masks[i].every((v) => v === 0)).toBe(true);
      else expect(iou(masks[i], truth(i))).toBeGreaterThan(0.9);
    }
  });

  it('gives up on the rest when the subject is lost for good, and says nothing for frames it never saw', async () => {
    const first = at(5);
    const masks = await cutOut({ n: N, start: 5, prompt: { points: [[(first[0] + 10) / W, (first[1] + 10) / H, 1]] }, w: W, h: H, segment: model((i) => i > 15), maxLost: 4 });
    expect(iou(masks[15], truth(15))).toBeGreaterThan(0.95);
    expect(masks[30].every((v) => v === 0)).toBe(true);
  });
});

describe('a matte between frames of a moving subject', () => {
  const w = 120;
  const h = 80;
  it('puts the subject in between, not two half-strength copies', () => {
    const a = square(20, 30, 20, w, h);
    const b = square(50, 30, 20, w, h);
    const mid = matteAt({ from: 0, to: 1, fps: 1, w, h }, [a, b], 0.5)!;
    expect(iou(mid, square(35, 30, 20, w, h))).toBeGreaterThan(0.9);
    // and at a quarter of the way
    const q = matteAt({ from: 0, to: 1, fps: 1, w, h }, [a, b], 0.25)!;
    expect(iou(q, square(28, 30, 20, w, h))).toBeGreaterThan(0.85);
    // no half-grey strips: every pixel is nearly black or white
    expect([...mid].filter((v) => v > 40 && v < 215).length).toBeLessThan(40);
  });
  it('blends as it is when the subject jumps, appears or vanishes', () => {
    const a = square(5, 30, 20, w, h);
    const far = square(95, 30, 20, w, h);
    const m = matteAt({ from: 0, to: 1, fps: 1, w, h }, [a, far], 0.5)!;
    expect(m[35 * w + 15]).toBeGreaterThan(100);
    expect(m[35 * w + 15]).toBeLessThan(150);
    const none = new Uint8Array(w * h);
    const appear = matteAt({ from: 0, to: 1, fps: 1, w, h }, [none, a], 0.5)!;
    expect(appear[35 * w + 15]).toBeGreaterThan(120);
    expect(appear[35 * w + 15]).toBeLessThan(135);
  });
});
