// FFmpeg argument builders. Pure functions so they can be tested with native ffmpeg.
import type { Clip, DecoderSettings, EncoderSettings, MediaItem, Project, TextClip } from './types';
import { BLEND_TRANSITIONS, audioSources, clipLen, cutFrames, segments, transitionKeyTimes, type Segment } from './timeline';

export const GENERATORS: { id: string; name: string; spec: (w: number, h: number, fps: number) => string }[] = [
  { id: 'mandelbrot', name: 'Mandelbrot zoom', spec: (w, h, r) => `mandelbrot=s=${w}x${h}:r=${r}` },
  { id: 'life', name: 'Game of Life', spec: (w, h, r) => `life=s=${w}x${h}:r=${r}:mold=10:ratio=0.1:death_color=#C83232:life_color=#00ff99,scale=${w}:${h}` },
  { id: 'testsrc2', name: 'Test pattern', spec: (w, h, r) => `testsrc2=s=${w}x${h}:r=${r}` },
  { id: 'cellauto', name: 'Cellular automaton', spec: (w, h, r) => `cellauto=s=${w}x${h}:r=${r}:rule=110:scroll=1` },
  { id: 'gradients', name: 'Gradient swirl', spec: (w, h, r) => `gradients=s=${w}x${h}:r=${r}:speed=0.03:n=5` },
  { id: 'rgbtest', name: 'Plasma noise', spec: (w, h, r) => `cellauto=s=${w}x${h}:r=${r}:rule=30,hue=H=t*60:s=4,gblur=sigma=3,scale=${w}:${h}` },
];

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16, '4:5': 4 / 5, '21:9': 21 / 9 };

export function outputSize(project: Pick<Project, 'encoder' | 'clips' | 'media'>, width: number): { w: number; h: number } {
  const firstClip = project.clips.find((c) => c.track === 'v1');
  const first = (firstClip && project.media.find((m) => m.id === firstClip.mediaId)) || project.media.find((m) => m.hasVideo);
  const ar = project.encoder.aspect === 'auto' ? (first && first.height ? first.width / first.height : 16 / 9) : ASPECTS[project.encoder.aspect];
  const w = even(width);
  return { w, h: even(w / (ar || 16 / 9)) };
}

export type PathFn = (m: MediaItem) => string;

/** A title burned into the video before moshing: a transparent PNG of the text, full frame. */
export interface TextOverlay {
  tx: TextClip;
  path: string;
}

/** File name of a media item inside the ffmpeg file system. */
export const inputName = (m: Pick<MediaItem, 'id' | 'source'>) => (m.source.kind === 'file' ? `in_${m.id}.${m.source.ext}` : '');

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Input arguments for one clip, already cut to its in/out range (fast seek). */
export function clipInputArgs(c: Clip, m: MediaItem, fps: number, path: PathFn = inputName): string[] {
  const dur = r3(Math.max(0.04, c.out - c.in));
  if (m.source.kind === 'generator') {
    const g = GENERATORS.find((x) => x.id === (m.source as { generator: string }).generator) ?? GENERATORS[0];
    return ['-f', 'lavfi', '-t', String(r3(c.out)), '-i', g.spec(even(m.width), even(m.height), fps)];
  }
  if (m.source.isImage) return ['-loop', '1', '-framerate', String(fps), '-t', String(dur), '-i', path(m)];
  return ['-ss', String(r3(c.in)), '-t', String(dur), '-i', path(m)];
}

function scaleChain(c: Clip, w: number, h: number): string {
  if (c.fit === 'stretch') return `scale=${w}:${h}:flags=bicubic`;
  if (c.fit === 'fill') return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
}

/** Filter chain for one clip's picture (input already trimmed), padded/cut to its exact length. */
function clipVideoChain(c: Clip, m: MediaItem, fps: number, w: number, h: number): string {
  const len = r3(clipLen(c));
  const f: string[] = [];
  if (m.source.kind === 'generator') f.push(`trim=start=${r3(c.in)}:end=${r3(c.out)}`);
  f.push('setpts=PTS-STARTPTS');
  if (c.speed !== 1) f.push(`setpts=PTS/${r3(c.speed)}`);
  f.push(`fps=${fps}`, scaleChain(c, w, h), 'setsar=1', 'format=yuv420p');
  // reverse buffers the whole clip in memory, so do it after scaling down
  if (c.reverse) f.push('reverse', 'setpts=PTS-STARTPTS');
  f.push(`tpad=stop_mode=clone:stop_duration=${len}`, `trim=duration=${len}`);
  return f.join(',');
}

