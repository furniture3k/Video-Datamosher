// Milestone 4: keyframes, speed ramps, chroma key, LUTs, adjustment layers.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evalKeys, keysExpr, rampIntegral, rampInverse, rampLength, rampSetpts, type KeyPoint, type Ramp } from '../src/engine/keys';
import { clipLen, localTime, makeClip, segments, sourceTime, splitClip } from '../src/engine/timeline';
import { segmentArgs, segmentKey, windowClip } from '../src/engine/args';
import { cubeText, lutFile, parseCube, sampleLut } from '../src/engine/lut';
import { newProject, type Clip, type MediaItem, type Project } from '../src/engine/types';
import { hasFfmpeg, tmpdir, ff } from './helpers';

/** Evaluate an FFmpeg expression in JS (the functions our builders use). */
function ffEval(expr: string, vars: Record<string, number>): number {
  const fns = { if: (c: number, a: number, b: number) => (c ? a : b), lt: (a: number, b: number) => (a < b ? 1 : 0), max: Math.max, min: Math.min, clip: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)), cos: Math.cos, sin: Math.sin };
  const js = expr.replace(/\bif\(/g, 'F.if(').replace(/\b(lt|max|min|clip|cos|sin)\(/g, 'F.$1(').replace(/\bPI\b/g, 'Math.PI');
  return new Function('F', ...Object.keys(vars), `return ${js};`)(fns, ...Object.values(vars));
}

describe('keyframes', () => {
  const pts: KeyPoint[] = [[0.5, 0], [1.5, 10], [3, -4]];
  it('hold before and after, ease in between', () => {
    expect(evalKeys(pts, 0)).toBe(0);
    expect(evalKeys(pts, 1)).toBeCloseTo(5);
    expect(evalKeys(pts, 0.75)).toBeLessThan(2.5); // eased: slow start
    expect(evalKeys(pts, 9)).toBe(-4);
    expect(evalKeys([[2, 7]], 0)).toBe(7);
  });
  it('the FFmpeg expression gives the same curve', () => {
    const e = keysExpr(pts, 'T');
    for (let t = -0.5; t < 4; t += 0.13) expect(ffEval(e, { T: t })).toBeCloseTo(evalKeys(pts, t), 4);
  });
});

describe('speed ramps', () => {
  const r: Ramp = [[0, 0.5], [1, 2]];
  it('integral, length and inverse', () => {
    expect(rampIntegral([[0, 2], [1, 2]], 1)).toBeCloseTo(2);
    expect(rampIntegral(r, 1)).toBeCloseTo(1.25);
    expect(rampLength(r, 3)).toBeCloseTo(2.4);
    for (const y of [0, 0.3, 0.9, 1.25]) expect(rampIntegral(r, rampInverse(r, y))).toBeCloseTo(y, 5);
  });
  it('clips follow the ramp: length, source time and its inverse', () => {
    const c = { ...makeClip({ id: 'm', source: { kind: 'file', fileId: 'm', name: 'm', mime: '', isImage: false, ext: 'mp4' }, duration: 10, width: 320, height: 240, fps: 24, hasAudio: false, hasVideo: true }, 'v1'), in: 1, out: 4, ramp: r } as Clip;
    expect(clipLen(c)).toBeCloseTo(2.4);
    expect(sourceTime(c, 0)).toBeCloseTo(1);
    expect(sourceTime(c, 2.4)).toBeCloseTo(4);
    // slow at the start: the first half of the clip shows less than half the source
    expect(sourceTime(c, 1.2) - 1).toBeLessThan(1.5);
    for (const l of [0, 0.4, 1.7, 2.4]) expect(localTime(c, sourceTime(c, l))).toBeCloseTo(l, 4);
    expect(localTime({ ...c, reverse: true }, sourceTime({ ...c, reverse: true }, 1))).toBeCloseTo(1, 4);
  });
  it('the setpts expression maps source time to the same local time', () => {
    const e = rampSetpts(r, 3).replace('/TB', '');
    const c = { in: 0, out: 3, speed: 1, freeze: false, reverse: false, ramp: r } as Clip;
    for (const s of [0, 0.5, 1.4, 2.9]) expect(ffEval(e, { T: s })).toBeCloseTo(localTime(c, s), 2);
  });
});

describe('LUTs', () => {
  const invert = 'TITLE "inv"\nLUT_3D_SIZE 2\n' + [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${1 - r} ${1 - g} ${1 - b}`))).join('\n');
  it('parses 3D and 1D cubes and samples them', () => {
    const l = parseCube(invert);
    expect(l.size).toBe(2);
    const o = [0, 0, 0];
    sampleLut(l, 0.25, 0.5, 1, o);
    expect(o.map((v) => +v.toFixed(3))).toEqual([0.75, 0.5, 0]);
    const one = parseCube('LUT_1D_SIZE 3\n0 0 0\n0.25 0.5 1\n1 1 1\n');
    sampleLut(one, 0.5, 0.5, 0.5, o);
    expect(o.map((v) => +v.toFixed(3))).toEqual([0.25, 0.5, 1]);
    expect(() => parseCube('hello')).toThrow();
  });
  it('bakes the amount into the file the render reads', () => {
    const half = parseCube(cubeText(parseCube(invert), 0.5));
    const o = [0, 0, 0];
    sampleLut(half, 1, 0, 0.5, o);
    expect(o.map((v) => +v.toFixed(3))).toEqual([0.5, 0.5, 0.5]);
    expect(lutFile('ab-c!', 0.5)).toBe('lut_abc_50.cube');
  });
});

// ---------------------------------------------------------------- native renders

const d = hasFfmpeg ? describe : describe.skip;
d('native ffmpeg renders', () => {
  const fps = 24;
  const media = (id: string, duration = 3): MediaItem => ({ id, source: { kind: 'file', fileId: id, name: id, mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration, width: 320, height: 240, fps, hasAudio: false, hasVideo: true });
  const project = (clips: Clip[], ms: MediaItem[]): Project => ({ ...newProject(), encoder: { ...newProject().encoder, fps, width: 320, aspect: '4:3', gop: 1000 }, media: ms, clips });
  /** Render the timeline's first segment and return its frames as 64×48 gray pictures. */
  function render(dir: string, p: Project): Uint8Array[] {
    const seg = segments(p, fps, true)[0];
    ff(dir, segmentArgs(p, seg, 320, 'out.avi', (m) => `${m.id}.mp4`));
    ff(dir, ['-i', 'out.avi', '-vf', 'scale=64:48', '-pix_fmt', 'gray', '-f', 'rawvideo', 'out.gray']);
    const raw = new Uint8Array(fs.readFileSync(path.join(dir, 'out.gray')));
    const n = 64 * 48;
    return Array.from({ length: raw.length / n }, (_, i) => raw.subarray(i * n, (i + 1) * n));
  }
  const mean = (px: Uint8Array, x0 = 0, x1 = 64, y0 = 0, y1 = 48) => {
    let s = 0;
    let c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ((s += px[y * 64 + x]), c++);
    return s / c;
  };
  function sources(dir: string) {
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=white:s=320x240:r=24:d=3', '-pix_fmt', 'yuv420p', 'white.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=3', '-pix_fmt', 'yuv420p', 'black.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=0x00ff00:s=320x240:r=24:d=3,drawbox=x=120:y=80:w=80:h=80:color=red:t=fill', '-pix_fmt', 'yuv420p', 'green.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=3', '-pix_fmt', 'yuv420p', 'test.mp4']);
  }

  it('keyframed position moves the picture across the frame', () => {
    const dir = tmpdir();
    sources(dir);
    const c = { ...makeClip(media('white'), 'v1'), out: 2, keys: { zoom: [[0, 0.4]] as KeyPoint[], x: [[0, -0.3], [2, 0.3]] as KeyPoint[] } };
    const fr = render(dir, project([c], [media('white')]));
    expect(fr.length).toBe(48);
    expect(mean(fr[0], 0, 32)).toBeGreaterThan(mean(fr[0], 32, 64) + 40);
    expect(mean(fr[47], 32, 64)).toBeGreaterThan(mean(fr[47], 0, 32) + 40);
  });

  it('position-only keys slide the picture (overlay path)', () => {
    const dir = tmpdir();
    sources(dir);
    const c = { ...makeClip(media('white'), 'v2'), start: 0, out: 2, transform: { zoom: 0.4 }, keys: { x: [[0, -0.3], [2, 0.3]] as KeyPoint[] } };
    const base = { ...makeClip(media('black'), 'v1'), out: 2 };
    const fr = render(dir, project([base, c], [media('white'), media('black')]));
    expect(mean(fr[0], 0, 32)).toBeGreaterThan(mean(fr[0], 32, 64) + 40);
    expect(mean(fr[47], 32, 64)).toBeGreaterThan(mean(fr[47], 0, 32) + 40);
    const seg = segments(project([base, c], [media('white'), media('black')]), fps, true)[0];
    expect(segmentArgs(project([base, c], [media('white'), media('black')]), seg, 320, 'o.avi', (m) => m.id).join(' ')).not.toContain('perspective');
  });

  it('stabilization shifts the picture by its correction', () => {
    const dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=2,drawbox=x=150:y=0:w=20:h=240:color=white:t=fill', '-pix_fmt', 'yuv420p', 'bar.mp4']);
    const c = { ...makeClip(media('bar', 2), 'v1'), out: 1, stab: { x: [[0, 0.15]] as [number, number][], y: [[0, 0]] as [number, number][], r: [[0, 0]] as [number, number][], zoom: 1.6 } };
    const fr = render(dir, project([c], [media('bar', 2)]));
    // the bar (centre column 32 of 64) moves right by a quarter of the frame, magnified by the zoom
    // centre of the bright bar (its brightness-weighted mean column, + half a column for pixel centres)
    const col = (px: Uint8Array) => {
      let sum = 0;
      let wsum = 0;
      for (let x = 0; x < 64; x++) {
        const m = Math.max(0, mean(px, x, x + 1) - 60);
        sum += m * (x + 0.5);
        wsum += m;
      }
      return sum / wsum;
    };
    expect(Math.abs(col(fr[5]) - (32 + 0.15 * 1.6 * 64))).toBeLessThanOrEqual(1);
  });

  it('keyframed rotation and opacity', () => {
    const dir = tmpdir();
    sources(dir);
    const c = { ...makeClip(media('white'), 'v1'), out: 2, keys: { rotate: [[0, 0], [2, 45]] as KeyPoint[], zoom: [[0, 0.5]] as KeyPoint[], opacity: [[0, 1], [2, 0]] as KeyPoint[] } };
    const fr = render(dir, project([c], [media('white')]));
    expect(mean(fr[0])).toBeGreaterThan(40);
    expect(mean(fr[47])).toBeLessThan(10);
  });

  it('a speed ramp makes the clip the length the ramp says', () => {
    const dir = tmpdir();
    sources(dir);
    const c = { ...makeClip(media('test'), 'v1'), out: 3, ramp: [[0, 0.5], [1, 2]] as Ramp };
    const fr = render(dir, project([c], [media('test')]));
    expect(fr.length).toBe(Math.round(2.4 * fps));
  });

  it('chroma key shows the track below through the green', () => {
    const dir = tmpdir();
    sources(dir);
    const base = { ...makeClip(media('white'), 'v1'), out: 1 };
    const top = { ...makeClip(media('green'), 'v2'), out: 1, start: 0, key: { color: '#00ff00', similarity: 0.3, blend: 0.05, spill: true } };
    const fr = render(dir, project([base, top], [media('white'), media('green')]));
    // the green surround is now white (the clip below); the red box stays dark-ish
    expect(mean(fr[10], 0, 10)).toBeGreaterThan(200);
    expect(mean(fr[10], 27, 37, 19, 29)).toBeLessThan(150);
  });

  it('a LUT recolours the clip', () => {
    const dir = tmpdir();
    sources(dir);
    const inv = 'LUT_3D_SIZE 2\n' + [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${1 - r} ${1 - g} ${1 - b}`))).join('\n');
    fs.writeFileSync(path.join(dir, lutFile('inv', 1)), cubeText(parseCube(inv), 1));
    const c = { ...makeClip(media('white'), 'v1'), out: 1, grade: { lut: 'inv', lutAmount: 1 } };
    const fr = render(dir, project([c], [media('white')]));
    expect(mean(fr[5])).toBeLessThan(30);
  });

  it('an adjustment layer re-grades what is under it, only while it is on', () => {
    const dir = tmpdir();
    sources(dir);
    const adj: MediaItem = { id: 'adj', source: { kind: 'adjust', name: 'Adjustment' }, duration: 3600, width: 0, height: 0, fps, hasAudio: false, hasVideo: true };
    const base = { ...makeClip(media('white'), 'v1'), out: 2 };
    const layer = { ...makeClip(adj, 'v2'), start: 1, in: 0, out: 1, grade: { brightness: -1 } };
    const fr = render(dir, project([base, layer], [media('white'), adj]));
    expect(mean(fr[10])).toBeGreaterThan(200);
    expect(mean(fr[36])).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------- compounds and scopes
import { buildCompound, innerProject, renderProject, rootWithInner, sequenceOf, staleCompounds, withSequence } from '../src/engine/compound';
import { layoutVideo as layout } from '../src/engine/timeline';
import { makeEffect } from '../src/engine/presets';
import { chroma, histogramData, waveformData } from '../src/lib/scopes';

describe('compound clips', () => {
  const m = (id: string): MediaItem => ({ id, source: { kind: 'file', fileId: id, name: id, mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration: 10, width: 320, height: 240, fps: 24, hasAudio: true, hasVideo: true });
  const base = (): Project => {
    const p = { ...newProject(), media: [m('a'), m('b'), m('c'), m('d')] };
    p.encoder.fps = 24;
    p.clips = ['a', 'b', 'c', 'd'].map((id) => ({ ...makeClip(m(id), 'v1'), id: 'clip_' + id, out: 2 }));
    p.clips[2].transition = { type: 'melt', duration: 1, intensity: 1 };
    p.effects = [makeEffect('bloom', 50, 60), makeEffect('glitch', 10, 30)];
    return p;
  };
  const cmp: MediaItem = { id: 'cmp', source: { kind: 'file', fileId: '', name: 'Compound 1', mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration: 1, width: 0, height: 0, fps: 24, hasAudio: true, hasVideo: true };

  it('folds a run of the main track into one clip of the same length', () => {
    const p = base();
    const { seq, project } = buildCompound(p, ['clip_b', 'clip_c'], cmp);
    expect(seq.clips.map((c) => c.id)).toEqual(['clip_b', 'clip_c']);
    expect(seq.clips[0].transition).toBeUndefined();
    expect(seq.clips[1].transition?.type).toBe('melt');
    const after = layout({ ...project, media: [...project.media, { ...cmp, duration: 4 }] });
    expect(after.map((pl) => pl.clip.mediaId)).toEqual(['a', 'cmp', 'd']);
    expect(after[1].start).toBeCloseTo(2);
    expect(after[1].end).toBeCloseTo(6);
    // effects wholly inside the run (frames 48-96) move in, shifted; the rest stay put
    expect(seq.effects.map((e) => [e.type, e.start, e.end])).toEqual([['bloom', 2, 12]]);
    expect(project.effects.length).toBe(2);
    expect(renderProject(p, seq).effects).toEqual([]);
    expect(renderProject(p, { ...seq, moshInside: true }).effects.length).toBe(1);
  });

  it('opening and closing round-trips; edits mark the compound stale until rendered', () => {
    const p0 = base();
    const { seq, project } = buildCompound(p0, ['clip_b', 'clip_c'], cmp);
    const parent: Project = { ...project, media: [...project.media, { ...cmp, source: { ...cmp.source, compound: seq } as MediaItem['source'] }] };
    const inner = innerProject(parent, seq);
    expect(inner.clips.map((c) => c.id)).toEqual(['clip_b', 'clip_c']);
    expect(JSON.stringify(sequenceOf(inner))).toBe(JSON.stringify(seq));
    // edit inside: trim the last clip; the autosaved root carries it, marked stale
    inner.clips = inner.clips.map((c, i) => (i === 1 ? { ...c, out: 1 } : c));
    const root = rootWithInner([{ parent, mediaId: 'cmp' }], inner);
    expect(staleCompounds(root).map((x) => x.id)).toEqual(['cmp']);
    // rendered: the file and duration are updated, clips past the new end are trimmed
    const done = withSequence(root, 'cmp', sequenceOf(inner), { fileId: 'f2', duration: 3 });
    const md = done.media.find((x) => x.id === 'cmp')!;
    expect(staleCompounds(done)).toEqual([]);
    expect(md.duration).toBe(3);
    expect(done.clips.find((c) => c.mediaId === 'cmp')!.out).toBe(3);
  });

  it('refuses an empty selection', () => {
    expect(() => buildCompound(base(), ['nope'], cmp)).toThrow();
  });
});

describe('scopes', () => {
  // a 2×2 picture: black, white, pure red, pure blue
  const px = Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  it('waveform and histogram count levels', () => {
    const wf = waveformData(px, 2, 2, 2);
    expect(wf[0 * 256 + 0]).toBe(1);
    expect(wf[1 * 256 + 255]).toBe(1);
    const [r, , b, l] = histogramData(px);
    expect(r[255]).toBe(2);
    expect(b[255]).toBe(2);
    expect(l[0]).toBe(1);
  });
  it('vectorscope: grey at the centre, red up-right-ish, blue to the right', () => {
    expect(chroma(128, 128, 128).map((v) => Math.abs(v) < 1e-9)).toEqual([true, true]);
    const [ru, rv] = chroma(255, 0, 0);
    expect(rv).toBeGreaterThan(0.9);
    expect(ru).toBeLessThan(0);
    expect(chroma(0, 0, 255)[0]).toBeGreaterThan(0.9);
  });
});

describe('editing ramped clips', () => {
  it('splitting keeps both halves timed exactly as the whole', () => {
    const m: MediaItem = { id: 'm', source: { kind: 'file', fileId: 'm', name: 'm', mime: '', isImage: false, ext: 'mp4' }, duration: 10, width: 320, height: 240, fps: 24, hasAudio: false, hasVideo: true };
    const p: Project = { ...newProject(), media: [m] };
    const c = { ...makeClip(m, 'v1'), in: 0, out: 6, ramp: [[0, 0.5], [0.5, 3], [1, 1]] as Ramp };
    p.clips = [c];
    const len = clipLen(c);
    const whole = [0.3, 1.1, len - 0.2].map((t) => sourceTime(c, t));
    const b = splitClip(p, c.id, 1.0)!;
    const a = p.clips[0];
    expect(clipLen(a)).toBeCloseTo(1.0, 5);
    expect(clipLen(b)).toBeCloseTo(len - 1.0, 5);
    expect(sourceTime(a, 0.3)).toBeCloseTo(whole[0], 4);
    expect(sourceTime(b, 0.1)).toBeCloseTo(whole[1], 4);
    expect(sourceTime(b, len - 1.2)).toBeCloseTo(whole[2], 4);
  });
});

describe('review fixes', () => {
  const m: MediaItem = { id: 'm', source: { kind: 'file', fileId: 'm', name: 'm', mime: '', isImage: false, ext: 'mp4' }, duration: 20, width: 320, height: 240, fps: 24, hasAudio: false, hasVideo: true };
  it('a windowed piece of a ramped clip shows the same source at the same times', () => {
    const c = { ...makeClip(m, 'v2'), in: 2, out: 8, ramp: [[0, 0.5], [0.5, 3], [1, 1]] as Ramp };
    const len = clipLen(c);
    const [a, b] = [len * 0.3, len * 0.7];
    const w = windowClip(c, a, b);
    expect(clipLen(w)).toBeCloseTo(b - a, 4);
    for (const t of [0, 0.2, b - a - 0.01]) expect(sourceTime(w, t)).toBeCloseTo(sourceTime(c, a + t), 3);
  });
  it('changing keyframes, a ramp, a key or stabilization re-prepares the segment', () => {
    const p: Project = { ...newProject(), media: [m], clips: [{ ...makeClip(m, 'v1'), out: 3 }] };
    const key = (q: Project) => segmentKey(q, segments(q, 24)[0], 320, (x) => x.id);
    const base = key(p);
    const with_ = (patch: Partial<Clip>) => key({ ...p, clips: [{ ...p.clips[0], ...patch }] });
    expect(with_({ keys: { x: [[0, 0.1]] } })).not.toBe(base);
    expect(with_({ ramp: [[0, 1], [1, 2]] })).not.toBe(base);
    expect(with_({ key: { color: '#00ff00', similarity: 0.2, blend: 0, spill: false } })).not.toBe(base);
    expect(with_({ stab: { x: [[0, 0]], y: [[0, 0]], r: [[0, 0]], zoom: 1.1 } })).not.toBe(base);
  });
});
