// Orchestrates prep -> mosh -> decode -> post for previews and exports.
import { ffmpeg } from './ffmpeg';
import { getFile } from './storage';
import { runPost, pixelEffectsOf } from './post';
import { prepArgs, decodeToMjpegArgs, audioArgs, exportArgs, inputName, parseProbe, outputSize, type ExportOptions, even } from '../engine/args';
import { framesFromAvi, applyBitstream, writeMoshed, clipStarts, type Prepared } from '../engine/mosh';
import { splitJpegs } from '../engine/jpeg';
import { buildAudio, wav } from '../engine/audio';
import { zip } from '../engine/zip';
import type { Clip, Frame, Project } from '../engine/types';

export interface RenderResult {
  id: number;
  prep: Prepared;
  frames: Frame[];
  jpegs: Uint8Array[];
  fps: number;
  w: number;
  h: number;
  cuts: number[];
  post: boolean;
}

export type Progress = (stage: string, p: number) => void;
export interface Signal {
  cancelled: boolean;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

const check = (s?: Signal) => {
  if (s?.cancelled) throw new Cancelled();
};

function inputsFor(clips: Clip[]): Record<string, () => Promise<Uint8Array>> {
  const out: Record<string, () => Promise<Uint8Array>> = {};
  clips.forEach((c, i) => {
    if (c.source.kind !== 'file') return;
    const id = c.source.fileId;
    out[inputName(c, i)] = async () => {
      const b = await getFile(id);
      if (!b) throw new Error(`Media for "${c.source.name}" is missing. Please re-add it.`);
      return new Uint8Array(await b.arrayBuffer());
    };
  });
  return out;
}

const prepKey = (p: Project, width: number) =>
  JSON.stringify({ c: p.clips.map((c) => ({ ...c, thumb: undefined })), e: { ...p.encoder, previewWidth: 0 }, width });

class LRU<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string) {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}

const prepCache = new LRU<Prepared>(4);
const origCache = new LRU<Uint8Array[]>(2);
const audioCache = new LRU<Int16Array | null>(2);
let renderId = 0;

export async function prepare(project: Project, width: number, progress?: Progress, signal?: Signal): Promise<Prepared> {
  if (!project.clips.length) throw new Error('Add a clip first');
  const key = prepKey(project, width);
  const hit = prepCache.get(key);
  if (hit) return hit;
  progress?.('Preparing clips', 0);
  const total = project.clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0) * project.encoder.fps;
  const r = await ffmpeg.run(prepArgs(project, width, 'prep.avi'), {
    inputs: inputsFor(project.clips),
    keep: Object.keys(inputsFor(project.clips)),
    outputs: ['prep.avi'],
    onFrame: (n) => progress?.('Preparing clips', Math.min(1, n / total)),
  });
  check(signal);
  const prep = framesFromAvi(r.out['prep.avi'], project.encoder.codec);
  if (!prep.frames.length) throw new Error('Preparing produced no frames.\n' + r.log.slice(-800));
  prepCache.set(key, prep);
  return prep;
}

async function decode(project: Project, avi: Uint8Array, quality: number, total: number, label: string, progress?: Progress, scaleW?: number): Promise<Uint8Array[]> {
  const r = await ffmpeg.run(decodeToMjpegArgs(project.decoder, 'mosh.avi', 'out.mjpeg', quality, scaleW), {
    inputs: { 'mosh.avi': async () => avi },
    outputs: ['out.mjpeg'],
    onFrame: (n) => progress?.(label, Math.min(1, n / Math.max(1, total))),
  });
  await ffmpeg.remove('mosh.avi');
  return splitJpegs(r.out['out.mjpeg']);
}

export function cutsOf(project: Project): number[] {
  return clipStarts(project.clips, project.encoder.fps).slice(1);
}

