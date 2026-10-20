// Orchestrates prep -> mosh -> decode -> post for previews and exports.
import { ffmpeg, ffmpegBg, Cancelled, MOUNT, type RunOptions, type Engine } from './ffmpeg';
import { fileSize, framesFromDisk, loadFrames, assembleAvi, removeEngineFile, moveEngineFile, writeEngineFile } from './ffmpeg-native';
import { isDesktop } from './platform';
import { getFile } from './storage';
import { lutInputs } from './luts.svelte';
import { PostRunner } from './post';
import { mediaState } from './mediastate.svelte';
import { backdropPlate, borderPlate, maskPlate } from './canvas';
import { cardRect, hasCanvas } from '../engine/canvas';
import { regenArgs, generationEncoder, loopPassArgs, type LayerOverlay, type CanvasPlates, commentArgs, metadataArgs, segmentArgs, prepArgs, segmentKey, decodeToMjpegArgs, decoderInputArgs, audioMixArgs, exportArgs, inputName, parseProbe, outputSize, type ExportOptions, type PathFn, even, GENERATORS } from '../engine/args';
import { hasScripts, prepareScripts, packsNeeded, traceGeneration, loopMelt, type Packs, framesFromAvi, applyBitstream, applyBitstreamDisk, writeMoshed, writeMoshedBlob, concatPrepared, type Prepared } from '../engine/mosh';
import { cutFrames, segments, timelineDuration, timelineFrames, audioSources, mediaOf, type Segment } from '../engine/timeline';
import { analyzeAudio, type AudioFeatures } from '../engine/beats';
import { audioKey, audioKeysNeeded, type MoshAudio } from '../engine/audiofx';
import { splitJpegs } from '../engine/jpeg';
import { buildAudio, wav, wavParts, SAMPLE_RATE } from '../engine/audio';
import { zip } from '../engine/zip';
import { hashSeed } from '../engine/rng';
import { packArgs } from '../engine/motionpacks';
import { aspectRatio, reframePath } from '../engine/reframe';
import { grayFrames } from './analysis';
import { bitrateFor } from '../engine/social';
import { encodeRecipe, findRecipe, gifComments, gifWithComment } from '../engine/recipe';
import type { Frame, MediaItem, Project } from '../engine/types';
import { drawOrder, isEmpty, isStill, layerAlpha, layerEnd, type Layer } from '../engine/layers';
import { drawLayer } from './layers';
import { ensureFonts } from './fonts.svelte';
import { FrameEncoder, encodedSize, hardwareCodec, hardwareProxy } from './webcodecs';

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
/** pictures of moving layers, one per frame (see layerOverlays) */
const seqCache = new LRU<Blob>(32, 300e6);

/**
 * Layers that melt with the video, drawn as transparent full-frame pictures for the prep graph:
 * one picture of a layer that looks the same throughout, or one per frame of a layer that moves.
 */
async function layerOverlays(project: Project, w: number, h: number, mounts: Record<string, Blob>, progress?: Progress, signal?: Signal): Promise<LayerOverlay[]> {
  const fps = project.encoder.fps;
  const out: LayerOverlay[] = [];
  for (const l of drawOrder(project.layers ?? [])) {
    if (!l.moshed || isEmpty(l)) continue;
    if (isStill(l)) {
      const key = JSON.stringify({ ...l, start: 0, duration: 0, fade: 0, w, h });
      let png = pngCache.get(key);
      if (!png) {
        png = await layerPng(l, w, h);
        if (pngCache.size > 64) pngCache.clear();
        pngCache.set(key, png);
      }
      const name = `layer_${l.id}.png`;
      mounts[name] = png;
      out.push({ layer: l, path: MOUNT + name });
      continue;
    }
    // the timeline frames it's on screen in
    const first = Math.ceil(l.start * fps - 1e-6);
    const count = Math.max(1, Math.ceil(layerEnd(l) * fps - 1e-6) - first);
    const key = JSON.stringify({ l, w, h, fps });
    let seq = seqCache.get(key);
    if (!seq) {
      seq = await layerFrames(l, w, h, first, count, fps, progress, signal);
      seqCache.set(key, seq, seq.size);
    }
    const name = `layer_${l.id}.pngs`;
    mounts[name] = seq;
    out.push({ layer: l, path: MOUNT + name, frames: { first, count } });
  }
  return out;
}

/** The canvas's pictures for the prep graph (see CanvasPlates), when the picture is set in. */
async function canvasPlates(project: Project, w: number, h: number, mounts: Record<string, Blob>): Promise<CanvasPlates | undefined> {
  const c = project.canvas;
  if (!hasCanvas(c)) return undefined;
  const R = cardRect(c, w, h);
  mounts['canvas_bg.png'] = await canvasPng(backdropPlate(c, w, h));
  const out: CanvasPlates = { bg: MOUNT + 'canvas_bg.png' };
  if (R.r > 0) {
    mounts['canvas_mask.png'] = await canvasPng(maskPlate(R));
    out.mask = MOUNT + 'canvas_mask.png';
  }
  if ((c.border ?? 0) > 0) {
    mounts['canvas_border.png'] = await canvasPng(borderPlate(c, w, h));
    out.border = MOUNT + 'canvas_border.png';
  }
  return out;
}

const canvasPng = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('drawing a layer failed'))), 'image/png'));

function layerPng(l: Layer, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawLayer(c.getContext('2d')!, l, w, h, 1, l.start);
  return canvasPng(c);
}

