// Milestone 3: frame sequencer, databending, generation loss, motion packs.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bend, bendBytes, defaultBend } from '../src/engine/dsp';
import { applyBitstream, framesFromAvi, traceGeneration, writeMoshed, type Prepared } from '../src/engine/mosh';
import { makeEffect, chaos } from '../src/engine/presets';
import { stepsOf, DEFAULT_STEPS } from '../src/engine/effects/bend';
import { encoderArgs, generationEncoder, regenArgs, decodeToMjpegArgs } from '../src/engine/args';
import { MOTION_PACKS, packArgs } from '../src/engine/motionpacks';
import { defaultEncoder, newProject, type Frame, type Project } from '../src/engine/types';
import { hasFfmpeg, tmpdir, ff, splitJpegs } from './helpers';

const pos = (f: Frame) => f.at ?? f.src;

/** A fake stream: keyframe every `gop`, payload bytes that never form a start code. */
function prep(n: number, gop = 1000): Prepared {
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) frames.push({ data: Uint8Array.from({ length: 300 }, (_, k) => 10 + ((i * 31 + k * 7) % 200)), type: i % gop === 0 ? 'I' : 'P', src: i, tag: 'orig', payloadStart: 8 });
  return { info: {} as Prepared['info'], frames };
}
const run = (n: number, effects: Project['effects'], gop?: number) => applyBitstream(prep(n, gop), { ...newProject(), effects }, []);

describe('dsp', () => {
  it('echo repeats an impulse every delay with feedback', () => {
    const x = new Float32Array(50);
    x[0] = 0.5;
    const y = bend(x, { ...defaultBend(), mode: 'echo', delay: 10, feedback: 0.5, mix: 1, wrap: false });
    expect(y.length).toBe(50);
    expect(y[10]).toBeCloseTo(0.25);
    expect(y[20]).toBeCloseTo(0.125);
    expect(y[5]).toBe(0);
  });
  it('every mode keeps the length and stays in range', () => {
    const x = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i / 7) * 0.9);
    for (const mode of ['echo', 'reverb', 'phaser', 'crush', 'reverse', 'gain'] as const) {
      const y = bend(x, { ...defaultBend(), mode, amount: mode === 'crush' ? 2 : 6, mix: 1 });
      expect(y.length).toBe(x.length);
      for (const v of y) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
  it('mix 0 changes nothing; crush leaves few levels; reverse flips chunks', () => {
    const b = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...bendBytes(b, { ...defaultBend(), mix: 0 })]).toEqual([...b]);
    expect(new Set(bendBytes(b, { ...defaultBend(), mode: 'crush', amount: 2, mix: 1 })).size).toBeLessThanOrEqual(5);
    expect([...bendBytes(Uint8Array.from([1, 2, 3, 4, 5, 6]), { ...defaultBend(), mode: 'reverse', delay: 3, mix: 1, wrap: false })]).toEqual([3, 2, 1, 6, 5, 4]);
  });
});

describe('frame sequencer', () => {
  it('plays the pattern step by step and keeps every frame in place', () => {
    const e = makeEffect('sequence', 10, 50, { stepLen: 2 });
    e.data = { steps: ['bloom', 'keep', 'reverse', 'keep'] };
    const out = run(60, [e]);
    expect(out.length).toBe(60);
    out.forEach((f, i) => expect(pos(f)).toBe(i));
    // bloom steps (10-11, 18-19…) repeat the motion before them
    expect(out[10].tag).toBe('dup');
    expect(out[10].src).toBe(9);
    expect(out[11].src).toBe(9);
    // keep steps are untouched
    expect(out[12].src).toBe(12);
    expect(out[12].tag).toBe('orig');
    // reverse steps (14-15) swap their frames
    expect([out[14].src, out[15].src]).toEqual([15, 14]);
  });
  it('echo, melt and glitch steps', () => {
    const e = makeEffect('sequence', 10, 40, { stepLen: 5, echoDist: 4, glitchAmount: 6 });
    e.data = { steps: ['echo', 'melt', 'glitch'] };
    const src = prep(40, 16);
    const out = applyBitstream(src, { ...newProject(), effects: [e] }, []);
    expect(out[10].src).toBe(6);
    // the keyframe at 16 sits in a melt step (15-19) and is replaced
    expect(out[16].type).not.toBe('I');
    // glitch step 20-24: bytes changed, header kept, no start codes made
    const g = out[21];
    expect(g.tag).toBe('glitch');
    expect([...g.data.subarray(0, 8)]).toEqual([...src.frames[21].data.subarray(0, 8)]);
    for (let q = 0; q + 2 < g.data.length; q++) expect(g.data[q] === 0 && g.data[q + 1] === 0 && g.data[q + 2] <= 1).toBe(false);
  });
  it('has a default pattern and random stacks get their own', () => {
    expect(stepsOf(makeEffect('sequence', 0, 10))).toEqual(DEFAULT_STEPS);
    let seen = false;
    for (let s = 0; s < 60 && !seen; s++) {
      const seq = chaos(newProject(), 200, s, 1).effects.find((x) => x.type === 'sequence');
      if (seq) {
        seen = true;
        expect(Array.isArray(seq.data?.steps)).toBe(true);
      }
    }
    expect(seen).toBe(true);
  });
});

