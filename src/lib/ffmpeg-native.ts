// Desktop engine: the same interface as the ffmpeg.wasm service, backed by a native FFmpeg
// process (src-tauri/src/engine.rs). Jobs run in a per-engine work folder on disk; mounted
// Blobs are written to disk once and then passed to FFmpeg as file paths.
import { invoke, Channel } from '@tauri-apps/api/core';
import { MOUNT, Cancelled, type Engine, type RunOptions, type RunResult } from './ffmpeg';
import { aviInfo, aviPlan } from '../engine/avi';
import { analyzeFrame, type MoshCodec } from '../engine/bitstream';
import type { Prepared } from '../engine/mosh';
import type { Frame } from '../engine/types';

type LogFn = (line: string) => void;

const CHUNK = 32 << 20;
let fileSeq = 0;

/** Write bytes into the engine's work folder at `at`, in chunks so no IPC message gets huge. */
async function put(path: string, data: Blob | Uint8Array, at = 0) {
  const size = data instanceof Blob ? data.size : data.length;
  for (let k = 0; k === 0 || k < size; k += CHUNK) {
    const part = data instanceof Blob ? new Uint8Array(await data.slice(k, k + CHUNK).arrayBuffer()) : data.slice(k, k + CHUNK);
    await invoke('engine_write', part, { headers: { 'x-path': encodeURIComponent(path), 'x-offset': String(at + k) } });
  }
}

/** Write a file in the engine's folder from parts (not joined in memory first). */
export async function writeEngineFile(path: string, parts: Uint8Array[]) {
  let off = 0;
  for (const p of parts) {
    await put(path, p, off);
    off += p.length;
  }
}

const removeFile = (path: string) => invoke('engine_remove', { path }).catch(() => {});

/** Blobs already on disk, shared by both engines. A file is deleted once its Blob is garbage collected. */
const onDisk = new WeakMap<Blob, Promise<string>>();
const cleanup = new FinalizationRegistry<string>((path) => void removeFile(path));
function diskPath(blob: Blob, name: string): Promise<string> {
  let p = onDisk.get(blob);
  if (!p) {
    const path = `media/${++fileSeq}_${name.replace(/[^\w.-]+/g, '_')}`;
    p = put(path, blob).then(() => path);
    p.catch(() => onDisk.delete(blob));
    onDisk.set(blob, p);
    cleanup.register(blob, path);
  }
  return p;
}

let jobSeq = 0;

/** Copy a Blob into the engine's work folder (used to save big files without one huge IPC message). */
export async function blobToDisk(blob: Blob, name: string): Promise<string> {
  const path = `exports/${++fileSeq}_${name.replace(/[^\w.-]+/g, '_')}`;
  await put(path, blob);
  return path;
}

/** Native Save dialog for a file in the work folder; the file is moved there. Resolves with the chosen path, or null if cancelled. */
export const saveFromDisk = (path: string, name: string) => invoke<string | null>('save_path', { path, name });
export const revealFile = (path: string) => invoke('reveal', { path }).catch(() => {});
export const fileSize = (path: string) => invoke<number | null>('engine_size', { path });
export const removeEngineFile = (path: string) => invoke('engine_remove', { path }).catch(() => {});
export const moveEngineFile = (from: string, to: string) => invoke('engine_move', { from, to });

export class NativeService implements Engine {
  ready = false;
  stallMs = 0; // native jobs don't stall the way ffmpeg.wasm does; cancel still works
  onStatus: (s: string) => void = () => {};
  private files = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private logListeners = new Set<LogFn>();
  private cancelGen = 0;
  private job = '';
  private loading: Promise<unknown> | null = null;

  constructor(private dir: string) {}

  warmup() {
    this.loading ??= invoke<{ version: string }>('engine_info').then(
      (info) => {
        this.ready = true;
        console.info('native engine:', info.version);
        return info;
      },
      (e) => {
        this.loading = null;
        throw new Error('Could not start FFmpeg (' + ((e as Error)?.message ?? e) + ')');
      },
    );
    return this.loading;
  }

  onLog(fn: LogFn) {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const p = this.chain.then(job, job);
    this.chain = p.catch(() => {});
    return p;
  }

  cancel() {
    this.cancelGen++;
    this.abort();
  }

  /** Kill the running job. Unlike ffmpeg.wasm, kept files survive. */
  abort() {
    if (this.job) invoke('engine_kill', { job: this.job }).catch(() => {});
  }

  has(name: string) {
    return this.files.has(name);
  }

