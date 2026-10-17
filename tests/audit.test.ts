// Regression tests for engine bugs found in an audit.
import { describe, expect, it } from 'vitest';
import { parseAvi, writeAvi, type AviInfo } from '../src/engine/avi';
import { defuseStartCodes } from '../src/engine/effects/util';
import { describeChange } from '../src/engine/history';
import { insertFreeze, layoutVideo, splitClip, slipClip } from '../src/engine/timeline';
import { migrate } from '../src/engine/migrate';
import { formatSeconds } from '../src/engine/eta';
import { audioMixArgs } from '../src/engine/args';
import { applyBitstream } from '../src/engine/mosh';
import { newProject, type Project } from '../src/engine/types';
import { fileMedia, clipOf } from './helpers';

function aviInfo(): AviInfo {
  const avih = new Uint8Array(56);
  const strh = new Uint8Array(56);
  strh.set([...'vidsXVID'].map((c) => c.charCodeAt(0)));
  new DataView(strh.buffer).setUint32(20, 1, true);
  new DataView(strh.buffer).setUint32(24, 25, true);
  return { width: 64, height: 48, rate: 25, scale: 1, fourcc: 'XVID', strh, strf: new Uint8Array(40), avih };
}

describe('avi index', () => {
  it("ignores other streams' idx1 entries when reading keyframe flags", () => {
    const frames = [[1, 2], [3, 4], [5, 6]].map((d) => ({ data: new Uint8Array(d), keyframe: false }));
    const buf = writeAvi(aviInfo(), frames);
    const ascii = new TextDecoder('latin1').decode(buf);
    const movi = ascii.indexOf('movi');
    const idx = ascii.indexOf('idx1') + 8;
    // the third entry becomes an audio keyframe whose (relative) offset happens to equal the
    // absolute position of the first video chunk
    const e = idx + 2 * 16;
    buf.set([...'01wb'].map((c) => c.charCodeAt(0)), e);
    const v = new DataView(buf.buffer);
    v.setUint32(e + 4, 0x10, true);
    v.setUint32(e + 8, movi + 4, true);
    expect(parseAvi(buf).chunks.map((c) => c.keyframe)).toEqual([false, false, false]);
  });
});

describe('start code defusing', () => {
  it('leaves untouched zero runs (4-byte start codes) alone', () => {
    const orig = new Uint8Array([9, 9, 9, 0, 0, 0, 1, 0x41, 7, 7]);
    const d = orig.slice();
    d[9] = 8; // an edit somewhere else
    defuseStartCodes(d, orig, 2);
    expect([...d.subarray(3, 7)]).toEqual([0, 0, 0, 1]);
  });
  it('still breaks start codes an edit creates', () => {
    const orig = new Uint8Array([9, 9, 0, 0, 5, 7]);
    const d = orig.slice();
    d[4] = 1;
    defuseStartCodes(d, orig, 0);
    expect(d[4]).toBe(2);
  });
});

const media = fileMedia('m', 'mp4', { duration: 10 });
const base = (): Project => ({ ...newProject(), media: [media], clips: [clipOf(media, { in: 2, out: 6 }), clipOf(media, { in: 6, out: 8 })] });
const copy = (p: Project): Project => JSON.parse(JSON.stringify(p));

describe('undo names', () => {
  it('names the split of a reversed clip a split', () => {
    const a = base();
    a.clips[0].reverse = true;
    const b = copy(a);
    splitClip(b, b.clips[0].id, 1);
    expect(describeChange(a, b)).toBe('Split m');
  });
  it('names a slip a slip', () => {
    const a = base();
    const b = copy(a);
    slipClip(b, b.clips[0].id, -0.3, { ...a.clips[0] });
    expect(describeChange(a, b)).toBe('Slip m');
    const t = copy(a);
    t.clips[0].in = 2.5;
    expect(describeChange(a, t)).toBe('Trim m');
  });
});

describe('freeze frames', () => {
  it('a freeze at the very start of a clip goes before it', () => {
    const p = base();
    p.clips[1].transition = { type: 'melt', duration: 1, intensity: 1 };
    const second = p.clips[1];
    const f = insertFreeze(p, second.id, 4.01, 1)!;
    expect(layoutVideo(p).map((pl) => pl.clip.id)).toEqual([p.clips[0].id, f.id, second.id]);
    expect(f.in).toBeCloseTo(6, 1);
    // the cut's transition now leads into the freeze
    expect(f.transition?.type).toBe('melt');
    expect(second.transition).toBeUndefined();
  });
  it('a freeze at the start of an upper-track clip pushes the clip later', () => {
    const p = base();
    p.tracks.push({ id: 'v2', kind: 'video', name: 'V2', muted: false, solo: false, volume: 1, mosh: true });
    const c = clipOf(media, { track: 'v2', start: 3, in: 0, out: 2 });
    p.clips.push(c);
    const f = insertFreeze(p, c.id, 3.01, 1.5)!;
    expect(f.start).toBe(3);
    expect(c.start).toBeCloseTo(4.5);
  });
});

describe('migration', () => {
  it("doesn't change the saved project's track list", () => {
    const saved = { ...newProject(), tracks: [{ id: 'a1', kind: 'audio', name: 'Music', muted: false, solo: false, volume: 1, mosh: false }] };
    const p = migrate(saved);
    expect(p.tracks.map((t) => t.id)).toEqual(['v1', 'a0', 'a1']);
    expect(saved.tracks.map((t) => t.id)).toEqual(['a1']);
  });
});

describe('time left', () => {
  it('never shows 60 seconds or 60 minutes', () => {
    expect(formatSeconds(59.5)).toBe('1 min');
    expect(formatSeconds(119.7)).toBe('2 min');
    expect(formatSeconds(3599.6)).toBe('1 h 0 min');
    expect(formatSeconds(7190)).toBe('2 h 0 min');
    expect(formatSeconds(4000)).toBe('1 h 7 min');
  });
});

describe('audio mix', () => {
  it('a clip with speed 0 does not hang', () => {
    const p = base();
    p.clips = [clipOf(media, { speed: 0 })];
    const mix = audioMixArgs(p, 2);
    expect(mix?.args.join(' ')).not.toContain('atempo');
  });
});

describe('mosh', () => {
  it('an empty prepared stream gives no frames (not an undefined one)', () => {
    const frames = applyBitstream({ info: aviInfo(), frames: [] }, newProject(), []);
    expect(frames).toEqual([]);
  });
});