describe('databend', () => {
  it('bends payloads only, keeps headers and length, makes no start codes', () => {
    const src = prep(30);
    const out = applyBitstream(src, { ...newProject(), effects: [makeEffect('databend', 5, 25, { mode: 'echo', delay: 20, feedback: 0.7, mix: 1, protect: 4 })] }, []);
    for (let i = 5; i < 25; i++) {
      const f = out[i];
      const o = src.frames[i];
      expect(f.data.length).toBe(o.data.length);
      expect([...f.data.subarray(0, 12)]).toEqual([...o.data.subarray(0, 12)]);
      expect(f.data).not.toEqual(o.data);
      for (let q = 0; q + 2 < f.data.length; q++) expect(f.data[q] === 0 && f.data[q + 1] === 0 && f.data[q + 2] <= 1).toBe(false);
    }
    expect(out[4].data).toBe(src.frames[4].data);
  });
});

describe('generation loss bookkeeping', () => {
  it('traces sound sources and timeline positions through a pass', () => {
    // pass 1: frame 3 repeats frame 2 (shown at 3); pass 2: frame 5 shows output frame 3
    const p1: Frame[] = [0, 1, 2, 2, 4, 5].map((s, i) => ({ data: new Uint8Array(1), type: 'P', src: s, at: i, tag: i === 3 ? 'dup' : 'orig', payloadStart: 0 }));
    const p2: Frame[] = [0, 1, 2, 3, 4, 3].map((s, i) => ({ data: new Uint8Array(1), type: 'P', src: s, at: i, tag: i === 5 ? 'dup' : 'orig', payloadStart: 0 }));
    const t = traceGeneration(p1, p2);
    expect(t.map((f) => f.src)).toEqual([0, 1, 2, 2, 4, 2]);
    expect(t.map(pos)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t[3].tag).toBe('dup');
  });
  it('each generation crushes quality, capped at 31', () => {
    const enc = { ...defaultEncoder(), quality: 4, genCrush: 3 };
    expect(generationEncoder(enc, 2).quality).toBe(7);
    expect(generationEncoder(enc, 3).quality).toBe(10);
    expect(generationEncoder({ ...enc, quality: 30 }, 4).quality).toBe(31);
  });
});

const d = hasFfmpeg ? describe : describe.skip;
d('native ffmpeg: packs and generations', () => {
  const enc = { ...defaultEncoder(), fps: 24 };
  const make = (dir: string) => ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=3', '-an', '-pix_fmt', 'yuv420p', ...encoderArgs(enc, []), '-f', 'avi', 'prep.avi']);
  it('every motion pack renders as a stream of one keyframe and motion', () => {
    const dir = tmpdir();
    for (const p of MOTION_PACKS) {
      ff(dir, packArgs(p.id, enc, 320, 180, `${p.id}.avi`));
      const fr = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, `${p.id}.avi`))), 'mpeg4').frames;
      expect(fr.length).toBeGreaterThanOrEqual(190);
      expect(fr[0].type).toBe('I');
      expect(fr.slice(1).filter((f) => f.type === 'I').length).toBe(0);
    }
  });
  it('pack motion spliced into the timeline decodes, frames stay in place', () => {
    const dir = tmpdir();
    make(dir);
    ff(dir, packArgs('vortex', enc, 320, 180, 'pack.avi'));
    const pr = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    const pack = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'pack.avi'))), 'mpeg4').frames;
    const project = { ...newProject(), encoder: enc, effects: [makeEffect('kill', 0, 72), makeEffect('splice', 24, 60, { source: 'pack', pack: 'vortex' })] };
    const out = applyBitstream(pr, project, [], undefined, { vortex: pack });
    expect(out.length).toBe(72);
    const spliced = out.filter((f) => f.tag === 'spliced');
    expect(spliced.length).toBe(36);
    for (const f of spliced) expect(f.src).toBe(pos(f));
    expect(pack.some((p) => p.data === spliced[0].data)).toBe(true);
    fs.writeFileSync(path.join(dir, 'mosh.avi'), writeMoshed(pr, out));
    ff(dir, decodeToMjpegArgs(project.decoder, 'mosh.avi', 'out.mjpeg', 5));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'out.mjpeg'))))).toBe(72);
  });
  it('a generation pass re-encodes the mosh with the same number of frames', () => {
    const dir = tmpdir();
    make(dir);
    const pr = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    const project = { ...newProject(), encoder: enc, effects: [makeEffect('kill', 0, 72), makeEffect('bloom', 10, 40)] };
    const first = applyBitstream(pr, project, []);
    fs.writeFileSync(path.join(dir, 'g1.avi'), writeMoshed(pr, first));
    ff(dir, regenArgs(project, generationEncoder(enc, 2), 'g1.avi', 'g2.avi'));
    const next = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'g2.avi'))), 'mpeg4');
    expect(next.frames.length).toBe(72);
    const second = traceGeneration(first, applyBitstream(next, project, []));
    expect(second.length).toBe(72);
    second.forEach((f, i) => expect(pos(f)).toBe(i));
  });
});
