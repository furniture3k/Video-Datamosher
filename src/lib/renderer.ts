// Orchestrates prep -> mosh -> decode -> post for previews and exports.
import { ffmpeg, ffmpegBg, Cancelled, MOUNT } from './ffmpeg';
import { getFile } from './storage';
import { PostRunner } from './post';
import { mediaState } from './mediastate.svelte';
import { type TextOverlay, segmentArgs, prepArgs, segmentKey, decodeToMjpegArgs, decoderInputArgs, audioMixArgs, exportArgs, inputName, parseProbe, outputSize, type ExportOptions, type PathFn, even, GENERATORS } from '../engine/args';
import { framesFromAvi, applyBitstream, writeMoshed, writeMoshedBlob, concatPrepared, type Prepared } from '../engine/mosh';
import { cutFrames, segments, timelineDuration, mediaOf, type Segment } from '../engine/timeline';
import { splitJpegs } from '../engine/jpeg';
import { buildAudio, wav, SAMPLE_RATE } from '../engine/audio';
import { zip } from '../engine/zip';
import type { Frame, MediaItem, Project, TextClip } from '../engine/types';
import { drawText } from './text';

export interface RenderResult {
  id: number;
  key: string;
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

export { Cancelled };

const check = (s?: Signal) => {
  if (s?.cancelled) throw new Cancelled();
};

// ---------------------------------------------------------------- inputs

export const proxyKey = (id: string) => 'proxy:' + id;

/** Media used by the timeline, mounted read-only into ffmpeg (no copies). Proxies for previews. */
async function mountsFor(project: Project, useProxy: boolean, onlyAudio = false): Promise<{ mounts: Record<string, Blob>; path: PathFn }> {
  const mounts: Record<string, Blob> = {};
  const names = new Map<string, string>();
  const used = new Set(project.clips.map((c) => c.mediaId));
  for (const m of project.media) {
    if (!used.has(m.id) || m.source.kind !== 'file') continue;
    if (onlyAudio && !m.hasAudio) continue;
    let blob: Blob | undefined;
    let name = inputName(m);
    if (useProxy && !onlyAudio && mediaState[m.id]?.proxy === 'ready') {
      blob = await getFile(proxyKey(m.id));
      if (blob) name = `p_${m.id}.${blob.type === 'video/webm' ? 'webm' : 'mp4'}`;
    }
    blob ??= await getFile(m.source.fileId);
    if (!blob) throw new Error(`Media for "${m.source.name}" is missing. Please re-import it.`);
    mounts[name] = blob;
    names.set(m.id, name);
  }
  return { mounts, path: (m: MediaItem) => MOUNT + (names.get(m.id) ?? inputName(m)) };
}

class LRU<V> {
  private m = new Map<string, { v: V; size: number }>();
  private bytes = 0;
  constructor(
    private max: number,
    private maxBytes = Infinity,
  ) {}
  get(k: string) {
    const e = this.m.get(k);
    if (e) {
      this.m.delete(k);
      this.m.set(k, e);
    }
    return e?.v;
  }
  set(k: string, v: V, size = 0) {
    const old = this.m.get(k);
    if (old) this.bytes -= old.size;
    this.m.delete(k);
    this.m.set(k, { v, size });
    this.bytes += size;
    while (this.m.size > 1 && (this.m.size > this.max || this.bytes > this.maxBytes)) {
      const first = this.m.keys().next().value!;
      this.bytes -= this.m.get(first)!.size;
      this.m.delete(first);
    }
  }
}

const prepBytes = (p: Prepared) => p.frames.reduce((s, f) => s + f.data.length, 0);
/** Prepared segments for previews, so editing one clip only re-prepares its own piece. */
const segCache = new LRU<Prepared>(256, 400e6);
const origCache = new LRU<Uint8Array[]>(2);
const audioCache = new LRU<Buses>(2);
let renderId = 0;

// ---------------------------------------------------------------- prep

const pngCache = new Map<string, Blob>();
/** Titles that melt with the video, drawn as transparent full-frame PNGs for the prep graph. */
async function textOverlays(project: Project, w: number, h: number, mounts: Record<string, Blob>): Promise<TextOverlay[]> {
  const out: TextOverlay[] = [];
  for (const tx of project.texts ?? []) {
    if (!tx.moshed || !tx.text.trim()) continue;
    const key = JSON.stringify({ ...tx, start: 0, duration: 0, fade: 0, w, h });
    let png = pngCache.get(key);
    if (!png) {
      png = await renderTextPng(tx, w, h);
      if (pngCache.size > 64) pngCache.clear();
      pngCache.set(key, png);
    }
    const name = `text_${tx.id}.png`;
    mounts[name] = png;
    out.push({ tx, path: MOUNT + name });
  }
  return out;
}

function renderTextPng(tx: TextClip, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawText(c.getContext('2d')!, tx, w, h, 1);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('text render failed'))), 'image/png'));
}