/** A layer at timeline frames first.. first + count - 1, fades and all: PNGs one after another. */
async function layerFrames(l: Layer, w: number, h: number, first: number, count: number, fps: number, progress?: Progress, signal?: Signal): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const pngs: Blob[] = [];
  for (let k = 0; k < count; k++) {
    if (k % 8 === 0) {
      check(signal);
      progress?.('Drawing titles', k / count);
    }
    const t = (first + k) / fps;
    ctx.clearRect(0, 0, w, h);
    drawLayer(ctx, l, w, h, layerAlpha(l, t), t);
    pngs.push(await canvasPng(c));
  }
  return new Blob(pngs);
}

/** `disk` (desktop exports): segments stay on disk as disk-backed frames, see framesFromDisk. */
export async function prepare(project: Project, width: number, progress?: Progress, signal?: Signal, preview = true, disk = false, eng: Engine = ffmpeg): Promise<Prepared> {
  if (!project.clips.length && !project.layers?.length) throw new Error('Add a clip first');
  const fps = project.encoder.fps;
  const { mounts, path } = await mountsFor(project, preview);
  const inputs = await lutInputs(project);
  const size = outputSize(project, width);
  await ensureFonts(project);
  const overlays = await layerOverlays(project, size.w, size.h, mounts, progress, signal);
  const plates = await canvasPlates(project, size.w, size.h, mounts);
  // Without keyframes at cuts the stream must be encoded in one go (cuts become P-frames).
  const whole = !project.encoder.keyAtCuts;
  const segs: (Segment | null)[] = whole ? [null] : segments(project, fps);
  const totalFrames = Math.max(1, Math.round(timelineDuration(project) * fps));
  const parts: Prepared[] = [];
  let done = 0;
  for (const seg of segs) {
    check(signal);
    const key = (preview ? 'p' : 'x') + width + (seg ? segmentKey(project, seg, width, path) : JSON.stringify({ whole: prepArgs(project, width, 'o', path, overlays, plates), t: project.layers.filter((t) => t.moshed), cv: project.canvas }));
    const n = seg ? seg.f1 - seg.f0 : totalFrames;
    let part = preview ? segCache.get(key) : undefined;
    if (!part) {
      const name = disk ? `prep_${parts.length}.avi` : 'prep.avi';
      const args = seg ? segmentArgs(project, seg, width, name, path, overlays, plates) : prepArgs(project, width, name, path, overlays, plates);
      const base = done;
      const onFrame = (k: number) => progress?.('Preparing clips', Math.min(1, (base + k) / totalFrames));
      let log: string;
      if (disk) {
        log = (await eng.run(args, { mounts, inputs, leave: [name], onFrame })).log;
        check(signal);
        part = await framesFromDisk(eng.file!(name), project.encoder.codec);
      } else {
        const r = await eng.run(args, { mounts, inputs, outputs: [name], onFrame });
        check(signal);
        part = framesFromAvi(r.out[name], project.encoder.codec);
        log = r.log;
      }
      if (!part.frames.length) throw new Error('Preparing produced no frames.\n' + log.slice(-800));
      if (preview) segCache.set(key, part, prepBytes(part));
    }
    parts.push(part);
    done += n;
  }
  return concatPrepared(parts);
}

// ---------------------------------------------------------------- decode

/** `avi`: the moshed stream in memory, or (desktop) the name of a file in the engine's folder. */
async function decode(project: Project, avi: Uint8Array | Blob | string, quality: number, total: number, label: string, progress?: Progress, opts: { scaleW?: number; from?: number; to?: number } = {}, eng: Engine = ffmpeg): Promise<Uint8Array[]> {
  const onDisk = typeof avi === 'string';
  const blob = onDisk ? null : avi instanceof Blob ? avi : new Blob([avi as BlobPart]);
  const vf: string[] = [];
  if (opts.from || opts.to !== undefined) vf.push(`select='between(n,${opts.from ?? 0},${(opts.to ?? 1e9) - 1})'`);
  if (opts.scaleW) vf.push(`scale=${even(opts.scaleW)}:-2`);
  const args = [
    ...decoderInputArgs(project.decoder),
    '-i', onDisk ? avi : MOUNT + 'mosh.avi',
    '-fps_mode', 'passthrough',
    ...(vf.length ? ['-vf', vf.join(',')] : []),
    ...(opts.to !== undefined ? ['-frames:v', String(opts.to - (opts.from ?? 0))] : []),
    '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-q:v', String(quality),
    '-f', 'image2pipe', 'out.mjpeg',
  ];
  const r = await eng.run(args, {
    mounts: blob ? { 'mosh.avi': blob } : {},
    outputs: ['out.mjpeg'],
    onFrame: (n) => progress?.(label, Math.min(1, n / Math.max(1, total))),
  });
  return splitJpegs(r.out['out.mjpeg']);
}

export function cutsOf(project: Project): number[] {
  return cutFrames(project, project.encoder.fps);
}

/** Identity of everything that changes the moshed picture. */
export const renderKey = (p: Project) => JSON.stringify({
  // effects that follow the music change when the sound does
  au: audioKeysNeeded(p).length ? { tr: p.tracks.filter((t) => t.kind === 'audio').map((t) => [t.id, t.muted, t.solo, t.volume]), bs: p.beatSource } : 0, c: p.clips.map(({ label: _l, paths: _p, ...c }) => c), tp: p.effects.some((e) => e.type === 'mask' && e.params.source === 'track') ? p.clips.map((c) => c.paths ?? 0) : 0, v: p.tracks.filter((t) => t.kind === 'video').map((t) => [t.id, t.muted]), m: p.media.map((m) => [m.id, m.width, m.height]), t: (p.layers ?? []).filter((t) => t.moshed), e: p.effects, enc: p.encoder, d: p.decoder, s: p.globalSeed, ch: p.chaos ?? 1 });

