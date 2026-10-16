// ffmpeg.wasm wrapper: one instance, serialised jobs, crash recovery and cancellation.
// In the desktop app the same interface is backed by a native FFmpeg (see ffmpeg-native.ts).
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { isDesktop } from './platform';
import { NativeService } from './ffmpeg-native';
import { localGet } from './storage';

type LogFn = (line: string) => void;

/** Directory where `mounts` appear inside the ffmpeg file system. */
export const MOUNT = '/m/';

export interface RunOptions {
  inputs?: Record<string, () => Promise<Uint8Array>>;
  /** read straight from Blobs/Files without copying them into memory (WORKERFS); paths are MOUNT + name */
  mounts?: Record<string, Blob>;
  outputs?: string[];
  keep?: string[];
  /** desktop engine only: outputs left on disk in the engine's folder (see Engine.file) instead of read into memory */
  leave?: string[];
  onFrame?: (n: number) => void;
}

export interface RunResult {
  code: number;
  log: string;
  out: Record<string, Uint8Array>;
}

/** What the rest of the app uses; implemented by ffmpeg.wasm (web) and native FFmpeg (desktop). */
export interface Engine {
  ready: boolean;
  stallMs: number;
  onStatus: (s: string) => void;
  warmup(): Promise<unknown>;
  onLog(fn: LogFn): () => void;
  cancel(): void;
  abort(): void;
  has(name: string): boolean;
  run(args: string[], opts?: RunOptions): Promise<RunResult>;
  remove(name: string): Promise<void>;
  /** desktop engine only: where a `leave` output is, relative to the engine's root folder */
  file?(name: string): string;
}

export class EngineCrash extends Error {}
/** Thrown when a job is killed on purpose (user cancel). */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

type CoreUrls = { coreURL: string; wasmURL: string; workerURL?: string };
const cores: Partial<Record<'st' | 'mt', Promise<CoreUrls>>> = {};

/**
 * The multithreaded engine can run: it needs SharedArrayBuffer, which browsers only give a page
 * that is "cross-origin isolated" (the app's service worker adds the headers for it, see
 * scripts/sw.js). It can be turned off in Settings; it also turns itself off for the session after
 * crashing (its memory is fixed at 1 GB, which a very big job can run out of).
 */
export const threads = {
  available: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated && typeof SharedArrayBuffer === 'function',
  enabled: localGet<boolean>('ffmpegThreads', true),
  /** set after the multithreaded engine crashed: single-threaded until the app is reloaded */
  failed: false,
};
/**
 * The multithreaded engine with the thread count left to ffmpeg crashes in x264 ("null function or
 * function signature mismatch": it asks for more threads than the engine can start). A set count
 * of up to 4 is solid and gets most of the speed: given to the encoder of the job's output.
 */
export const THREADS = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
export function withThreads(args: string[]): string[] {
  // no output (a probe: "-i file") or already set
  if (args.includes('-threads') || args.length < 2 || args[args.length - 2] === '-i') return args;
  return [...args.slice(0, -1), '-threads', String(THREADS), args[args.length - 1]];
}

const useThreads = () => threads.available && threads.enabled && !threads.failed;

/**
 * The engine files as blob URLs, downloaded once per session with a byte count for the status line
 * (instances are recycled every few jobs and reuse them).
 */
