import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ff, ffLog, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { prepArgs, segmentArgs, decodeToMjpegArgs, audioMixArgs, exportArgs, defaultExport, parseProbe } from '../src/engine/args';
import { framesFromAvi, applyBitstream, writeMoshed, concatPrepared } from '../src/engine/mosh';
import { cutFrames, segments, timelineDuration, transitionEffects } from '../src/engine/timeline';
import { splitJpegs } from '../src/engine/jpeg';
import { newProject, type EffectInstance, type Project } from '../src/engine/types';
import { cardRect } from '../src/engine/canvas';
import { EFFECTS, defaultParams } from '../src/engine/effects';

const d = hasFfmpeg ? describe : describe.skip;

function effect(type: string, params: Record<string, unknown> = {}, start = 0, end = 1e9): EffectInstance {
  return { id: type + Math.random(), type, enabled: true, solo: false, start, end, seed: 7, params: { ...defaultParams(EFFECTS[type].params), ...params } as EffectInstance['params'], auto: {}, locks: [] };
}

d('native ffmpeg pipeline', () => {
  let dir: string;
  let project: Project;
  beforeAll(() => {
    dir = tmpdir();
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', 'a.mp4']);
    ff(dir, ['-f', 'lavfi', '-i', 'mandelbrot=s=320x240:r=25:end_scale=0.1', '-t', '2', '-c:v', 'libx264', 'b.mp4']);
    project = newProject();
    project.encoder.fps = 25;
    project.encoder.width = 320;
    project.encoder.gop = 12;
    const ma = fileMedia('a', 'mp4');
    const mb = fileMedia('b', 'mp4', { hasAudio: false });
    project.media = [ma, mb];
    project.clips = [clipOf(ma), clipOf(mb)];
    place(dir, 'a.mp4', ma);
    place(dir, 'b.mp4', mb);
    ff(dir, prepArgs(project, 320));
  });

  it('probe parser reads ffmpeg -i output', () => {
    const p = parseProbe(ffLog(dir, ['-i', 'a.mp4']));
    expect(p.width).toBe(320);
    expect(p.hasAudio).toBe(true);
    expect(p.duration).toBeCloseTo(2, 0);
    expect(parseProbe(ffLog(dir, ['-i', 'b.mp4'])).hasAudio).toBe(false);
  });

  it('prepares an AVI with detectable I/P frames and keys at cuts', () => {
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    expect(prep.frames.length).toBe(100);
    expect(prep.frames[0].type).toBe('I');
    const types = prep.frames.map((f) => f.type);
    expect(types.every((t) => t === 'I' || t === 'P')).toBe(true);
    expect(types[50]).toBe('I'); // forced key at the cut
    expect(types.filter((t) => t === 'I').length).toBeGreaterThanOrEqual(8); // gop 12
    expect(cutFrames(project, 25)).toEqual([50]);
  });

  it('round-trips unmodified and decodes every frame', () => {
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
    fs.writeFileSync(path.join(dir, 'rt.avi'), writeMoshed(prep, prep.frames));
    ff(dir, decodeToMjpegArgs(project.decoder, 'rt.avi', 'rt.mjpeg'));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'rt.mjpeg')))).length).toBe(100);
  });

  for (const [type, params] of [
    ['kill', {}],
    ['kill', { mode: 'cuts', replace: 'prev' }],
    ['bloom', { repeats: 30, target: 'strongest' }],
    ['bloom', { target: 'every', interval: 1, repeats: 2 }],
    ['stutter', { pingpong: true, every: 10 }],
    ['shuffle', {}],
    ['reverse', {}],
    ['drop', {}],
    ['echo', { taps: 2 }],
    ['splice', { from: 55, length: 20 }],
    ['splice', { from: 55, length: 20, mode: 'insert', loops: 2 }],
    ...['flip', 'replace', 'nudge', 'zero', 'max', 'run', 'repeat', 'swap', 'shift', 'insert', 'delete'].map((m) => ['glitch', { mode: m, amount: 8, probability: 1 }]),
  ] as [string, Record<string, unknown>][]) {
    it(`effect ${type} ${JSON.stringify(params)} produces a decodable mosh`, () => {
      const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
      const p: Project = { ...project, effects: [effect('kill', {}, 0, 1e9), effect(type, params, 20, 80)] };
      const frames = applyBitstream(prep, p, [50]);
      expect(frames[0].type).toBe('I');
      fs.writeFileSync(path.join(dir, 'm.avi'), writeMoshed(prep, frames));
      ff(dir, decodeToMjpegArgs(project.decoder, 'm.avi', 'm.mjpeg'));
      const n = splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'm.mjpeg')))).length;
      // Every chunk should come out as a picture (glitched data may lose a couple).
      expect(n).toBeGreaterThanOrEqual(frames.length - (type === 'glitch' ? 10 : 0));
      expect(n).toBeLessThanOrEqual(frames.length);
      if (type === 'kill') expect(frames.filter((f) => f.type === 'I').length).toBeLessThan(prep.frames.filter((f) => f.type === 'I').length);
    });
  }

  it('builds timeline audio and exports mp4 / gif / webm', () => {
    const mix = audioMixArgs(project, timelineDuration(project))!;
    expect(mix.outputs.clean).toBeUndefined();
    ff(dir, mix.args);
    const raw = fs.readFileSync(path.join(dir, 'mosh.raw'));
    expect(raw.length / 4 / 44100).toBeCloseTo(4, 1);
    ff(dir, ['-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'mosh.raw', 'audio.wav']);
    // webm needs libvorbis, which the browser engine has but some native builds (Homebrew's) lack
    const vorbis = /libvorbis/.test(execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString());
    if (!vorbis) console.warn('libvorbis missing in this ffmpeg: skipping the webm export check');
    for (const format of ['mp4', 'gif', ...(vorbis ? ['webm'] : [])] as ('mp4' | 'gif' | 'webm')[]) {
      const o = { ...defaultExport(), format, width: 160 };
      ff(dir, exportArgs(o, project.decoder, 25, { file: 'prep.avi', mjpeg: false }, 'audio.wav', `out.${format}`));
      expect(fs.statSync(path.join(dir, `out.${format}`)).size).toBeGreaterThan(1000);
    }
    ff(dir, decodeToMjpegArgs(project.decoder, 'prep.avi', 'frames.mjpeg', 3));
    ff(dir, exportArgs({ ...defaultExport() }, project.decoder, 25, { file: 'frames.mjpeg', mjpeg: true }, null, 'post.mp4'));
    expect(parseProbe(ffLog(dir, ['-i', 'post.mp4'])).duration).toBeCloseTo(4, 0);
  });

  it('mpeg2 codec works too', () => {
    const p2: Project = { ...project, encoder: { ...project.encoder, codec: 'mpeg2' } };
    ff(dir, prepArgs(p2, 320, 'prep2.avi'));
    const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep2.avi'))), 'mpeg2');
    expect(prep.frames.length).toBe(100);
    expect(prep.frames[0].type).toBe('I');
    expect(prep.frames[1].type).toBe('P');
    const frames = applyBitstream(prep, { ...p2, effects: [effect('kill'), effect('bloom', { repeats: 10 }, 10, 40)] }, [50]);
    fs.writeFileSync(path.join(dir, 'm2.avi'), writeMoshed(prep, frames));
    ff(dir, decodeToMjpegArgs(project.decoder, 'm2.avi', 'm2.mjpeg'));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'm2.mjpeg')))).length).toBeGreaterThan(frames.length - 5);
  });

  it('segments prepared separately join into one decodable stream', () => {
    const segs = segments(project, 25);
    expect(segs.map((sg) => [sg.f0, sg.f1])).toEqual([[0, 50], [50, 100]]);
    const parts = segs.map((sg, i) => {
      ff(dir, segmentArgs(project, sg, 320, `seg${i}.avi`));
      const pr = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, `seg${i}.avi`))), 'mpeg4');
      expect(pr.frames.length).toBe(sg.f1 - sg.f0);
      expect(pr.frames[0].type).toBe('I');
      return pr;
    });
    const prep = concatPrepared(parts);
    expect(prep.frames.map((f) => f.src)).toEqual([...Array(100).keys()]);
    const frames = applyBitstream(prep, { ...project, effects: [effect('kill', { replace: 'drop' }, 50, 51)] }, [50]);
    expect(frames.length).toBe(99);
    // filling the gap (the default) keeps the length
    expect(applyBitstream(prep, { ...project, effects: [effect('kill', {}, 50, 51)] }, [50]).length).toBe(100);
    fs.writeFileSync(path.join(dir, 'segm.avi'), writeMoshed(prep, frames));
    ff(dir, decodeToMjpegArgs(project.decoder, 'segm.avi', 'segm.mjpeg'));
    expect(splitJpegs(new Uint8Array(fs.readFileSync(path.join(dir, 'segm.mjpeg')))).length).toBe(99);
  });

  it('blend transitions overlap clips and keep exact frame counts', () => {
    for (const type of ['dissolve', 'dip', 'wipeleft', 'circleopen', 'pixelize', 'whipleft', 'whipright', 'zoomin', 'blurdissolve', 'clock', 'diagonal', 'squeeze', 'circleclose'] as const) {
      const p: Project = { ...project, clips: [project.clips[0], { ...project.clips[1], transition: { type, duration: 0.8, intensity: 0.5 } }] };
      expect(timelineDuration(p)).toBeCloseTo(3.2, 5);
      const segs = segments(p, 25);
      expect(segs.length).toBe(1);
      ff(dir, segmentArgs(p, segs[0], 320, 'x.avi'));
      expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'x.avi'))), 'mpeg4').frames.length).toBe(80);
      ff(dir, prepArgs(p, 320, 'xw.avi'));
      expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'xw.avi'))), 'mpeg4').frames.length).toBe(80);
    }
  });

  it('mosh transitions turn into effects at the cut', () => {
    for (const type of ['melt', 'bloom', 'glitch', 'stutter', 'liquid'] as const) {
      const p: Project = { ...project, clips: [project.clips[0], { ...project.clips[1], transition: { type, duration: 1, intensity: 0.7 } }] };
      const fx = transitionEffects(p, 25);
      expect(fx[0].type).toBe('kill');
      expect(fx[0].start).toBeLessThanOrEqual(50);
      expect(fx[0].end).toBeGreaterThan(50);
      const prep = framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'prep.avi'))), 'mpeg4');
      const frames = applyBitstream(prep, p, [50]);
      expect(frames.filter((f) => f.type === 'I').length).toBeLessThan(prep.frames.filter((f) => f.type === 'I').length);
      // transitions keep the timeline's length, so the playhead and sound stay in sync
      expect(frames.length).toBe(prep.frames.length);
    }
  });

  it('mixes clip audio and audio tracks into mosh and clean buses', () => {
    const music = fileMedia('m', 'wav', { duration: 6 });
    ff(dir, ['-f', 'lavfi', '-i', 'sine=f=220:d=6', 'm.wav']);
    place(dir, 'm.wav', music);
    const p: Project = {
      ...project,
      media: [...project.media, music],
      clips: [...project.clips, clipOf(music, { track: 'a1', start: 1, in: 0.5, out: 6, fadeIn: 0.5, fadeOut: 1, volume: 0.8 })],
    };
    const total = timelineDuration(p);
    expect(total).toBeCloseTo(6.5, 5);
    const mix = audioMixArgs(p, total)!;
    expect(mix.outputs).toEqual({ mosh: 'mosh.raw', clean: 'clean.raw' });
    ff(dir, mix.args);
    for (const f of ['mosh.raw', 'clean.raw']) expect(Math.abs(fs.statSync(path.join(dir, f)).size / 4 / 44100 - total)).toBeLessThan(0.03);
    const clean = new Int16Array(new Uint8Array(fs.readFileSync(path.join(dir, 'clean.raw'))).buffer);
    const rms = (a: number, b: number) => Math.sqrt(clean.subarray(a * 88200, b * 88200).reduce((s, v) => s + v * v, 0) / ((b - a) * 88200));
    expect(rms(0, 0.9)).toBeLessThan(10); // music starts at 1 s
    expect(rms(2, 4)).toBeGreaterThan(1000);
    // the video (4 s) is shorter than the music, so the prepared video gets a black tail
    ff(dir, prepArgs(p, 320, 'tail.avi'));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'tail.avi'))), 'mpeg4').frames.length).toBe(Math.round(6.5 * 25));
    const segs = segments(p, 25);
    expect(segs.at(-1)!.clips.length).toBe(0);
    ff(dir, segmentArgs(p, segs.at(-1)!, 320, 'black.avi'));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'black.avi'))), 'mpeg4').frames.length).toBe(segs.at(-1)!.f1 - segs.at(-1)!.f0);
  });

  it('muted tracks and clips drop out of the mix', () => {
    const p: Project = { ...project, tracks: project.tracks.map((t) => (t.id === 'a0' ? { ...t, muted: true } : t)) };
    expect(audioMixArgs(p, 4)).toBeNull();
    const q: Project = { ...project, clips: project.clips.map((c) => ({ ...c, muted: true })) };
    expect(audioMixArgs(q, 4)).toBeNull();
  });

  it('burns melting titles into prepared segments', () => {
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=red:s=320x240,format=rgba,geq=r=255:g=0:b=0:a=if(between(X\\,100\\,220)*between(Y\\,100\\,140)\\,255\\,0)', '-frames:v', '1', 'title.png']);
    const tx = { id: 't', kind: 'text' as const, row: 'g1', text: 'Hi', start: 1, duration: 2, size: 0.1, color: '#fff', font: 'sans' as const, bold: true, x: 0.5, y: 0.5, align: 'center' as const, shadow: false, box: false, fade: 0.3, moshed: true };
    const p: Project = { ...project, layers: [tx] };
    const segs = segments(p, 25);
    ff(dir, segmentArgs(p, segs[0], 320, 'tseg.avi', undefined, [{ layer: tx, path: 'title.png' }]));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'tseg.avi'))), 'mpeg4').frames.length).toBe(50);
    ff(dir, ['-i', 'tseg.avi', '-vf', 'select=eq(n\\,40),crop=20:20:150:110', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'px.raw']);
    const px = fs.readFileSync(path.join(dir, 'px.raw'));
    expect(px[0]).toBeGreaterThan(180); // red box visible at 1.6 s
    expect(px[1]).toBeLessThan(90);
    ff(dir, prepArgs(p, 320, 'tall.avi', undefined, [{ layer: tx, path: 'title.png' }]));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'tall.avi'))), 'mpeg4').frames.length).toBe(100);
    // the black tail segment can carry a title too
    const q: Project = { ...p, layers: [{ ...tx, start: 0.2 }], clips: [], media: p.media };
    q.clips = [clipOf(p.media[0], { track: 'a1', out: 2 })];
    const bs = segments(q, 25)[0];
    expect(bs.f1 - bs.f0).toBe(55); // the title (to 2.2 s) is the longest thing
    ff(dir, segmentArgs(q, bs, 320, 'tblack.avi', undefined, [{ layer: q.layers[0], path: 'title.png' }]));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'tblack.avi'))), 'mpeg4').frames.length).toBe(55);
  });

  it('burns in melting layers that move, one picture per frame, across segments', () => {
    // a box moving right at 100 px/s, drawn for each of the title's 50 frames (1 s to 3 s)
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black@0:s=320x240:r=25:d=2,format=rgba', '-f', 'lavfi', '-i', 'color=c=white:s=40x40:r=25:d=2,format=rgba', '-filter_complex', "[0][1]overlay=x='20+t*100':y=100:format=auto,format=rgba", '-f', 'image2pipe', '-c:v', 'png', 'moving.pngs']);
    const tx = { id: 'm', kind: 'text' as const, row: 'g1', text: 'Hi', start: 1, duration: 2, size: 0.1, color: '#fff', font: 'sans' as const, bold: true, x: 0.5, y: 0.5, align: 'center' as const, shadow: false, box: false, fade: 0, moshed: true, anim: 'type' as const };
    const p: Project = { ...project, layers: [tx] };
    const over = [{ layer: tx, path: 'moving.pngs', frames: { first: 25, count: 50 } }];
    const segs = segments(p, 25);
    expect(segs.map((sg) => [sg.f0, sg.f1])).toEqual([[0, 50], [50, 100]]);
    ff(dir, segmentArgs(p, segs[0], 320, 'mov0.avi', undefined, over));
    ff(dir, segmentArgs(p, segs[1], 320, 'mov1.avi', undefined, over));
    ff(dir, segmentArgs(p, segs[0], 320, 'base0.avi'));
    ff(dir, segmentArgs(p, segs[1], 320, 'base1.avi'));
    for (const f of ['mov0', 'mov1', 'base0', 'base1']) expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, f + '.avi'))), 'mpeg4').frames.length).toBe(50);
    /** how much the burned-in box changed a 20×20 patch at x (box rows), frame n of the segment */
    const changed = (seg: 0 | 1, n: number, x: number) => {
      const px = (f: string) => {
        ff(dir, ['-i', f, '-vf', `select=eq(n\\,${n}),crop=20:20:${x}:110`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', f + '.px']);
        return fs.readFileSync(path.join(dir, f + '.px'));
      };
      const a = px(`mov${seg}.avi`);
      const b = px(`base${seg}.avi`);
      return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
    };
    // before the title: nothing burned in
    expect(changed(0, 10, 30)).toBeLessThan(8);
    // frame 30 (0.2 s into the title): the box is at x 40..80
    expect(changed(0, 30, 50)).toBeGreaterThan(60);
    expect(changed(0, 30, 200)).toBeLessThan(8);
    // frame 70, in the next segment (1.8 s in, so 45 pictures in): the box is at x 200..240
    expect(changed(1, 20, 210)).toBeGreaterThan(60);
    expect(changed(1, 20, 50)).toBeLessThan(8);
    // after the title: nothing
    expect(changed(1, 40, 210)).toBeLessThan(8);
  });

  it('starts a moving layer part-way into a segment', () => {
    const tx = { id: 'm', kind: 'text' as const, row: 'g1', text: 'Hi', start: 0.6, duration: 1, size: 0.1, color: '#fff', font: 'sans' as const, bold: true, x: 0.5, y: 0.5, align: 'center' as const, shadow: false, box: false, fade: 0, moshed: true, anim: 'type' as const };
    const p: Project = { ...project, layers: [tx] };
    const seg = segments(p, 25)[0];
    ff(dir, segmentArgs(p, seg, 320, 'late.avi', undefined, [{ layer: tx, path: 'moving.pngs', frames: { first: 15, count: 25 } }]));
    ff(dir, segmentArgs(p, seg, 320, 'late0.avi'));
    const patch = (f: string, n: number) => {
      ff(dir, ['-i', f, '-vf', `select=eq(n\\,${n}),crop=20:20:30:110`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', f + '.px']);
      return fs.readFileSync(path.join(dir, f + '.px'));
    };
    const diff = (n: number) => {
      const a = patch('late.avi', n);
      const b = patch('late0.avi', n);
      return a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
    };
    expect(diff(10)).toBeLessThan(8); // 0.4 s: not yet
    expect(diff(16)).toBeGreaterThan(60); // 0.64 s: its second picture, the box at x 24..64
  });

  it('sets the picture in as a card on the canvas: backdrop, round corners and border', () => {
    const c = { bg: 'color' as const, color: '#00ff00', inset: 0.1, radius: 0.1, border: 0.02, borderColor: '#0000ff' };
    const p: Project = { ...project, canvas: c };
    const seg = segments(p, 25)[0];
    const { w, h } = { w: 320, h: 240 };
    const R = cardRect(c, w, h);
    const b = Math.round(0.02 * h);
    // the pictures the page draws, made here with FFmpeg: a green backdrop, the card's shape
    // with its top-left corner cut off, and a blue border round the card
    ff(dir, ['-f', 'lavfi', '-i', `color=c=0x00ff00:s=${w}x${h}`, '-frames:v', '1', 'cv_bg.png']);
    ff(dir, ['-f', 'lavfi', '-i', `color=c=white:s=${R.w}x${R.h},format=gray,geq=lum='if(lt(X\\,${R.r})*lt(Y\\,${R.r})\\,0\\,255)'`, '-frames:v', '1', 'cv_mask.png']);
    ff(dir, ['-f', 'lavfi', '-i', `color=c=blue:s=${w}x${h},format=rgba,geq=r=0:g=0:b=255:a='if(between(X\\,${R.x - b}\\,${R.x + R.w + b - 1})*between(Y\\,${R.y - b}\\,${R.y + R.h + b - 1})*not(between(X\\,${R.x}\\,${R.x + R.w - 1})*between(Y\\,${R.y}\\,${R.y + R.h - 1}))\\,255\\,0)'`, '-frames:v', '1', 'cv_border.png']);
    ff(dir, segmentArgs(p, seg, w, 'card.avi', undefined, [], { bg: 'cv_bg.png', mask: 'cv_mask.png', border: 'cv_border.png' }));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'card.avi'))), 'mpeg4').frames.length).toBe(seg.f1 - seg.f0);
    ff(dir, ['-i', 'card.avi', '-vf', 'select=eq(n\\,10)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'card.raw']);
    const px = fs.readFileSync(path.join(dir, 'card.raw'));
    const at = (x: number, y: number) => [...px.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
    const green = ([r, g, bl]: number[]) => g > 180 && r < 80 && bl < 80;
    const blue = ([r, g, bl]: number[]) => bl > 160 && r < 80 && g < 80;
    expect(green(at(4, 4))).toBe(true); // the backdrop, outside the card
    expect(green(at(R.x + 2, R.y + 2))).toBe(true); // the card's cut-off corner shows the backdrop
    expect(blue(at(R.x + R.w / 2, R.y - Math.ceil(b / 2)))).toBe(true); // the border, just above the card
    expect(green(at(R.x + R.w / 2, R.y + R.h / 2)) || blue(at(R.x + R.w / 2, R.y + R.h / 2))).toBe(false); // the picture in the middle
    // without the canvas's pictures nothing changes (as old projects)
    expect(segmentArgs(p, seg, w, 'x.avi').join(' ')).toBe(segmentArgs(project, seg, w, 'x.avi').join(' '));
  });

  it('puts the card on a blurred copy of the picture', () => {
    const c = { bg: 'blur' as const, color: '#000000', blur: 0.5, inset: 0.15 };
    const p: Project = { ...project, canvas: c };
    const seg = segments(p, 25)[0];
    ff(dir, ['-f', 'lavfi', '-i', 'color=c=black@0:s=320x240,format=rgba', '-frames:v', '1', 'cv_clear.png']);
    ff(dir, segmentArgs(p, seg, 320, 'blur.avi', undefined, [], { bg: 'cv_clear.png' }));
    expect(framesFromAvi(new Uint8Array(fs.readFileSync(path.join(dir, 'blur.avi'))), 'mpeg4').frames.length).toBe(seg.f1 - seg.f0);
  });
});