export async function renderPreview(project: Project, width: number, progress?: Progress, signal?: Signal): Promise<RenderResult> {
  const id = ++renderId;
  const prep = await prepare(project, width, progress, signal);
  check(signal);
  const cuts = cutsOf(project);
  progress?.('Moshing', 0);
  const frames = applyBitstream(prep, project, cuts);
  const avi = writeMoshed(prep, frames);
  check(signal);
  let jpegs = await decode(project, avi, 4, frames.length, 'Decoding', progress);
  check(signal);
  const post = pixelEffectsOf(project).length > 0;
  if (post) jpegs = await runPost(jpegs, frames, project, 0.85, (p) => progress?.('Pixel effects', p), signal);
  check(signal);
  const { w, h } = outputSize(project, width);
  return { id, prep, frames, jpegs, fps: project.encoder.fps, w, h, cuts, post };
}

/** Decoded frames of the clean prepared video (for A/B compare). */
export async function originalFrames(project: Project, width: number): Promise<Uint8Array[]> {
  const key = prepKey(project, width);
  const hit = origCache.get(key);
  if (hit) return hit;
  const prep = await prepare(project, width);
  const jpegs = await decode(project, writeMoshed(prep, prep.frames), 4, prep.frames.length, 'Decoding original');
  origCache.set(key, jpegs);
  return jpegs;
}

export async function timelineAudio(project: Project): Promise<Int16Array | null> {
  const a = project.audio;
  if (a.source === 'none') return null;
  const only = a.source === 'clip' ? a.clipId : null;
  const key = JSON.stringify({ c: project.clips.map((c) => ({ ...c, thumb: undefined })), only, fps: project.encoder.fps });
  const hit = audioCache.get(key);
  if (hit !== undefined) return hit;
  const args = audioArgs(project, 'audio.raw', only);
  if (!args) {
    audioCache.set(key, null);
    return null;
  }
  const r = await ffmpeg.run(args, { inputs: inputsFor(project.clips), keep: Object.keys(inputsFor(project.clips)), outputs: ['audio.raw'] });
  const raw = r.out['audio.raw'];
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
  audioCache.set(key, pcm);
  return pcm;
}

/** Audio for a list of output frames, as WAV bytes (or null when there is no audio). */
export async function moshedAudioWav(project: Project, frames: Pick<Frame, 'src' | 'tag'>[]): Promise<Uint8Array | null> {
  const pcm = await timelineAudio(project);
  if (!pcm) return null;
  return wav(buildAudio(pcm.slice(), frames, project.encoder.fps, project.audio, project.globalSeed));
}

export async function probeFile(blob: Blob, ext: string): Promise<{ info: ReturnType<typeof parseProbe>; thumb: string }> {
  const name = `probe.${ext}`;
  const data = new Uint8Array(await blob.arrayBuffer());
  const r = await ffmpeg.run(['-i', name], { inputs: { [name]: async () => data } });
  const info = parseProbe(r.log);
  let thumb = '';
  try {
    const t = await ffmpeg.run(['-ss', String(Math.min(1, info.duration / 3 || 0)), '-i', name, '-frames:v', '1', '-vf', 'scale=192:-2', '-q:v', '5', '-huffman', '0', '-update', '1', '-f', 'image2', 'thumb.jpg'], { outputs: ['thumb.jpg'] });
    thumb = URL.createObjectURL(new Blob([t.out['thumb.jpg'] as BlobPart], { type: 'image/jpeg' }));
  } catch {
    /* thumbnail optional */
  }
  await ffmpeg.remove(name);
  return { info, thumb };
}

export async function generatorThumb(spec: string[]): Promise<string> {
  try {
    const t = await ffmpeg.run([...spec, '-frames:v', '1', '-vf', 'scale=192:-2', '-q:v', '5', '-huffman', '0', '-update', '1', '-f', 'image2', 'thumb.jpg'], { outputs: ['thumb.jpg'] });
    return URL.createObjectURL(new Blob([t.out['thumb.jpg'] as BlobPart], { type: 'image/jpeg' }));
  } catch {
    return '';
  }
}

