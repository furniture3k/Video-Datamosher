// Mosh Maps: grayscale pictures that say where the mosh goes (Subject Guard's map sources).
// Painted on the player, taken from a picture or video in the project, or the depth of the scene
// from a small model that runs on this device. White keeps the clean picture, black moshes.
import { ffmpeg, MOUNT } from './ffmpeg';
import { getFile } from './storage';
import { inputName } from '../engine/args';
import type { MediaItem, Project } from '../engine/types';

// ---------- painted maps ----------

export interface MaskStroke {
  /** [x, y] shares of the frame */
  pts: [number, number][];
  /** brush radius, share of the frame width */
  radius: number;
  /** paints black (moshes again) instead of white */
  erase?: boolean;
}

/** Draw painted strokes as a mask (white where painted) on a w×h canvas. */
export function drawMask(ctx: CanvasRenderingContext2D, strokes: MaskStroke[], w: number, h: number) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = ctx.fillStyle = s.erase ? '#000' : '#fff';
    ctx.lineWidth = Math.max(1, s.radius * 2 * w);
    const pts = s.pts.map(([x, y]) => [x * w, y * h]);
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
}

const painted = new Map<string, { key: string; c: HTMLCanvasElement }>();
/** The painted mask of an effect, redrawn only when its strokes change. */
export function paintedMask(id: string, strokes: MaskStroke[], w: number, h: number): HTMLCanvasElement {
  const key = JSON.stringify([strokes, w, h]);
  const hit = painted.get(id);
  if (hit?.key === key) return hit.c;
  const c = hit?.c ?? document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawMask(c.getContext('2d')!, strokes, w, h);
  painted.set(id, { key, c });
  return c;
}

// ---------- maps from media ----------

/** Width the map videos are decoded at: maps are soft, so small is plenty. */
const MAP_W = 192;

interface VideoMap {
  w: number;
  h: number;
  frames: Uint8Array[];
}
const videoMaps = new Map<string, Promise<VideoMap | null>>();
const imageMaps = new Map<string, Promise<ImageBitmap | null>>();

/** A video's frames as small grayscale pictures at the project's frame rate (decoded once). */
function videoMap(m: MediaItem, fps: number): Promise<VideoMap | null> {
  const key = `${m.id}@${fps}`;
  let p = videoMaps.get(key);
  if (!p) {
    p = (async () => {
      if (m.source.kind !== 'file') return null;
      const blob = await getFile(m.source.fileId);
      if (!blob) return null;
      const w = MAP_W;
      const h = Math.max(2, Math.round((MAP_W * (m.height || 9)) / (m.width || 16) / 2) * 2);
      const name = inputName(m);
      // at most a minute of map: it loops
      const r = await ffmpeg.run(['-i', MOUNT + name, '-t', '60', '-an', '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', 'map.gray'], { mounts: { [name]: blob }, outputs: ['map.gray'] });
      const raw = r.out['map.gray'];
      const n = Math.floor(raw.length / (w * h));
      if (!n) return null;
      return { w, h, frames: Array.from({ length: n }, (_, i) => raw.subarray(i * w * h, (i + 1) * w * h)) };
    })();
    p.catch(() => videoMaps.delete(key));
    videoMaps.set(key, p);
    if (videoMaps.size > 6) videoMaps.delete(videoMaps.keys().next().value!);
  }
  return p;
}

function imageMap(m: MediaItem): Promise<ImageBitmap | null> {
  let p = imageMaps.get(m.id);
  if (!p) {
    p = (async () => {
      if (m.source.kind !== 'file') return null;
      const blob = await getFile(m.source.fileId);
      return blob ? createImageBitmap(blob) : null;
    })();
    p.catch(() => imageMaps.delete(m.id));
    imageMaps.set(m.id, p);
  }
  return p;
}

let grayCanvas: HTMLCanvasElement | null = null;
/** The map from a media item for a frame `k` frames into the effect (videos loop). */
export async function mediaMap(project: Project, mediaId: string | undefined, k: number): Promise<CanvasImageSource | null> {
  const m = project.media.find((x) => x.id === mediaId);
  if (!m) return null;
  if (m.source.kind === 'file' && m.source.isImage) return imageMap(m);
  if (!m.hasVideo) return null;
  const v = await videoMap(m, project.encoder.fps);
  if (!v) return null;
  const g = v.frames[((k % v.frames.length) + v.frames.length) % v.frames.length];
  grayCanvas ??= document.createElement('canvas');
  grayCanvas.width = v.w;
  grayCanvas.height = v.h;
  const ctx = grayCanvas.getContext('2d')!;
  const id = ctx.createImageData(v.w, v.h);
  for (let i = 0; i < g.length; i++) {
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = g[i];
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return grayCanvas;
}

// ---------- depth ----------

// Depth Anything V2 (small) through transformers.js, both downloaded on first use and cached by
// the browser; pictures never leave the device.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const MODEL = 'onnx-community/depth-anything-v2-small';

type DepthFn = (img: ImageBitmap) => Promise<HTMLCanvasElement>;
let model: Promise<(img: HTMLCanvasElement) => Promise<{ depth: { toCanvas(): HTMLCanvasElement } }>> | null = null;
let override: DepthFn | null = null;

/** Swap the depth model (tests use a fake one so they don't download a model). */
export function setDepthModel(fn: DepthFn | null) {
  override = fn;
}

function load() {
  model ??= (async () => {
    const tf = await import(/* @vite-ignore */ LIB);
    const webgpu = 'gpu' in navigator;
    const pipe = await tf.pipeline('depth-estimation', MODEL, { device: webgpu ? 'webgpu' : 'wasm', dtype: webgpu ? 'fp16' : 'q8' }).catch(() => tf.pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8' }));
    return (c: HTMLCanvasElement) => pipe(tf.RawImage.fromCanvas(c));
  })();
  model.catch(() => (model = null));
  return model;
}

/** How near each pixel is, as a grayscale canvas (white = near), any size; same way up as the picture. */
export async function depthMap(img: ImageBitmap): Promise<HTMLCanvasElement> {
  if (override) return override(img);
  const run = await load();
  // the model works at about 518 px; smaller pictures are quicker and the map is soft anyway
  const c = document.createElement('canvas');
  const k = Math.min(1, 384 / Math.max(img.width, img.height));
  c.width = Math.max(8, Math.round(img.width * k));
  c.height = Math.max(8, Math.round(img.height * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const out = await run(c);
  return out.depth.toCanvas();
}
