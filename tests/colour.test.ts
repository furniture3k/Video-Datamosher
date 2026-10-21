// Colours survive the pipeline: footage, pictures and titles come out of the preview and the
// exports the colour they went in, read the way a browser (JPEG: BT.601, full range) and a player
// (HD video: BT.709, video range) read them.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ff, hasFfmpeg, tmpdir, fileMedia, clipOf, place } from './helpers';
import { decodeToMjpegArgs, defaultExport, exportArgs, segmentArgs } from '../src/engine/args';
import { segments } from '../src/engine/timeline';
import { newProject, type Clip, type MediaItem, type Project } from '../src/engine/types';
import { hdrCube, hdrToSdr, parseColour, sourceMatrix } from '../src/engine/colour';

const d = hasFfmpeg ? describe : describe.skip;
const W = 1280;
const H = 720;
/** four stripes, left to right */
const PATCHES: [number, number, number][] = [
  [220, 40, 40],
  [40, 200, 60],
  [40, 60, 220],
  [224, 160, 128],
];
const TOL = 7;

/** The colour in the middle of each stripe of a picture or video, read as `how`. */
function stripes(dir: string, file: string, how: 'browser' | 'player'): [number, number, number][] {
  const vf = how === 'browser' ? 'scale=64:36:flags=area:in_color_matrix=bt601:in_range=pc' : 'scale=64:36:flags=area:in_color_matrix=bt709:in_range=tv';
  ff(dir, ['-i', file, '-frames:v', '1', '-vf', `${vf},format=rgb24`, '-f', 'rawvideo', file + '.rgb']);
  const b = new Uint8Array(fs.readFileSync(path.join(dir, file + '.rgb')));
  return PATCHES.map((_, i) => {
    const x = Math.round((i + 0.5) * 16);
    const o = (18 * 64 + x) * 3;
    return [b[o], b[o + 1], b[o + 2]];
  });
}

function expectColours(got: [number, number, number][], what: string) {
  got.forEach((c, i) => c.forEach((v, k) => expect(Math.abs(v - PATCHES[i][k]), `${what}: stripe ${i} channel ${k} is ${v}, wants ${PATCHES[i][k]}`).toBeLessThanOrEqual(TOL)));
}