let lastDecode: { key: string; frames: Frame[]; jpegs: Uint8Array[] } | null = null;

// ---------------------------------------------------------------- scripts

/** Run the Script effects (in their sandbox) so the mosh that follows has their answers. */
async function runScripts(project: Project, prep: Prepared, cuts: number[], audio?: MoshAudio, packs?: Packs) {
  if (!hasScripts(project)) return;
  const { planScript } = await import('./scripts.svelte');
  await prepareScripts(prep, project, cuts, (e, input) => planScript(e, input, project.encoder.fps, prep.frames.length), audio, packs);
}

// ---------------------------------------------------------------- motion packs

const packCache = new Map<string, Promise<Frame[]>>();

/** Frames of every motion pack the project uses, rendered at the mosh's size and settings. */
export async function packsFor(project: Project, width: number, eng: Engine = ffmpeg): Promise<Packs | undefined> {
  const ids = packsNeeded(project);
  if (!ids.length) return undefined;
  const { w, h } = outputSize(project, width);
  const out: Packs = {};
  for (const id of ids) {
    const { keyMarkers: _k, previewWidth: _p, generations: _g, genCrush: _c, ...enc } = project.encoder;
    const key = JSON.stringify([id, w, h, enc]);
    let hit = packCache.get(key);
    if (!hit) {
      hit = eng.run(packArgs(id, project.encoder, w, h, 'pack.avi'), { outputs: ['pack.avi'] }).then((r) => framesFromAvi(r.out['pack.avi'], project.encoder.codec).frames);
      hit.catch(() => packCache.delete(key));
      packCache.set(key, hit);
      if (packCache.size > 8) packCache.delete(packCache.keys().next().value!);
    }
    out[id] = await hit;
  }
  return out;
}

/**
 * Feedback / generation loss: decode the mosh, encode it again and mosh it again, N times. Each
 * pass crushes the quality a little more. Returns the last pass, with every frame's source and
 * timeline position traced back through the passes (so the sound and the timeline still match).
 */
export async function generations(project: Project, prep: Prepared, frames: Frame[], cuts: number[], audio: MoshAudio | undefined, progress?: Progress, signal?: Signal, packs?: Packs, eng: Engine = ffmpeg): Promise<{ prep: Prepared; frames: Frame[] }> {
  const n = Math.max(1, Math.min(8, Math.round(project.encoder.generations ?? 1)));
  let curPrep = prep;
  let cur = frames;
  for (let g = 2; g <= n; g++) {
    progress?.(`Generation ${g} of ${n}`, (g - 2) / (n - 1));
    const enc = generationEncoder(project.encoder, g);
    const r = await eng.run(regenArgs(project, enc, MOUNT + 'gen_in.avi', 'gen.avi'), {
      mounts: { 'gen_in.avi': writeMoshedBlob(curPrep, cur) },
      outputs: ['gen.avi'],
    });
    check(signal);
    const next = framesFromAvi(r.out['gen.avi'], enc.codec);
    if (!next.frames.length) break;
    const gp = { ...project, encoder: enc, globalSeed: hashSeed(project.globalSeed, g) };
    await runScripts(gp, next, cuts, audio, packs);
    const out = applyBitstream(next, gp, cuts, audio, packs);
    cur = traceGeneration(cur, out);
    curPrep = next;
  }
  return { prep: curPrep, frames: cur };
}

export async function renderPreview(project: Project, width: number, progress?: Progress, signal?: Signal): Promise<RenderResult> {
  const id = ++renderId;
  let prep = await prepare(project, width, progress, signal);
  // the clean footage (generation passes replace `prep` with moshed streams)
  const clean0 = prep;
  check(signal);
  const cuts = cutsOf(project);
  progress?.('Moshing', 0);
  const audio = await moshAudioFor(project);
  const packs = await packsFor(project, width);
  await runScripts(project, prep, cuts, audio, packs);
  check(signal);
  let frames = applyBitstream(prep, project, cuts, audio, packs);
  check(signal);
  if ((project.encoder.generations ?? 1) > 1) ({ prep, frames } = await generations(project, prep, frames, cuts, audio, progress, signal, packs));
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
    const tail = await decode(project, blob, 3, frames.length - from, 'Decoding', progress, { from });
    jpegs = tail.length === frames.length - from ? [...lastDecode!.jpegs.slice(0, from), ...tail] : await decode(project, blob, 3, frames.length, 'Decoding', progress);
  } else jpegs = await decode(project, blob, 3, frames.length, 'Decoding', progress);
  check(signal);
  lastDecode = { key: dkey, frames, jpegs };
  const clean = needsClean(project) ? new CleanFrames(project, clean0) : undefined;
  const runner = new PostRunner(project, 0.85, false, audio, clean);
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
/**
 * The clean (un-moshed) picture at any timeline position, decoded a stretch at a time from the
 * prepared stream. Each stretch is decoded from the nearest keyframe before it (not from the
 * start), so long videos stay quick. Subject Guard puts these pictures back where its mask says.
 */