export async function prepare(project: Project, width: number, progress?: Progress, signal?: Signal, preview = true): Promise<Prepared> {
  if (!project.clips.length) throw new Error('Add a clip first');
  const fps = project.encoder.fps;
  const { mounts, path } = await mountsFor(project, preview);
  const size = outputSize(project, width);
  const overlays = await textOverlays(project, size.w, size.h, mounts);
  // Without keyframes at cuts the stream must be encoded in one go (cuts become P-frames).
  const whole = !project.encoder.keyAtCuts;
  const segs: (Segment | null)[] = whole ? [null] : segments(project, fps);
  const totalFrames = Math.max(1, Math.round(timelineDuration(project) * fps));
  const parts: Prepared[] = [];
  let done = 0;
  for (const seg of segs) {
    check(signal);
    const key = (preview ? 'p' : 'x') + width + (seg ? segmentKey(project, seg, width, path) : JSON.stringify({ whole: prepArgs(project, width, 'o', path, overlays), t: project.texts.filter((t) => t.moshed) }));
    const n = seg ? seg.f1 - seg.f0 : totalFrames;
    let part = preview ? segCache.get(key) : undefined;
    if (!part) {
      const args = seg ? segmentArgs(project, seg, width, 'prep.avi', path, overlays) : prepArgs(project, width, 'prep.avi', path, overlays);
      const base = done;
      const r = await ffmpeg.run(args, { mounts, outputs: ['prep.avi'], onFrame: (k) => progress?.('Preparing clips', Math.min(1, (base + k) / totalFrames)) });
      check(signal);
      part = framesFromAvi(r.out['prep.avi'], project.encoder.codec);
      if (!part.frames.length) throw new Error('Preparing produced no frames.\n' + r.log.slice(-800));
      if (preview) segCache.set(key, part, prepBytes(part));
    }
    parts.push(part);
    done += n;
  }
  return concatPrepared(parts);
}

// ---------------------------------------------------------------- decode

async function decode(project: Project, avi: Uint8Array | Blob, quality: number, total: number, label: string, progress?: Progress, opts: { scaleW?: number; from?: number; to?: number } = {}): Promise<Uint8Array[]> {
  const blob = avi instanceof Blob ? avi : new Blob([avi as BlobPart]);
  const vf: string[] = [];
  if (opts.from || opts.to !== undefined) vf.push(`select='between(n,${opts.from ?? 0},${(opts.to ?? 1e9) - 1})'`);
  if (opts.scaleW) vf.push(`scale=${even(opts.scaleW)}:-2`);
  const args = [
    ...decoderInputArgs(project.decoder),
    '-i', MOUNT + 'mosh.avi',
    '-fps_mode', 'passthrough',
    ...(vf.length ? ['-vf', vf.join(',')] : []),
    ...(opts.to !== undefined ? ['-frames:v', String(opts.to - (opts.from ?? 0))] : []),
    '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-q:v', String(quality),
    '-f', 'image2pipe', 'out.mjpeg',
  ];
  const r = await ffmpeg.run(args, {
    mounts: { 'mosh.avi': blob },
    outputs: ['out.mjpeg'],
    onFrame: (n) => progress?.(label, Math.min(1, n / Math.max(1, total))),
  });
  return splitJpegs(r.out['out.mjpeg']);
}

