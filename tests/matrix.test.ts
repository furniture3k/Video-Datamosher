// Sweeps encoder options, codecs, frame rates, clip options and generators through native ffmpeg.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { prepArgs, decodeToMjpegArgs, GENERATORS, audioMixArgs } from '../src/engine/args';
import { timelineDuration } from '../src/engine/timeline';
import { framesFromAvi, applyBitstream, writeMoshed } from '../src/engine/mosh';
import { splitJpegs } from '../src/engine/jpeg';
import { newProject, type Clip, type EncoderSettings, type MediaItem, type Project } from '../src/engine/types';
import { makeEffect } from '../src/engine/presets';

const d = hasFfmpeg ? describe : describe.skip;

d('encoder / clip option matrix', () => {
  let dir: string;
  const vmedia = fileMedia('v', 'mp4');
  const imedia = fileMedia('i', 'png', { width: 200, height: 300 });
  beforeAll(() => {
    dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', 'v.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc=s=200x300', '-frames:v', '1', 'i.png']);
  });

  function run(p: Project, mosh = true) {
    place(dir, 'v.mp4', vmedia);
    place(dir, 'i.png', imedia);
    ff(dir, prepArgs(p, p.encoder.width, 'p.avi'));
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'p.avi'))), p.encoder.codec);
    expect(prep.frames.length).toBeGreaterThan(10);
    expect(prep.frames[0].type).toBe('I');
    const frames = mosh ? applyBitstream(prep, { ...p, effects: [makeEffect('kill', 0, 1e6), makeEffect('bloom', 5, 30, { repeats: 6 })] }, []) : prep.frames;
    fs.writeFileSync(path.join(dir, 'm.avi'), writeMoshed(prep, frames));
    ff(dir, decodeToMjpegArgs(p.decoder, 'm.avi', 'm.mjpeg'));
    return { prep, n: splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'm.mjpeg')))).length, frames };
  }

  const base = (enc: Partial<EncoderSettings> = {}, clips?: Clip[], media: MediaItem[] = []): Project => {
    const p = newProject();
    p.encoder = { ...p.encoder, width: 320, ...enc };
    p.media = [vmedia, imedia, ...media];
    p.clips = clips ?? [clipOf(vmedia)];
    return p;
  };

  const encCases: [string, Partial<EncoderSettings>][] = [
    ['mpeg2 15fps', { codec: 'mpeg2', fps: 15 }],
    ['mpeg1 12fps', { codec: 'mpeg1', fps: 12 }],
    ['mpeg1 8fps', { codec: 'mpeg1', fps: 8 }],
    ['mpeg2 60fps', { codec: 'mpeg2', fps: 60 }],
    ['mpeg4 8fps', { fps: 8 }],
    ['bframes 2', { bframes: 2 }],
    ['mpeg2 bframes 2', { codec: 'mpeg2', bframes: 2 }],
    ['zero motion', { motionEst: 'zero' }],
    ['xone + rd', { motionEst: 'xone', mbd: 'rd' }],
    ['mv4 qpel trellis', { mv4: true, qpel: true, trellis: true, mbd: 'bits' }],
    ['me range 4', { meRange: 4 }],
    ['quality 31', { quality: 31 }],
    ['quality 1', { quality: 1 }],
    ['gop 1', { gop: 1 }],
    ['scene cut', { sceneCut: true }],
    ['markers', { keyMarkers: [10, 20] }],
    ...(['sad', 'sse', 'satd', 'dct', 'rd', 'zero', 'vsad', 'nsse'] as const).map((cmp): [string, Partial<EncoderSettings>] => [`cmp ${cmp}`, { cmp }]),
    ['aspect 9:16', { aspect: '9:16' }],
    ['aspect 21:9 width 854', { aspect: '21:9', width: 854 }],
  ];
  for (const [name, enc] of encCases)
    it(`encoder: ${name}`, () => {
      const { n, frames } = run(base(enc));
      expect(n).toBeGreaterThanOrEqual(frames.length - 2);
    });

  it('B-frames are detected', () => {
    const { prep } = run(base({ bframes: 2 }), false);
    expect(prep.frames.some((f) => f.type === 'B')).toBe(true);
  });

  for (const [name, extra] of [
    ['reverse', { reverse: true }],
    ['speed 0.5', { speed: 0.5 }],
    ['speed 3', { speed: 3 }],
    ['trimmed', { in: 0.5, out: 1.5 }],
    ['fill', { fit: 'fill' }],
    ['stretch', { fit: 'stretch' }],
  ] as [string, Partial<Clip>][])
    it(`clip: ${name} (video + audio)`, () => {
      const p = base({}, [clipOf(vmedia, extra), clipOf(vmedia)]);
      run(p);
      const mix = audioMixArgs(p, timelineDuration(p))!;
      ff(dir, mix.args);
      const want = Math.round(timelineDuration(p) * 44100) * 4;
      expect(Math.abs(fs.statSync(path.join(dir, 'mosh.raw')).size - want)).toBeLessThan(44100 * 4 * 0.05);
    });

  it('still image clip', () => {
    run(base({}, [clipOf(imedia, { out: 2 }), clipOf(vmedia)]));
  });

  for (const g of GENERATORS)
    it(`generator: ${g.id}`, () => {
      const gm: MediaItem = { ...fileMedia('g', 'mp4'), source: { kind: 'generator', generator: g.id, name: g.name }, width: 320, height: 180, hasAudio: false, duration: 60 };
      const { prep } = run(base({}, [clipOf(gm, { out: 1.5 })], [gm]));
      expect(prep.frames.length).toBeGreaterThanOrEqual(35);
    });
});
