// ffmpeg.wasm wrapper: one instance, serialised jobs, crash recovery and cancellation.
import { FFmpeg } from '@ffmpeg/ffmpeg';

type LogFn = (line: string) => void;

export class EngineCrash extends Error {}

class FFmpegService {
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
      await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
      this.ff = ff;
      this.ready = true;
      this.files.clear();
      this.onStatus('');
      return ff;
    })();
    this.loading.finally(() => (this.loading = null));
    return this.loading;
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

  /** Kill the running ffmpeg (used to cancel stale renders). Files are lost. */
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
    opts: { inputs?: Record<string, () => Promise<Uint8Array>>; outputs?: string[]; keep?: string[]; onFrame?: (n: number) => void } = {},
  ): Promise<{ code: number; log: string; out: Record<string, Uint8Array> }> {
    return this.serial(async () => {
      try {
        return await this.runOnce(args, opts);
      } catch (e) {
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
    opts: { inputs?: Record<string, () => Promise<Uint8Array>>; outputs?: string[]; keep?: string[]; onFrame?: (n: number) => void },
  ): Promise<{ code: number; log: string; out: Record<string, Uint8Array> }> {
    if (this.ff && this.execs >= this.recycleEvery) this.abort();
    const ff = await this.load();
    for (const [name, get] of Object.entries(opts.inputs ?? {})) {
      if (this.files.has(name)) continue;
      await ff.writeFile(name, (await get()).slice());
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
      code = await Promise.race([ff.exec(['-hide_banner', '-nostdin', '-y', ...args]), stalled]);
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

export const ffmpeg = new FFmpegService();
