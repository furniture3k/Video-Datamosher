// Milestone 1: Chaos dial, recipes in exports, breeding, social presets.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withChaos, chaosValue } from '../src/engine/chaos';
import { EFFECTS, type ParamDef } from '../src/engine/effects';
import { makeEffect, breed, chaos } from '../src/engine/presets';
import { encodeRecipe, decodeRecipe, applyRecipe, findRecipe, gifWithComment, gifComments } from '../src/engine/recipe';
import { bitrateFor, aspectSize, SOCIAL_PRESETS } from '../src/engine/social';
import { exportArgs, defaultExport, parseProbe, metadataArgs } from '../src/engine/args';
import { newProject, type Project } from '../src/engine/types';
import { hasFfmpeg, tmpdir, ff, ffLog } from './helpers';

type NumDef = Extract<ParamDef, { type: 'number' | 'int' }>;
const def = (type: string, key: string) => EFFECTS[type].params.find((d) => d.key === key) as NumDef;

describe('chaos dial', () => {
  it('leaves effects untouched at 1', () => {
    const e = makeEffect('bloom', 0, 100, { length: 'count', repeats: 30 });
    expect(withChaos(e, 1)).toBe(e);
    expect(withChaos(e, undefined)).toBe(e);
  });
  it('calms to nothing at 0 and pushes wild above 1', () => {
    const e = makeEffect('glitch', 0, 100, { amount: 4, probability: 0.5 });
    const calm = withChaos(e, 0);
    expect(calm.params.amount).toBe(0);
    expect(calm.params.probability).toBe(0);
    const wild = withChaos(e, 2);
    expect(Number(wild.params.amount)).toBeGreaterThan(4);
    expect(wild.params.probability).toBe(1);
    // the original is not changed
    expect(e.params.amount).toBe(4);
  });
  it('"down" settings get smaller when wilder, ints stay ints, limits hold', () => {
    const d = def('bloom', 'interval');
    expect(chaosValue(d, 12, 2)).toBe(d.min);
    expect(chaosValue(d, 12, 0)).toBe(d.max);
    const r = chaosValue(def('bloom', 'repeats'), 24, 1.37);
    expect(Number.isInteger(r)).toBe(true);
    for (let c = 0; c <= 2; c += 0.1) {
      const v = chaosValue(def('vectorWarp', 'amplify'), -3, c);
      expect(v).toBeGreaterThanOrEqual(-6);
      expect(v).toBeLessThanOrEqual(0);
    }
  });
  it('scales automation with the values', () => {
    const e = makeEffect('glitch', 0, 100, { amount: 4 });
    e.auto.amount = { kind: 'lfo', shape: 'sine', rate: 2, min: 2, max: 6, phase: 0 };
    const calm = withChaos(e, 0.5);
    const a = calm.auto.amount as { min: number; max: number };
    expect(a.min).toBeCloseTo(1);
    expect(a.max).toBeCloseTo(3);
  });
});

const projectWith = (effects: Project['effects']): Project => ({ ...newProject(), effects });

describe('recipes', () => {
  it('round-trip through a code and onto a timeline of another length', async () => {
    const p = projectWith([makeEffect('kill', 0, 100), makeEffect('splice', 50, 100, { from: 20 })]);
    p.chaos = 1.5;
    p.globalSeed = 99;
    const code = await encodeRecipe(p, 100);
    expect(code.startsWith('MOSH:')).toBe(true);
    expect(findRecipe(`  comment         : ${code}\n`)).toBe(code);
    const out = applyRecipe(newProject(), await decodeRecipe(code), 200);
    expect(out.globalSeed).toBe(99);
    expect(out.chaos).toBe(1.5);
    expect(out.effects.map((e) => [e.type, e.start, e.end])).toEqual([
      ['kill', 0, 200],
      ['splice', 100, 200],
    ]);
    expect(out.effects[1].params.from).toBe(40);
  });
  it('reject text that is not a recipe', async () => {
    await expect(decodeRecipe('MOSH:aGVsbG8')).rejects.toThrow();
    expect(findRecipe('no code here')).toBeNull();
  });
  it('GIF comments are written and read back', () => {
    // smallest valid GIF: header, logical screen with a 2-colour table, one 1×1 image, trailer
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0, 0x3b]);
    const long = 'MOSH:' + 'x'.repeat(700);
    const tagged = gifWithComment(gif, long);
    expect(tagged.length).toBe(gif.length + 2 + 705 + Math.ceil(705 / 255) + 1);
    expect(gifComments(tagged)).toEqual([long]);
    expect(gifComments(gif)).toEqual([]);
  });
});

