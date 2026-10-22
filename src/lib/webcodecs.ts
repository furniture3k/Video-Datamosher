// Hardware video encoding with the browser's own encoders (WebCodecs), through mediabunny for the
// file format. Much faster than encoding in ffmpeg.wasm, which has no access to the GPU and (in
// most browsers) runs on one thread. Used for MP4 / WebM exports and for preview copies; anything
// it can't do falls back to ffmpeg.
import type { Output, BufferTarget, VideoSampleSource, VideoCodec } from 'mediabunny';
import { isDesktop } from './platform';
import { even } from '../engine/args';
import { centreAt, type ReframePath } from '../engine/reframe';

/**
 * mediabunny, loaded the first time it's needed: it's a big library that only hardware exports and
 * preview copies use, so the editor starts without it.
 */
let lib: Promise<typeof import('mediabunny')> | null = null;
function mediabunny() {
  lib ??= import('mediabunny');
  lib.catch(() => (lib = null));
  return lib;
}

/** The browser has WebCodecs (the desktop app has a native FFmpeg instead, which is faster still). */
export const hasWebCodecs = () => !isDesktop && typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

/** The codecs tried for each format, best first. MP4 needs H.264 to play everywhere. */
const CODECS: Record<'mp4' | 'webm', VideoCodec[]> = { mp4: ['avc'], webm: ['vp9', 'vp8'] };

