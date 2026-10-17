import { describe, expect, it } from 'vitest';
import { midiControl, oscValue, controlValue, controlLabel } from '../src/engine/controls';
import { EFFECTS } from '../src/engine/effects';
import { analyzeFrame, renumberH264, spsFrameNumBits } from '../src/engine/bitstream';

const def = (type: string, key: string) => EFFECTS[type].params.find((p) => p.key === key)!;

describe('MIDI and OSC', () => {
  it('reads knobs, pads and pitch bend, on any channel', () => {
    expect(midiControl([0xb0, 21, 127])).toEqual({ key: 'cc:1:21', value: 1 });
    expect(midiControl([0xb3, 7, 0])).toEqual({ key: 'cc:4:7', value: 0 });
    expect(midiControl([0x90, 60, 64])?.key).toBe('note:1:60');
    // note-off and a zero-velocity note-on do nothing
    expect(midiControl([0x80, 60, 0])).toBeNull();
    expect(midiControl([0x90, 60, 0])).toBeNull();
    expect(midiControl([0xe0, 0x7f, 0x7f])?.value).toBe(1);
    expect(midiControl([0xf8])).toBeNull();
    expect(oscValue(0.3)).toBe(0.3);
    expect(oscValue(127)).toBe(1);
    expect(oscValue(-2)).toBe(0);
    expect(controlLabel('cc:1:21')).toBe('CC 21');
    expect(controlLabel('note:2:60')).toBe('Note C4 (ch 2)');
    expect(controlLabel('osc:/fader1')).toBe('OSC /fader1');
  });

  it('turns 0..1 into a setting: numbers across their range, switches and lists', () => {
    const off = def('chroma', 'offset');
    expect(controlValue(off, 0, 6, 'cc:1:1')).toBe(0);
    expect(controlValue(off, 1, 6, 'cc:1:1')).toBe(40);
    expect(controlValue(off, 0.5, 6, 'cc:1:1')).toBe(20);
    const sw = def('grain', 'colour');
    expect(controlValue(sw, 0.9, false, 'cc:1:1')).toBe(true);
    // a pad flips it
    expect(controlValue(sw, 0.9, true, 'note:1:36')).toBe(false);
    const sel = def('posterize', 'dither');
    expect(controlValue(sel, 0, 'bayer', 'cc:1:1')).toBe('none');
    expect(controlValue(sel, 1, 'bayer', 'cc:1:1')).toBe('noise');
    expect(controlValue(sel, 1, 'bayer', 'note:1:36')).toBe('noise');
  });
});

describe('H.264', () => {
  // Annex B: SPS (Baseline, log2_max_frame_num 4+0 = 4 bits), PPS, then slices
  const sc = [0, 0, 1];
  // profile 66, constraints 0xC0, level 30, then ue(0)=1 (sps id), ue(0)=1 (log2_max_frame_num_minus4) → bits "11", rest padding
  const sps = [...sc, 0x67, 66, 0xc0, 30, 0b11000000];
  const pps = [...sc, 0x68, 0xce, 0x38, 0x80];
  // slice header bits: first_mb ue(0)=1, slice_type ue(5)=00110 (P), pps ue(0)=1, frame_num u(4)
  const slice = (nal: number, type: string, frameNum: number) => {
    const bits = '1' + type + '1' + frameNum.toString(2).padStart(4, '0') + '1';
    const bytes: number[] = [];
    const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8 + 16, '0');
    for (let i = 0; i < padded.length; i += 8) bytes.push(parseInt(padded.slice(i, i + 8), 2));
    return [...sc, nal, ...bytes];
  };
  const P = '00110';
  const I = '0001000'; // ue(7) = I
  const idr = new Uint8Array([...sps, ...pps, ...slice(0x65, I, 0)]);
  const p = (n: number) => new Uint8Array(slice(0x41, P, n));
  const frameNum = (d: Uint8Array) => {
    // after the slice NAL header: 1, 00110, 1, then 4 bits
    const b = d[4];
    const bits = b.toString(2).padStart(8, '0') + d[5].toString(2).padStart(8, '0');
    return parseInt(bits.slice(7, 11), 2);
  };

  it('finds keyframes and motion frames, and the frame number size', () => {
    expect(analyzeFrame(idr, 'h264')).toMatchObject({ type: 'I', hasHeaders: true });
    expect(analyzeFrame(p(3), 'h264')).toMatchObject({ type: 'P', hasHeaders: false });
    expect(spsFrameNumBits(new Uint8Array(sps), 3)).toBe(4);
  });

  it('numbers the frames again in playing order after a mosh', () => {
    // a removed keyframe and a repeated frame: 1 2 3 3 1 2 → 1 2 3 4 5 6
    const frames = [idr, p(1), p(2), p(3), p(3), p(1), p(2)].map((data) => ({ data, type: analyzeFrame(data, 'h264').type }));
    const out = renumberH264(frames);
    expect(out.slice(1).map((f) => frameNum(f.data))).toEqual([1, 2, 3, 4, 5, 6]);
    // already right: the same array back (so the preview's decode cache still matches)
    expect(out[1].data).toBe(frames[1].data);
    // it wraps at 16 (4 bits)
    const long = [idr, ...Array.from({ length: 20 }, (_, i) => p((i + 1) % 16))].map((data) => ({ data, type: analyzeFrame(data, 'h264').type }));
    expect(renumberH264(long).map((f) => frameNum(f.data)).slice(15, 18)).toEqual([15, 0, 1]);
  });
});