function coreUrls(kind: 'st' | 'mt', status: (s: string) => void) {
  let core = cores[kind];
  if (core) return core;
  core = cores[kind] = (async () => {
    const base = new URL(kind === 'mt' ? 'ffmpeg-mt/' : 'ffmpeg/', document.baseURI).href;
    const get = async (name: string, type: string, onBytes?: (n: number, total: number) => void) => {
      const r = await fetch(base + name);
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      const total = Number(r.headers.get('content-length')) || 0;
      if (!r.body || !onBytes) return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
      const reader = r.body.getReader();
      const parts: Uint8Array[] = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
        onBytes(n, total);
      }
      return URL.createObjectURL(new Blob(parts as BlobPart[], { type }));
    };
    const mb = (n: number) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
    let last = 0;
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      get('ffmpeg-core.js', 'text/javascript'),
      get('ffmpeg-core.wasm', 'application/wasm', (n, total) => {
        const now = performance.now();
        if (now - last < 120) return;
        last = now;
        status(total ? `Loading video engine ${mb(n)} / ${mb(total)} MB` : `Loading video engine ${mb(n)} MB`);
      }),
      kind === 'mt' ? get('ffmpeg-core.worker.js', 'text/javascript') : undefined,
    ]);
    return { coreURL, wasmURL, workerURL };
  })();
  core.catch(() => delete cores[kind]);
  return core;
}

class FFmpegService implements Engine {
  private ff: FFmpeg | null = null;
  private loading: Promise<FFmpeg> | null = null;
  private files = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private logListeners = new Set<LogFn>();
  private currentLog: string[] = [];
  ready = false;
  /** this instance runs the multithreaded engine */
  mt = false;
  private execs = 0;
  /** ffmpeg.wasm leaks internal state between runs; start a fresh instance every N jobs. */
  recycleEvery = 6;
  /** abort a job if ffmpeg prints nothing for this long */
  stallMs = 30000;
  onStatus: (s: string) => void = () => {};

