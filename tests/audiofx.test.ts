// Milestone 2: audio-reactive automation, beat triggers and auto-edit to the beat.
import { describe, expect, it } from 'vitest';
import { applyBitstream, type Prepared } from '../src/engine/mosh';
import { makeEffect } from '../src/engine/presets';
import { audioKey, audioKeysNeeded, bakeAudio, usesBeats, type MoshAudio } from '../src/engine/audiofx';
import { evalAutomation, paramAt } from '../src/engine/automation';
import { subdivide } from '../src/engine/beattime';
import { beatEdit, defaultBeatEdit, findDrops } from '../src/engine/beatedit';
import { withChaos } from '../src/engine/chaos';
import type { AudioFeatures } from '../src/engine/beats';
import { layoutVideo } from '../src/engine/timeline';
import { newProject, type EffectInstance, type Frame, type MediaItem, type Project } from '../src/engine/types';

const FPS = 24;

/** Features of a steady 120 BPM song (a beat every 12 frames, a bar every 48) with a drop at 192. */
function song(frames = 400): AudioFeatures {
  const beats: number[] = [];
  for (let b = 6; b < frames; b += 12) beats.push(b);
  const full = new Float32Array(frames).map((_, i) => (i < 192 ? 0.2 : 0.9));
  const low = new Float32Array(frames).map((_, i) => (beats.includes(i) ? 1 : 0.1));
  return {
    fps: FPS,
    frames,
    bands: { low, mid: full, high: full, full, onset: low },
    onsets: [...beats, 100, 192].sort((a, b) => a - b),
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    beatTimes: beats.map((b) => b / FPS),
    bpm: 120,
    confidence: 0.8,
  };
}

function prep(n: number): Prepared {
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) frames.push({ data: new Uint8Array(40 + ((i * 7) % 13)), type: i === 0 ? 'I' : 'P', src: i, tag: 'orig', payloadStart: 0 });
  return { info: {} as Prepared['info'], frames };
}
const music = (p: Project = newProject()): Project => ({ ...p, clips: [{ id: 'm', mediaId: 'x', track: 'a1', start: 0, in: 0, out: 20, speed: 1, reverse: false, fit: 'fit', volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }] });
const audioOf = (f = song()): MoshAudio => ({ sources: { a1: f, mix: f }, beatKey: 'a1' });
const pos = (f: Frame) => f.at ?? f.src;

describe('which sound effects listen to', () => {
  it('"auto" is the music track, else everything', () => {
    expect(audioKey(music(), 'auto')).toBe('a1');
    expect(audioKey(newProject(), 'auto')).toBe('mix');
    expect(audioKey(music(), 'a0')).toBe('a0');
    expect(audioKey(music(), 'gone')).toBe('mix');
  });
  it('only projects with audio automation or beat triggers need analysing', () => {
    const p = music();
    expect(audioKeysNeeded(p)).toEqual([]);
    p.effects = [makeEffect('bloom', 0, 100, { target: 'beats' })];
    expect(usesBeats(p.effects[0])).toBe(true);
    expect(audioKeysNeeded(p)).toEqual(['a1']);
    p.effects = [makeEffect('glitch', 0, 100)];
    p.effects[0].auto.amount = { kind: 'audio', track: 'mix', band: 'low', min: 0, max: 10, attack: 0, release: 0, threshold: 0 };
    expect(audioKeysNeeded(p)).toEqual(['mix']);
  });
});

describe('audio automation', () => {
  const e = makeEffect('glitch', 100, 200, { amount: 3 });
  e.auto.amount = { kind: 'audio', track: 'auto', band: 'low', min: 1, max: 9, attack: 0, release: 0, threshold: 0 };
  it('becomes one value per frame that follows the band', () => {
    const b = bakeAudio(e, audioOf(), music());
    const a = b.auto.amount;
    expect(a.kind).toBe('samples');
    // frame 102 is a beat (bass 1 → loud value), 103 is not
    expect(paramAt(b, 'amount', (102 - 100) / 99)).toBeCloseTo(9);
    expect(paramAt(b, 'amount', (103 - 100) / 99)).toBeCloseTo(1 + 8 * 0.1);
    expect(e.auto.amount.kind).toBe('audio');
  });
  it('rests at its quiet value without music', () => {
    expect(paramAt(bakeAudio(e, undefined, music()), 'amount', 0.5)).toBe(1);
    expect(evalAutomation(e.auto.amount, 0.5)).toBe(1);
  });
  it('the Chaos dial scales its range', () => {
    const a = withChaos(e, 0).auto.amount as { min: number; max: number };
    expect(a.min).toBe(0);
    expect(a.max).toBe(0);
  });
});