import { checkPlan, plans, planKey, scriptInput, SCRIPT_EXAMPLES, script } from '../src/engine/effects/script';
import { prepareScripts, applyBitstream } from '../src/engine/mosh';
import { makeEffect } from '../src/engine/presets';
import { newProject, type Frame } from '../src/engine/types';

describe('Script effect', () => {
  const frame = (i: number): Frame => ({ data: new Uint8Array(40).fill(i + 1), type: i % 6 === 0 ? 'I' : 'P', src: i, tag: 'orig', payloadStart: 4 });
  const prep = { info: {} as never, frames: Array.from({ length: 24 }, (_, i) => frame(i)) };

  it('checks answers: whole numbers in range, glitch counts kept sane', () => {
    expect(checkPlan([0, 1, 1, { i: 2, glitch: 3 }], 3)).toEqual([0, 1, 1, { i: 2, glitch: 3 }]);
    expect(checkPlan([{ i: 0, glitch: 1e9 }], 1)).toEqual([{ i: 0, glitch: 64 }]);
    expect(() => checkPlan('nope', 3)).toThrow(/array/);
    expect(() => checkPlan([3], 3)).toThrow(/0 to 2/);
    expect(() => checkPlan([0.5], 3)).toThrow();
    expect(() => checkPlan(new Array(100).fill(0), 3)).toThrow(/too many/);
  });

  it('runs before the mosh, and the mosh uses its answer for the frames under the bar', async () => {
    const p = { ...newProject(), effects: [makeEffect('script', 6, 12, { timing: 'stretch' })] };
    p.effects[0].data = { code: 'function mosh(f){ return [5,4,3,2,1,0]; }' };
    // nothing known yet: the frames go through
    expect(applyBitstream(prep, p, []).map((f) => f.src)).toEqual(prep.frames.map((f) => f.src));
    const seen: number[][] = [];
    await prepareScripts(prep, p, [], async (e, input) => {
      seen.push(input.map((f) => f.src));
      plans.set(planKey(e, input), checkPlan([5, 4, 3, 2, 1, 0], input.length));
    });
    expect(seen).toEqual([[6, 7, 8, 9, 10, 11]]);
    const out = applyBitstream(prep, p, []).map((f) => f.src);
    expect(out.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.slice(6, 12)).toEqual([11, 10, 9, 8, 7, 6]);
    // asked again: already known, not run again
    await prepareScripts(prep, p, [], async () => void seen.push([]));
    expect(seen).toHaveLength(1);
  });

  it('a glitch answer damages bytes after the header, and the examples are valid code', () => {
    const e = makeEffect('script', 0, 24);
    e.data = { code: 'x' };
    const input = scriptInput(prep.frames, e);
    plans.set(planKey(e, input), [{ i: 1, glitch: 5 }, ...input.slice(2).map((_, k) => k + 2)]);
    const out = script.apply(prep.frames, e, {} as never);
    expect(out[0].tag).toBe('glitch');
    expect([...out[0].data.slice(0, 4)]).toEqual([2, 2, 2, 2]);
    expect(out[0].data.some((b, k) => b !== prep.frames[1].data[k])).toBe(true);
    for (const x of SCRIPT_EXAMPLES) expect(() => new Function('frames', 'ctx', x.code + ';return mosh(frames, ctx)')(input, { amount: 0.5, random: Math.random })).not.toThrow();
  });
});
