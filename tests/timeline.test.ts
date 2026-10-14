import { describe, expect, it } from 'vitest';
import { fileMedia, clipOf } from './helpers';
import { newProject, type Project } from '../src/engine/types';
import { clipLen, deleteClips, detachAudio, insertVideo, layoutVideo, mapTime, moveVideo, nearestCut, remapToFootage, segments, splitClip, timelineDuration, trimClip, audioSources, makeClip } from '../src/engine/timeline';
import { migrate } from '../src/engine/migrate';
import { makeEffect } from '../src/engine/presets';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function proj(): Project {
  const p = newProject();
  p.encoder.fps = 10;
  const a = fileMedia('a', 'mp4', { duration: 10 });
  const b = fileMedia('b', 'mp4', { duration: 10 });
  p.media = [a, b];
  p.clips = [clipOf(a, { id: 'A', out: 4 }), clipOf(b, { id: 'B', out: 3 })];
  return p;
}

describe('timeline layout', () => {
  it('lays video clips end to end, blend transitions overlap', () => {
    const p = proj();
    expect(layoutVideo(p).map((x) => [x.start, x.end])).toEqual([[0, 4], [4, 7]]);
    p.clips[1].transition = { type: 'dissolve', duration: 1, intensity: 0.5 };
    expect(layoutVideo(p).map((x) => [x.start, x.end])).toEqual([[0, 4], [3, 6]]);
    // capped at half the shorter clip
    p.clips[1].transition.duration = 10;
    expect(layoutVideo(p)[1].overlap).toBe(1.5);
    // mosh transitions don't overlap
    p.clips[1].transition = { type: 'melt', duration: 1, intensity: 0.5 };
    expect(timelineDuration(p)).toBe(7);
  });

  it('segments tile the timeline in frames', () => {
    const p = proj();
    p.clips.push(clipOf(p.media[0], { id: 'M', track: 'a1', start: 5, out: 4 }));
    const s = segments(p, 10);
    expect(s.map((x) => [x.f0, x.f1, x.clips.length])).toEqual([[0, 40, 1], [40, 70, 1], [70, 90, 0]]);
    expect(segments(p, 10, true).map((x) => [x.f0, x.f1, x.clips.length])).toEqual([[0, 90, 2]]);
  });
});

describe('edit operations', () => {
  it('split keeps the picture continuous', () => {
    const p = proj();
    const b = splitClip(p, 'A', 1.5)!;
    expect(p.clips.map((c) => [c.in, c.out])).toEqual([[0, 1.5], [1.5, 4], [0, 3]]);
    expect(b.transition).toBeUndefined();
    expect(timelineDuration(p)).toBe(7);
    // reverse clips split from the other end of the source
    const q = proj();
    q.clips[0].reverse = true;
    splitClip(q, 'A', 1);
    expect(q.clips.slice(0, 2).map((c) => [c.in, c.out])).toEqual([[3, 4], [0, 3]]);
    // too close to an edge does nothing
    expect(splitClip(proj(), 'A', 0.01)).toBeNull();
  });

  it('split with speed maps through source time', () => {
    const p = proj();
    p.clips[0].speed = 2; // 2 s on the timeline
    splitClip(p, 'A', 0.5);
    expect(p.clips[0].out).toBe(1);
    expect(p.clips[1].in).toBe(1);
  });

  it('trim respects media bounds and direction', () => {
    const p = proj();
    const orig = clone(p.clips[0]);
    trimClip(p, 'A', 'l', 1, orig);
    expect(p.clips[0].in).toBe(1);
    trimClip(p, 'A', 'l', -5, orig);
    expect(p.clips[0].in).toBe(0);
    trimClip(p, 'A', 'r', 100, orig);
    expect(p.clips[0].out).toBe(10);
    // audio clip trimmed on the left keeps its right edge
    const a = makeClip(p.media[0], 'a1', { id: 'X', start: 2, out: 4 });
    p.clips.push(a);
    trimClip(p, 'X', 'l', 1, clone(a));
    expect(a.start).toBe(3);
    expect(a.start + clipLen(a)).toBe(6);
  });

  it('move, insert, delete and nearest cut', () => {
    const p = proj();
    p.clips[1].transition = { type: 'melt', duration: 1, intensity: 0.5 };
    moveVideo(p, 'B', 0);
    expect(p.clips.map((c) => c.id)).toEqual(['B', 'A']);
    expect(p.clips[0].transition).toBeUndefined();
    insertVideo(p, clipOf(p.media[0], { id: 'C', out: 1 }), 1);
    expect(p.clips.map((c) => c.id)).toEqual(['B', 'C', 'A']);
    expect(nearestCut(p, 3.4)).toBe(1);
    expect(nearestCut(p, 100)).toBe(3);
    p.clips[1].transition = { type: 'dissolve', duration: 0.5, intensity: 0.5 };
    deleteClips(p, ['B']);
    expect(p.clips[0].transition).toBeUndefined();
  });

  it('detach audio moves sound to a track at the same time', () => {
    const p = proj();
    const a = detachAudio(p, 'B', 'a1')!;
    expect(a.start).toBe(4);
    expect(p.clips.find((c) => c.id === 'B')!.muted).toBe(true);
    const srcs = audioSources(p);
    expect(srcs.map((s) => [s.clip.id, s.start, s.bus])).toEqual([['A', 0, 'mosh'], [a.id, 4, 'clean']]);
  });
});