/**
 * Filter graph for one segment. Clips inside a segment are joined by blend transitions (xfade)
 * or plain concatenation. Returns the inputs it needs and its output label.
 */
function segmentGraph(seg: Segment, fps: number, w: number, h: number, first: number, tag: string, path: PathFn, overlays: TextOverlay[] = []): { inputs: string[]; filter: string[]; label: string; count: number } {
  const n = seg.f1 - seg.f0;
  const label = `seg${tag}`;
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const texts = overlays.filter((o) => o.tx.start < t1 && o.tx.start + o.tx.duration > t0);
  const out = texts.length ? `${tag}pre` : label;
  const inputs: string[] = [];
  const filter: string[] = [];
  let count = 0;
  const addTexts = () => {
    let acc = out;
    texts.forEach((o, k) => {
      const idx = first + count++;
      const a = r3(Math.max(0, o.tx.start - t0));
      const b = r3(Math.min(t1, o.tx.start + o.tx.duration) - t0);
      const f = Math.min(o.tx.fade, o.tx.duration / 2);
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(r3(t1 - t0 + 1)), '-i', o.path);
      // fades that started in an earlier segment can't be expressed (negative start): skip them
      const fi = r3(o.tx.start - t0);
      const fo = r3(o.tx.start + o.tx.duration - f - t0);
      const fades = f > 0.01 ? (fi >= 0 ? `,fade=t=in:st=${fi}:d=${r3(f)}:alpha=1` : '') + (fo >= 0 ? `,fade=t=out:st=${fo}:d=${r3(f)}:alpha=1` : '') : '';
      filter.push(`[${idx}:v]format=rgba,scale=${w}:${h}${fades}[${tag}t${k}]`);
      const next = k === texts.length - 1 ? label : `${tag}o${k}`;
      filter.push(`[${acc}][${tag}t${k}]overlay=0:0:enable='between(t,${a},${b})':format=auto:shortest=1,format=yuv420p[${next}]`);
      acc = next;
    });
  };
  if (!seg.clips.length) {
    filter.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${r3(n / fps + 1)},format=yuv420p,setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS[${out}]`);
    addTexts();
    return { inputs, filter, label, count };
  }
  seg.clips.forEach((pl, k) => {
    inputs.push(...clipInputArgs(pl.clip, pl.media, fps, path));
    filter.push(`[${first + k}:v]${clipVideoChain(pl.clip, pl.media, fps, w, h)}[${tag}c${k}]`);
  });
  count = seg.clips.length;
  let acc = `${tag}c0`;
  seg.clips.slice(1).forEach((pl, i) => {
    const k = i + 1;
    const out = `${tag}x${k}`;
    if (pl.overlap > 0) {
      const tr = BLEND_TRANSITIONS[pl.clip.transition!.type]?.xfade ?? 'fade';
      filter.push(`[${acc}][${tag}c${k}]xfade=transition=${tr}:duration=${r3(pl.overlap)}:offset=${r3(pl.start - seg.start)}[${out}]`);
    } else filter.push(`[${acc}][${tag}c${k}]concat=n=2:v=1:a=0[${out}]`);
    acc = out;
  });
  filter.push(`[${acc}]tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${n},setpts=PTS-STARTPTS[${out}]`);
  addTexts();
  return { inputs, filter, label, count };
}

export function encoderArgs(enc: EncoderSettings, keyTimes: number[]): string[] {
  const a: string[] = [];
  if (enc.codec === 'mpeg4') {
    a.push('-c:v', 'mpeg4', '-vtag', 'XVID');
    a.push('-motion_est', enc.motionEst);
    const flags = [enc.mv4 ? '+mv4' : '', enc.qpel ? '+qpel' : ''].join('');
    if (flags) a.push('-flags', flags);
  } else {
    a.push('-c:v', enc.codec === 'mpeg2' ? 'mpeg2video' : 'mpeg1video');
    a.push('-motion_est', enc.motionEst);
    // allow non-standard frame rates (8/12/15 fps) for MPEG-1/2
    a.push('-strict', '-1');
  }
  a.push('-q:v', String(enc.quality), '-qmin', String(enc.quality), '-qmax', String(enc.quality));
  a.push('-g', String(Math.max(1, enc.gop)), '-bf', String(enc.bframes));
  if (enc.meRange > 0) a.push('-me_range', String(enc.meRange));
  a.push('-mbd', enc.mbd, '-cmp', enc.cmp, '-subcmp', enc.cmp);
  if (enc.trellis) a.push('-trellis', '1');
  a.push('-sc_threshold', enc.sceneCut ? '0' : '1000000000');
  const kt = keyTimes.filter((t) => t > 0.001);
  if (kt.length) a.push('-force_key_frames', kt.map((t) => r3(t)).join(','));
  return a;
}

/** Keyframe times (s) on the whole timeline: clip cuts (optional), mosh transitions and user markers. */
export function keyTimes(project: Project): number[] {
  const fps = project.encoder.fps;
  const t: number[] = [...transitionKeyTimes(project)];
  if (project.encoder.keyAtCuts) for (const s of segments(project, fps)) t.push(s.f0 / fps);
  if (project.encoder.keyAtCuts) t.push(...cutFrames(project, fps).map((f) => f / fps));
  for (const m of project.encoder.keyMarkers) t.push(m / fps);
  return [...new Set(t.map(r3))].filter((x) => x > 0).sort((a, b) => a - b);
}

/** Prepare the whole timeline in a single pass (used when cuts must not get keyframes). */
export function prepArgs(project: Project, width: number, out = 'prep.avi', path: PathFn = inputName, overlays: TextOverlay[] = []): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  const segs = segments(project, fps);
  const inputs: string[] = [];
  const filter: string[] = [];
  const labels: string[] = [];
  let next = 0;
  segs.forEach((s, i) => {
    const g = segmentGraph(s, fps, w, h, next, `s${i}`, path, overlays);
    next += g.count;
    inputs.push(...g.inputs);
    filter.push(...g.filter);
    labels.push(g.label);
  });
  filter.push(labels.length > 1 ? `${labels.map((l) => `[${l}]`).join('')}concat=n=${labels.length}:v=1:a=0[vout]` : `[${labels[0]}]null[vout]`);
  return [...inputs, '-filter_complex', filter.join(';'), '-map', '[vout]', '-an', ...encoderArgs(project.encoder, keyTimes(project)), '-f', 'avi', out];
}

/** Prepare one segment on its own (starts with a keyframe). Keyframe times are relative to it. */
export function segmentArgs(project: Project, seg: Segment, width: number, out: string, path: PathFn = inputName, overlays: TextOverlay[] = []): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  const g = segmentGraph(seg, fps, w, h, 0, 'a', path, overlays);
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const keys = keyTimes(project)
    .filter((t) => t > t0 + 0.001 && t < t1 - 0.001)
    .map((t) => t - t0);
  return [...g.inputs, '-filter_complex', g.filter.join(';'), '-map', `[${g.label}]`, '-an', '-frames:v', String(seg.f1 - seg.f0), ...encoderArgs(project.encoder, keys), '-f', 'avi', out];
}

/** Stable identity of a segment's prepared output (for caching). */
export function segmentKey(project: Project, seg: Segment, width: number, path: PathFn = inputName): string {
  const fps = project.encoder.fps;
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const { previewWidth: _p, width: _w, keyMarkers: _k, ...enc } = project.encoder;
  return JSON.stringify({
    enc,
    size: outputSize(project, width),
    n: seg.f1 - seg.f0,
    keys: keyTimes(project).filter((t) => t > t0 + 0.001 && t < t1 - 0.001).map((t) => r3(t - t0)),
    texts: (project.texts ?? []).filter((t) => t.moshed && t.start < t1 && t.start + t.duration > t0),
    clips: seg.clips.map((pl) => ({ m: path(pl.media) || JSON.stringify(pl.media.source), w: pl.media.width, h: pl.media.height, i: pl.clip.in, o: pl.clip.out, s: pl.clip.speed, r: pl.clip.reverse, f: pl.clip.fit, ov: r3(pl.overlap), st: r3(pl.start - seg.start), t: pl.overlap > 0 ? pl.clip.transition?.type : '' })),
  });
}

/**
 * Decoding a moshed stream makes the decoder report an error for nearly every macroblock.
 * Keep the log quiet (only fatal errors) and report progress via -progress instead.
 */
export const QUIET = ['-loglevel', 'fatal', '-progress', 'pipe:1', '-stats_period', '0.5'];

export function decoderInputArgs(d: DecoderSettings): string[] {
  const a: string[] = [...QUIET];
  const ec = [d.guessMvs && 'guess_mvs', d.deblock && 'deblock', d.favorInter && 'favor_inter'].filter(Boolean).join('+');
  a.push('-ec', ec || '0');
  if (d.ignoreErrors) a.push('-err_detect', 'ignore_err');
  if (d.showAll) a.push('-flags2', '+showall');
  return a;
}

/** Decode a (moshed) AVI to a stream of JPEGs for frame-accurate preview. */
export function decodeToMjpegArgs(d: DecoderSettings, input: string, out: string, quality = 5, scaleW?: number): string[] {
  return [
    ...decoderInputArgs(d),
    '-i', input,
    '-fps_mode', 'passthrough',
    ...(scaleW ? ['-vf', `scale=${even(scaleW)}:-2`] : []),
    '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-q:v', String(quality),
    '-f', 'image2pipe', out,
  ];
}

function tempo(speed: number): string[] {
  const f: string[] = [];
  let s = speed;
  while (s > 2) (f.push('atempo=2'), (s /= 2));
  while (s < 0.5) (f.push('atempo=0.5'), (s /= 0.5));
  if (Math.abs(s - 1) > 1e-4) f.push(`atempo=${r3(s)}`);
  return f;
}

export interface AudioMix {
  args: string[];
  /** output files that were produced, by bus */
  outputs: { mosh?: string; clean?: string };
}

/**
 * Mix every audible clip into two raw s16le stereo 44.1 kHz buses: sound that follows the mosh
 * and sound that stays clean. Both are exactly `total` seconds long.
 */
export function audioMixArgs(project: Project, total: number, path: PathFn = inputName, names = { mosh: 'mosh.raw', clean: 'clean.raw' }): AudioMix | null {
  const fps = project.encoder.fps;
  const srcs = audioSources(project).filter((s) => s.start < total);
  if (!srcs.length || total <= 0) return null;
  const inputs: string[] = [];
  const filter: string[] = [];
  const buses: Record<'mosh' | 'clean', string[]> = { mosh: [], clean: [] };
  srcs.forEach((s, i) => {
    inputs.push(...clipInputArgs(s.clip, s.media, fps, path));
    const len = r3(Math.min(s.len, total - s.start));
    const f: string[] = ['asetpts=PTS-STARTPTS'];
    if (s.clip.reverse) f.push('areverse');
    f.push(...tempo(s.clip.speed));
    f.push('aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=end=${len}`);
    if (Math.abs(s.gain - 1) > 1e-4) f.push(`volume=${r3(s.gain)}`);
    const fi = Math.min(s.fadeIn, len / 2);
    const fo = Math.min(s.fadeOut, len / 2);
    if (fi > 0.005) f.push(`afade=t=in:st=0:d=${r3(fi)}`);
    if (fo > 0.005) f.push(`afade=t=out:st=${r3(len - fo)}:d=${r3(fo)}`);
    const ms = Math.round(s.start * 1000);
    if (ms > 0) f.push(`adelay=delays=${ms}:all=1`);
    filter.push(`[${i}:a]${f.join(',')}[s${i}]`);
    buses[s.bus].push(`[s${i}]`);
  });
  const maps: string[] = [];
  const outputs: AudioMix['outputs'] = {};
  for (const bus of ['mosh', 'clean'] as const) {
    const ins = buses[bus];
    if (!ins.length) continue;
    const mix = ins.length > 1 ? `${ins.join('')}amix=inputs=${ins.length}:duration=longest:dropout_transition=0:normalize=0,` : `${ins[0]}`;
    filter.push(`${mix}${ins.length > 1 ? '' : 'anull,'}apad,atrim=end=${r3(total)},aformat=sample_fmts=s16:channel_layouts=stereo[${bus}]`);
    maps.push('-map', `[${bus}]`, '-f', 's16le', '-ar', '44100', '-ac', '2', names[bus]);
    outputs[bus] = names[bus];
  }
  return { args: [...inputs, '-filter_complex', filter.join(';'), ...maps], outputs };
}

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'avi' | 'png';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  /** scale algorithm when resizing the output */
  scaler: 'bicubic' | 'neighbor' | 'lanczos';
  crf: number;
  preset: 'ultrafast' | 'veryfast' | 'medium' | 'slow';
  gifColors: number;
  gifDither: 'bayer' | 'floyd_steinberg' | 'sierra2_4a' | 'none';
  gifFps: number;
  loop: boolean;
  audio: boolean;
}