  run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return this.serial(async () => {
      const gen = this.cancelGen;
      try {
        const r = await this.runOnce(args, opts, gen);
        if (gen !== this.cancelGen) throw new Cancelled();
        return r;
      } catch (e) {
        if (gen !== this.cancelGen) throw new Cancelled();
        throw e;
      }
    });
  }

  private async runOnce(args: string[], opts: RunOptions, gen: number): Promise<RunResult> {
    await this.warmup();
    const written: string[] = [];
    try {
      for (const [name, get] of Object.entries(opts.inputs ?? {})) {
        if (this.files.has(name)) continue;
        await put(`${this.dir}/${name}`, await get());
        written.push(name);
      }
      // mounts are read in place: point FFmpeg at the file on disk (paths are relative to the work folder)
      const paths = new Map<string, string>();
      for (const [name, blob] of Object.entries(opts.mounts ?? {})) paths.set(MOUNT + name, '../' + (await diskPath(blob, name)));
      if (gen !== this.cancelGen) throw new Cancelled();

      const lines: string[] = [];
      const channel = new Channel<string[]>();
      channel.onmessage = (batch) => {
        for (const l of batch) {
          lines.push(l);
          this.logListeners.forEach((fn) => fn(l));
          const m = /frame=\s*(\d+)/.exec(l);
          if (m) opts.onFrame?.(+m[1]);
        }
      };
      const level = args.includes('-loglevel') ? [] : ['-loglevel', 'info'];
      const full = ['-hide_banner', '-nostdin', '-y', ...level, ...args.map((a) => paths.get(a) ?? a)];
      this.job = `${this.dir}-${++jobSeq}`;
      let code: number;
      try {
        code = await invoke<number>('engine_run', { job: this.job, dir: this.dir, args: full, onLog: channel });
      } finally {
        this.job = '';
      }
      const log = lines.join('\n');
      const out: Record<string, Uint8Array> = {};
      for (const name of opts.leave ?? []) {
        if (!(await invoke<number | null>('engine_size', { path: `${this.dir}/${name}` }))) {
          if (gen !== this.cancelGen) throw new Cancelled();
          throw new Error(`ffmpeg produced no ${name} (exit ${code}).\n${log.split('\n').slice(-12).join('\n')}`);
        }
        this.files.add(name);
      }
      for (const name of opts.outputs ?? []) {
        try {
          out[name] = new Uint8Array(await invoke<ArrayBuffer>('engine_read', { path: `${this.dir}/${name}` }));
        } catch {
          if (gen !== this.cancelGen) throw new Cancelled();
          throw new Error(`ffmpeg produced no ${name} (exit ${code}).\n${log.split('\n').slice(-12).join('\n')}`);
        } finally {
          removeFile(`${this.dir}/${name}`);
        }
      }
      return { code, log, out };
    } finally {
      for (const name of written) {
        if (opts.keep?.includes(name)) this.files.add(name);
        else removeFile(`${this.dir}/${name}`);
      }
    }
  }

  /** Path (inside the engine's work folder) of a file left by `leave`. */
  file(name: string) {
    return `${this.dir}/${name}`;
  }

  async remove(name: string) {
    if (!this.files.has(name)) return;
    this.files.delete(name);
    await this.serial(() => removeFile(`${this.dir}/${name}`));
  }
}

// ---------------------------------------------------------------- disk-backed moshing (long exports)

/** Bytes of each frame kept in memory: enough for the frame headers the mosh engine reads. */
const HEAD = 1024;
const BATCH = 64 << 20;

/** Read ranges of an engine file, in batches so no single transfer gets huge. */
async function readRanges(path: string, ranges: [number, number][]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (let i = 0; i < ranges.length; ) {
    let bytes = 0;
    let j = i;
    while (j < ranges.length && (j === i || bytes + ranges[j][1] <= BATCH)) bytes += ranges[j++][1];
    const buf = new Uint8Array(await invoke<ArrayBuffer>('engine_read_ranges', { path, ranges: ranges.slice(i, j) }));
    let o = 0;
    for (let k = i; k < j; k++) out.push(buf.subarray(o, (o += ranges[k][1])));
    i = j;
  }
  return out;
}

/** A prepared AVI on disk as frames whose payloads stay there (like framesFromAvi). */
export async function framesFromDisk(path: string, codec: MoshCodec): Promise<Prepared> {
  const scan = await invoke<{ avih: number[]; strh: number[]; strf: number[]; frames: [number, number, boolean][] }>('avi_scan', { path });
  const heads = await readRanges(path, scan.frames.map(([off, size]) => [off, Math.min(size, HEAD)]));
  const frames = scan.frames.map(([off, size, key], i): Frame => {
    const a = analyzeFrame(heads[i], codec);
    return { data: heads[i], size, off, file: path, type: a.type === '?' && key ? 'I' : a.type, src: i, tag: 'orig', payloadStart: a.payloadStart };
  });
  return { info: aviInfo(new Uint8Array(scan.avih), new Uint8Array(scan.strh), new Uint8Array(scan.strf)), frames };
}

/** Full payloads of disk-backed frames, as ordinary in-memory frames (for effects that edit bytes). */
export async function loadFrames(frames: Frame[]): Promise<Map<Frame, Frame>> {
  const map = new Map<Frame, Frame>();
  const byFile = new Map<string, Frame[]>();
  for (const f of frames) byFile.set(f.file!, [...(byFile.get(f.file!) ?? []), f]);
  for (const [file, list] of byFile) {
    const data = await readRanges(file, list.map((f) => [f.off!, f.size!]));
    list.forEach((f, i) => map.set(f, { ...f, data: data[i].slice(), size: undefined, off: undefined, file: undefined }));
  }
  return map;
}

/** Write the moshed AVI for (possibly disk-backed) frames into the engine's folder at `dst`. */
export async function assembleAvi(dst: string, prep: Prepared, frames: Frame[]) {
  const plan = aviPlan(prep.info, frames.map((f) => ({ data: f.data, keyframe: f.type === 'I', size: f.size, off: f.off, file: f.file })));
  const json = new TextEncoder().encode(JSON.stringify({ dst, files: plan.files, pieces: plan.pieces }));
  const body = new Uint8Array(4 + json.length + plan.inline.length);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  body.set(plan.inline, 4 + json.length);
  await invoke('engine_assemble', body);
}