describe('effects follow footage', () => {
  it('maps times through moves, trims, splits and deletes', () => {
    const a = proj();
    const b = clone(a);
    moveVideo(b, 'B', 0);
    expect(mapTime(a, b, 5)).toBe(1); // 1 s into B
    expect(mapTime(a, b, 1)).toBe(4); // 1 s into A
    const c = clone(a);
    c.clips[0].in = 1; // A trimmed by 1 s at the start
    expect(mapTime(a, c, 2)).toBe(1);
    expect(mapTime(a, c, 5)).toBe(4);
    const d = clone(a);
    splitClip(d, 'A', 2);
    expect(mapTime(a, d, 3)).toBe(3);
    const e = clone(a);
    deleteClips(e, ['A']);
    expect(mapTime(a, e, 2)).toBe(0);
    expect(mapTime(a, e, 6)).toBe(2);
  });

  it('remaps effect ranges, whole-range effects stretch', () => {
    const a = proj();
    a.effects = [makeEffect('bloom', 45, 55), makeEffect('kill', 0, 70)];
    const b = clone(a);
    moveVideo(b, 'B', 0);
    remapToFootage(a, b);
    expect([b.effects[0].start, b.effects[0].end]).toEqual([5, 15]);
    const c = clone(a);
    c.clips[0].out = 2;
    remapToFootage(a, c);
    expect([c.effects[1].start, c.effects[1].end]).toEqual([0, 50]);
    expect([c.effects[0].start, c.effects[0].end]).toEqual([25, 35]);
  });
});

describe('migration', () => {
  it('turns v1 clip lists into media + timeline clips', () => {
    const v1 = {
      version: 1,
      name: 'old',
      clips: [
        { id: 'x', source: { kind: 'file', fileId: 'x', name: 'x.mp4', mime: '', isImage: false, ext: 'mp4' }, duration: 5, width: 320, height: 240, fps: 25, hasAudio: true, in: 1, out: 3, speed: 1, reverse: false, fit: 'fit' },
        { id: 'y', source: { kind: 'generator', generator: 'life', name: 'Life' }, duration: 60, width: 320, height: 240, fps: 24, hasAudio: false, in: 0, out: 2, speed: 1, reverse: false, fit: 'fit' },
      ],
      encoder: { fps: 12 },
      decoder: {},
      effects: [makeEffect('kill', 0, 10)],
      audio: { source: 'clip', clipId: 'y', mode: 'follow', volume: 0.5 },
      globalSeed: 3,
    };
    const p = migrate(v1);
    expect(p.version).toBe(2);
    expect(p.media.map((m) => m.id)).toEqual(['x', 'y']);
    expect(p.clips.map((c) => [c.mediaId, c.in, c.out, c.track, c.muted])).toEqual([['x', 1, 3, 'v1', true], ['y', 0, 2, 'v1', false]]);
    expect(p.encoder.fps).toBe(12);
    expect(p.encoder.quality).toBe(4);
    expect(p.audio.volume).toBe(0.5);
    expect('source' in p.audio).toBe(false);
    expect(p.tracks.some((t) => t.id === 'a0')).toBe(true);
    expect(migrate(v1 as never).clips.length).toBe(2);
    expect(() => migrate({ version: 9 })).toThrow();
  });
});

describe('frame rate changes', () => {
  it('keep effects at the same moments', () => {
    const a = proj(); // 10 fps
    a.effects = [makeEffect('bloom', 45, 55)];
    const b = clone(a);
    b.encoder.fps = 20;
    remapToFootage(a, b);
    expect([b.effects[0].start, b.effects[0].end]).toEqual([90, 110]);
  });
});