export class CleanFrames {
  private cache = new Map<number, Uint8Array>();
  private loading: Promise<void> | null = null;
  constructor(
    private project: Project,
    /** the prepared (clean) stream; on desktop its frames may be on disk */
    private prep: Prepared,
    private span = 96,
    private eng: Engine = ffmpeg,
    /** how far past the asked-for frame one decode may run (to the next keyframe), in frames */
    private reach = 900,
  ) {
    const key = JSON.stringify(project.decoder ?? null);
    if (key !== sharedClean.key) sharedClean = { key, pics: new Map() };
  }
  private async load(pos: number) {
    const fr = this.prep.frames;
    let kf = pos;
    while (kf > 0 && fr[kf].type !== 'I') kf--;
    // on to the next keyframe (within reason): the next stretch then starts there instead of
    // decoding this keyframe's frames all over again
    let next = pos + 1;
    while (next < fr.length && fr[next].type !== 'I') next++;
    const to = Math.min(fr.length, Math.max(pos + this.span, Math.min(next, kf + this.reach)));
    // the stream's first keyframe carries the headers; it's decoded first and dropped
    let list = [fr[0], ...fr.slice(kf, to)];
    if (list.some((f) => f.size !== undefined)) {
      const loaded = await loadFrames(list.filter((f) => f.size !== undefined));
      list = list.map((f) => loaded.get(f) ?? f);
    }
    const js = await decode(this.project, writeMoshedBlob(this.prep, list), 4, list.length, 'Clean frames', undefined, {}, this.eng);
    if (this.cache.size > this.reach * 2) this.cache.clear();
    js.slice(1).forEach((j, i) => {
      this.cache.set(kf + i, j);
      // the same stretch of a cached segment decodes to the same pictures next render
      const f = fr[kf + i];
      if (f && f.size === undefined) sharedClean.pics.set(f.data, j);
    });
    const pics = sharedClean.pics;
    if (pics.size > 1200) for (const k of [...pics.keys()].slice(0, pics.size - 900)) pics.delete(k);
  }
  async get(pos: number): Promise<Uint8Array | null> {
    pos = Math.max(0, Math.min(this.prep.frames.length - 1, pos));
    // (frames kept on disk have only their headers in memory: no key for them)
    const f = this.prep.frames[pos];
    const shared = f && f.size === undefined ? sharedClean.pics.get(f.data) : undefined;
    if (shared && !this.cache.has(pos)) this.cache.set(pos, shared);
    while (!this.cache.has(pos)) {
      if (this.loading) {
        await this.loading;
        continue;
      }
      this.loading = this.load(pos);
      try {
        await this.loading;
      } finally {
        this.loading = null;
      }
      if (!this.cache.has(pos)) break;
    }
    return this.cache.get(pos) ?? null;
  }
}

/**
 * Clean pictures decoded for earlier renders, by the frame data they came from. Prepared
 * segments are cached, so an unchanged clip keeps the same frame data and needs no new decode.
 */
let sharedClean: { key: string; pics: Map<Uint8Array, Uint8Array> } = { key: '', pics: new Map() };

/** Does any active effect need clean frames? */
const needsClean = (p: Project) => p.effects.some((e) => e.enabled && e.type === 'mask');

