import { describe, expect, it } from 'vitest';
import { analyseReference, colourStats, cutsAgainstBeats, detectBorders, detectCuts, effectiveFps, frameChanges, labToRgb, palette, rgbToLab, shotStats, stealPlan, textDensity, transferLut, type RGBFrames } from '../src/engine/steal';
import { sampleLut } from '../src/engine/lut';
import type { Gray } from '../src/engine/track';

const W = 96;
const H = 54;
const FPS = 24;
const OFFSETS = [0, 40, -30, 25, -20, 35];

/** A frame of shot `s`: a smooth pattern that is different in every shot and drifts by 2 px each time `k` steps (`hold` frames per step). */
function shotFrame(s: number, k: number, hold = 1): Uint8Array {
  const f = new Uint8Array(W * H);
  const shift = 2 * Math.floor(k / hold);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = 128 + OFFSETS[s % 6] + 40 * Math.sin((x + shift) * 0.13 + s * 1.7) * Math.cos(y * 0.11 + s) + 20 * Math.sin((x + shift) * 0.05 + y * 0.07 + s * 2.3);
      f[y * W + x] = Math.max(0, Math.min(255, v));
    }
  return f;
}

/** The reference: shots cut at `cuts` (seconds), `seconds` long, with `hold` frames per change. */
function reference(cuts: number[], seconds: number, hold = 1): Gray {
  const edges = [0, ...cuts, seconds];
  const frames: Uint8Array[] = [];
  for (let i = 0; i < Math.round(seconds * FPS); i++) {
    const t = i / FPS;
    const s = edges.findIndex((e, j) => t >= e - 1e-9 && t < edges[j + 1] - 1e-9);
    frames.push(shotFrame(s, i - Math.round(edges[s] * FPS), hold));
  }
  return { w: W, h: H, frames };
}

const CUTS = [1.0, 2.5, 3.0, 4.5, 5.0];

describe('cuts and shots', () => {
  const g = reference(CUTS, 6);
  it('finds where the reference cuts', () => {
    const found = detectCuts(g, FPS);
    expect(found.length).toBe(5);
    found.forEach((c, i) => expect(Math.abs(c - CUTS[i])).toBeLessThan(1.5 / FPS));
  });
  it('finds none in one shot that keeps moving', () => {
    expect(detectCuts(reference([], 4), FPS)).toEqual([]);
  });
  it('measures the change from frame to frame', () => {
    const d = frameChanges(g);
    expect(d.length).toBe(g.frames.length - 1);
    // a cut is far bigger than the drift inside a shot
    const cutFrame = Math.round(1.0 * FPS) - 1;
    expect(d[cutFrame]).toBeGreaterThan(d[cutFrame + 3] * 4);
  });
  it('reports the shot lengths', () => {
    const s = shotStats(CUTS, 6);
    expect(s.lengths).toEqual([1, 1.5, 0.5, 1.5, 0.5, 1]);
    expect(s.count).toBe(6);
    expect(s.median).toBe(1);
    expect(s.min).toBe(0.5);
    expect(s.max).toBe(1.5);
  });
  it('is not fooled by two cuts a frame or two apart: it keeps the bigger', () => {
    const f = reference([1.0, 1.0 + 2 / FPS], 3);
    const found = detectCuts(f, FPS);
    expect(found.length).toBe(1);
  });
});

describe('cuts against the beat', () => {
  const beats = Array.from({ length: 14 }, (_, i) => i * 0.5);
  it('says how many cuts land on a beat and how many beats a shot lasts', () => {
    const fit = cutsAgainstBeats(CUTS, beats)!;
    expect(fit.bpm).toBe(120);
    expect(fit.onBeat).toBe(1);
    expect(fit.every).toBe(2);
    expect(fit.offset).toBe(0);
  });
  it('says so when the cuts miss the beat', () => {
    const fit = cutsAgainstBeats(CUTS.map((c) => c + 0.2), beats)!;
    expect(fit.onBeat).toBe(0);
    expect(fit.offset).toBeCloseTo(0.2, 2);
  });
  it('snaps quick cutting to quarter beats', () => {
    const quick = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
    expect(cutsAgainstBeats(quick, beats)!.every).toBe(0.5);
  });
  it('needs beats to say anything', () => {
    expect(cutsAgainstBeats(CUTS, [])).toBeNull();
    expect(cutsAgainstBeats([], beats)).toBeNull();
  });
});

