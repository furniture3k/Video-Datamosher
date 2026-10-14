// ffmpeg.wasm wrapper: one instance, serialised jobs, crash recovery and cancellation.
// In the desktop app the same interface is backed by a native FFmpeg (see ffmpeg-native.ts).
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { isDesktop } from './platform';
import { NativeService } from './ffmpeg-native';

type LogFn = (line: string) => void;

/** Directory where `mounts` appear inside the ffmpeg file system. */
export const MOUNT = '/m/';

export interface RunOptions {
  inputs?: Record<string, () => Promise<Uint8Array>>;
  /** read straight from Blobs/Files without copying them into memory (WORKERFS); paths are MOUNT + name */
  mounts?: Record<string, Blob>;
  outputs?: string[];
  keep?: string[];
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
}

export class EngineCrash extends Error {}
/** Thrown when a job is killed on purpose (user cancel). */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

class FFmpegService implements Engine {
  private ff: FFmpeg | null = null;
  private loading: Promise<FFmpeg> | null = null;
  private files = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private logListeners = new Set<LogFn>();
  private currentLog: string[] = [];
  ready = false;
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
      const base = new URL('ffmpeg/', document.baseURI).href;
      try {
        await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
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
        // fresh instance, one retry
        console.warn('ffmpeg crashed, retrying on a fresh instance:', e.message);
        this.abort();
        return await this.runOnce(args, opts);
      }
    });
  }

  private async runOnce(
    args: string[],
    opts: RunOptions,
  ): Promise<{ code: number; log: string; out: Record<string, Uint8Array> }> {
    if (this.ff && this.execs >= this.recycleEvery) this.abort();
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
      code = await Promise.race([ff.exec(['-hide_banner', '-nostdin', '-y', ...level, ...args]), stalled]);
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
