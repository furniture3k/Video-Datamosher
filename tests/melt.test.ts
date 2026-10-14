import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { segmentArgs } from '../src/engine/args';
import { framesFromAvi, applyBitstream, writeMoshed, concatPrepared } from '../src/engine/mosh';
import { cutFrames, segments } from '../src/engine/timeline';
import { newProject, type Project } from '../src/engine/types';

const d = hasFfmpeg ? describe : describe.skip;
const W = 64;
const H = 48;

/** Decode an AVI to tiny greyscale frames. */
function grey(dir: string, file: string): Uint8Array[] {
  ff(dir, ['-ec', 'guess_mvs+favor_inter', '-err_detect', 'ignore_err', '-i', file, '-fps_mode', 'passthrough', '-vf', `scale=${W}:${H}`, '-pix_fmt', 'gray', '-f', 'rawvideo', file + '.gray']);
  const b = new Uint8Array(fs.readFileSync(path.join(dir, file + '.gray')));
  const out: Uint8Array[] = [];
  for (let o = 0; o + W * H <= b.length; o += W * H) out.push(b.subarray(o, o + W * H));
  return out;
}
const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

d('mosh transitions really melt', () => {
  for (const type of ['melt', 'bloom', 'stutter', 'liquid', 'glitch'] as const)
    it(type, () => {
      const dir = tmpdir();
      ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', '-c:v', 'libx264', 'a.mp4']);
      ff(dir, ['-f', 'lavfi', '-i', 'mandelbrot=s=320x240:r=25', '-t', '2', '-c:v', 'libx264', 'b.mp4']);
      const p: Project = newProject();
      p.encoder.fps = 25;
      p.encoder.width = 320;
      const ma = fileMedia('a', 'mp4', { hasAudio: false });
      const mb = fileMedia('b', 'mp4', { hasAudio: false });
      p.media = [ma, mb];
      p.clips = [clipOf(ma), clipOf(mb, { transition: { type, duration: 1, intensity: 0.7 } })];
      place(dir, 'a.mp4', ma);
      place(dir, 'b.mp4', mb);
      const parts = segments(p, 25).map((sg, i) => {
        ff(dir, segmentArgs(p, sg, 320, `s${i}.avi`));
        return framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, `s${i}.avi`))), 'mpeg4');
      });
      const prep = concatPrepared(parts);
      fs.writeFileSync(path.join(dir, 'clean.avi'), writeMoshed(prep, prep.frames));
      const frames = applyBitstream(prep, p, cutFrames(p, 25));
      fs.writeFileSync(path.join(dir, 'mosh.avi'), writeMoshed(prep, frames));
      const clean = grey(dir, 'clean.avi');
      const mosh = grey(dir, 'mosh.avi');
      // a few frames after the cut, the picture is still mostly clip A, not clip B
      const k = frames.findIndex((f) => f.src >= 55);
      const outF = mosh[k];
      expect(diff(outF, clean[49])).toBeLessThan(diff(outF, clean[55]));
      // after the transition (1 s) a fresh keyframe brings clip B back clean
      expect(frames.length).toBe(prep.frames.length);
      expect(frames[75].type).toBe('I');
      expect(diff(mosh[78], clean[78])).toBeLessThan(diff(mosh[78], clean[49]));
    });
});
