// Milestone 5: tracking, stabilization, captions, reframe, seamless loops.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { trackBox, stabilize, frameMotion, simplify, linearAt, linearExpr, type Gray } from '../src/engine/track';
import { groupWords, captionTexts, toSrt, toVtt, toMono16k, type Word } from '../src/engine/captions';
import { reframePath, reframeFilter, aspectRatio } from '../src/engine/reframe';
import { loopMelt, framesFromAvi, writeMoshed, applyBitstream } from '../src/engine/mosh';
import { exportArgs, defaultExport, encoderArgs, decodeToMjpegArgs, loopPassArgs } from '../src/engine/args';
import { makeEffect } from '../src/engine/presets';
import { makeRng } from '../src/engine/rng';
import { defaultEncoder, newProject } from '../src/engine/types';
import { execFileSync } from 'node:child_process';
import { hasFfmpeg, tmpdir, ff, splitJpegs } from './helpers';

/** Gray frames of textured noise with a bright textured square moving along `path`. */
function scene(w: number, h: number, n: number, path: (k: number) => [number, number], size = 20, shake?: (k: number) => [number, number]): Gray {
  const rng = makeRng(5);
  const bgW = w + 40;
  const bg = Uint8Array.from({ length: bgW * (h + 40) }, () => 40 + Math.floor(rng() * 60));
  const tex = Uint8Array.from({ length: size * size }, () => 150 + Math.floor(rng() * 100));
  const frames: Uint8Array[] = [];
  for (let k = 0; k < n; k++) {
    const [sx, sy] = shake ? shake(k) : [0, 0];
    const f = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = bg[(y + 20 + sy) * bgW + x + 20 + sx];
    const [cx, cy] = path(k);
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const x = Math.round(cx - size / 2 + i + sx);
        const y = Math.round(cy - size / 2 + j + sy);
        if (x >= 0 && y >= 0 && x < w && y < h) f[y * w + x] = tex[j * size + i];
      }
    frames.push(f);
  }
  return { w, h, frames };
}

describe('tracking', () => {
  const path = (k: number): [number, number] => [40 + k * 2.5, 50 + Math.sin(k / 6) * 15];
  const g = scene(200, 120, 40, path);
  it('follows a moving object within a pixel', () => {
    const t = trackBox(g, 0, 40, 50, 20, 20, 1);
    expect(t.length).toBe(40);
    for (const [k, x, y, c] of t) {
      const [ex, ey] = path(k);
      expect(Math.abs(x - ex)).toBeLessThanOrEqual(1.01);
      expect(Math.abs(y - ey)).toBeLessThanOrEqual(1.01);
      expect(c).toBeGreaterThan(0.45);
    }
  });
  it('tracks backwards too, and stops when the object is gone', () => {
    const [x, y] = path(39);
    const back = trackBox(g, 39, x, y, 20, 20, -1);
    expect(back[0][0]).toBe(0);
    expect(back.at(-1)![0]).toBe(39);
    // the object vanishes after frame 20: the track ends there
    const gone = { ...g, frames: g.frames.map((f, k) => (k > 20 ? scene(200, 120, 1, () => [-100, -100]).frames[0] : f)) };
    expect(trackBox(gone, 0, 40, 50, 20, 20, 1).length).toBeLessThanOrEqual(22);
  });
});

describe('stabilization', () => {
  const shake = (k: number): [number, number] => [Math.round(Math.sin(k * 1.9) * 5), Math.round(Math.cos(k * 2.3) * 4)];
  const g = scene(160, 96, 30, () => [-50, -50], 20, shake);
  it('measures frame-to-frame camera shake', () => {
    const m = frameMotion(g.frames[3], g.frames[4], g.w, g.h);
    const [ax, ay] = shake(3);
    const [bx, by] = shake(4);
    // content shifts by the shake difference; the measured motion points from frame 3 to 4
    expect(Math.abs(Math.abs(m.dx) - Math.abs(ax - bx))).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.abs(m.dy) - Math.abs(ay - by))).toBeLessThanOrEqual(1);
  });
  it('removes most of the jitter', () => {
    const s = stabilize(g, 6);
    // content position in frame k is -shake(k); a correction shifts it by corr[k]
    const jitter = (use: boolean) => {
      let sum = 0;
      for (let k = 1; k < 30; k++) {
        const pa = shake(k - 1).map((v, i) => -v + (use ? [s.corr[k - 1].x, s.corr[k - 1].y][i] : 0));
        const pb = shake(k).map((v, i) => -v + (use ? [s.corr[k].x, s.corr[k].y][i] : 0));
        sum += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      }
      return sum;
    };
    expect(jitter(true)).toBeLessThan(jitter(false) * 0.2);
    expect(s.zoom).toBeGreaterThan(1);
    expect(s.zoom).toBeLessThanOrEqual(1.3);
  });
});

