// FFmpeg argument builders. Pure functions so they can be tested with native ffmpeg.
import type { Clip, DecoderSettings, EncoderSettings, Project } from './types';
import { clipDuration } from './mosh';

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

export function outputSize(project: Project, width: number): { w: number; h: number } {
  const first = project.clips[0];
  const ar = project.encoder.aspect === 'auto' ? (first ? first.width / Math.max(1, first.height) : 16 / 9) : ASPECTS[project.encoder.aspect];
  const w = even(width);
  return { w, h: even(w / (ar || 16 / 9)) };
}

export const inputName = (c: Clip, _i = 0) => (c.source.kind === 'file' ? `in_${c.id}.${c.source.ext}` : '');

/** Input arguments for clip i (files must be written to the FS under inputName). */
export function inputArgs(c: Clip, i: number, fps: number): string[] {
  if (c.source.kind === 'generator') {
    const g = GENERATORS.find((x) => x.id === (c.source as { generator: string }).generator) ?? GENERATORS[0];
    return ['-f', 'lavfi', '-t', String(c.out), '-i', g.spec(even(c.width), even(c.height), fps)];
  }
  if (c.source.isImage) return ['-loop', '1', '-framerate', String(fps), '-t', String(c.out), '-i', inputName(c, i)];
  return ['-i', inputName(c, i)];
}

function scaleChain(c: Clip, w: number, h: number): string {
  if (c.fit === 'stretch') return `scale=${w}:${h}:flags=bicubic`;
  if (c.fit === 'fill') return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function videoFilter(clips: Clip[], fps: number, w: number, h: number): string {
  const parts = clips.map((c, i) => {
    const f = [`trim=start=${r3(c.in)}:end=${r3(c.out)}`, 'setpts=PTS-STARTPTS'];
    if (c.reverse) f.push('reverse');
    if (c.speed !== 1) f.push(`setpts=PTS/${r3(c.speed)}`);
    f.push(`fps=${fps}`, scaleChain(c, w, h), 'setsar=1', 'format=yuv420p');
    return `[${i}:v]${f.join(',')}[v${i}]`;
  });
  return `${parts.join(';')};${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[vout]`;
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
  }
  a.push('-q:v', String(enc.quality), '-qmin', String(enc.quality), '-qmax', String(enc.quality));
  a.push('-g', String(Math.max(1, enc.gop)), '-bf', String(enc.bframes));
  if (enc.meRange > 0) a.push('-me_range', String(enc.meRange));
  a.push('-mbd', enc.mbd, '-cmp', enc.cmp, '-subcmp', enc.cmp);
  if (enc.trellis) a.push('-trellis', '1');
  a.push('-sc_threshold', enc.sceneCut ? '0' : '1000000000');
  if (keyTimes.length) a.push('-force_key_frames', keyTimes.map((t) => r3(t)).join(','));
  return a;
}

/** Keyframe times in seconds: clip cuts (optional) + user markers. */
export function keyTimes(project: Project): number[] {
  const t: number[] = [];
  const fps = project.encoder.fps;
  if (project.encoder.keyAtCuts) {
    let acc = 0;
    project.clips.forEach((c, i) => {
      if (i > 0) t.push(acc);
      acc += clipDuration(c);
    });
  }
  for (const m of project.encoder.keyMarkers) t.push(m / fps);
  return [...new Set(t)].sort((a, b) => a - b);
}

export function prepArgs(project: Project, width: number, out = 'prep.avi'): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  return [
    ...project.clips.flatMap((c, i) => inputArgs(c, i, fps)),
    '-filter_complex', videoFilter(project.clips, fps, w, h),
    '-map', '[vout]', '-an',
    ...encoderArgs(project.encoder, keyTimes(project)),
    '-f', 'avi', out,
  ];
}

export function decoderInputArgs(d: DecoderSettings): string[] {
  const a: string[] = [];
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

/** Audio for the whole timeline as raw s16le stereo 44.1k (silence for clips without audio). */
export function audioArgs(project: Project, out = 'audio.raw', onlyClip: string | null = null): string[] | null {
  const clips = project.clips;
  const fps = project.encoder.fps;
  if (!clips.some((c) => c.hasAudio)) return null;
  const inputs: string[] = [];
  const parts: string[] = [];
  clips.forEach((c, i) => {
    const d = r3(clipDuration(c));
    const use = c.hasAudio && (!onlyClip || onlyClip === c.id);
    if (use) {
      inputs.push(...inputArgs(c, i, fps));
      const n = inputs.filter((x) => x === '-i').length - 1;
      const f = [`atrim=start=${r3(c.in)}:end=${r3(c.out)}`, 'asetpts=PTS-STARTPTS'];
      if (c.reverse) f.push('areverse');
      let s = c.speed;
      while (s > 2) (f.push('atempo=2'), (s /= 2));
      while (s < 0.5) (f.push('atempo=0.5'), (s /= 0.5));
      if (s !== 1) f.push(`atempo=${r3(s)}`);
      f.push('aresample=44100', 'aformat=sample_fmts=s16:channel_layouts=stereo', 'apad', `atrim=end=${d}`);
      parts.push(`[${n}:a]${f.join(',')}[a${i}]`);
    } else {
      parts.push(`anullsrc=r=44100:cl=stereo,atrim=end=${d},aformat=sample_fmts=s16:channel_layouts=stereo[a${i}]`);
    }
  });
  const fc = `${parts.join(';')};${clips.map((_, i) => `[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[aout]`;
  return [...inputs, '-filter_complex', fc, '-map', '[aout]', '-f', 's16le', '-ar', '44100', '-ac', '2', out];
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
    a.push('-c:v', 'libvpx-vp9', '-crf', String(Math.min(63, o.crf + 12)), '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1');
    if (withAudio) a.push('-c:a', 'libopus', '-b:a', '160k');
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
  return {
    duration,
    width: vid ? +vid[1] : 0,
    height: vid ? +vid[2] : 0,
    fps: fpsM ? +fpsM[1] : 30,
    hasAudio: /Stream #.*Audio:/.test(log),
    hasVideo: !!vid,
  };
}