export async function exportVideo(project: Project, o: ExportOptions, progress: Progress, signal: Signal): Promise<{ blob: Blob; name: string }> {
  const width = project.encoder.width;
  const prep = await prepare(project, width, progress, signal);
  check(signal);
  const frames = applyBitstream(prep, project, cutsOf(project));
  const avi = writeMoshed(prep, frames);
  const base = (project.name || 'mosh').replace(/[^\w-]+/g, '_');
  const fps = project.encoder.fps;
  const audio = o.audio && o.format !== 'gif' ? await moshedAudioWav(project, frames) : null;
  check(signal);

  if (o.format === 'avi') {
    if (!audio) return { blob: new Blob([avi as BlobPart], { type: 'video/x-msvideo' }), name: `${base}.avi` };
    const r = await ffmpeg.run(['-i', 'mosh.avi', '-i', 'a.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-shortest', 'out.avi'], {
      inputs: { 'mosh.avi': async () => avi, 'a.wav': async () => audio },
      outputs: ['out.avi'],
    });
    await ffmpeg.remove('mosh.avi');
    await ffmpeg.remove('a.wav');
    return { blob: new Blob([r.out['out.avi'] as BlobPart], { type: 'video/x-msvideo' }), name: `${base}.avi` };
  }

  const post = pixelEffectsOf(project).length > 0;
  let videoIn: { file: string; mjpeg: boolean; data: Uint8Array };
  let jpegs: Uint8Array[] | null = null;
  if (post || o.format === 'png') {
    jpegs = await decode(project, avi, 2, frames.length, 'Decoding', progress);
    check(signal);
    if (post) jpegs = await runPost(jpegs, frames, project, 0.95, (p) => progress('Pixel effects', p), signal);
    check(signal);
  }
  if (o.format === 'png' && jpegs) {
    progress('Writing PNGs', 0);
    const pngs: { name: string; data: Uint8Array }[] = [];
    const c = document.createElement('canvas');
    for (let i = 0; i < jpegs.length; i++) {
      check(signal);
      const bmp = await createImageBitmap(new Blob([jpegs[i] as BlobPart], { type: 'image/jpeg' }));
      const w = o.width > 0 ? even(o.width) : bmp.width;
      const h = Math.round((bmp.height * w) / bmp.width);
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = o.scaler !== 'neighbor';
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const b = await new Promise<Blob>((res) => c.toBlob((x) => res(x!), 'image/png'));
      pngs.push({ name: `frame_${String(i + 1).padStart(5, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) });
      progress('Writing PNGs', i / jpegs.length);
    }
    return { blob: zip(pngs), name: `${base}_frames.zip` };
  }
  if (jpegs) {
    const total = jpegs.reduce((s, j) => s + j.length, 0);
    const cat = new Uint8Array(total);
    let off = 0;
    for (const j of jpegs) (cat.set(j, off), (off += j.length));
    videoIn = { file: 'frames.mjpeg', mjpeg: true, data: cat };
  } else videoIn = { file: 'mosh.avi', mjpeg: false, data: avi };

  const out = `out.${o.format}`;
  const inputs: Record<string, () => Promise<Uint8Array>> = { [videoIn.file]: async () => videoIn.data };
  if (audio) inputs['a.wav'] = async () => audio;
  const r = await ffmpeg.run(exportArgs(o, project.decoder, fps, videoIn, audio ? 'a.wav' : null, out), {
    inputs,
    outputs: [out],
    onFrame: (n) => progress('Encoding ' + o.format.toUpperCase(), Math.min(1, n / frames.length)),
  });
  await ffmpeg.remove(videoIn.file);
  await ffmpeg.remove('a.wav');
  const type = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' }[o.format as 'mp4'];
  return { blob: new Blob([r.out[out] as BlobPart], { type }), name: `${base}.${o.format}` };
}