  private load(): Promise<FFmpeg> {
    if (this.ff && this.ready) return Promise.resolve(this.ff);
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.onStatus('Loading video engine…');
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => {
        this.currentLog.push(message);
        this.logListeners.forEach((l) => l(message));
      });
      try {
        const mt = useThreads();
        try {
          await ff.load(await coreUrls(mt ? 'mt' : 'st', (s) => this.onStatus(s)));
          this.mt = mt;
        } catch (e) {
          if (!mt) throw e;
          // no threads after all: the single-threaded engine
          console.warn('multithreaded video engine failed to load, using the single-threaded one', e);
          threads.failed = true;
          await ff.load(await coreUrls('st', (s) => this.onStatus(s)));
          this.mt = false;
        }
      } catch (e) {
        this.onStatus('');
        throw new Error('Could not load the video engine (' + ((e as Error)?.message ?? e) + '). Check your connection and reload.');
      }
      this.ff = ff;
      this.ready = true;
      this.files.clear();
      this.onStatus('');
      return ff;
    })();
    const p = this.loading;
    p.then(
      () => (this.loading = null),
      () => (this.loading = null),
    );
    return p;
  }

  warmup() {
    return this.load();
  }

  onLog(fn: LogFn) {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }

  /** Run jobs one at a time. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const p = this.chain.then(job, job);
    this.chain = p.catch(() => {});
    return p;
  }

  private cancelGen = 0;

  /** User cancel: kill the running job without retrying it. */
  cancel() {
    this.cancelGen++;
    this.abort();
  }

  /** Kill the running ffmpeg instance. Files are lost. */
  abort() {
    if (this.ff) {
      try {
        this.ff.terminate();
      } catch {
        /* ignore */
      }
    }
    this.ff = null;
    this.ready = false;
    this.loading = null;
    this.execs = 0;
    this.files.clear();
  }

  has(name: string) {
    return this.files.has(name);
  }

  /**
   * Run an ffmpeg job. `inputs` are written first (when not already present) via their getters.
   * Returns the requested output files.
   */
  run(
    args: string[],
    opts: RunOptions = {},
  ): Promise<{ code: number; log: string; out: Record<string, Uint8Array> }> {
    return this.serial(async () => {
      const gen = this.cancelGen;
      try {
        return await this.runOnce(args, opts);
      } catch (e) {
        if (gen !== this.cancelGen) throw new Cancelled();
        if (!(e instanceof EngineCrash)) throw e;
        // fresh instance, one retry (single-threaded from now on, if the threaded one crashed)
        console.warn('ffmpeg crashed, retrying on a fresh instance:', e.message);
        if (this.mt) threads.failed = true;
        this.abort();
        return await this.runOnce(args, opts);
      }
    });
  }

  private async runOnce(
    args: string[],
    opts: RunOptions,
  ): Promise<{ code: number; log: string; out: Record<string, Uint8Array> }> {
    // a fresh instance every few jobs, or when threads were turned on or off
    if (this.ff && (this.execs >= this.recycleEvery || this.mt !== useThreads())) this.abort();
    const ff = await this.load();
    for (const [name, get] of Object.entries(opts.inputs ?? {})) {
      if (this.files.has(name)) continue;
      await ff.writeFile(name, (await get()).slice());
    }
    const mounted = !!opts.mounts && Object.keys(opts.mounts).length > 0;
    if (mounted) {
      await ff.createDir(MOUNT).catch(() => {});
      await ff.mount(FFFSType.WORKERFS, { blobs: Object.entries(opts.mounts!).map(([name, data]) => ({ name, data })) }, MOUNT);
    }
    this.currentLog = [];
    let lastActivity = performance.now();
    let crashed = false;
    const off = this.onLog((l) => {
      lastActivity = performance.now();
      if (/memory access out of bounds|RuntimeError|unreachable/.test(l)) crashed = true;
      const m = /frame=\s*(\d+)/.exec(l);
      if (m) opts.onFrame?.(+m[1]);
    });
    const errListener = (ev: ErrorEvent) => {
      if (/memory access out of bounds|RuntimeError/.test(String(ev.message))) crashed = true;
    };
    self.addEventListener('error', errListener);
    let code: number;
    let watchdog = 0;
    try {
      this.execs++;
      const stalled = new Promise<never>((_, rej) => {
        watchdog = window.setInterval(() => {
          if (crashed) rej(new EngineCrash('video engine crashed'));
          else if (performance.now() - lastActivity > this.stallMs) rej(new EngineCrash('video engine stalled'));
        }, 500);
      });
      // ffmpeg.wasm keeps global options (like the log level) between runs, so always set them
      const level = args.includes('-loglevel') ? [] : ['-loglevel', 'info'];
      code = await Promise.race([ff.exec(['-hide_banner', '-nostdin', '-y', ...level, ...(this.mt ? withThreads(args) : args)]), stalled]);
    } catch (e) {
      this.abort();
      if (e instanceof EngineCrash) throw e;
      throw new EngineCrash(String((e as Error)?.message ?? e));
    } finally {
      clearInterval(watchdog);
      off();
      self.removeEventListener('error', errListener);
    }
    const log = this.currentLog.join('\n');
    const out: Record<string, Uint8Array> = {};
    try {
      for (const name of opts.outputs ?? []) {
        try {
          out[name] = (await ff.readFile(name)) as Uint8Array;
          await ff.deleteFile(name);
        } catch {
          throw new Error(`ffmpeg produced no ${name} (exit ${code}).\n${log.split('\n').slice(-12).join('\n')}`);
        }
      }
    } finally {
      if (mounted && this.ff === ff) await ff.unmount(MOUNT).catch(() => {});
      for (const name of Object.keys(opts.inputs ?? {})) {
        if (opts.keep?.includes(name)) this.files.add(name);
        else if (!this.files.has(name)) await ff.deleteFile(name).catch(() => {});
      }
    }
    return { code, log, out };
  }

  async remove(name: string) {
    if (!this.files.has(name) || !this.ff) return;
    this.files.delete(name);
    await this.serial(() => this.ff!.deleteFile(name).catch(() => {}));
  }
}

const create = (name: string): Engine => (isDesktop ? new NativeService(name) : new FFmpegService());
export const ffmpeg = create('main');
/** A second engine for background jobs (preview proxies, audio waveforms) so they never block renders. */
export const ffmpegBg = create('bg');
ffmpegBg.stallMs = 60000;
