import { describe, expect, it } from 'vitest';
import { applyBitstream, type Prepared } from '../src/engine/mosh';
import { makeEffect } from '../src/engine/presets';
import { migrate } from '../src/engine/migrate';
import { transitionEffects, transitionKeyTimes } from '../src/engine/timeline';
import { newProject, type EffectInstance, type Frame, type MediaItem, type Project } from '../src/engine/types';
import { keyTimes } from '../src/engine/args';

/** A fake prepared stream: keyframe every `gop` frames, sizes vary so "strongest" is defined. */
function prep(n: number, gop = 1000): Prepared {
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) frames.push({ data: new Uint8Array(10 + ((i * 7) % 13)), type: i % gop === 0 ? 'I' : 'P', src: i, tag: 'orig', payloadStart: 0 });
  return { info: {} as Prepared['info'], frames };
}
const run = (n: number, effects: EffectInstance[]) => applyBitstream(prep(n), { ...newProject(), effects } as Project, []);
const pos = (f: Frame) => f.at ?? f.src;

describe('effects keep their length', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['bloom', {}],
    ['bloom', { target: 'strongest' }],
    ['bloom', { target: 'every', interval: 3 }],
    ['bloom', { target: 'random', probability: 0.2 }],
    ['bloom', { length: 'count', repeats: 30 }],
    ['bloom', { target: 'every', interval: 1, length: 'count', repeats: 2 }],
    ['stutter', {}],
    ['stutter', { mode: 'once', loops: 8 }],
    ['stutter', { mode: 'every', every: 5, pingpong: true }],
    ['echo', { taps: 3, probability: 1 }],
    ['splice', { from: 60, mode: 'insert', loops: 3 }],
    ['splice', { from: 60 }],
    ['drop', {}],
    ['drop', { mode: 'probability', probability: 0.5 }],
    ['kill', {}],
    ['shuffle', {}],
    ['reverse', { window: 4 }],
  ];
  for (const [type, params] of cases)
    it(`${type} ${JSON.stringify(params)}`, () => {
      const out = run(100, [makeEffect('kill', 0, 100), makeEffect(type, 20, 50, params as never)]);
      expect(out.length).toBe(100);
      // output frame N is timeline frame N
      expect(out.map(pos)).toEqual([...Array(100).keys()]);
      // untouched outside the range
      expect(out.slice(0, 20).every((f, i) => f.src === i)).toBe(true);
      expect(out.slice(50).every((f, i) => f.src === 50 + i)).toBe(true);
    });

  it('bloom "fill" lasts as long as its bar', () => {
    for (const end of [30, 60, 90]) {
      const out = run(100, [makeEffect('kill', 0, 100), makeEffect('bloom', 20, end)]);
      const held = out.filter((f) => f.tag === 'dup');
      expect(held.length).toBe(end - 21);
      expect(new Set(held.map((f) => f.src)).size).toBe(1);
    }
  });

  it('stretch inserts frames and makes the video longer', () => {
    const out = run(100, [makeEffect('bloom', 20, 50, { length: 'count', repeats: 10, timing: 'stretch' })]);
    expect(out.length).toBe(110);
    const slow = run(100, [makeEffect('bloom', 0, 100, { target: 'every', interval: 1, length: 'count', repeats: 1, timing: 'stretch' })]);
    expect(slow.length).toBe(199);
  });

  it('frame drop can shorten instead', () => {
    expect(run(100, [makeEffect('drop', 0, 100, { every: 2, timing: 'stretch' })]).length).toBe(51);
  });
});

describe('old projects keep their look', () => {
  it('migrates effects saved before Keep length', () => {
    const p = newProject();
    p.effects = [makeEffect('bloom', 0, 10, { repeats: 5 }), makeEffect('stutter', 0, 10, { every: 0 }), makeEffect('kill', 0, 10)];
    for (const e of p.effects) for (const k of ['timing', 'length', 'mode', 'replace']) delete e.params[k];
    const m = migrate(JSON.parse(JSON.stringify(p)));
    expect(m.effects[0].params).toMatchObject({ timing: 'stretch', length: 'count' });
    expect(m.effects[1].params).toMatchObject({ timing: 'stretch', mode: 'once' });
    expect(m.effects[2].params.replace).toBe('drop');
  });
});

describe('mosh transitions', () => {
  const media = (id: string): MediaItem => ({ id, source: { kind: 'file', fileId: id, name: id, mime: '', isImage: false, ext: 'mp4' }, duration: 4, width: 320, height: 240, fps: 25, hasAudio: false, hasVideo: true });
  const proj = (type: string, resolve?: boolean) => {
    const p = newProject();
    p.encoder.fps = 25;
    p.media = [media('a'), media('b')];
    const clip = (id: string, m: string) => ({ id, mediaId: m, track: 'v1', start: 0, in: 0, out: 4, speed: 1, reverse: false, fit: 'fit' as const, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 });
    p.clips = [clip('x', 'a'), { ...clip('y', 'b'), transition: { type: type as 'melt', duration: 1, intensity: 0.5, resolve } }];
    return p;
  };
  it('resolve with a keyframe at the end of the transition', () => {
    expect(transitionKeyTimes(proj('melt'))).toEqual([4, 5]);
    expect(transitionKeyTimes(proj('melt', false))).toEqual([4]);
    expect(keyTimes(proj('bloom'))).toContain(5);
  });
  it('the melt covers the whole transition and stops before the resolve key', () => {
    for (const type of ['melt', 'bloom', 'glitch', 'stutter', 'liquid', 'ghost', 'rewind']) {
      const fx = transitionEffects(proj(type), 25);
      expect(fx[0]).toMatchObject({ type: 'kill', start: 99, end: 125 });
      for (const e of fx) expect(e.end).toBeLessThanOrEqual(125);
    }
  });
});

import { tc, parseTimecode } from '../src/lib/timecode';
describe('timecode', () => {
  it('formats and parses', () => {
    expect(tc(3723.5, 24)).toBe('01:02:03:12');
    expect(parseTimecode('01:02:03:12', 24)).toBeCloseTo(3723.5);
    expect(parseTimecode('1:30', 24)).toBe(90);
    expect(parseTimecode('12.5', 24)).toBe(12.5);
    expect(parseTimecode('48f', 24)).toBe(2);
    expect(parseTimecode('+2', 24, 10)).toBe(12);
    expect(parseTimecode('-12f', 24, 10)).toBe(9.5);
    expect(parseTimecode('abc', 24)).toBeNull();
  });
});
