import { describe, expect, it } from 'vitest';
import { evalAutomation } from '../src/engine/automation';
import { buildAudio, wav } from '../src/engine/audio';
import { defaultAudio, newProject, type Frame } from '../src/engine/types';
import { PRESETS, applyPreset, chaos, mutate, makeEffect } from '../src/engine/presets';
import { EFFECTS } from '../src/engine/effects';
import { makeRng } from '../src/engine/rng';
import { writeAvi, parseAvi } from '../src/engine/avi';
import { zip, crc32 } from '../src/engine/zip';

describe('automation', () => {
  it('curves interpolate', () => {
    const a = { kind: 'curve' as const, points: [[0, 0], [1, 10]] as [number, number][], interp: 'linear' as const };
    expect(evalAutomation(a, 0.5)).toBe(5);
    expect(evalAutomation({ ...a, interp: 'step' }, 0.5)).toBe(0);
  });
  it('lfo stays in range and is deterministic', () => {
    for (const shape of ['sine', 'triangle', 'square', 'saw', 'random', 'noise'] as const) {
      const a = { kind: 'lfo' as const, shape, rate: 3, min: 2, max: 8, phase: 0 };
      for (let t = 0; t <= 1; t += 0.05) {
        const v = evalAutomation(a, t, 5);
        expect(v).toBeGreaterThanOrEqual(2);
        expect(v).toBeLessThanOrEqual(8);
        expect(evalAutomation(a, t, 5)).toBe(v);
      }
    }
  });
});

describe('rng', () => {
  it('is reproducible', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('audio', () => {
  it('follows the frame list', () => {
    const pcm = new Int16Array(44100 * 2).map((_, i) => i % 1000);
    const frames = [0, 1, 1, 1, 2].map((src) => ({ src, tag: 'orig' as Frame['tag'] }));
    const out = buildAudio(pcm, frames, 25, { ...defaultAudio(), crossfade: false });
    expect(out.length).toBe(Math.round((5 * 44100) / 25) * 2);
    const spf = 44100 / 25;
    expect(out[Math.round(2 * spf) * 2 + 10]).toBe(out[Math.round(1 * spf) * 2 + 10]);
    expect(wav(out).length).toBe(44 + out.length * 2);
  });
});

describe('presets & chaos', () => {
  it('every preset references real effects', () => {
    for (const p of PRESETS) {
      const pr = applyPreset(newProject(), p, 200, [100]);
      for (const e of pr.effects) {
        expect(EFFECTS[e.type]).toBeTruthy();
        expect(e.end).toBeGreaterThan(e.start);
      }
    }
  });
  it('chaos and mutate produce valid stacks, honouring locks', () => {
    const p = chaos(newProject(), 300, 99);
    expect(p.effects.length).toBeGreaterThan(0);
    const e = makeEffect('bloom', 0, 100, { repeats: 7 });
    e.locks = ['repeats', '__range'];
    const m = mutate({ ...newProject(), effects: [e] }, 300, 1, 5);
    expect(m.effects[0].params.repeats).toBe(7);
    expect(m.effects[0].start).toBe(0);
  });
});

describe('containers', () => {
  it('avi writer output parses back', () => {
    const avih = new Uint8Array(56);
    new DataView(avih.buffer).setUint32(32, 64, true);
    new DataView(avih.buffer).setUint32(36, 48, true);
    const strh = new Uint8Array(56);
    strh.set([...'vidsXVID'].map((c) => c.charCodeAt(0)));
    new DataView(strh.buffer).setUint32(20, 1, true);
    new DataView(strh.buffer).setUint32(24, 25, true);
    const info = { width: 64, height: 48, rate: 25, scale: 1, fourcc: 'XVID', strh, strf: new Uint8Array(40), avih };
    const frames = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])].map((data, i) => ({ data, keyframe: i === 0 }));
    const back = parseAvi(writeAvi(info, frames));
    expect(back.chunks.map((c) => [...c.data])).toEqual([[1, 2, 3], [4, 5]]);
    expect(back.chunks.map((c) => c.keyframe)).toEqual([true, false]);
    expect(back.info.rate).toBe(25);
  });
  it('zip has the right crc', async () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const z = zip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
    expect(z.size).toBeGreaterThan(100);
  });
});

import { parseProbe } from '../src/engine/args';
describe('probe', () => {
  it('swaps width and height for rotated phone video', () => {
    const base = 'Duration: 00:00:02.00, start: 0\n  Stream #0:0[0x1]: Video: hevc (Main), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr\n';
    expect(parseProbe(base)).toMatchObject({ width: 1920, height: 1080 });
    expect(parseProbe(base + '      displaymatrix: rotation of -90.00 degrees\n')).toMatchObject({ width: 1080, height: 1920 });
    expect(parseProbe(base + '      rotate          : 90\n')).toMatchObject({ width: 1080, height: 1920 });
    expect(parseProbe(base + '      displaymatrix: rotation of 180.00 degrees\n')).toMatchObject({ width: 1920, height: 1080 });
  });
});
