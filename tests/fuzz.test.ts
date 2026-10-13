// Random effect stacks (the same generator Chaos uses) must never throw and must stay decodable.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir } from './helpers';
import { prepArgs, decodeToMjpegArgs, inputName } from '../src/engine/args';
import { framesFromAvi, applyBitstream, writeMoshed, type Prepared } from '../src/engine/mosh';
import { splitJpegs } from '../src/engine/jpeg';
import { buildAudio } from '../src/engine/audio';
import { chaos, mutate, makeEffect, randomizeEffect } from '../src/engine/presets';
import { EFFECTS } from '../src/engine/effects';
import { makeRng } from '../src/engine/rng';
import { newProject, defaultAudio, type Clip, type Project } from '../src/engine/types';

const d = hasFfmpeg ? describe : describe.skip;

d('fuzz', () => {
  let dir: string;
  let prep: Prepared;
  let project: Project;
  beforeAll(() => {
    dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=24:d=3', '-c:v', 'libx264', 'v.mp4']);
    project = newProject();
    project.encoder = { ...project.encoder, width: 192, gop: 20 };
    const c: Clip = { id: 'a', source: { kind: 'file', fileId: 'a', name: 'a', mime: '', isImage: false, ext: 'mp4' }, duration: 3, width: 192, height: 108, fps: 24, hasAudio: false, in: 0, out: 3, speed: 1, reverse: false, fit: 'fit' };
    project.clips = [c, { ...c, id: 'b' }];
    project.clips.forEach((cl, i) => fs.copyFileSync(path.join(dir, 'v.mp4'), path.join(dir, inputName(cl, i))));
    ff(dir, prepArgs(project, 192, 'p.avi'));
    prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'p.avi'))), 'mpeg4');
  });

  for (let seed = 1; seed <= 30; seed++)
    it(`chaos seed ${seed}`, () => {
      let p = chaos(project, prep.frames.length, seed * 7919, 1);
      if (seed % 3 === 0) p = mutate(p, prep.frames.length, 1, seed);
      const frames = applyBitstream(prep, p, [72]);
      expect(frames[0].type).toBe('I');
      expect(frames.every((f) => f.data instanceof Uint8Array && f.data.length > 0)).toBe(true);
      fs.writeFileSync(path.join(dir, 'm.avi'), writeMoshed(prep, frames));
      if (process.env.KEEP) fs.copyFileSync(path.join(dir, 'm.avi'), `${process.env.KEEP}/seed${seed}.avi`);
      ff(dir, decodeToMjpegArgs(project.decoder, 'm.avi', 'm.mjpeg'));
      expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'm.mjpeg')))).length).toBeGreaterThan(0);
      // audio follow never throws, length matches
      const pcm = new Int16Array(44100 * 2 * 6);
      const out = buildAudio(pcm, frames, 24, { ...defaultAudio(), bitcrush: 4, downsample: 5, glitch: 1, reverseChunks: 0.5 });
      expect(out.length).toBe(Math.round((frames.length * 44100) / 24) * 2);
    });

  it('edge-case ranges never throw', () => {
    const n = prep.frames.length;
    const ranges: [number, number][] = [[0, 0], [5, 5], [n, n + 50], [n - 1, n], [-10, 3], [0, 1], [50, 10]];
    for (const def of Object.values(EFFECTS)) {
      if (def.kind !== 'bitstream') continue;
      for (const [s, e] of ranges)
        for (let k = 0; k < 3; k++) {
          const fx = randomizeEffect(makeEffect(def.type, s, e), makeRng(k + s), n);
          const frames = applyBitstream(prep, { ...project, effects: [fx] }, [72]);
          expect(frames.length).toBeGreaterThan(0);
        }
    }
  });

  it('single-frame source', () => {
    const one: Prepared = { info: prep.info, frames: [prep.frames[0]] };
    for (const def of Object.values(EFFECTS)) if (def.kind === 'bitstream') applyBitstream(one, { ...project, effects: [makeEffect(def.type, 0, 1)] }, []);
  });
});
