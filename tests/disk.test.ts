// Desktop exports keep frame payloads on disk and assemble the moshed AVI from file ranges
// (aviPlan + engine_assemble). That must give exactly the same file as the in-memory path.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { prepArgs } from '../src/engine/args';
import { framesFromAvi, applyBitstream, applyBitstreamDisk, writeMoshed, type Prepared } from '../src/engine/mosh';
import { aviPlan, type AviPlan } from '../src/engine/avi';
import { analyzeFrame } from '../src/engine/bitstream';
import { chaos, makeEffect } from '../src/engine/presets';
import { newProject, type Frame, type Project } from '../src/engine/types';

const d = hasFfmpeg ? describe : describe.skip;
const HEAD = 1024;

/** What the desktop engine's avi_scan reports: payload offset and size of each video frame. */
function scan(buf: Uint8Array): { off: number; size: number }[] {
  const out: { off: number; size: number }[] = [];
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const walk = (p: number, end: number, movi: boolean) => {
    while (p + 8 <= end) {
      const id = String.fromCharCode(...buf.subarray(p, p + 4));
      const size = dv.getUint32(p + 4, true);
      if (id === 'RIFF' || id === 'LIST') {
        const kind = String.fromCharCode(...buf.subarray(p + 8, p + 12));
        walk(p + 12, p + 8 + size, movi || kind === 'movi');
      } else if (movi && /^00d[cb]$/.test(id) && size > 0) out.push({ off: p + 8, size });
      p += 8 + size + (size & 1);
    }
  };
  walk(0, buf.length, false);
  return out;
}

/** engine_assemble, in JS */
function assemble(plan: AviPlan, files: Record<string, Uint8Array>): Uint8Array {
  const parts = plan.pieces.map((p) => (p[0] === 0 ? plan.inline.subarray(p[1], p[1] + p[2]) : files[plan.files[p[1]]].subarray(p[2], p[2] + p[3])));
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of parts) (out.set(x, o), (o += x.length));
  return out;
}

d('disk-backed moshing (desktop exports)', () => {
  let buf: Uint8Array;
  let prep: Prepared;
  let disk: Prepared;
  let project: Project;
  beforeAll(() => {
    const dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=24:d=3', '-c:v', 'libx264', 'v.mp4']);
    project = newProject();
    project.encoder = { ...project.encoder, width: 192, gop: 20 };
    const m = fileMedia('a', 'mp4', { duration: 3, width: 192, height: 108, fps: 24, hasAudio: false });
    project.media = [m];
    project.clips = [clipOf(m, { out: 3 }), clipOf(m, { out: 3 })];
    place(dir, 'v.mp4', m);
    ff(dir, prepArgs(project, 192, 'p.avi'));
    buf = new Uint8Array(fs.readFileSync(path.join(dir, 'p.avi')));
    prep = framesFromAvi(buf, 'mpeg4');
    // the desktop path: header bytes only, payload referenced on disk
    const pos = scan(buf);
    disk = {
      info: prep.info,
      frames: pos.map(({ off, size }, i): Frame => {
        const head = buf.slice(off, off + Math.min(size, HEAD));
        const a = analyzeFrame(head, 'mpeg4');
        return { data: head, size, off, file: 'p.avi', type: a.type === '?' ? prep.frames[i].type : a.type, src: i, tag: 'orig', payloadStart: a.payloadStart };
      }),
    };
  });

  const load = async (frames: Frame[]) => new Map(frames.map((f) => [f, { ...f, data: buf.slice(f.off!, f.off! + f.size!), size: undefined, off: undefined, file: undefined }] as [Frame, Frame]));
  const moshDisk = async (p: Project) => {
    const frames = await applyBitstreamDisk(disk, p, [72], load);
    return assemble(aviPlan(disk.info, frames.map((f) => ({ ...f, keyframe: f.type === 'I' }))), { 'p.avi': buf });
  };

  it('header analysis from the first bytes matches the full frames', () => {
    expect(disk.frames.length).toBe(prep.frames.length);
    disk.frames.forEach((f, i) => {
      expect(f.type).toBe(prep.frames[i].type);
      expect(f.payloadStart).toBe(prep.frames[i].payloadStart);
      expect(f.size).toBe(prep.frames[i].data.length);
    });
  });

  it('unmodified stream assembles byte-identical', async () => {
    const p = { ...project, effects: [] };
    expect(Buffer.from(await moshDisk(p)).equals(Buffer.from(writeMoshed(prep, applyBitstream(prep, p, [72]))))).toBe(true);
  });

  it('byte glitch, bloom and keyframe removal assemble byte-identical', async () => {
    const p = {
      ...project,
      effects: [makeEffect('kill', 0, 144, {}, 1), makeEffect('bloom', 10, 60, {}, 2), makeEffect('glitch', 20, 100, { probability: 0.8, amount: 6 }, 3), makeEffect('glitch', 0, 144, { mode: 'insert' }, 4)],
    };
    const mem = writeMoshed(prep, applyBitstream(prep, p, [72]));
    expect(Buffer.from(await moshDisk(p)).equals(Buffer.from(mem))).toBe(true);
  });

  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    it(`random stack ${seed} assembles byte-identical`, async () => {
      const p = chaos(project, prep.frames.length, seed * 7919, 1);
      const mem = writeMoshed(prep, applyBitstream(prep, p, [72]));
      expect(Buffer.from(await moshDisk(p)).equals(Buffer.from(mem))).toBe(true);
    });
  }
});