describe('the frame rate it really has', () => {
  it('sees 24 pictures a second in plain footage', () => {
    const e = effectiveFps(reference([], 4, 1), FPS);
    expect(e.fps).toBeCloseTo(24, 0);
    expect(e.stepFps).toBeUndefined();
  });
  it('sees a 12 fps step print played at 24, between the cuts too', () => {
    const g = reference([1.5, 3], 4.5, 2);
    const e = effectiveFps(g, FPS, detectCuts(g, FPS));
    expect(e.fps).toBeCloseTo(12, 0);
    expect(e.stepFps).toBe(12);
    expect(e.repeated).toBeGreaterThan(0.4);
  });
  it('sees an 8 fps step print too', () => {
    const e = effectiveFps(reference([], 4, 3), FPS);
    expect(e.stepFps).toBe(8);
  });
  it('does not call stillness a step print', () => {
    const still: Gray = { w: W, h: H, frames: Array.from({ length: 48 }, () => shotFrame(0, 0)) };
    const e = effectiveFps(still, FPS);
    expect(e.stepFps).toBeUndefined();
    expect(e.fps).toBe(24);
  });
});

/** RGB frames of one flat colour, or a picture of flat bands. */
function flat(w: number, h: number, n: number, colour: (x: number, y: number, k: number) => number[]): RGBFrames {
  return { w, h, frames: Array.from({ length: n }, (_, k) => { const f = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f.set(colour(x, y, k), (y * w + x) * 3); return f; }) };
}

describe('colour', () => {
  it('goes to Lab and back', () => {
    for (const c of [[0.2, 0.5, 0.8], [1, 0, 0], [0.5, 0.5, 0.5], [0.9, 0.8, 0.1]] as [number, number, number][]) {
      const back = labToRgb(...rgbToLab(...c));
      c.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 2));
    }
    expect(rgbToLab(1, 1, 1)[0]).toBeCloseTo(100, 0);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });
  it('measures the cast of a picture', () => {
    const neutral = colourStats(flat(8, 8, 4, () => [128, 128, 128]));
    const orange = colourStats(flat(8, 8, 4, () => [200, 130, 60]));
    expect(Math.abs(neutral.mean[1])).toBeLessThan(1);
    expect(orange.mean[1]).toBeGreaterThan(10);
    expect(orange.mean[2]).toBeGreaterThan(25);
  });
  it('builds a LUT that gives neutral footage the reference’s cast', () => {
    const ref = colourStats(flat(8, 8, 4, (x) => (x < 4 ? [210, 140, 70] : [160, 100, 50])));
    const mine = colourStats(flat(8, 8, 4, (x) => (x < 4 ? [140, 140, 140] : [100, 100, 100])));
    const lut = transferLut(mine, ref, 9);
    const out: number[] = [0, 0, 0];
    sampleLut(lut, 0.5, 0.5, 0.5, out);
    // grey comes out warm: more red than blue
    expect(out[0] - out[2]).toBeGreaterThan(0.12);
    // black stays dark, white stays light
    sampleLut(lut, 0, 0, 0, out);
    expect(Math.max(...out)).toBeLessThan(0.35);
    sampleLut(lut, 1, 1, 1, out);
    expect(Math.max(...out)).toBeGreaterThan(0.6);
  });
  it('mixes with no change as much as asked', () => {
    const ref = colourStats(flat(8, 8, 2, () => [210, 140, 70]));
    const mine = colourStats(flat(8, 8, 2, () => [128, 128, 128]));
    const half = transferLut(mine, ref, 5, 0);
    const out: number[] = [0, 0, 0];
    sampleLut(half, 0.3, 0.6, 0.9, out);
    expect(out[0]).toBeCloseTo(0.3, 3);
    expect(out[1]).toBeCloseTo(0.6, 3);
    expect(out[2]).toBeCloseTo(0.9, 3);
  });
  it('finds the main colours and how much of the picture each is', () => {
    const p = palette(flat(20, 10, 4, (x) => (x < 14 ? [220, 40, 60] : [20, 30, 200])), 2);
    expect(p.length).toBe(2);
    expect(p[0].share).toBeCloseTo(0.7, 1);
    expect(p[0].hex).toBe('#dc283c');
    expect(p[1].hex).toBe('#141ec8');
  });
});

describe('bars and cards', () => {
  const picture = (k: number) => (x: number, y: number) => [(x * 5 + y * 3 + k * 40) % 220 + 20, (x * 2 + y * 7 + k * 20) % 200 + 30, (x * 9 + y * 2) % 180 + 40];
  it('finds black bars above and below', () => {
    const frames = flat(60, 40, 6, (x, y, k) => (y < 5 || y >= 35 ? [0, 0, 0] : picture(k)(x, y)));
    const b = detectBorders(frames)!;
    expect(b.top).toBeCloseTo(5 / 40, 3);
    expect(b.bottom).toBeCloseTo(5 / 40, 3);
    expect(b.left).toBe(0);
    expect(b.right).toBe(0);
    expect(b.colour).toBe('#000000');
  });
  it('finds a card on a coloured backdrop, all round', () => {
    const frames = flat(60, 40, 6, (x, y, k) => (x < 6 || x >= 54 || y < 4 || y >= 36 ? [255, 209, 232] : picture(k)(x, y)));
    const b = detectBorders(frames)!;
    expect(b.left).toBeCloseTo(6 / 60, 3);
    expect(b.right).toBeCloseTo(6 / 60, 3);
    expect(b.top).toBeCloseTo(4 / 40, 3);
    expect(b.colour).toBe('#ffd1e8');
  });
  it('finds nothing in plain footage, or when a dark shot only sometimes has a dark top', () => {
    expect(detectBorders(flat(60, 40, 6, (x, y, k) => picture(k)(x, y)))).toBeNull();
    // dark at the top in some frames only is a dark scene, not a bar
    expect(detectBorders(flat(60, 40, 6, (x, y, k) => (y < 5 && k % 2 ? [0, 0, 0] : picture(k)(x, y))))).toBeNull();
  });
});

