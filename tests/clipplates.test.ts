import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { prepArgs, segmentArgs, segmentKey, type ClipPlates } from '../src/engine/args';
import { canvasZoomAt, canvasZoomKeys, type Canvas } from '../src/engine/canvas';
import { framesFromAvi } from '../src/engine/mosh';
import { segments } from '../src/engine/timeline';
import { newProject, type Project } from '../src/engine/types';

const d = hasFfmpeg ? describe : describe.skip;
const W = 32;
const H = 24;

function rgb(dir: string, file: string): Uint8Array[] {
  ff(dir, ['-i', file, '-vf', `scale=${W}:${H}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', file + '.rgb']);
  const b = new Uint8Array(fs.readFileSync(path.join(dir, file + '.rgb')));
  const out: Uint8Array[] = [];
  for (let o = 0; o + W * H * 3 <= b.length; o += W * H * 3) out.push(b.subarray(o, o + W * H * 3));
  return out;
}
/** the colour at a point (shares of the tiny frame) */
const at = (f: Uint8Array, x: number, y: number) => [0, 1, 2].map((c) => f[(Math.min(H - 1, Math.floor(y * H)) * W + Math.min(W - 1, Math.floor(x * W))) * 3 + c]);

d('a card and a mask on a clip, in the filter graph', () => {
  let dir: string;
  const grey = fileMedia('grey', 'mp4', { hasAudio: false });
  const red = fileMedia('red', 'mp4', { hasAudio: false });
  beforeAll(() => {
    dir = tmpdir();
    for (const [n, c] of [['grey', 'gray'], ['red', 'red']]) ff(dir, ['-f', 'lavfi', '-i', `color=c=${c}:s=320x240:r=25:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${n}.mp4`]);
    place(dir, 'grey.mp4', grey);
    place(dir, 'red.mp4', red);
    // the paper behind: a blue picture the size of the frame
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1,format=rgba', '-frames:v', '1', 'back.png']);
    // a static mask: a white disc of radius 60 in the middle
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1', '-vf', "geq=lum='if(lt(hypot(X-160,Y-120),60),255,0)':cb=128:cr=128,format=gray", '-frames:v', '1', 'mask.png']);
    // a mask that grows: radius 20 for the first second, 100 for the second
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=25:d=2', '-vf', "geq=lum='if(lt(hypot(X-160,Y-120),20+80*floor(T)),255,0)':cb=128:cr=128,format=gray", '-f', 'image2pipe', '-c:v', 'png', 'grow.pngs']);
  });
  const proj = (): Project => {
    const p = newProject();
    p.encoder.fps = 25;
    p.encoder.width = 320;
    p.encoder.quality = 2;
    p.media = [grey, red];
    p.tracks.push({ id: 'v2', kind: 'video', name: 'Video 2', muted: false, solo: false, volume: 1, mosh: true });
    p.clips = [clipOf(grey, { id: 'main' }), clipOf(red, { id: 'over', track: 'v2', start: 0 })];
    return p;
  };
  const render = (plates: ClipPlates[], name: string) => {
    ff(dir, prepArgs(proj(), 320, name, undefined, [], undefined, [], plates));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, name))), 'mpeg4').frames.length).toBe(50);
    return rgb(dir, name);
  };
  const red_ = (c: number[]) => c[0] > 200 && c[1] < 60 && c[2] < 60;
  const blue_ = (c: number[]) => c[2] > 200 && c[0] < 60 && c[1] < 60;
  const grey_ = (c: number[]) => Math.abs(c[0] - c[1]) < 25 && Math.abs(c[1] - c[2]) < 25 && c[0] > 90 && c[0] < 170;

  it('is plain without plates', () => {
    const f = render([], 'plain.avi');
    expect(red_(at(f[5], 0.5, 0.5)) && red_(at(f[5], 0.05, 0.05))).toBe(true);
  });
  it('shows the picture only where the mask is white, and what is below elsewhere', () => {
    const f = render([{ clipId: 'over', mask: 'mask.png' }], 'masked.avi');
    expect(red_(at(f[5], 0.5, 0.5))).toBe(true);
    expect(grey_(at(f[5], 0.05, 0.05))).toBe(true);
    expect(grey_(at(f[5], 0.95, 0.9))).toBe(true);
  });
  it('puts the paper behind the picture, so it shows where the mask is not', () => {
    const f = render([{ clipId: 'over', mask: 'mask.png', back: 'back.png' }], 'card.avi');
    expect(red_(at(f[5], 0.5, 0.5))).toBe(true);
    expect(blue_(at(f[5], 0.05, 0.05))).toBe(true);
  });
  it('follows a mask that changes over the clip, frame by frame', () => {
    const plates: ClipPlates[] = [{ clipId: 'over', mask: 'grow.pngs', maskFrames: 50, back: 'back.png' }];
    const f = render(plates, 'grow.avi');
    // early: the disc is small (radius 20 of 320 → 2 px of the tiny frame): a point 0.25 across is outside it
    expect(blue_(at(f[5], 0.75, 0.5))).toBe(true);
    expect(red_(at(f[5], 0.5, 0.5))).toBe(true);
    // late: radius 100 (10 px): 0.75 across is 80 px from the middle, inside
    expect(red_(at(f[40], 0.75, 0.5))).toBe(true);
  });
  it('is the same when the timeline is prepared one segment at a time', () => {
    const p = proj();
    const [seg] = segments(p, 25);
    ff(dir, segmentArgs(p, seg, 320, 'seg.avi', undefined, [], undefined, [], [{ clipId: 'over', mask: 'grow.pngs', maskFrames: 50, back: 'back.png' }]));
    const f = rgb(dir, 'seg.avi');
    expect(blue_(at(f[5], 0.75, 0.5))).toBe(true);
    expect(red_(at(f[40], 0.75, 0.5))).toBe(true);
  });
  it('is a different prepared picture with a card or a mask (so the cache re-prepares it)', () => {
    const a = proj();
    const b = proj();
    b.clips[1].mask = { shape: 'circle', size: 1, x: 0.5, y: 0.5 };
    const [sa] = segments(a, 25);
    const [sb] = segments(b, 25);
    expect(segmentKey(a, sa, 320)).not.toBe(segmentKey(b, sb, 320));
    b.clips[1].card = { border: 0.02, borderColor: '#fff', radius: 0.1, shadow: 0.4 };
    const c = segmentKey(b, segments(b, 25)[0], 320);
    expect(c).not.toBe(segmentKey(a, sa, 320));
  });
});

describe('a camera move into the card', () => {
  const canvas: Canvas = { bg: 'color', color: '#222222', inset: 0.2, radius: 0, zoomIn: { at: 1, dur: 2 } };
  it('does not move before it starts, and zooms to the card filling the frame by its end', () => {
    expect(canvasZoomAt(canvas, 1600, 900, 0.5).z).toBe(1);
    expect(canvasZoomAt(canvas, 1600, 900, 1).z).toBe(1);
    const mid = canvasZoomAt(canvas, 1600, 900, 2).z;
    const end = canvasZoomAt(canvas, 1600, 900, 3);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(end.z);
    // the card is inset 0.2 of the shorter side (180 px each way): it is 540 tall, so filling the frame is 900 / 540
    expect(end.z).toBeCloseTo(900 / 540, 2);
    expect(canvasZoomAt(canvas, 1600, 900, 30).z).toBeCloseTo(end.z, 6);
    // the card is in the middle, so the zoom is towards the middle
    expect(end.cx).toBeCloseTo(0.5, 3);
    expect(end.cy).toBeCloseTo(0.5, 3);
  });
  it('can go further than the card, and a canvas without a move does not zoom', () => {
    expect(canvasZoomAt({ ...canvas, zoomIn: { at: 0, dur: 1, to: 3 } }, 1600, 900, 5).z).toBe(3);
    expect(canvasZoomAt({ ...canvas, zoomIn: undefined }, 1600, 900, 5).z).toBe(1);
    expect(canvasZoomAt(undefined, 1600, 900, 5).z).toBe(1);
  });
  it('turns into keys for the render: one a frame while it moves, one at each end otherwise', () => {
    const k = canvasZoomKeys(canvas, 1600, 900, 25, 0, 4)!;
    // 2 s of motion at 25 fps, plus the ends
    expect(k.zoom.length).toBeGreaterThan(50);
    expect(k.zoom.length).toBeLessThan(60);
    expect(k.zoom[0]).toEqual([0, 1, 0]);
    expect(k.zoom.at(-1)![0]).toBe(4);
    expect(k.zoom.at(-1)![1]).toBeCloseTo(900 / 540, 3);
    // a centred card needs no sideways move
    expect(Math.max(...k.x.map((p) => Math.abs(p[1])))).toBeLessThan(0.002);
    // a stretch that ends before the move starts, or after it is over, is not a move at the start/is steady
    expect(canvasZoomKeys(canvas, 1600, 900, 25, 0, 0.9)).toBeNull();
    const after = canvasZoomKeys(canvas, 1600, 900, 25, 5, 8)!;
    expect(after.zoom.every((p) => Math.abs(p[1] - 900 / 540) < 1e-3)).toBe(true);
    expect(after.zoom.length).toBeLessThan(5);
  });
  it('zooms towards a card that is not in the middle', () => {
    const low: Canvas = { ...canvas, shift: 0.1 };
    const end = canvasZoomAt(low, 1600, 900, 3);
    expect(end.cy).toBeGreaterThan(0.55);
    const k = canvasZoomKeys(low, 1600, 900, 25, 0, 4)!;
    // the picture slides up as it zooms, so the card's middle stays where it was heading
    expect(k.y.at(-1)![1]).toBeLessThan(0);
  });
});