describe('curves', () => {
  it('simplify keeps the shape, linear expr matches', () => {
    const pts: [number, number][] = Array.from({ length: 100 }, (_, i) => [i / 10, Math.sin(i / 10)]);
    const s = simplify(pts, 0.01);
    expect(s.length).toBeLessThan(40);
    for (const [t, v] of pts) expect(Math.abs(linearAt(s, t) - v)).toBeLessThan(0.011);
    const e = linearExpr(s, 'T');
    const js = e.replace(/\bif\(/g, 'F.if(').replace(/\blt\(/g, 'F.lt(');
    const f = new Function('F', 'T', `return ${js};`);
    const F = { if: (c: number, a: number, b: number) => (c ? a : b), lt: (a: number, b: number) => (a < b ? 1 : 0) };
    for (const t of [0, 1.234, 5.5, 9.9]) expect(f(F, t)).toBeCloseTo(linearAt(s, t), 5);
  });
});

describe('captions', () => {
  const w = (t0: number, t1: number, text: string): Word => ({ t0, t1, text });
  const words = [w(0, 0.3, 'Hello'), w(0.3, 0.6, 'there.'), w(0.7, 1, 'This'), w(1, 1.2, 'is'), w(1.2, 1.5, 'moshpit'), w(3, 3.4, 'after'), w(3.4, 3.8, 'a'), w(3.8, 4.2, 'pause')];
  it('groups on sentence ends, pauses and length', () => {
    const g = groupWords(words, { maxChars: 38, maxSeconds: 3.5, gap: 0.7 });
    expect(g.map((x) => x.map((y) => y.text).join(' '))).toEqual(['Hello there.', 'This is moshpit', 'after a pause']);
    expect(groupWords(words, { maxChars: 8, maxSeconds: 9, gap: 9 }).every((x) => x.map((y) => y.text).join(' ').length <= 8 || x.length === 1)).toBe(true);
  });
  it('makes titles in each style with word timings', () => {
    const clean = captionTexts(words, 'clean', () => 'id');
    expect(clean[0]).toMatchObject({ text: 'Hello there.', start: 0, moshed: false, caption: true });
    expect(clean[0].words).toBeUndefined();
    const kar = captionTexts(words, 'karaoke', () => 'id');
    kar[1].words!.forEach((x, i) => expect(x.t0).toBeCloseTo([0, 0.3, 0.5][i]));
    expect(captionTexts(words, 'bold', () => 'id')[0].text).toBe('HELLO THERE.');
    expect(captionTexts(words, 'melt', () => 'id')[0].moshed).toBe(true);
  });
  it('writes SRT and VTT', () => {
    const t = [{ start: 1.5, duration: 2.25, text: 'Hi' }, { start: 3661.001, duration: 1, text: 'Later' }];
    expect(toSrt(t)).toBe('1\n00:00:01,500 --> 00:00:03,750\nHi\n\n2\n01:01:01,001 --> 01:01:02,001\nLater\n');
    expect(toVtt(t).startsWith('WEBVTT\n\n00:00:01.500 --> 00:00:03.750\nHi\n')).toBe(true);
  });
  it('downmixes to 16 kHz mono', () => {
    const pcm = new Int16Array(44100 * 2).fill(16384);
    const m = toMono16k(pcm);
    expect(m.length).toBe(16000);
    expect(m[100]).toBeCloseTo(0.5, 3);
  });
});

describe('reframe', () => {
  it('follows the action and stays inside the frame', () => {
    const g = scene(160, 90, 48, (k) => [20 + k * 2.5, 45], 16);
    const r = reframePath(g, 24, 16 / 9, 9 / 16, 0.3)!;
    expect(r.axis).toBe('x');
    expect(r.size).toBeCloseTo(0.316, 2);
    const at = (t: number) => linearAt(r.pts, t);
    expect(at(1.9)).toBeGreaterThan(at(0.1) + 0.2);
    for (const [, c] of r.pts) {
      expect(c).toBeGreaterThanOrEqual(r.size / 2 - 1e-9);
      expect(c).toBeLessThanOrEqual(1 - r.size / 2 + 1e-9);
    }
    expect(reframePath(g, 24, 16 / 9, 16 / 9)).toBeNull();
    expect(aspectRatio('4:5')).toBeCloseTo(0.8);
  });
});

const d = hasFfmpeg ? describe : describe.skip;
d('native ffmpeg: reframe and loops', () => {
  const enc = { ...defaultEncoder(), fps: 24, gop: 24 };
  it('reframe crops to 9:16 and a crossfade loop keeps the length minus the seam', () => {
    const dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=4', '-f', 'lavfi', '-i', 'sine=d=4', '-pix_fmt', 'yuv420p', '-shortest', 'in.mp4']);
    ff(dir, ['-i', 'in.mp4', '-vn', 'a.wav']);
    const g = { w: 32, h: 18, frames: Array.from({ length: 96 }, (_, k) => Uint8Array.from({ length: 32 * 18 }, (_, i) => ((i % 32) + k) % 32 === 3 ? 255 : 0)) };
    const reframe = reframePath(g, 24, 16 / 9, 9 / 16)!;
    const o = { ...defaultExport(), reframe, crossfade: { frames: 96, overlap: 12 } };
    ff(dir, exportArgs(o, newProject().decoder, 24, { file: 'in.mp4', mjpeg: false }, 'a.wav', 'out.mp4'));
    // ffprobe's output is stable across FFmpeg builds (the -i log line isn't)
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', 'out.mp4'], { cwd: dir }).toString().trim();
    expect(dims).toBe(`${Math.trunc((320 * reframe.size) / 2) * 2},180`);
    ff(dir, ['-i', 'out.mp4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'f.mjpeg']);
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'f.mjpeg'))))).toBe(84);
    // chunked exports loop in a final pass
    ff(dir, loopPassArgs(defaultExport(), 'in.mp4', 96, 12, 24, true, 'loop2.mp4'));
    ff(dir, ['-i', 'loop2.mp4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'g.mjpeg']);
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'g.mjpeg'))))).toBe(84);
    // the GIF path builds too
    ff(dir, exportArgs({ ...defaultExport(), format: 'gif', reframe, crossfade: { frames: 96, overlap: 12 } }, newProject().decoder, 24, { file: 'in.mp4', mjpeg: false }, null, 'out.gif'));
  });
  it('a melt loop decodes, and its start continues from the end', () => {
    const dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=3', '-an', '-pix_fmt', 'yuv420p', ...encoderArgs(enc, []), '-f', 'avi', 'prep.avi']);
    const pr = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    const frames = applyBitstream(pr, { ...newProject(), encoder: enc, effects: [makeEffect('bloom', 10, 30)] }, []);
    const { frames: lf, lead } = loopMelt(pr, frames, 12);
    expect(lf.length).toBe(frames.length + lead);
    expect(lf[0].type).toBe('I');
    // no keyframe in the first 12 frames of the video part: the end's picture carries on
    expect(lf.slice(lead, lead + 12).filter((f) => f.type === 'I').length).toBe(0);
    fs.writeFileSync(path.join(dir, 'loop.avi'), writeMoshed(pr, lf));
    ff(dir, decodeToMjpegArgs(newProject().decoder, 'loop.avi', 'loop.mjpeg', 5));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'loop.mjpeg'))))).toBe(lf.length);
  });
});