export const defaultExport = (): ExportOptions => ({
  format: 'mp4',
  width: 0,
  scaler: 'bicubic',
  crf: 18,
  preset: 'veryfast',
  gifColors: 128,
  gifDither: 'bayer',
  gifFps: 15,
  loop: true,
  audio: true,
});

/**
 * Final encode. `videoIn` is either the moshed AVI (decoder args applied) or an MJPEG
 * stream of post-processed frames.
 */
export function exportArgs(o: ExportOptions, d: DecoderSettings, fps: number, videoIn: { file: string; mjpeg: boolean }, audioWav: string | null, out: string): string[] {
  const a: string[] = [];
  if (videoIn.mjpeg) a.push('-framerate', String(fps), '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', videoIn.file);
  else a.push(...decoderInputArgs(d), '-i', videoIn.file);
  const withAudio = !!audioWav && o.audio && o.format !== 'gif';
  if (withAudio) a.push('-i', audioWav!);
  const scale = o.width > 0 ? `scale=${even(o.width)}:-2:flags=${o.scaler}` : '';
  if (o.format === 'gif') {
    const pre = [`fps=${o.gifFps}`, scale].filter(Boolean).join(',');
    const dither = o.gifDither === 'bayer' ? 'dither=bayer:bayer_scale=3' : `dither=${o.gifDither}`;
    a.push('-filter_complex', `[0:v]${pre},split[a][b];[a]palettegen=max_colors=${o.gifColors}:stats_mode=diff[p];[b][p]paletteuse=${dither}`);
    a.push('-loop', o.loop ? '0' : '-1', out);
    return a;
  }
  if (o.format === 'png') {
    if (scale) a.push('-vf', scale);
    a.push('-fps_mode', 'passthrough', '-f', 'image2', out);
    return a;
  }
  a.push('-map', '0:v');
  if (withAudio) a.push('-map', '1:a');
  if (scale) a.push('-vf', `${scale},format=yuv420p`);
  else a.push('-pix_fmt', 'yuv420p');
  a.push('-r', String(fps));
  if (o.format === 'mp4') {
    a.push('-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-movflags', '+faststart');
    if (withAudio) a.push('-c:a', 'aac', '-b:a', '192k');
  } else {
    // VP8: the VP9 encoder in ffmpeg.wasm crashes, VP8 is solid
    a.push('-c:v', 'libvpx', '-crf', String(Math.min(63, Math.max(4, o.crf - 4))), '-b:v', '12M', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0');
    if (withAudio) a.push('-c:a', 'libvorbis', '-q:a', '6');
  }
  if (withAudio) a.push('-shortest');
  a.push(out);
  return a;
}

/** Parse "ffmpeg -i" log output into basic media info. */
export function parseProbe(log: string): { duration: number; width: number; height: number; fps: number; hasAudio: boolean; hasVideo: boolean } {
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const duration = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const vid = /Stream #.*Video: .*?(\d{2,5})x(\d{2,5})/.exec(log);
  const fpsM = /Stream #.*Video: .*?([\d.]+) (?:fps|tbr)/.exec(log);
  // phones store upright video as landscape + a rotation flag; ffmpeg rotates it when decoding
  const rot = /displaymatrix: rotation of (-?[\d.]+)/.exec(log) ?? /\brotate\s*:\s*(-?\d+)/.exec(log);
  const quarter = rot ? Math.round(Math.abs(+rot[1]) / 90) % 2 === 1 : false;
  const w = vid ? +vid[1] : 0;
  const h = vid ? +vid[2] : 0;
  return {
    duration,
    width: quarter ? h : w,
    height: quarter ? w : h,
    fps: fpsM ? +fpsM[1] : 30,
    hasAudio: /Stream #.*Audio:/.test(log),
    hasVideo: !!vid,
  };
}