describe('breeding', () => {
  const total = 240;
  const a = projectWith([makeEffect('kill', 0, total, {}, 1), makeEffect('bloom', 40, 80, { length: 'count', repeats: 10 }, 2)]);
  const b = projectWith([makeEffect('kill', 0, total, {}, 3), makeEffect('bloom', 50, 90, { length: 'count', repeats: 50 }, 4), makeEffect('glitch', 100, 200, {}, 5)]);
  it('is deterministic and only uses parents\' genes', () => {
    const x = breed([a, b], total, 42, 0);
    const y = breed([a, b], total, 42, 0);
    expect(JSON.stringify(x.effects.map((e) => [e.type, e.start, e.end, e.params]))).toBe(JSON.stringify(y.effects.map((e) => [e.type, e.start, e.end, e.params])));
    for (let s = 0; s < 40; s++) {
      const c = breed([a, b], total, s, 0);
      const types = c.effects.map((e) => e.type);
      // shared genes always come through, in stack order
      expect(types[0]).toBe('kill');
      expect(types).toContain('bloom');
      for (const t of types) expect(['kill', 'bloom', 'glitch']).toContain(t);
      const bl = c.effects.find((e) => e.type === 'bloom')!;
      expect(Number(bl.params.repeats)).toBeGreaterThanOrEqual(10);
      expect(Number(bl.params.repeats)).toBeLessThanOrEqual(50);
      expect(bl.start).toBeGreaterThanOrEqual(40);
      expect(bl.end).toBeLessThanOrEqual(90);
      expect(new Set(c.effects.map((e) => e.id)).size).toBe(c.effects.length);
    }
  });
  it('children of random stacks are valid stacks', () => {
    for (let s = 0; s < 30; s++) {
      const ps = [chaos(newProject(), total, s), chaos(newProject(), total, s + 100), chaos(newProject(), total, s + 200)];
      const c = breed(ps, total, s);
      for (const e of c.effects) {
        expect(EFFECTS[e.type]).toBeDefined();
        expect(e.start).toBeGreaterThanOrEqual(0);
        expect(e.end).toBeGreaterThan(e.start);
        expect(e.end).toBeLessThanOrEqual(total);
      }
    }
  });
});

describe('social presets', () => {
  it('bitrates keep files under the limit', () => {
    expect(bitrateFor(undefined, 10, true)).toBe(0);
    const k = bitrateFor(10, 30, true);
    expect(((k + 128) * 30) / 8 / 1024).toBeLessThan(10);
    expect(bitrateFor(10, 6000, true)).toBe(150);
    expect(aspectSize('9:16', 1080)).toEqual({ w: 1080, h: 1920 });
    expect(SOCIAL_PRESETS.length).toBeGreaterThan(5);
  });
});

const d = hasFfmpeg ? describe : describe.skip;
d('recipes in exported files (native ffmpeg)', () => {
  it('mp4, webm and sized mp4 carry the recipe and respect the size', async () => {
    const dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=3', '-c:v', 'mpeg4', '-q:v', '4', 'in.avi']);
    const code = await encodeRecipe(projectWith([makeEffect('kill', 0, 75)]), 75);
    for (const format of ['mp4', 'webm'] as const) {
      const o = { ...defaultExport(), format, comment: code };
      ff(dir, exportArgs(o, newProject().decoder, 25, { file: 'in.avi', mjpeg: false }, null, `out.${format}`));
      expect(parseProbe(ffLog(dir, ['-i', `out.${format}`])).recipe).toBeTruthy();
      ff(dir, metadataArgs(`out.${format}`, `meta_${format}.txt`));
      expect(findRecipe(fs.readFileSync(path.join(dir, `meta_${format}.txt`), 'utf8'))).toBe(code);
    }
    const kbps = bitrateFor(0.25, 3, false);
    ff(dir, exportArgs({ ...defaultExport(), videoKbps: kbps }, newProject().decoder, 25, { file: 'in.avi', mjpeg: false }, null, 'small.mp4'));
    expect(fs.statSync(path.join(dir, 'small.mp4')).size).toBeLessThan(0.25 * 1024 * 1024 * 1.1);
  });
  it('a GIF from ffmpeg keeps its comment and still decodes', async () => {
    const dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=160x120:r=10:d=1', 'a.gif']);
    const code = await encodeRecipe(projectWith([makeEffect('kill', 0, 10)]), 10);
    fs.writeFileSync(path.join(dir, 'b.gif'), gifWithComment(new Uint8Array(fs.readFileSync(path.join(dir, 'a.gif'))), code));
    expect(gifComments(new Uint8Array(fs.readFileSync(path.join(dir, 'b.gif'))))).toEqual([code]);
    ff(dir, ['-i', 'b.gif', '-f', 'null', '-']);
  });
});