d('colours through the pipeline', () => {
  let dir: string;
  const cam = fileMedia('cam', 'mp4', { hasAudio: false, width: W, height: H, fps: 24, color: { matrix: 'bt709', range: 'tv' } } as Partial<MediaItem>);
  const pic = fileMedia('pic', 'png', { width: W, height: H });
  beforeAll(() => {
    dir = tmpdir();
    // the stripes as a picture, and as camera footage (BT.709, tagged)
    const draw = PATCHES.map(([r, g, b], i) => `drawbox=x=${i * (W / 4)}:y=0:w=${W / 4}:h=${H}:color=0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}:t=fill`).join(',');
    ff(dir, ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=24:d=1,format=rgb24,${draw}`, '-frames:v', '1', 'pic.png']);
    ff(dir, ['-loop', '1', '-i', 'pic.png', '-t', '1', '-r', '24', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libx264', '-qp', '0', 'cam.mp4']);
    place(dir, 'cam.mp4', cam);
    place(dir, 'pic.png', pic);
    // the source itself reads right (the measuring is sound)
    expectColours(stripes(dir, 'cam.mp4', 'player'), 'source footage');
    expectColours(stripes(dir, 'pic.png', 'browser'), 'source picture');
  });

  function project(clips: Clip[], media: MediaItem[]): Project {
    const p = newProject();
    p.encoder = { ...p.encoder, width: W, fps: 24, quality: 1, gop: 1000, aspect: '16:9' };
    p.media = media;
    p.clips = clips;
    return p;
  }

  /** Prepare the timeline as the app does; the preview's JPEGs and an MP4 straight from it. */
  function run(p: Project, name: string) {
    ff(dir, segmentArgs(p, segments(p, 24, true)[0], W, `${name}.avi`));
    ff(dir, [...decodeToMjpegArgs(p.decoder, `${name}.avi`, `${name}.jpg`, 1).slice(0, -3), '-frames:v', '1', '-q:v', '1', '-f', 'image2', `${name}.jpg`]);
    const o = { ...defaultExport(), crf: 0, preset: 'ultrafast' as const };
    ff(dir, exportArgs(o, p.decoder, 24, { file: `${name}.avi`, mjpeg: false }, null, `${name}.mp4`));
    // the picture-effects path: the browser's JPEGs encoded to MP4
    ff(dir, exportArgs(o, p.decoder, 24, { file: `${name}.jpg`, mjpeg: true }, null, `${name}-fx.mp4`));
    return {
      preview: stripes(dir, `${name}.jpg`, 'browser'),
      mp4: stripes(dir, `${name}.mp4`, 'player'),
      fx: stripes(dir, `${name}-fx.mp4`, 'player'),
    };
  }

  it('camera footage', () => {
    const r = run(project([clipOf(cam, { out: 1 })], [cam]), 'plain');
    expectColours(r.preview, 'preview');
    expectColours(r.mp4, 'export');
    expectColours(r.fx, 'export with picture effects');
  });

  it('camera footage that is flipped (goes through RGB)', () => {
    const r = run(project([clipOf(cam, { out: 1, transform: { flipH: true } as Clip['transform'] })], [cam]), 'flip');
    // flipped: the stripes come in the other order
    const back = (x: [number, number, number][]) => [...x].reverse() as [number, number, number][];
    expectColours(back(r.preview), 'preview');
    expectColours(back(r.mp4), 'export');
  });

  it('a picture (RGB) on the main track', () => {
    const r = run(project([clipOf(pic, { out: 1, fit: 'stretch' })], [pic]), 'pic');
    expectColours(r.preview, 'preview');
    expectColours(r.mp4, 'export');
  });

  it('a picture over footage on a track above', () => {
    const top = clipOf(pic, { track: 'v2', start: 0, out: 1, fit: 'stretch' });
    const r = run(project([clipOf(cam, { out: 1 }), top], [cam, pic]), 'over');
    expectColours(r.preview, 'preview');
    expectColours(r.mp4, 'export');
  });

  it('older footage in BT.601 (untagged, below 720 lines) and a JPEG photo', () => {
    ff(dir, ['-loop', '1', '-i', 'pic.png', '-t', '1', '-r', '24', '-vf', `scale=${W}:${H},scale=out_color_matrix=bt601:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-qp', '0', 'sdsrc.mp4']);
    // (the size it says is what decides: untagged and under 720 lines is BT.601)
    const sd = fileMedia('sd', 'mp4', { hasAudio: false, width: 640, height: 360, fps: 24 });
    place(dir, 'sdsrc.mp4', sd);
    expectColours(run(project([clipOf(sd, { out: 1, fit: 'stretch' })], [sd]), 'sd').mp4, 'SD footage');
    ff(dir, ['-i', 'pic.png', '-q:v', '1', 'photo.jpg']);
    const jpg = fileMedia('photo', 'jpg', { width: W, height: H });
    place(dir, 'photo.jpg', jpg);
    const r = run(project([clipOf(jpg, { out: 1, fit: 'stretch' })], [jpg]), 'jpg');
    expectColours(r.preview, 'photo preview');
    expectColours(r.mp4, 'photo export');
  });

  it('HDR footage (HLG) is tone-mapped: its reference white comes out near white, not grey', () => {
    // HLG at 75 % is HDR's reference white; 38 % a mid-dark grey
    const hlg = fileMedia('hlg', 'mp4', { hasAudio: false, width: W, height: H, fps: 24, color: { pix: 'yuv420p10le', range: 'tv', matrix: 'bt2020nc', primaries: 'bt2020', transfer: 'arib-std-b67' } } as Partial<MediaItem>);
    const v = (x: number) => Math.round(64 + x * 876);
    ff(dir, ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=24:d=1,format=yuv420p10le,geq=lum='if(lt(X,${W / 2}),${v(0.75)},${v(0.38)})':cb=512:cr=512`, '-frames:v', '24', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p10le', '-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', 'hlgsrc.mp4']);
    place(dir, 'hlgsrc.mp4', hlg);
    fs.writeFileSync(path.join(dir, 'hdr_hlg.cube'), hdrCube('hlg'));
    const r = run(project([clipOf(hlg, { out: 1 })], [hlg]), 'hlg').mp4;
    const white = Math.round(255 * hdrToSdr('hlg', [0.75, 0.75, 0.75])[0]);
    const grey = Math.round(255 * hdrToSdr('hlg', [0.38, 0.38, 0.38])[0]);
    for (const c of r[0]) expect(Math.abs(c - white)).toBeLessThanOrEqual(TOL);
    for (const c of r[3]) expect(Math.abs(c - grey)).toBeLessThanOrEqual(TOL);
    // (without it, the 75 % grey stays a 75 % grey)
    expect(white).toBeGreaterThan(235);
  });

  it('exports say which colours they are in', () => {
    const log = (() => {
      try {
        ff(dir, ['-i', 'plain.mp4']);
        return '';
      } catch (e) {
        return String(e);
      }
    })();
    expect(log).toMatch(/bt709/);
  });
});

describe('reading colours from FFmpeg', () => {
  it('parses the properties of a stream', () => {
    expect(parseColour('Stream #0:0[0x1](und): Video: h264 (High 10) (avc1 / 0x31637661), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive), 320x240')).toEqual({ pix: 'yuv420p10le', range: 'tv', matrix: 'bt2020nc', primaries: 'bt2020', transfer: 'arib-std-b67' });
    expect(parseColour('Stream #0:0: Video: h264 (High), yuv420p(tv, bt709, progressive), 320x240')).toEqual({ pix: 'yuv420p', range: 'tv', matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' });
    expect(parseColour('Stream #0:0: Video: h264 (High), yuv420p(progressive), 320x240')).toEqual({ pix: 'yuv420p' });
    expect(parseColour('Stream #0:0: Video: png, rgb24(pc, gbr/unknown/unknown), 360x640')?.pix).toBe('rgb24');
    expect(parseColour('Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 320x240')).toMatchObject({ pix: 'yuvj420p', range: 'pc', matrix: 'bt470bg' });
    expect(parseColour('Stream #0:0: Audio: aac')).toBeUndefined();
  });
  it('knows the matrix of untagged footage by its size', () => {
    const file = { kind: 'file', fileId: 'a', name: 'a', mime: '', isImage: false, ext: 'mp4' } as const;
    expect(sourceMatrix({ source: file, width: 1920, height: 1080 })).toBe('bt709');
    expect(sourceMatrix({ source: file, width: 1080, height: 1920 })).toBe('bt709');
    expect(sourceMatrix({ source: file, width: 640, height: 480 })).toBe('bt601');
    expect(sourceMatrix({ source: file, width: 640, height: 480, color: { matrix: 'bt709' } })).toBe('bt709');
    expect(sourceMatrix({ source: file, width: 1920, height: 1080, color: { matrix: 'smpte170m' } })).toBe('bt601');
  });
});

describe('HDR to SDR', () => {
  it('maps black to black, reference white near white, and stays in order', () => {
    expect(hdrToSdr('hlg', [0, 0, 0])).toEqual([0, 0, 0]);
    expect(hdrToSdr('pq', [0, 0, 0])[0]).toBeCloseTo(0, 3);
    expect(hdrToSdr('hlg', [0.75, 0.75, 0.75])[0]).toBeGreaterThan(0.93);
    // PQ code 0.58 is 203 nits
    expect(hdrToSdr('pq', [0.58, 0.58, 0.58])[0]).toBeGreaterThan(0.93);
    let last = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const y = hdrToSdr('hlg', [x, x, x])[0];
      expect(y).toBeGreaterThanOrEqual(last);
      expect(y).toBeLessThanOrEqual(1);
      last = y;
    }
    // greys stay grey
    const g = hdrToSdr('pq', [0.5, 0.5, 0.5]);
    expect(Math.abs(g[0] - g[2])).toBeLessThan(0.01);
  });
  it('writes a cube FFmpeg can read', () => {
    const t = hdrCube('hlg', 5);
    expect(t.split('\n').filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l)).length).toBe(125);
  });
});
