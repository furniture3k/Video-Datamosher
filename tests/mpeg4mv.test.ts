// Motion-vector editing spike: bit-exact round trips, then edited vectors that still decode.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseVol, parsePVop, writePVop, clampField } from '../src/engine/mpeg4mv';
import { framesFromAvi, writeMoshed, applyBitstream } from '../src/engine/mosh';
import { makeEffect } from '../src/engine/presets';
import { encoderArgs } from '../src/engine/args';
import { defaultEncoder, newProject } from '../src/engine/types';
import { hasFfmpeg, tmpdir, ff, ffLog } from './helpers';

const d = hasFfmpeg ? describe : describe.skip;
d('MPEG-4 motion vectors (native ffmpeg)', () => {
  const make = (dir: string, src: string, extra: Partial<ReturnType<typeof defaultEncoder>> = {}) => {
    ff(dir, ['-f', 'lavfi', '-i', src, '-an', '-pix_fmt', 'yuv420p', ...encoderArgs({ ...defaultEncoder(), fps: 24, ...extra }, []), '-f', 'avi', 'in.avi']);
    return framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'in.avi'))), 'mpeg4');
  };

  for (const [name, src, q] of [
    ['test pattern', 'testsrc2=s=320x240:r=24:d=2', 4],
    ['fast mandelbrot, coarse', 'mandelbrot=s=352x288:r=24,trim=duration=2', 12],
    ['noise and motion, fine', 'testsrc2=s=176x144:r=24:d=2,noise=alls=40:allf=t', 2],
  ] as const)
    it(`${name}: every P-frame round-trips bit for bit`, () => {
      const dir = tmpdir();
      const pr = make(dir, src, { quality: q });
      const vol = parseVol(pr.frames[0].data);
      let checked = 0;
      for (const f of pr.frames) {
        if (f.type !== 'P') continue;
        const p = parsePVop(f.data, vol);
        const again = writePVop(f.data, p, p.field.mv);
        expect(Buffer.from(again).equals(Buffer.from(f.data))).toBe(true);
        checked++;
      }
      expect(checked).toBeGreaterThan(40);
    });

  it('doubled vectors still decode cleanly, and change the picture', () => {
    const dir = tmpdir();
    const pr = make(dir, 'testsrc2=s=320x240:r=24:d=2', { quality: 4 });
    const vol = parseVol(pr.frames[0].data);
    const out = pr.frames.map((f) => {
      if (f.type !== 'P') return f;
      const p = parsePVop(f.data, vol);
      const mv = clampField(p.field.mv.map((v) => (v ? [v[0] * 2, v[1] * 2] : null)), p.field.fcode);
      return { ...f, data: writePVop(f.data, p, mv) };
    });
    fs.writeFileSync(path.join(dir, 'x2.avi'), writeMoshed(pr, out));
    const log = ffLog(dir, ['-v', 'error', '-i', 'x2.avi', '-f', 'null', '-']);
    expect(log.trim()).toBe('');
    // the decoder reads back exactly the vectors written
    const again = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'x2.avi'))), 'mpeg4');
    const k = again.frames.findIndex((f, i) => f.type === 'P' && i > 10);
    const want = clampField(parsePVop(pr.frames[k].data, vol).field.mv.map((v) => (v ? [v[0] * 2, v[1] * 2] : null)), parsePVop(pr.frames[k].data, vol).field.fcode);
    expect(parsePVop(again.frames[k].data, vol).field.mv).toEqual(want);
    ff(dir, ['-i', 'in.avi', '-vf', 'scale=32:24', '-pix_fmt', 'gray', '-f', 'rawvideo', 'a.gray']);
    ff(dir, ['-i', 'x2.avi', '-vf', 'scale=32:24', '-pix_fmt', 'gray', '-f', 'rawvideo', 'b.gray']);
    const a = fs.readFileSync(path.join(dir, 'a.gray'));
    const b = fs.readFileSync(path.join(dir, 'b.gray'));
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length).toBeGreaterThan(2);
  });

  it('the Vector Edit effect (amplify, turn, jitter, painted flow) renders a stream that decodes cleanly', () => {
    const dir = tmpdir();
    const pr = make(dir, 'testsrc2=s=320x240:r=24:d=2', { quality: 4 });
    const e = makeEffect('mvedit', 5, 48, { amplify: 3, rotate: 45, jitter: 2 });
    e.data = { strokes: [{ tool: 'swirl', pts: [[0.5, 0.5]], radius: 0.3, strength: 0.02 }] };
    const out = applyBitstream(pr, { ...newProject(), effects: [e] }, []);
    expect(out.length).toBe(pr.frames.length);
    const changed = out.filter((f, i) => f.data !== pr.frames[i].data).length;
    expect(changed).toBeGreaterThan(30);
    fs.writeFileSync(path.join(dir, 'mvx.avi'), writeMoshed(pr, out));
    expect(ffLog(dir, ['-v', 'error', '-i', 'mvx.avi', '-f', 'null', '-']).trim()).toBe('');
    // MPEG-2 streams are left alone rather than broken
    const d2 = tmpdir();
    ff(d2, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=1', '-an', '-pix_fmt', 'yuv420p', ...encoderArgs({ ...defaultEncoder(), fps: 24, codec: 'mpeg2' }, []), '-f', 'avi', 'm2.avi']);
    const p2 = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(d2, 'm2.avi'))), 'mpeg2');
    const o2 = applyBitstream(p2, { ...newProject(), effects: [makeEffect('mvedit', 0, 24)] }, []);
    expect(o2.every((f, i) => f.data === p2.frames[i].data)).toBe(true);
  });
});