export function cutsOf(project: Project): number[] {
  return cutFrames(project, project.encoder.fps);
}

/** Identity of everything that changes the moshed picture. */
export const renderKey = (p: Project) => JSON.stringify({ c: p.clips, m: p.media.map((m) => [m.id, m.width, m.height]), t: (p.texts ?? []).filter((t) => t.moshed), e: p.effects, enc: p.encoder, d: p.decoder, s: p.globalSeed });

let lastDecode: { key: string; frames: Frame[]; jpegs: Uint8Array[] } | null = null;

export async function renderPreview(project: Project, width: number, progress?: Progress, signal?: Signal): Promise<RenderResult> {
  const id = ++renderId;
  const prep = await prepare(project, width, progress, signal);
  check(signal);
  const cuts = cutsOf(project);
  progress?.('Moshing', 0);
  const frames = applyBitstream(prep, project, cuts);
  check(signal);
  // Frames before the first change decode exactly as last time: only decode what changed.
  const dkey = JSON.stringify({ d: project.decoder, w: width });
  let from = 0;
  if (lastDecode && lastDecode.key === dkey) {
    const old = lastDecode.frames;
    const lim = Math.min(old.length, frames.length);
    while (from < lim && old[from].data === frames[from].data && old[from].type === frames[from].type) from++;
    if (from >= frames.length) from = frames.length - 1;
    from = Math.max(0, Math.min(from, lastDecode.jpegs.length));
  }
  let jpegs: Uint8Array[];
  const blob = writeMoshedBlob(prep, frames);
  if (from > 24) {
    const tail = await decode(project, blob, 4, frames.length - from, 'Decoding', progress, { from });
    jpegs = tail.length === frames.length - from ? [...lastDecode!.jpegs.slice(0, from), ...tail] : await decode(project, blob, 4, frames.length, 'Decoding', progress);
  } else jpegs = await decode(project, blob, 4, frames.length, 'Decoding', progress);
  check(signal);
  lastDecode = { key: dkey, frames, jpegs };
  const runner = new PostRunner(project, 0.85);
  const post = runner.active;
  try {
    if (post) jpegs = await runner.run(jpegs, frames, 0, (p) => progress?.('Pixel effects', p), signal);
  } finally {
    runner.dispose();
  }
  check(signal);
  const { w, h } = outputSize(project, width);
  return { id, key: renderKey(project), prep, frames, jpegs, fps: project.encoder.fps, w, h, cuts, post };
}

/** Decoded frames of the clean prepared video (for A/B compare). */
export async function originalFrames(project: Project, width: number): Promise<Uint8Array[]> {
  const key = JSON.stringify({ c: project.clips, e: project.encoder, width });
  const hit = origCache.get(key);
  if (hit) return hit;
  const prep = await prepare(project, width);
  const jpegs = await decode(project, writeMoshed(prep, prep.frames), 4, prep.frames.length, 'Decoding original');
  origCache.set(key, jpegs);
  return jpegs;
}

// ---------------------------------------------------------------- audio

interface Buses {
  mosh: Int16Array | null;
  clean: Int16Array | null;
}

const pcmOf = (raw?: Uint8Array) => (raw ? new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2)) : null);