describe('beat triggers', () => {
  const run = (effects: EffectInstance[], audio?: MoshAudio) => applyBitstream(prep(200), { ...music(), effects }, [], audio);
  it('Bloom blooms from each beat and keeps its length', () => {
    const out = run([makeEffect('bloom', 20, 120, { target: 'beats' })], audioOf());
    expect(out.length).toBe(200);
    // a beat at 30: from there the frame shown is the one at the beat, repeated
    const at = (p: number) => out.find((f) => pos(f) === p)!;
    expect(at(31).tag).toBe('dup');
    expect(at(31).src).toBe(30);
    expect(at(41).src).toBe(30);
    expect(at(42).src).toBe(42);
  });
  it('every Nth beat, and nothing without music', () => {
    const out = run([makeEffect('bloom', 20, 120, { target: 'beats', beatEvery: 2 })], audioOf());
    const at = (p: number) => out.find((f) => pos(f) === p)!;
    expect(at(45).src).toBe(30);
    const none = run([makeEffect('bloom', 20, 120, { target: 'beats' })]);
    expect(none.every((f) => f.tag === 'orig')).toBe(true);
  });
  it('Stutter loops start on the beat', () => {
    const out = run([makeEffect('stutter', 20, 120, { mode: 'beats', group: 4, loops: 2 })], audioOf());
    expect(out.length).toBe(200);
    const dups = out.filter((f) => f.tag === 'dup').map((f) => f.src);
    // each loop replays the 4 frames from a beat
    expect(dups.slice(0, 4)).toEqual([30, 31, 32, 33]);
  });
  it('Frame Drop drops on the beat', () => {
    const out = run([makeEffect('drop', 0, 200, { mode: 'beats' })], audioOf());
    const replaced = out.filter((f) => f.tag === 'dup').map(pos);
    expect(replaced).toEqual(song().beats.filter((b) => b < 200));
  });
  it('Byte Glitch only damages frames just after beats', () => {
    const out = run([makeEffect('glitch', 0, 200, { gate: 'beats', beatHold: 2, probability: 1, amount: 4 })], audioOf());
    const hit = out.filter((f, i) => f.data !== prep(200).frames[i].data && f.tag === 'glitch').map(pos);
    for (const p of hit) expect(song().beats.some((b) => p >= b && p < b + 2)).toBe(true);
    expect(hit.length).toBeGreaterThan(10);
  });
});

describe('auto-edit to the beat', () => {
  const media = (id: string, duration: number): MediaItem => ({ id, source: { kind: 'file', fileId: id, name: id + '.mp4', mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration, width: 640, height: 360, fps: 24, hasAudio: true, hasVideo: true });
  const base = (): Project => ({ ...music(), media: [media('a', 30), media('b', 2), media('x', 60)] });
  it('cuts land on every Nth beat and the edit lasts as long as the music', () => {
    const f = song(400);
    const p = beatEdit(base(), f, { ...defaultBeatEdit(['a', 'b']), every: 2, melts: 'none', blooms: false });
    const placed = layoutVideo(p);
    const starts = placed.map((pl) => Math.round(pl.start * FPS));
    expect(starts).toEqual([0, ...f.beats.filter((_, i) => i % 2 === 0)]);
    expect(Math.round(placed.at(-1)!.end * FPS)).toBe(400);
    // footage alternates, keeps moving forward, and short footage is slowed to fill its piece
    expect(placed.slice(0, 4).map((pl) => pl.clip.mediaId)).toEqual(['a', 'b', 'a', 'b']);
    expect(placed[2].clip.in).toBeGreaterThan(placed[0].clip.in);
    expect(placed.every((pl) => pl.clip.muted)).toBe(true);
    // the music clip is untouched
    expect(p.clips.find((c) => c.id === 'm')).toBeTruthy();
  });
  it('cuts on quarter beats: four pieces to a beat', () => {
    const f = song(400);
    const p = beatEdit(base(), f, { ...defaultBeatEdit(['a', 'b']), every: 0.25, melts: 'none', blooms: false });
    const starts = layoutVideo(p).map((pl) => Math.round(pl.start * FPS));
    const want = [0, ...subdivide(f.beats, 4).map(Math.round).filter((b) => b > 0 && b < 400)];
    expect(starts).toEqual(want);
    // between two beats there are three more cuts
    const [b0, b1] = f.beats.slice(1, 3);
    expect(starts.filter((s) => s > b0 && s < b1).length).toBe(3);
  });
  it('melts on bars, blooms on drops', () => {
    const f = song(400);
    expect(findDrops(f)).toEqual([192]);
    const p = beatEdit(base(), f, { ...defaultBeatEdit(['a']), every: 1, melts: 'bars', blooms: true });
    const placed = layoutVideo(p);
    for (const pl of placed.slice(1)) expect(!!pl.clip.transition).toBe(f.downbeats.includes(Math.round(pl.start * FPS)));
    expect(p.effects.some((e) => e.type === 'bloom' && e.start === 192)).toBe(true);
    expect(p.markers?.some((m) => m.name === 'drop')).toBe(true);
  });
  it('refuses without pictures or beats', () => {
    expect(() => beatEdit(base(), song(), defaultBeatEdit([]))).toThrow();
    expect(() => beatEdit(base(), { ...song(), beats: [], downbeats: [] }, defaultBeatEdit(['a']))).toThrow();
  });
});
