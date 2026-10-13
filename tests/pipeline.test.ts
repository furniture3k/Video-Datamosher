import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, ffLog, hasFfmpeg, tmpdir } from './helpers';
import { prepArgs, decodeToMjpegArgs, audioArgs, exportArgs, defaultExport, parseProbe, inputName } from '../src/engine/args';
import { framesFromAvi, applyBitstream, writeMoshed, clipStarts } from '../src/engine/mosh';
import { splitJpegs } from '../src/engine/jpeg';
import { newProject, type Clip, type EffectInstance, type Project } from '../src/engine/types';
import { EFFECTS, defaultParams } from '../src/engine/effects';

const d = hasFfmpeg ? describe : describe.skip;

function clip(id: string, ext: string, dur: number, hasAudio: boolean): Clip {
  return { id, source: { kind: 'file', fileId: id, name: id, mime: 'video/mp4', isImage: false, ext }, duration: dur, width: 320, height: 240, fps: 25, hasAudio, in: 0, out: dur, speed: 1, reverse: false, fit: 'fit' };
}

function effect(type: string, params: Record<string, unknown> = {}, start = 0, end = 1e9): EffectInstance {
  return { id: type + Math.random(), type, enabled: true, solo: false, start, end, seed: 7, params: { ...defaultParams(EFFECTS[type].params), ...params } as EffectInstance['params'], auto: {}, locks: [] };
}

d('native ffmpeg pipeline', () => {
  let dir: string;
  let project: Project;
  beforeAll(() => {
    dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', 'a.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'mandelbrot=s=320x240:r=25:end_scale=0.1', '-t', '2', '-c:v', 'libx264', 'b.mp4']);
    project = newProject();
    project.encoder.fps = 25;
    project.encoder.width = 320;
    project.encoder.gop = 12;
    project.clips = [clip('a', 'mp4', 2, true), clip('b', 'mp4', 2, false)];
    project.clips.forEach((c, i) => fs.copyFileSync(path.join(dir, c.id + '.mp4'), path.join(dir, inputName(c, i))));
    ff(dir, prepArgs(project, 320));
  });

  it('probe parser reads ffmpeg -i output', () => {
    const p = parseProbe(ffLog(dir, ['-i', 'a.mp4']));
    expect(p.width).toBe(320);
    expect(p.hasAudio).toBe(true);
    expect(p.duration).toBeCloseTo(2, 0);
    expect(parseProbe(ffLog(dir, ['-i', 'b.mp4'])).hasAudio).toBe(false);
  });

  it('prepares an AVI with detectable I/P frames and keys at cuts', () => {
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    expect(prep.frames.length).toBe(100);
    expect(prep.frames[0].type).toBe('I');
    const types = prep.frames.map((f) => f.type);
    expect(types.every((t) => t === 'I' || t === 'P')).toBe(true);
    expect(types[50]).toBe('I'); // forced key at the cut
    expect(types.filter((t) => t === 'I').length).toBeGreaterThanOrEqual(8); // gop 12
    expect(clipStarts(project.clips, 25)).toEqual([0, 50]);
  });

  it('round-trips unmodified and decodes every frame', () => {
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    fs.writeFileSync(path.join(dir, 'rt.avi'), writeMoshed(prep, prep.frames));
    ff(dir, decodeToMjpegArgs(project.decoder, 'rt.avi', 'rt.mjpeg'));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'rt.mjpeg')))).length).toBe(100);
  });

  for (const [type, params] of [
    ['kill', {}],
    ['kill', { mode: 'cuts', replace: 'prev' }],
    ['bloom', { repeats: 30, target: 'strongest' }],
    ['bloom', { target: 'every', interval: 1, repeats: 2 }],
    ['stutter', { pingpong: true, every: 10 }],
    ['shuffle', {}],
    ['reverse', {}],
    ['drop', {}],
    ['echo', { taps: 2 }],
    ['splice', { from: 55, length: 20 }],
    ['splice', { from: 55, length: 20, mode: 'insert', loops: 2 }],
    ...['flip', 'replace', 'nudge', 'zero', 'max', 'run', 'repeat', 'swap', 'shift', 'insert', 'delete'].map((m) => ['glitch', { mode: m, amount: 8, probability: 1 }]),
  ] as [string, Record<string, unknown>][]) {
    it(`effect ${type} ${JSON.stringify(params)} produces a decodable mosh`, () => {
      const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
      const p: Project = { ...project, effects: [effect('kill', {}, 0, 1e9), effect(type, params, 20, 80)] };
      const frames = applyBitstream(prep, p, [50]);
      expect(frames[0].type).toBe('I');
      fs.writeFileSync(path.join(dir, 'm.avi'), writeMoshed(prep, frames));
      ff(dir, decodeToMjpegArgs(project.decoder, 'm.avi', 'm.mjpeg'));
      const n = splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'm.mjpeg')))).length;
      // Every chunk should come out as a picture (glitched data may lose a couple).
      expect(n).toBeGreaterThanOrEqual(frames.length - (type === 'glitch' ? 10 : 0));
      expect(n).toBeLessThanOrEqual(frames.length);
      if (type === 'kill') expect(frames.filter((f) => f.type === 'I').length).toBeLessThan(prep.frames.filter((f) => f.type === 'I').length);
    });
  }

  it('builds timeline audio and exports mp4 / gif / webm', () => {
    const aa = audioArgs(project)!;
    ff(dir, aa);
    const raw = fs.readFileSync(path.join(dir, 'audio.raw'));
    expect(raw.length / 4 / 44100).toBeCloseTo(4, 0);
    ff(dir, ['-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'audio.raw', 'audio.wav']);
    for (const format of ['mp4', 'gif', 'webm'] as const) {
      const o = { ...defaultExport(), format, width: 160 };
      ff(dir, exportArgs(o, project.decoder, 25, { file: 'prep.avi', mjpeg: false }, 'audio.wav', `out.${format}`));
      expect(fs.statSync(path.join(dir, `out.${format}`)).size).toBeGreaterThan(1000);
    }
    ff(dir, decodeToMjpegArgs(project.decoder, 'prep.avi', 'frames.mjpeg', 3));
    ff(dir, exportArgs({ ...defaultExport() }, project.decoder, 25, { file: 'frames.mjpeg', mjpeg: true }, null, 'post.mp4'));
    expect(parseProbe(ffLog(dir, ['-i', 'post.mp4'])).duration).toBeCloseTo(4, 0);
  });

  it('mpeg2 codec works too', () => {
    const p2: Project = { ...project, encoder: { ...project.encoder, codec: 'mpeg2' } };
    ff(dir, prepArgs(p2, 320, 'prep2.avi'));
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep2.avi'))), 'mpeg2');
    expect(prep.frames.length).toBe(100);
    expect(prep.frames[0].type).toBe('I');
    expect(prep.frames[1].type).toBe('P');
    const frames = applyBitstream(prep, { ...p2, effects: [effect('kill'), effect('bloom', { repeats: 10 }, 10, 40)] }, [50]);
    fs.writeFileSync(path.join(dir, 'm2.avi'), writeMoshed(prep, frames));
    ff(dir, decodeToMjpegArgs(project.decoder, 'm2.avi', 'm2.mjpeg'));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'm2.mjpeg')))).length).toBeGreaterThan(frames.length - 5);
  });
});