export async function originalFrames(project: Project, width: number): Promise<Uint8Array[]> {
  // (tracked paths and labels don't change the picture)
  const key = JSON.stringify({ c: project.clips.map(({ label: _l, paths: _p, ...c }) => c), e: project.encoder, width });
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

// ---------------------------------------------------------------- listening to the music

const featureCache = new Map<string, Promise<AudioFeatures | null>>();

/** The project with only one audio source audible ('mix': everything as it is). */
function onlySource(project: Project, key: string): Project {
  if (key === 'mix') return project;
  return { ...project, tracks: project.tracks.map((t) => (t.kind !== 'audio' ? t : { ...t, muted: t.id !== key, solo: false })) };
}

/** The sound of one source ('mix' or an audio track id) over the whole timeline, mixed to one buffer. */
export async function sourcePcm(project: Project, key: string): Promise<Int16Array | null> {
  const { mosh, clean } = await timelineAudio(onlySource(project, key));
  const a = mosh ?? clean;
  if (!a) return null;
  const b = mosh && clean ? clean : null;
  return b ? a.map((v, i) => Math.max(-32768, Math.min(32767, v + (b[i] ?? 0)))) : a;
}

/** Analysed sound of one source ('mix' or an audio track id) over the whole timeline. */
export function audioFeatures(project: Project, key: string): Promise<AudioFeatures | null> {
  const p = onlySource(project, key);
  const fps = project.encoder.fps;
  const frames = timelineFrames(project, fps);
  const ck = JSON.stringify({ key, s: audioSources(p).map((s) => [s.clip.id, s.clip.mediaId, s.start, s.len, s.clip.in, s.clip.out, s.clip.speed, s.clip.reverse, s.gain, s.fadeIn, s.fadeOut]), fps, frames });
  let hit = featureCache.get(ck);
  if (!hit) {
    hit = (async () => {
      const pcm = await sourcePcm(project, key);
      return pcm ? analyzeAudio(pcm, fps, frames) : null;
    })();
    hit.catch(() => featureCache.delete(ck));
    featureCache.set(ck, hit);
    if (featureCache.size > 12) featureCache.delete(featureCache.keys().next().value!);
  }
  return hit;
}

/** Everything a render needs from the music (undefined when no effect listens to it). */
export async function moshAudioFor(project: Project): Promise<MoshAudio | undefined> {
  const keys = audioKeysNeeded(project);
  if (!keys.length) return undefined;
  const sources: Record<string, AudioFeatures> = {};
  for (const k of keys) {
    const f = await audioFeatures(project, k);
    if (f) sources[k] = f;
  }
  return { sources, beatKey: audioKey(project, project.beatSource) };
}

/** Final sound for a list of output frames, as WAV bytes (or null when silent). */
export async function moshedAudioWav(project: Project, frames: Pick<Frame, 'src' | 'tag' | 'at'>[]): Promise<Uint8Array | null> {
  const pcm = await moshedAudio(project, frames);
  return pcm && wav(pcm);
}

/** The finished soundtrack (interleaved stereo at SAMPLE_RATE) for these output frames. */
export async function moshedAudio(project: Project, frames: Pick<Frame, 'src' | 'tag' | 'at'>[], offset = 0): Promise<Int16Array | null> {
  const { mosh, clean } = await timelineAudio(project);
  if (!mosh && !clean) return null;
  const fps = project.encoder.fps;
  const len = Math.round(frames.length * (SAMPLE_RATE / fps)) * 2;
  // first sample of the clean / original sound (exports of a range start part-way in)
  const o0 = Math.round(offset * (SAMPLE_RATE / fps)) * 2;
  // buildAudio only reads the bus (and writes a new buffer), so the cached bus isn't copied
  const out = mosh ? buildAudio(project.audio.mode === 'original' ? mosh.subarray(Math.min(mosh.length, o0)) : mosh, frames, fps, project.audio, project.globalSeed) : new Int16Array(len);
  if (clean) {
    const v = project.audio.volume;
    for (let i = 0; i < out.length && o0 + i < clean.length; i++) out[i] = Math.max(-32768, Math.min(32767, out[i] + clean[o0 + i] * v));
  }
  return out;
}

// ---------------------------------------------------------------- media helpers

export async function probeFile(blob: Blob, ext: string): Promise<{ info: ReturnType<typeof parseProbe>; thumb: string }> {
  const name = `probe.${ext}`;
  const mounts = { [name]: blob };
  const r = await ffmpeg.run(['-i', MOUNT + name], { mounts });
  const info = parseProbe(r.log);
  if (info.recipe)
    try {
      const m = await ffmpeg.run(metadataArgs(MOUNT + name, 'meta.txt'), { mounts, outputs: ['meta.txt'] });
      info.recipe = findRecipe(new TextDecoder().decode(m.out['meta.txt'])) ?? info.recipe;
    } catch {
      /* keep what the log showed */
    }
  // GIFs keep their recipe in a comment block ffmpeg doesn't print
  if (!info.recipe && ext === 'gif' && blob.size < 64e6) info.recipe = gifComments(new Uint8Array(await blob.arrayBuffer())).map(findRecipe).find(Boolean) ?? null;
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

/**
 * Small, fast-seeking copy for previews: with the browser's own decoders and encoders where it can
 * (much faster, see webcodecs.ts), else on the background engine. H.264, or VP8/VP9 where the
 * browser lacks H.264.
 */
export async function makeProxy(m: MediaItem, blob: Blob, onProgress?: (p: number) => void, webm = false): Promise<{ blob: Blob; hardware: boolean }> {
  if (m.source.kind !== 'file') throw new Error('no file');
  const hw = await hardwareProxy(blob, m.width, m.fps, onProgress);
  if (hw) return { blob: hw, hardware: true };
  const name = inputName(m);
  const w = Math.min(960, even(m.width || 960));
  const vf = [`scale=${w}:-2:flags=bicubic`, m.fps > 30 ? 'fps=30' : '', 'format=yuv420p'].filter(Boolean).join(',');
  const total = Math.max(1, m.duration * Math.min(30, m.fps || 30));
  const out = webm ? 'proxy.webm' : 'proxy.mp4';
  const codec = webm
    ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2500k', '-g', '12', '-auto-alt-ref', '0', '-c:a', 'libvorbis', '-q:a', '4']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-g', '12', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'];
  const args = ['-i', MOUNT + name, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, ...codec, '-ac', '2', out];
  const r = await ffmpegBg.run(args, { mounts: { [name]: blob }, outputs: [out], onFrame: (n) => onProgress?.(Math.min(1, n / total)) });
  return { blob: new Blob([r.out[out] as BlobPart], { type: webm ? 'video/webm' : 'video/mp4' }), hardware: false };
}

/**
 * Browser recordings (MediaRecorder) have no duration and no seek index, so players can't seek
 * them and their length is unknown. Re-wrap them (no re-encoding) so they behave like normal files.
 */
export async function finalizeRecording(blob: Blob, name: string): Promise<File> {
  const mp4 = /mp4/.test(blob.type);
  const ext = mp4 ? 'mp4' : 'webm';
  const out = `fixed.${ext}`;
  try {
    const r = await ffmpeg.run(['-fflags', '+genpts', '-i', MOUNT + 'rec.' + ext, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...(mp4 ? ['-movflags', '+faststart'] : []), out], {
      mounts: { ['rec.' + ext]: blob },
      outputs: [out],
    });
    const data = r.out[out];
    if (data?.length > 1000) return new File([data as BlobPart], `${name}.${ext}`, { type: mp4 ? 'video/mp4' : 'video/webm' });
  } catch (e) {
    console.warn('could not tidy the recording, using it as is', e);
  }
  return new File([blob], `${name}.${ext}`, { type: blob.type || 'video/webm' });
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

/**
 * A finished export: in memory (`blob`), or on desktop a file in the native engine's folder
 * (`file`, saved with saveFromDisk) so long videos never pass through the webview.
 */
export interface Exported {
  name: string;
  type: string;
  size: number;
  blob?: Blob;
  file?: string;
  /** encoded with the browser's hardware encoder */
  hardware?: boolean;
}

/** The hardware encoder failed part-way: the export starts again with ffmpeg. */
class HardwareFailed extends Error {}

/** Sound codec arguments when the sound is added to an already encoded picture. */
const audioCodecArgs = (o: ExportOptions) =>
  o.format === 'mp4' ? ['-c:a', 'aac', '-b:a', o.videoKbps ? '128k' : '192k', '-movflags', '+faststart'] : o.videoKbps ? ['-c:a', 'libvorbis', '-b:a', '128k'] : ['-c:a', 'libvorbis', '-q:a', '6'];

const fromBlob = (blob: Blob, name: string): Exported => ({ blob, name, type: blob.type, size: blob.size });

/** Run the final encode; on desktop the output stays on disk. */
async function finish(eng: Engine, args: string[], opts: RunOptions, out: string, type: string, name: string): Promise<Exported> {
  if (isDesktop) {
    await eng.run(args, { ...opts, leave: [out] });
    const file = eng.file!(out);
    return { file, name, type, size: (await fileSize(file)) ?? 0 };
  }
  const r = await eng.run(args, { ...opts, outputs: [out] });
  return fromBlob(new Blob([r.out[out] as BlobPart], { type }), name);
}

/** `eng`: the engine to run on (the export queue uses the background one, so editing carries on). */
export async function exportVideo(project: Project, o: ExportOptions, progress: Progress, signal: Signal, eng: Engine = ffmpeg): Promise<Exported> {
  try {
    return await exportWith(project, o, progress, signal, eng);
  } catch (e) {
    if (!(e instanceof HardwareFailed) || signal.cancelled) throw e;
    console.warn('hardware encoding failed, exporting with ffmpeg instead', e.cause);
    return exportWith(project, { ...o, hardware: false }, progress, signal, eng);
  }
}

async function exportWith(project: Project, o: ExportOptions, progress: Progress, signal: Signal, eng: Engine): Promise<Exported> {
  const width = project.encoder.width;
  // Desktop: frame payloads stay on disk and the moshed AVI is assembled there, so memory use
  // doesn't grow with the length of the video.
  // generation loss re-encodes the mosh in memory, so it doesn't use the on-disk path
  const gens = (project.encoder.generations ?? 1) > 1;
  // (H.264 too: its frames are renumbered after the mosh, which needs them in memory)
  const disk = isDesktop && !gens && project.encoder.codec !== 'h264';
  try {
    let prep = await prepare(project, width, progress, signal, false, disk, eng);
    const clean0 = prep;
    check(signal);
    // the recipe rides along in the file, so anyone can load the mosh from the video
    o = { ...o, comment: o.comment ?? (await encodeRecipe(project, prep.frames.length)) };
    progress('Moshing', 0);
    const audioFx = await moshAudioFor(project);
    const packs = await packsFor(project, width, eng);
    await runScripts(project, prep, cutsOf(project), audioFx, packs);
    let frames = disk ? await applyBitstreamDisk(prep, project, cutsOf(project), loadFrames, audioFx, packs) : applyBitstream(prep, project, cutsOf(project), audioFx, packs);
    if (gens) ({ prep, frames } = await generations(project, prep, frames, cutsOf(project), audioFx, progress, signal, packs, eng));
    const fps = project.encoder.fps;
    // seamless loop, melt: the start melts out of the end (lead frames are decoded, then dropped)
    const looping = o.loopMode && o.loopMode !== 'off' && o.format !== 'avi' && o.format !== 'png' ? o.loopMode : null;
    const seam = Math.max(1, Math.round((o.loopSeconds ?? 0.5) * fps));
    let lead = 0;
    if (looping === 'melt') ({ frames, lead } = loopMelt(prep, frames, seam));
    const avi = disk ? null : writeMoshedBlob(prep, frames);
    if (disk) await assembleAvi(eng.file!('mosh.avi'), prep, frames);
    check(signal);
    // the moshed AVI: an engine file on desktop, a mounted Blob in the browser
    const aviIn = disk ? 'mosh.avi' : MOUNT + 'mosh.avi';
    const aviMounts: Record<string, Blob> = disk ? {} : { 'mosh.avi': avi! };
    const base = (project.name || 'mosh').replace(/[^\w-]+/g, '_');
    // only part of the timeline (In–Out): output frames whose timeline position is inside it
    let lo = lead;
    let hi = frames.length;
    const range = o.range && o.format !== 'avi' && !looping ? o.range : null;
    if (range) {
      const pos = (f: Frame) => f.at ?? f.src;
      const a = Math.round(range[0] * fps);
      const b = Math.round(range[1] * fps);
      lo = Math.max(0, frames.findIndex((f) => pos(f) >= a));
      const end = frames.findIndex((f) => pos(f) >= b);
      hi = Math.max(lo + 1, end < 0 ? frames.length : end);
    }
    progress('Mixing audio', 0);
    const pcm = o.audio && o.format !== 'gif' && o.format !== 'png' ? await moshedAudio(project, frames.slice(lo, hi), range ? lo : 0) : null;
    const audio = !!pcm;
    // a size limit (Discord…): aim the bitrate under it
    if (o.maxMB && (o.format === 'mp4' || o.format === 'webm')) o = { ...o, videoKbps: bitrateFor(o.maxMB, (hi - lo) / fps, audio) };
    // the soundtrack as a.wav: written straight to disk on desktop, an engine input in the browser
    if (pcm && disk) await writeEngineFile(eng.file!('a.wav'), wavParts(pcm));
    const audioIn: Record<string, () => Promise<Uint8Array>> = pcm && !disk ? { 'a.wav': async () => wav(pcm) } : {};
    check(signal);
    if (looping === 'crossfade') o = { ...o, crossfade: { frames: hi - lo, overlap: Math.min(seam, Math.floor((hi - lo) / 3)) } };
    // another shape than the project: find where the action is and let the crop follow it
    const shape = outputSize(project, width);
    if (o.reframeTo && o.format !== 'avi' && Math.abs(aspectRatio(o.reframeTo) - shape.w / shape.h) > 0.01) {
      progress('Finding the action', 0);
      const gw = 96;
      const gh = even((gw * shape.h) / shape.w);
      const r = await eng.run([...decoderInputArgs(project.decoder), '-i', aviIn, '-an', '-vf', `scale=${gw}:${gh},format=gray`, '-f', 'rawvideo', 'rf.gray'], { mounts: aviMounts, outputs: ['rf.gray'] });
      const g = grayFrames(r.out['rf.gray'], gw, gh);
      g.frames = g.frames.slice(lo, hi);
      o = { ...o, reframe: reframePath(g, fps, shape.w / shape.h, aspectRatio(o.reframeTo)) ?? undefined };
      check(signal);
    }

    if (o.format === 'avi') {
      if (!audio) {
        if (!disk) return fromBlob(avi!, `${base}.avi`);
        await moveEngineFile(eng.file!('mosh.avi'), eng.file!('out.avi'));
        return { file: eng.file!('out.avi'), name: `${base}.avi`, type: 'video/x-msvideo', size: (await fileSize(eng.file!('out.avi'))) ?? 0 };
      }
      return await finish(eng, ['-i', aviIn, '-i', 'a.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', '-shortest', ...commentArgs(o.comment), 'out.avi'], {
        mounts: aviMounts,
        inputs: audioIn,
      }, 'out.avi', 'video/x-msvideo', `${base}.avi`);
    }

    const type = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' }[o.format as 'mp4'];
    const clean = needsClean(project) ? new CleanFrames(project, clean0, 96, eng, 240) : undefined;
    const runner = new PostRunner(project, 0.95, true, audioFx, clean);
    const post = runner.active;
    const n = hi - lo;
    const { w, h } = outputSize(project, width);
    // the browser's hardware encoder (a crossfade loop needs ffmpeg's filters)
    const enc = o.hardware && !disk && (o.format === 'mp4' || o.format === 'webm') && !o.crossfade ? encodedSize({ srcW: w, srcH: h, width: o.width, reframe: o.reframe }) : null;
    const hwCodec = enc ? await hardwareCodec(o.format, enc.w, enc.h) : null;

    // No pixel effects (and the whole timeline): encode straight from the moshed file in one pass.
    if (!post && !hwCodec && o.format !== 'png' && !range && lo === 0) {
      const out = `out.${o.format}`;
      const done = await finish(eng, exportArgs(o, project.decoder, fps, { file: aviIn, mjpeg: false }, audio ? 'a.wav' : null, out), {
        mounts: aviMounts,
        inputs: audioIn,
        onFrame: (k) => progress('Encoding ' + o.format.toUpperCase(), Math.min(1, k / n)),
      }, out, type, `${base}.${o.format}`);
      await eng.remove('a.wav');
      return done;
    }

    // Pixel effects (or PNGs, or the hardware encoder): decode, process and encode in chunks to keep memory bounded.
    const hw = hwCodec ? new FrameEncoder({ format: o.format as 'mp4' | 'webm', codec: hwCodec, fps, srcW: w, srcH: h, width: o.width, scaler: o.scaler, crf: o.crf, kbps: o.videoKbps, reframe: o.reframe }) : null;
    const per = o.format === 'gif' ? n : Math.min(exportTuning.maxChunk, chunkFrames(w, h));
    // in one go only when the output is the whole file (a melt loop skips its lead-in frames)
    const whole = !range && lo === 0 && per >= n;
    // encoded pieces: in memory, or (desktop) left on disk under these names
    const pieces: Uint8Array[] = [];
    const pieceNames: string[] = [];
    const pngs: { name: string; data: Uint8Array }[] = [];
    const gifJpegs: Uint8Array[] = [];
    const canvas = document.createElement('canvas');
    try {
      for (let a = lo, k = 0; a < hi; a += per, k++) {
        const b = Math.min(hi, a + per);
        const span = (x: number) => (a - lo + x * (b - a)) / n;
        const src = avi ?? 'mosh.avi';
        const chunk = whole ? await decode(project, src, 2, n, 'Decoding', (s, p) => progress(s, p), {}, eng) : await decode(project, src, 2, b, 'Decoding', (s, p) => progress(`${s} ${a - lo + 1}–${b - lo} of ${n}`, span(p)), { from: a, to: b }, eng);
        check(signal);
        const done = await runner.run(chunk, frames, a, (p) => progress(`Pixel effects ${a - lo + 1}–${b - lo} of ${n}`, span(p)), signal);
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
            pngs.push({ name: `frame_${String(a - lo + i + 1).padStart(5, '0')}.png`, data: new Uint8Array(await pb.arrayBuffer()) });
            progress('Writing PNGs', (a - lo + i) / n);
          }
        } else if (o.format === 'gif') gifJpegs.push(...done);
        else if (hw) {
          for (let i = 0; i < done.length; i++) {
            check(signal);
            try {
              await hw.add(done[i]);
            } catch (e) {
              throw new HardwareFailed('hardware encoder', { cause: e });
            }
            progress(`Encoding ${o.format.toUpperCase()} (hardware) ${a - lo + 1}–${b - lo} of ${n}`, span((i + 1) / done.length));
          }
        } else {
          const cat = concatBytes(done);
          const out = `p${k}.${o.format}`;
          // pieces never loop on their own; the crop's clock carries on from piece to piece
          const r = await eng.run(exportArgs({ ...o, crossfade: undefined, timeOffset: (a - lo) / fps }, project.decoder, fps, { file: 'frames.mjpeg', mjpeg: true }, null, out), {
            inputs: { 'frames.mjpeg': async () => cat },
            ...(isDesktop ? { leave: [out] } : { outputs: [out] }),
            onFrame: (x) => progress(`Encoding ${o.format.toUpperCase()} ${a - lo + 1}–${b - lo} of ${n}`, span(Math.min(1, x / (b - a)))),
          });
          pieceNames.push(out);
          if (!isDesktop) pieces.push(r.out[out]);
        }
      }
    } catch (e) {
      await hw?.cancel();
      throw e;
    } finally {
      runner.dispose();
    }
    if (hw) {
      let video: Uint8Array;
      try {
        video = await hw.finish();
      } catch (e) {
        // release the browser's encoder before ffmpeg takes over
        await hw.cancel();
        throw new HardwareFailed('hardware encoder', { cause: e });
      }
      check(signal);
      // the sound and the recipe go in without touching the picture
      progress('Joining', 0);
      const vin = `v.${o.format}`;
      const out = `out.${o.format}`;
      const args = ['-i', vin];
      if (audio) args.push('-i', 'a.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioCodecArgs(o), '-shortest');
      else args.push('-c', 'copy', ...(o.format === 'mp4' ? ['-movflags', '+faststart'] : []));
      args.push(...commentArgs(o.comment), out);
      const done = await finish(eng, args, { inputs: { [vin]: async () => video, ...audioIn } }, out, type, `${base}.${o.format}`);
      return { ...done, hardware: true };
    }
    if (o.format === 'png') {
      if (o.comment) pngs.push({ name: 'recipe.txt', data: new TextEncoder().encode(o.comment + '\n') });
      return fromBlob(zip(pngs), `${base}_frames.zip`);
    }
    if (o.format === 'gif') {
      const cat = concatBytes(gifJpegs);
      const r = await eng.run(exportArgs(o, project.decoder, fps, { file: 'frames.mjpeg', mjpeg: true }, null, 'out.gif'), {
        inputs: { 'frames.mjpeg': async () => cat },
        outputs: ['out.gif'],
        onFrame: (x) => progress('Encoding GIF', Math.min(1, x / n)),
      });
      const gif = o.comment ? gifWithComment(r.out['out.gif'], o.comment) : r.out['out.gif'];
      return fromBlob(new Blob([gif as BlobPart], { type }), `${base}.gif`);
    }
    // join the pieces (and add the sound) without re-encoding
    progress('Joining', 0);
    const inputs: Record<string, () => Promise<Uint8Array>> = {};
    pieces.forEach((p, i) => (inputs[pieceNames[i]] = async () => p));
    inputs['list.txt'] = async () => new TextEncoder().encode(pieceNames.map((p) => `file '${p}'`).join('\n'));
    Object.assign(inputs, audioIn);
    const out = `out.${o.format}`;
    const args = ['-f', 'concat', '-safe', '0', '-i', 'list.txt'];
    if (audio) args.push('-i', 'a.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...audioCodecArgs(o), '-shortest');
    else args.push('-c', 'copy');
    try {
      if (o.crossfade) {
        // a crossfade loop needs the whole video: join, then one more encode that loops it
        const joined = `joined.${o.format}`;
        progress('Looping', 0);
        const r = await eng.run([...args, joined], { inputs, ...(isDesktop ? { leave: [joined] } : { outputs: [joined] }) });
        const loopIn = isDesktop ? {} : { [joined]: async () => r.out[joined] };
        try {
          return await finish(eng, loopPassArgs(o, joined, o.crossfade.frames, o.crossfade.overlap, fps, audio, out), { inputs: loopIn }, out, type, `${base}.${o.format}`);
        } finally {
          await eng.remove(joined);
        }
      }
      args.push(...commentArgs(o.comment), out);
      return await finish(eng, args, { inputs }, out, type, `${base}.${o.format}`);
    } finally {
      for (const p of pieceNames) await eng.remove(p);
    }
  } finally {
    if (disk) await cleanupExport(eng);
  }
}

/** Desktop: delete the prepared segments and moshed AVI an export left on disk. */
async function cleanupExport(eng: Engine) {
  for (let k = 0; eng.has(`prep_${k}.avi`); k++) await eng.remove(`prep_${k}.avi`);
  await removeEngineFile(eng.file!('mosh.avi'));
  await removeEngineFile(eng.file!('a.wav'));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, j) => s + j.length, 0));
  let off = 0;
  for (const j of parts) (out.set(j, off), (off += j.length));
  return out;
}

export { mediaOf };
