import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { prepArgs, segmentArgs, segmentKey, type ClipMatte } from '../src/engine/args';
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
/** mean of channel c in a box of the tiny frame (as fractions) */
function box(f: Uint8Array, c: number, x0: number, y0: number, x1: number, y1: number) {
  let s = 0;
  let n = 0;
  for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) for (let x = Math.floor(x0 * W); x < Math.ceil(x1 * W); x++) (s += f[(y * W + x) * 3 + c]), n++;
  return s / n;
}

d('a clip that goes behind the subject', () => {
  let dir: string;
  const red = fileMedia('red', 'mp4', { hasAudio: false });
  const blue = fileMedia('blue', 'mp4', { hasAudio: false });
  beforeAll(() => {
    dir = tmpdir();
    for (const [n, c] of [['red', 'red'], ['blue', 'blue']]) ff(dir, ['-f', 'lavfi', '-i', `color=c=${c}:s=320x240:r=25:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${n}.mp4`]);
    place(dir, 'red.mp4', red);
    place(dir, 'blue.mp4', blue);
    // the subject (white on black), one picture per frame as the page makes them: the left half for the first second, the right half for the second
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=25:d=2', '-vf', "drawbox=x=0:y=0:w=160:h=240:color=white:t=fill:enable='lt(t,1)',drawbox=x=160:y=0:w=160:h=240:color=white:t=fill:enable='gte(t,1)'", '-f', 'image2pipe', '-c:v', 'png', 'matte.pngs']);
  });
  const proj = (behind: boolean): Project => {
    const p = newProject();
    p.encoder.fps = 25;
    p.encoder.width = 320;
    p.encoder.quality = 2;
    p.media = [red, blue];
    p.tracks.push({ id: 'v2', kind: 'video', name: 'Video 2', muted: false, solo: false, volume: 1, mosh: true });
    p.clips = [clipOf(red, { id: 'main' }), clipOf(blue, { id: 'over', track: 'v2', start: 0, ...(behind ? { depth: 'behind' as const } : {}) })];
    return p;
  };
  const mattes: ClipMatte[] = [{ clipId: 'over', path: 'matte.pngs', frames: { first: 0, count: 50 } }];
  const render = (p: Project, m: ClipMatte[], name: string) => {
    ff(dir, prepArgs(p, 320, name, undefined, [], undefined, m));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, name))), 'mpeg4').frames.length).toBe(50);
    return rgb(dir, name);
  };

  it('is plain in front without the setting: the clip covers everything', () => {
    const f = render(proj(false), mattes, 'front.avi');
    for (const i of [5, 40]) {
      expect(box(f[i], 2, 0, 0, 1, 1)).toBeGreaterThan(200);
      expect(box(f[i], 0, 0, 0, 1, 1)).toBeLessThan(60);
    }
  });

  it('puts the main track back over the clip where the matte is white, frame by frame', () => {
    const f = render(proj(true), mattes, 'behind.avi');
    // first second: the subject is the left half, so the left shows the main track (red), the right the clip (blue)
    expect(box(f[5], 0, 0.05, 0.1, 0.4, 0.9)).toBeGreaterThan(200);
    expect(box(f[5], 2, 0.05, 0.1, 0.4, 0.9)).toBeLessThan(60);
    expect(box(f[5], 2, 0.6, 0.1, 0.95, 0.9)).toBeGreaterThan(200);
    expect(box(f[5], 0, 0.6, 0.1, 0.95, 0.9)).toBeLessThan(60);
    // second second: it has moved to the right half
    expect(box(f[40], 0, 0.6, 0.1, 0.95, 0.9)).toBeGreaterThan(200);
    expect(box(f[40], 2, 0.05, 0.1, 0.4, 0.9)).toBeGreaterThan(200);
  });

  it('is the same when the timeline is prepared one segment at a time', () => {
    const p = proj(true);
    const [seg] = segments(p, 25);
    ff(dir, segmentArgs(p, seg, 320, 'seg.avi', undefined, [], undefined, mattes));
    const f = rgb(dir, 'seg.avi');
    expect(box(f[5], 0, 0.05, 0.1, 0.4, 0.9)).toBeGreaterThan(200);
    expect(box(f[40], 0, 0.6, 0.1, 0.95, 0.9)).toBeGreaterThan(200);
  });

  it('puts the clip in front when no matte picture was made for it', () => {
    const f = render(proj(true), [], 'nomatte.avi');
    expect(box(f[5], 2, 0, 0, 1, 1)).toBeGreaterThan(200);
  });

  it('is a different prepared picture from the same clip in front (so the cache re-prepares it)', () => {
    const [a] = segments(proj(false), 25);
    const [b] = segments(proj(true), 25);
    expect(segmentKey(proj(false), a, 320)).not.toBe(segmentKey(proj(true), b, 320));
  });
});