/** The timeline's sound as two buses: what follows the mosh, and what stays clean. */
export async function timelineAudio(project: Project): Promise<Buses> {
  const total = timelineDuration(project);
  const key = JSON.stringify({ c: project.clips, m: project.media.map((m) => m.id), t: project.tracks, total, fps: project.encoder.fps });
  const hit = audioCache.get(key);
  if (hit) return hit;
  const { mounts, path } = await mountsFor(project, false, true);
  const mix = audioMixArgs(project, total, path);
  let buses: Buses = { mosh: null, clean: null };
  if (mix) {
    const outs = Object.values(mix.outputs);
    const r = await ffmpeg.run(mix.args, { mounts, outputs: outs });
    buses = { mosh: pcmOf(mix.outputs.mosh ? r.out[mix.outputs.mosh] : undefined), clean: pcmOf(mix.outputs.clean ? r.out[mix.outputs.clean] : undefined) };
  }
  audioCache.set(key, buses);
  return buses;
}

/** Final sound for a list of output frames, as WAV bytes (or null when silent). */
export async function moshedAudioWav(project: Project, frames: Pick<Frame, 'src' | 'tag'>[]): Promise<Uint8Array | null> {
  const { mosh, clean } = await timelineAudio(project);
  if (!mosh && !clean) return null;
  const fps = project.encoder.fps;
  const len = Math.round(frames.length * (SAMPLE_RATE / fps)) * 2;
  const out = mosh ? buildAudio(mosh.slice(), frames, fps, project.audio, project.globalSeed) : new Int16Array(len);
  if (clean) {
    const v = project.audio.volume;
    for (let i = 0; i < out.length && i < clean.length; i++) out[i] = Math.max(-32768, Math.min(32767, out[i] + clean[i] * v));
  }
  return wav(out);
}

// ---------------------------------------------------------------- media helpers

