import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { prepArgs, segmentArgs } from '../src/engine/args';
import { framesFromAvi } from '../src/engine/mosh';
import { segments, timelineDuration, insertFreeze, rollEdit, slipClip, rippleDelete, clipLen, layoutVideo } from '../src/engine/timeline';
import { newProject, type Clip, type Project } from '../src/engine/types';

const d = hasFfmpeg ? describe : describe.skip;
const W = 32;
const H = 24;

/** Decode an AVI to tiny RGB frames. */
function rgb(dir: string, file: string): Uint8Array[] {
  ff(dir, ['-i', file, '-vf', `scale=${W}:${H}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', file + '.rgb']);
  const b = new Uint8Array(fs.readFileSync(path.join(dir, file + '.rgb')));
  const out: Uint8Array[] = [];
  for (let o = 0; o + W * H * 3 <= b.length; o += W * H * 3) out.push(b.subarray(o, o + W * H * 3));
  return out;
}
const mean = (f: Uint8Array) => f.reduce((s, v) => s + v, 0) / f.length;
/** mean of channel c (0 r, 1 g, 2 b) in a box of the tiny frame, as fractions */
function box(f: Uint8Array, c: number, x0: number, y0: number, x1: number, y1: number) {
  let s = 0;
  let n = 0;
  for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.ceil(x1 * W); x++) (s += f[(y * W + x) * 3 + c]), n++;
  return s / n;
}

d('compositing, transforms and colour', () => {
  let dir: string;
  const red = fileMedia('red', 'mp4', { hasAudio: false });
  const blue = fileMedia('blue', 'mp4', { hasAudio: false });
  const grey = fileMedia('grey', 'mp4', { hasAudio: false });
  beforeAll(() => {
    dir = tmpdir();
    for (const [n, c] of [['red', 'red'], ['blue', 'blue'], ['grey', 'gray']]) ff(dir, ['-f', 'lavfi', '-i', `color=c=${c}:s=320x240:r=25:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${n}.mp4`]);
    place(dir, 'red.mp4', red);
    place(dir, 'blue.mp4', blue);
    place(dir, 'grey.mp4', grey);
  });
  const proj = (clips: Clip[]): Project => {
    const p = newProject();
    p.encoder.fps = 25;
    p.encoder.width = 320;
    p.encoder.quality = 2;
    p.media = [red, blue, grey];
    p.tracks.push({ id: 'v2', kind: 'video', name: 'Video 2', muted: false, solo: false, volume: 1, mosh: true });
    p.clips = clips;
    return p;
  };
  const prep = (p: Project, name: string) => {
    ff(dir, prepArgs(p, 320, name));
    const fr = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, name))), 'mpeg4');
    expect(fr.frames.length).toBe(Math.round(timelineDuration(p) * 25));
    return rgb(dir, name);
  };

  it('upper tracks draw on top, moved and scaled', () => {
    const p = proj([clipOf(red), clipOf(blue, { track: 'v2', start: 0.5, out: 1, transform: { zoom: 0.5, x: 0.25, y: 0 } })]);
    const f = prep(p, 'ov.avi');
    // before the layer: all red
    expect(box(f[5], 0, 0, 0, 1, 1)).toBeGreaterThan(200);
    // during: right half has a blue square, left half still red
    expect(box(f[30], 2, 0.6, 0.35, 0.9, 0.65)).toBeGreaterThan(180);
    expect(box(f[30], 0, 0.05, 0.1, 0.4, 0.9)).toBeGreaterThan(200);
    // after it ends: red again
    expect(box(f[45], 0, 0.6, 0.35, 0.9, 0.65)).toBeGreaterThan(200);
  });

  it('opacity and blend modes', () => {
    const half = prep(proj([clipOf(red), clipOf(blue, { track: 'v2', start: 0, out: 2, opacity: 0.5 })]), 'op.avi')[10];
    expect(box(half, 0, 0.2, 0.2, 0.8, 0.8)).toBeGreaterThan(90);
    expect(box(half, 2, 0.2, 0.2, 0.8, 0.8)).toBeGreaterThan(90);
    const scr = prep(proj([clipOf(red), clipOf(blue, { track: 'v2', start: 0, out: 2, blend: 'screen' })]), 'scr.avi')[10];
    // red screen blue = magenta
    expect(box(scr, 0, 0.2, 0.2, 0.8, 0.8)).toBeGreaterThan(200);
    expect(box(scr, 2, 0.2, 0.2, 0.8, 0.8)).toBeGreaterThan(200);
    const mul = prep(proj([clipOf(red), clipOf(blue, { track: 'v2', start: 0, out: 2, blend: 'multiply' })]), 'mul.avi')[10];
    expect(mean(mul)).toBeLessThan(30);
  });

  it('the other blend modes', () => {
    const over = (blend: Clip['blend'], base = red, top = blue) => prep(proj([clipOf(base), clipOf(top, { track: 'v2', start: 0, out: 2, blend })]), `bl_${blend}.avi`)[10];
    const rgbOf = (f: Uint8Array) => [0, 1, 2].map((c) => box(f, c, 0.2, 0.2, 0.8, 0.8));
    // lighten red and blue: both lit; darken: neither
    const [lr, , lb] = rgbOf(over('lighten'));
    expect(lr > 200 && lb > 200).toBe(true);
    expect(mean(over('darken'))).toBeLessThan(30);
    // exclusion of red and blue: magenta, like difference
    const [er, , eb] = rgbOf(over('exclusion'));
    expect(er > 200 && eb > 200).toBe(true);
    // overlay of grey on red keeps it red (mid grey disappears)
    const [or, og, ob] = rgbOf(over('overlay', red, grey));
    expect(or).toBeGreaterThan(180);
    expect(og + ob).toBeLessThan(80);
    for (const b of ['softlight', 'hardlight', 'dodge', 'burn'] as const) expect(over(b).length).toBeGreaterThan(0);
  });

  it('hidden tracks and disabled clips', () => {
    const p = proj([clipOf(red), clipOf(blue, { track: 'v2', start: 0, out: 2 })]);
    p.tracks.find((t) => t.id === 'v2')!.muted = true;
    expect(box(prep(p, 'hid.avi')[10], 0, 0, 0, 1, 1)).toBeGreaterThan(200);
    const q = proj([clipOf(red, { enabled: false }), clipOf(blue)]);
    const f = prep(q, 'dis.avi');
    expect(mean(f[10])).toBeLessThan(25);
    expect(box(f[60], 2, 0, 0, 1, 1)).toBeGreaterThan(180);
  });

  it('colour grade, crop, flip, rotate and fades', () => {
    const g = prep(proj([clipOf(grey, { grade: { brightness: 0.3 } })]), 'gr.avi')[10];
    const base = prep(proj([clipOf(grey)]), 'base.avi')[10];
    expect(mean(g)).toBeGreaterThan(mean(base) + 50);
    const sat = prep(proj([clipOf(red, { grade: { saturation: 0 } })]), 'sat.avi')[10];
    expect(Math.abs(box(sat, 0, 0.2, 0.2, 0.8, 0.8) - box(sat, 2, 0.2, 0.2, 0.8, 0.8))).toBeLessThan(12);
    const crop = prep(proj([clipOf(red, { transform: { cropL: 0.5 } })]), 'crop.avi')[10];
    expect(box(crop, 0, 0, 0, 0.45, 1)).toBeLessThan(25);
    expect(box(crop, 0, 0.55, 0, 1, 1)).toBeGreaterThan(200);
    const rot = prep(proj([clipOf(red, { transform: { rotate: 45, zoom: 0.5 } })]), 'rot.avi')[10];
    expect(box(rot, 0, 0, 0, 0.1, 0.1)).toBeLessThan(25);
    expect(box(rot, 0, 0.45, 0.45, 0.55, 0.55)).toBeGreaterThan(200);
    const fade = prep(proj([clipOf(red, { vfadeIn: 1, vfadeOut: 0.5 })]), 'fade.avi');
    expect(mean(fade[0])).toBeLessThan(20);
    expect(box(fade[12], 0, 0, 0, 1, 1)).toBeGreaterThan(100);
    expect(box(fade[12], 0, 0, 0, 1, 1)).toBeLessThan(170);
    expect(box(fade[35], 0, 0, 0, 1, 1)).toBeGreaterThan(200);
    expect(mean(fade[49])).toBeLessThan(30);
  });

  it('freeze frames and edits keep exact lengths', () => {
    const p = proj([clipOf(red), clipOf(blue)]);
    const f = insertFreeze(p, p.clips[0].id, 1, 1.5)!;
    expect(f.freeze).toBe(true);
    expect(layoutVideo(p).map((pl) => pl.clip.freeze ?? false)).toEqual([false, true, false, false]);
    expect(timelineDuration(p)).toBeCloseTo(5.5, 5);
    prep(p, 'frz.avi');
    for (const sg of segments(p, 25)) ff(dir, segmentArgs(p, sg, 320, 'seg.avi'));
  });
});

describe('trim tools', () => {
  const media = fileMedia('m', 'mp4', { duration: 10 });
  const base = () => {
    const p = newProject();
    p.media = [media];
    p.clips = [clipOf(media, { in: 2, out: 4 }), clipOf(media, { in: 6, out: 8 })];
    return p;
  };
  it('roll moves the cut without changing the total', () => {
    const p = base();
    const [a, b] = p.clips.map((c) => ({ ...c }));
    rollEdit(p, a.id, b.id, 0.5, a, b);
    expect(p.clips[0].out).toBeCloseTo(4.5);
    expect(p.clips[1].in).toBeCloseTo(6.5);
    expect(timelineDuration(p)).toBeCloseTo(4);
    // limited by the media: the second clip can't start before 0
    rollEdit(p, a.id, b.id, -10, a, b);
    expect(clipLen(p.clips[0])).toBeCloseTo(0.1);
    expect(timelineDuration(p)).toBeCloseTo(4);
  });
  it('slip shows other footage in the same place', () => {
    const p = base();
    const o = { ...p.clips[0] };
    slipClip(p, o.id, -1, o);
    expect([p.clips[0].in, p.clips[0].out]).toEqual([3, 5]);
    slipClip(p, o.id, 100, o);
    expect(p.clips[0].in).toBe(0);
    expect(clipLen(p.clips[0])).toBeCloseTo(2);
  });
  it('ripple delete closes gaps on free tracks', () => {
    const p = base();
    const a1 = clipOf(media, { track: 'a1', start: 0, out: 1 });
    const a2 = clipOf(media, { track: 'a1', start: 3, out: 1 });
    p.clips.push(a1, a2);
    rippleDelete(p, [a1.id]);
    expect(p.clips.find((c) => c.id === a2.id)!.start).toBeCloseTo(2);
  });
});