/** A codec the browser can encode this size with, or null (then ffmpeg does it). */
export async function hardwareCodec(format: string, w: number, h: number): Promise<VideoCodec | null> {
  if (!hasWebCodecs() || (format !== 'mp4' && format !== 'webm')) return null;
  let canEncodeVideo: typeof import('mediabunny').canEncodeVideo;
  try {
    ({ canEncodeVideo } = await mediabunny());
  } catch {
    // (offline, and it was never downloaded): ffmpeg encodes
    return null;
  }
  for (const c of CODECS[format]) {
    try {
      if (await canEncodeVideo(c, { width: w, height: h, bitrate: 4e6 })) return c;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * A bitrate (bit/s) for ffmpeg's CRF (lower is better): a mosh is full of sharp blocks and noise,
 * which the encoders' own "high quality" levels smear. 0.25 bits per pixel at CRF 18, halving every
 * 6 steps, like CRF itself. VP9 / AV1 need about a third less for the same picture.
 */
export function bitrateForCrf(crf: number, w: number, h: number, fps: number, codec: VideoCodec): number {
  const bpp = Math.min(0.6, 0.25 * 2 ** ((18 - crf) / 6)) * (codec === 'avc' || codec === 'vp8' ? 1 : 0.7);
  return Math.round(Math.max(300e3, w * h * fps * bpp));
}

export interface EncodeOptions {
  format: 'mp4' | 'webm';
  codec: VideoCodec;
  fps: number;
  /** size of the frames that come in */
  srcW: number;
  srcH: number;
  /** output width (0 = as they come); the height follows */
  width: number;
  scaler: 'bicubic' | 'neighbor' | 'lanczos';
  crf: number;
  /** a set bitrate (kbit/s), for exports that must stay under a size */
  kbps?: number;
  /** a crop that follows the action (auto reframe) */
  reframe?: ReframePath;
}

/** The output size after the reframe crop and the scale, both even. */
export function encodedSize(o: Pick<EncodeOptions, 'srcW' | 'srcH' | 'width' | 'reframe'>): { cw: number; ch: number; w: number; h: number } {
  let cw = o.srcW;
  let ch = o.srcH;
  if (o.reframe) {
    if (o.reframe.axis === 'x') cw = Math.max(2, Math.trunc((o.srcW * o.reframe.size) / 2) * 2);
    else ch = Math.max(2, Math.trunc((o.srcH * o.reframe.size) / 2) * 2);
  }
  const w = o.width > 0 ? even(o.width) : even(cw);
  const h = o.width > 0 ? even((w * ch) / cw) : even(ch);
  return { cw, ch, w, h };
}

/**
 * Encodes JPEG frames (as the renderer makes them) into a video-only MP4 / WebM. Add frames in
 * order with `add`, then `finish`. The sound and the recipe are added afterwards by ffmpeg
 * without re-encoding the picture. Made with `FrameEncoder.create`.
 */
export class FrameEncoder {
  private output: Output;
  private source: VideoSampleSource;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private size: ReturnType<typeof encodedSize>;
  private n = 0;
  private started: Promise<void>;

  static async create(o: EncodeOptions): Promise<FrameEncoder> {
    return new FrameEncoder(o, await mediabunny());
  }

  private constructor(
    private o: EncodeOptions,
    private mb: typeof import('mediabunny'),
  ) {
    const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, VideoSampleSource } = mb;
    this.size = encodedSize(o);
    this.output = new Output({ format: o.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
    this.source = new VideoSampleSource({
      codec: o.codec,
      bitrate: o.kbps ? o.kbps * 1000 : bitrateForCrf(o.crf, this.size.w, this.size.h, o.fps, o.codec),
      keyFrameInterval: 2,
      // VBR keeps the quality steady through the noisy parts of a mosh
      bitrateMode: o.kbps ? 'constant' : 'variable',
      latencyMode: 'quality',
    });
    this.output.addVideoTrack(this.source, { frameRate: o.fps });
    this.canvas = new OffscreenCanvas(this.size.w, this.size.h);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = o.scaler !== 'neighbor';
    this.ctx.imageSmoothingQuality = o.scaler === 'bicubic' ? 'medium' : 'high';
    this.started = this.output.start();
  }

  get frames() {
    return this.n;
  }

  /** Add the next frame (a JPEG). Waits when the encoder is busy, so memory stays flat. */
  async add(jpeg: Uint8Array) {
    await this.started;
    const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    try {
      const { cw, ch, w, h } = this.size;
      let sx = 0;
      let sy = 0;
      if (this.o.reframe) {
        const c = centreAt(this.o.reframe, this.n / this.o.fps);
        if (this.o.reframe.axis === 'x') sx = Math.max(0, Math.min(bmp.width - cw, c * bmp.width - cw / 2));
        else sy = Math.max(0, Math.min(bmp.height - ch, c * bmp.height - ch / 2));
      }
      // frames from the renderer are the mosh's size; scale in case one isn't
      const kx = bmp.width / this.o.srcW;
      const ky = bmp.height / this.o.srcH;
      this.ctx.drawImage(bmp, sx, sy, cw * kx, ch * ky, 0, 0, w, h);
    } finally {
      bmp.close();
    }
    const sample = new this.mb.VideoSample(this.canvas, { timestamp: this.n / this.o.fps, duration: 1 / this.o.fps });
    try {
      await this.source.add(sample);
    } finally {
      sample.close();
    }
    this.n++;
  }

  /** The finished file. */
  async finish(): Promise<Uint8Array> {
    await this.started;
    this.source.close();
    await this.output.finalize();
    const buf = (this.output.target as BufferTarget).buffer;
    if (!buf || !this.n) throw new Error('the hardware encoder produced nothing');
    return new Uint8Array(buf);
  }

  async cancel() {
    try {
      await this.output.cancel();
    } catch {
      /* already done */
    }
  }
}

/**
 * A preview copy made with the browser's decoders and encoders: no more than 960 px wide, at most
 * 30 fps, a keyframe every half second so it seeks fast. Returns null when the browser can't read
 * the file or encode it (ffmpeg makes the copy then).
 */
export async function hardwareProxy(blob: Blob, width: number, fps: number, onProgress?: (p: number) => void, signal?: { cancelled: boolean }): Promise<Blob | null> {
  if (!hasWebCodecs()) return null;
  const w = Math.min(960, even(width || 960));
  const codec: VideoCodec | null = (await hardwareCodec('mp4', w, w)) ? 'avc' : (await hardwareCodec('webm', w, w));
  if (!codec) return null;
  // (hardwareCodec found one, so the library is loaded)
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, QUALITY_MEDIUM, Input, BlobSource, ALL_FORMATS, Conversion } = await mediabunny();
  const mp4 = codec === 'avc';
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: { width: w, codec, bitrate: QUALITY_MEDIUM, keyFrameInterval: 0.5, frameRate: fps > 30 ? 30 : undefined, forceTranscode: true },
      // whichever sound codec the browser can encode for this format
      audio: { numberOfChannels: 2 },
      showWarnings: false,
    });
    // a file the browser can only half read (no video decoder, say) is left to ffmpeg
    if (!conversion.isValid || conversion.discardedTracks.some((t) => t.track.type === 'video')) return null;
    conversion.onProgress = (p) => {
      onProgress?.(p);
      if (signal?.cancelled) void conversion.cancel();
    };
    await conversion.execute();
    const buf = (output.target as BufferTarget).buffer;
    if (!buf) return null;
    return new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' });
  } catch (e) {
    console.warn('hardware preview copy failed, using ffmpeg', e);
    return null;
  } finally {
    input.dispose();
  }
}
