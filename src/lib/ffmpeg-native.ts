// Desktop engine: the same interface as the ffmpeg.wasm service, backed by a native FFmpeg
// process (src-tauri/src/engine.rs). Jobs run in a per-engine work folder on disk; mounted
// Blobs are written to disk once and then passed to FFmpeg as file paths.
import { invoke, Channel } from '@tauri-apps/api/core';
import { MOUNT, Cancelled, type Engine, type RunOptions, type RunResult } from './ffmpeg';

type LogFn = (line: string) => void;

const CHUNK = 32 << 20;
let fileSeq = 0;

/** Write bytes to a path inside the engine's work folder, in chunks so large media never sits in one IPC message. */
async function put(path: string, data: Blob | Uint8Array) {
  const size = data instanceof Blob ? data.size : data.length;
  for (let off = 0; off === 0 || off < size; off += CHUNK) {
    const part = data instanceof Blob ? new Uint8Array(await data.slice(off, off + CHUNK).arrayBuffer()) : data.slice(off, off + CHUNK);
    await invoke('engine_write', part, { headers: { 'x-path': encodeURIComponent(path), 'x-offset': String(off) } });
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

  async remove(name: string) {
    if (!this.files.has(name)) return;
    this.files.delete(name);
    await this.serial(() => removeFile(`${this.dir}/${name}`));
  }
}