export async function probeFile(blob: Blob, ext: string): Promise<{ info: ReturnType<typeof parseProbe>; thumb: string }> {
  const name = `probe.${ext}`;
  const mounts = { [name]: blob };
  const r = await ffmpeg.run(['-i', MOUNT + name], { mounts });
  const info = parseProbe(r.log);
  let thumb = '';
  if (info.hasVideo)
    try {
      const t = await ffmpeg.run(['-ss', String(Math.min(1, info.duration / 3 || 0)), '-i', MOUNT + name, '-frames:v', '1', '-vf', 'scale=192:-2', '-q:v', '5', '-huffman', '0', '-update', '1', '-f', 'image2', 'thumb.jpg'], { mounts, outputs: ['thumb.jpg'] });
      thumb = URL.createObjectURL(new Blob([t.out['thumb.jpg'] as BlobPart], { type: 'image/jpeg' }));
    } catch {
      /* thumbnail optional */
    }
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

/** Render a procedural generator to a real video file, so it behaves like any other footage. */
export async function renderGenerator(genId: string, seconds: number, w: number, h: number, fps = 24): Promise<Blob> {
  const g = GENERATORS.find((x) => x.id === genId) ?? GENERATORS[0];
  const r = await ffmpeg.run(['-f', 'lavfi', '-t', String(seconds), '-i', g.spec(w, h, fps), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-g', String(fps), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'gen.mp4'], { outputs: ['gen.mp4'] });
  return new Blob([r.out['gen.mp4'] as BlobPart], { type: 'video/mp4' });
}

/** Small, fast-seeking copy for previews (runs on the background engine). H.264, or VP8 where the browser lacks H.264. */
export async function makeProxy(m: MediaItem, blob: Blob, onProgress?: (p: number) => void, webm = false): Promise<Blob> {
  if (m.source.kind !== 'file') throw new Error('no file');
  const name = inputName(m);
  const w = Math.min(640, even(m.width || 640));
  const vf = [`scale=${w}:-2:flags=bicubic`, m.fps > 30 ? 'fps=30' : '', 'format=yuv420p'].filter(Boolean).join(',');
  const total = Math.max(1, m.duration * Math.min(30, m.fps || 30));
  const out = webm ? 'proxy.webm' : 'proxy.mp4';
  const codec = webm
    ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1500k', '-g', '12', '-auto-alt-ref', '0', '-c:a', 'libvorbis', '-q:a', '4']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-g', '12', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
  const args = ['-i', MOUNT + name, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, ...codec, '-ac', '2', out];
  const r = await ffmpegBg.run(args, { mounts: { [name]: blob }, outputs: [out], onFrame: (n) => onProgress?.(Math.min(1, n / total)) });
  return new Blob([r.out[out] as BlobPart], { type: webm ? 'video/webm' : 'video/mp4' });
}

/** Decoded stereo 44.1 kHz PCM of a media file (background engine). */
export async function extractPcm(m: MediaItem, blob: Blob): Promise<Int16Array> {
  const name = inputName(m);
  const r = await ffmpegBg.run(['-i', MOUNT + name, '-vn', '-ac', '2', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pcm.raw'], { mounts: { [name]: blob }, outputs: ['pcm.raw'] });
  return pcmOf(r.out['pcm.raw'])!;
}

// ---------------------------------------------------------------- export

/** Test hook: force smaller export chunks. */
export const exportTuning = { maxChunk: Infinity };

/** Frames per decode pass, so decoded frames of a big export never take more than ~300 MB. */
const chunkFrames = (w: number, h: number) => Math.max(48, Math.min(4000, Math.floor(300e6 / (w * h * 0.16))));

export async function exportVideo(project: Project, o: ExportOptions, progress: Progress, signal: Signal): Promise<{ blob: Blob; name: string }> {
  const width = project.encoder.width;
  const prep = await prepare(project, width, progress, signal, false);
  check(signal);
  progress('Moshing', 0);
  const frames = applyBitstream(prep, project, cutsOf(project));
  const avi = writeMoshedBlob(prep, frames);
  const base = (project.name || 'mosh').replace(/[^\w-]+/g, '_');
  const fps = project.encoder.fps;
  progress('Mixing audio', 0);
  const audio = o.audio && o.format !== 'gif' && o.format !== 'png' ? await moshedAudioWav(project, frames) : null;
  check(signal);

  if (o.format === 'avi') {
    if (!audio) return { blob: avi, name: `${base}.avi` };
    const r = await ffmpeg.run(['-i', MOUNT + 'mosh.avi', '-i', 'a.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-shortest', 'out.avi'], {
      mounts: { 'mosh.avi': avi },
      inputs: { 'a.wav': async () => audio },
      outputs: ['out.avi'],
    });
    return { blob: new Blob([r.out['out.avi'] as BlobPart], { type: 'video/x-msvideo' }), name: `${base}.avi` };
  }

  const type = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' }[o.format as 'mp4'];
  const runner = new PostRunner(project, 0.95, true);
  const post = runner.active;
  const n = frames.length;

  // No pixel effects: encode straight from the moshed file in one pass.
  if (!post && o.format !== 'png') {
    const out = `out.${o.format}`;
    const r = await ffmpeg.run(exportArgs(o, project.decoder, fps, { file: MOUNT + 'mosh.avi', mjpeg: false }, audio ? 'a.wav' : null, out), {
      mounts: { 'mosh.avi': avi },
      inputs: audio ? { 'a.wav': async () => audio } : {},
      outputs: [out],
      onFrame: (k) => progress('Encoding ' + o.format.toUpperCase(), Math.min(1, k / n)),
    });
    await ffmpeg.remove('a.wav');
    return { blob: new Blob([r.out[out] as BlobPart], { type }), name: `${base}.${o.format}` };
  }

  // Pixel effects (or PNGs): decode, process and encode in chunks to keep memory bounded.
  const { w, h } = outputSize(project, width);
  const per = o.format === 'gif' ? n : Math.min(exportTuning.maxChunk, chunkFrames(w, h));
  const pieces: Uint8Array[] = [];
  const pngs: { name: string; data: Uint8Array }[] = [];
  const gifJpegs: Uint8Array[] = [];
  const canvas = document.createElement('canvas');
  try {
    for (let a = 0, k = 0; a < n; a += per, k++) {
      const b = Math.min(n, a + per);
      const span = (x: number) => (a + x * (b - a)) / n;
      const chunk = per >= n ? await decode(project, avi, 2, n, 'Decoding', (s, p) => progress(s, p)) : await decode(project, avi, 2, b, 'Decoding', (s, p) => progress(`${s} ${a + 1}–${b} of ${n}`, span(p)), { from: a, to: b });
      check(signal);
      const done = await runner.run(chunk, frames, a, (p) => progress(`Pixel effects ${a + 1}–${b} of ${n}`, span(p)), signal);
      check(signal);
      if (o.format === 'png') {
        for (let i = 0; i < done.length; i++) {
          check(signal);
          const bmp = await createImageBitmap(new Blob([done[i] as BlobPart], { type: 'image/jpeg' }));
          const ow = o.width > 0 ? even(o.width) : bmp.width;
          canvas.width = ow;
          canvas.height = Math.round((bmp.height * ow) / bmp.width);
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = o.scaler !== 'neighbor';
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          bmp.close();
          const pb = await new Promise<Blob>((res) => canvas.toBlob((x) => res(x!), 'image/png'));
          pngs.push({ name: `frame_${String(a + i + 1).padStart(5, '0')}.png`, data: new Uint8Array(await pb.arrayBuffer()) });
          progress('Writing PNGs', (a + i) / n);
        }
      } else if (o.format === 'gif') gifJpegs.push(...done);
      else {
        const cat = concatBytes(done);
        const out = `p${k}.${o.format}`;
        const r = await ffmpeg.run(exportArgs(o, project.decoder, fps, { file: 'frames.mjpeg', mjpeg: true }, null, out), {
          inputs: { 'frames.mjpeg': async () => cat },
          outputs: [out],
          onFrame: (x) => progress(`Encoding ${o.format.toUpperCase()} ${a + 1}–${b} of ${n}`, span(Math.min(1, x / (b - a)))),
        });
        pieces.push(r.out[out]);
      }
    }
  } finally {
    runner.dispose();
  }
  if (o.format === 'png') return { blob: zip(pngs), name: `${base}_frames.zip` };
  if (o.format === 'gif') {
    const cat = concatBytes(gifJpegs);
    const r = await ffmpeg.run(exportArgs(o, project.decoder, fps, { file: 'frames.mjpeg', mjpeg: true }, null, 'out.gif'), {
      inputs: { 'frames.mjpeg': async () => cat },
      outputs: ['out.gif'],
      onFrame: (x) => progress('Encoding GIF', Math.min(1, x / n)),
    });
    return { blob: new Blob([r.out['out.gif'] as BlobPart], { type }), name: `${base}.gif` };
  }
  // join the pieces (and add the sound) without re-encoding
  progress('Joining', 0);
  const inputs: Record<string, () => Promise<Uint8Array>> = {};
  pieces.forEach((p, i) => (inputs[`p${i}.${o.format}`] = async () => p));
  inputs['list.txt'] = async () => new TextEncoder().encode(pieces.map((_, i) => `file 'p${i}.${o.format}'`).join('\n'));
  if (audio) inputs['a.wav'] = async () => audio;
  const out = `out.${o.format}`;
  const args = ['-f', 'concat', '-safe', '0', '-i', 'list.txt'];
  if (audio) args.push('-i', 'a.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...(o.format === 'mp4' ? ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] : ['-c:a', 'libvorbis', '-q:a', '6']), '-shortest');
  else args.push('-c', 'copy');
  args.push(out);
  const r = await ffmpeg.run(args, { inputs, outputs: [out] });
  return { blob: new Blob([r.out[out] as BlobPart], { type }), name: `${base}.${o.format}` };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, j) => s + j.length, 0));
  let off = 0;
  for (const j of parts) (out.set(j, off), (off += j.length));
  return out;
}

export { mediaOf };