describe('text', () => {
  /** rows of small hard-edged marks, like lines of letters, in the lower part of the picture */
  const texty = (rowsFrom: number, rowsTo: number): Gray => ({
    w: W,
    h: H,
    frames: Array.from({ length: 8 }, () => {
      const f = new Uint8Array(W * H).fill(20);
      for (let y = rowsFrom; y < rowsTo; y++) for (let x = 4; x < W - 4; x++) if (y % 6 < 4 && Math.floor(x / 3) % 2 === 0 && (x * 7 + y * 3) % 5 !== 0) f[y * W + x] = 230;
      return f;
    }),
  });
  it('finds lines of letters, and where they are', () => {
    const bottom = textDensity(texty(36, 52));
    expect(bottom.density).toBeGreaterThan(0.05);
    expect(bottom.where).toBe('bottom');
    expect(textDensity(texty(2, 18)).where).toBe('top');
  });
  it('finds none in a flat picture or in a smooth one', () => {
    expect(textDensity({ w: W, h: H, frames: [new Uint8Array(W * H).fill(90)] }).density).toBe(0);
    expect(textDensity({ w: W, h: H, frames: [shotFrame(2, 0)] }).density).toBeLessThan(0.01);
  });
  it('does not take random texture for text', () => {
    let a = 11;
    const noise = new Uint8Array(W * H).map(() => ((a = (a * 1664525 + 1013904223) >>> 0) >>> 24));
    expect(textDensity({ w: W, h: H, frames: [noise] }).density).toBeLessThan(0.02);
  });
});

describe('measuring a whole reference and planning from it', () => {
  const beats = Array.from({ length: 14 }, (_, i) => i * 0.5);
  const gray = reference(CUTS, 6, 2);
  const rgb = flat(W, H, 12, (x, y) => (y < 6 || y >= H - 6 ? [0, 0, 0] : [190, 130, 70]));
  const r = analyseReference({ gray, rgb, fps: FPS, duration: 6, beats });
  it('puts every measure together', () => {
    expect(r.cuts.length).toBe(5);
    expect(r.shots.count).toBe(6);
    expect(r.beat!.onBeat).toBe(1);
    expect(r.effective.stepFps).toBe(12);
    expect(r.borders!.top).toBeGreaterThan(0.1);
    expect(r.palette[0].share).toBeGreaterThan(0.5);
    expect(r.colour.mean[1]).toBeGreaterThan(0);
  });
  it('plans shots that fill the user’s footage, repeating the rhythm', () => {
    const plan = stealPlan(r, 10);
    expect(plan.shots.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 2);
    expect(plan.shots.slice(0, 6)).toEqual([1, 1.5, 0.5, 1.5, 0.5, 1]);
    expect(plan.shots.slice(6, 8)).toEqual([1, 1.5]);
    expect(plan.stepFps).toBe(12);
    expect(plan.card!.colour).toBe('#000000');
    expect(plan.card!.inset).toBeCloseTo(6 / H, 2);
  });
  it('lands the shots on whole beats of the user’s music when the reference cut on its beat', () => {
    const plan = stealPlan(r, 8, { beatPeriod: 0.4 });
    // 1, 1.5, 0.5 … become multiples of 0.4 s
    for (const s of plan.shots.slice(0, -1)) expect(Math.abs(s / 0.4 - Math.round(s / 0.4))).toBeLessThan(0.01);
  });
  it('is gentle with what it did not find', () => {
    const none = analyseReference({ gray: reference([], 3), rgb: flat(W, H, 6, () => [120, 120, 120]), fps: FPS, duration: 3 });
    const plan = stealPlan(none, 5);
    expect(plan.card).toBeUndefined();
    expect(plan.stepFps).toBeUndefined();
    expect(plan.shots.length).toBeGreaterThan(0);
    expect(plan.shots.reduce((s, v) => s + v, 0)).toBeCloseTo(5, 2);
  });
});
