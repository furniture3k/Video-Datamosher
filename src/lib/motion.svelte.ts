// Tracking and stabilization on the timeline: analyse a clip, then store or use the result.
import { store } from './store.svelte';
import { clipFrames } from './analysis';
import { trackBox, stabilize, simplify, type Gray, type Stabilized, type TrackPoint } from '../engine/track';
import { trackPlane, simplifyKeys, quadAt, type PlaneFrame } from '../engine/planar';
import { screenFromPlane } from '../engine/screen';
import { clipLen, layers, layoutVideo, localTime, sourceTime, mediaOf } from '../engine/timeline';
import { apply, fitRect, invert, pictureMatrix } from '../engine/placement';
import { outputSize } from '../engine/args';
import { uid } from '../engine/presets';
import { VIDEO_TRACK, type Clip, type Project } from '../engine/types';
import { FIRST_ROW, freeRow, type TextLayer } from '../engine/layers';
import type { TrackJob } from './track.worker';
import { markLayers } from '../engine/annotate';
import { linkFaces } from '../engine/faces';
import { detectFaces } from './faces';
import { cardScale, offCard, onCard } from '../engine/canvas';
import { addText, shapeLook } from './edit';

export const motionJob = $state({ running: false, stage: '' });

const ANALYSIS_W = 256;

/** Where a clip's source picture sits in the output frame (pixels), for its fit mode (no transform). */
export function pictureRect(c: Clip, p: Project): { x: number; y: number; w: number; h: number; W: number; H: number } {
  const { w: W, h: H } = outputSize(p, p.encoder.previewWidth);
  const m = mediaOf(p, c.mediaId);
  const [x, y, w, h] = fitRect(c.fit, m?.width || W, m?.height || H, W, H);
  return { x, y, w, h, W, H };
}

const frameSize = (p: Project): [number, number] => {
  const { w, h } = outputSize(p, p.encoder.previewWidth);
  return [w, h];
};
/** A point of the picture to where it shows in the frame (on the card, with a canvas). */
const framed = (p: Project, u: number, v: number) => onCard(p.canvas, ...frameSize(p), u, v);

/** Map from a clip's source picture (0..1) to the output frame (0..1) at `local` seconds into it. */
function placement(p: Project, c: Clip, local: number) {
  const { w: W, h: H } = outputSize(p, p.encoder.previewWidth);
  const m = mediaOf(p, c.mediaId);
  return pictureMatrix(c, local, m?.width || W, m?.height || H, W, H);
}

export const clipStart = (p: Project, c: Clip) => (c.track === VIDEO_TRACK ? (layoutVideo(p).find((pl) => pl.clip.id === c.id)?.start ?? 0) : c.start);

export async function busy<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  motionJob.running = true;
  motionJob.stage = stage;
  store.status.engine = stage + '…';
  try {
    return await fn();
  } finally {
    motionJob.running = false;
    store.status.engine = '';
  }
}

/** Frames `from`..`to` (exclusive) copied into one buffer, to hand to a worker. */
export function framesBuffer(g: Gray, from: number, to: number): ArrayBuffer {
  const n = g.w * g.h;
  const out = new Uint8Array(n * (to - from));
  for (let k = from; k < to; k++) out.set(g.frames[k], (k - from) * n);
  return out.buffer;
}

/** Run an analysis in its own worker (so two can run side by side); on the page if workers fail. */
export function inWorker<T>(job: TrackJob, inline: () => T): Promise<T> {
  let w: Worker;
  try {
    w = new Worker(new URL('./track.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve().then(inline);
  }
  return new Promise<T>((resolve, reject) => {
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.ok as T);
    };
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      // a worker that can't start (blocked script, old browser): do it here instead
      try {
        resolve(inline());
      } catch (err) {
        reject(err);
      }
    };
    w.postMessage(job, [job.buf]);
  });
}

/** Analyse a clip's camera shake and store a smoothed correction. `strength`: smoothing in frames. */
export async function stabilizeClip(id: string, strength = 20) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  const fps = p.encoder.fps;
  const result = await busy('Measuring the shake', async () => {
    const g = await clipFrames(c, m, fps, ANALYSIS_W);
    const s = await inWorker<Stabilized>({ kind: 'stabilize', w: g.w, h: g.h, buf: framesBuffer(g, 0, g.frames.length), radius: strength }, () => stabilize(g, strength));
    return { s, g };
  });
  const { s, g } = result;
  const t = (k: number) => c.in + k / fps;
  const stab = {
    x: simplify(s.corr.map((v, k) => [t(k), v.x / g.w] as [number, number]), 0.0015),
    y: simplify(s.corr.map((v, k) => [t(k), v.y / g.h] as [number, number]), 0.0015),
    r: simplify(s.corr.map((v, k) => [t(k), (v.a * 180) / Math.PI] as [number, number]), 0.05),
    zoom: Math.round(s.zoom * 1000) / 1000,
  };
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === id);
    if (x) x.stab = stab;
  });
  store.toast(`Stabilized (zoomed in ${Math.round((stab.zoom - 1) * 100)}% to hide the edges).`, 'ok');
}

/**
 * Start (or stop) drawing a box to track on the player, with the playhead on the clip. `then`:
 * 'mark' adds a box, an arrow and a label that follow it once it's tracked.
 */
export function toggleTrackPick(id: string, then: 'mark' | null = null) {
  store.ui.trackThen = then;
  if (store.ui.trackPick === id) return void ((store.ui.trackPick = null), (store.ui.trackThen = null));
  const c = store.project.clips.find((x) => x.id === id);
  if (!c) return;
  store.ui.playing = false;
  const start = clipStart(store.project, c);
  const len = clipLen(c);
  // the box is drawn on the picture under the playhead: it has to be this clip's
  if (store.ui.time < start || store.ui.time >= start + len - 1e-3) store.seek(start + Math.min(len / 2, 0.5));
  store.ui.trackPick = id;
}

/**
 * Track the box drawn on the player (u0,v0 → u1,v1 as shares of the output frame) through the
 * selected clip, from the playhead forwards and backwards. The path is stored on the clip.
 */
export async function trackClip(id: string, box: [number, number, number, number], then: 'mark' | null = null): Promise<string | void> {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  const fps = p.encoder.fps;
  const local = Math.max(0, Math.min(clipLen(c) - 1e-3, store.ui.time - clipStart(p, c)));
  const srcT = sourceTime(c, local);
  // the box from the output frame into the clip's own picture (undoing the canvas, and its zoom, move, turn and stabilization)
  const inv = invert(placement(p, c, local));
  const [W, H] = frameSize(p);
  const pic = (x: number, y: number) => apply(inv, ...offCard(p.canvas, W, H, x, y));
  const corners = [pic(box[0], box[1]), pic(box[2], box[1]), pic(box[0], box[3]), pic(box[2], box[3])];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const u0 = clamp(Math.min(...corners.map((q) => q[0])));
  const u1 = clamp(Math.max(...corners.map((q) => q[0])));
  const v0 = clamp(Math.min(...corners.map((q) => q[1])));
  const v1 = clamp(Math.max(...corners.map((q) => q[1])));
  if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return store.toast('That box is outside the clip: draw it over the clip’s picture.', 'error');
  store.ui.playing = false;
  const res = await busy('Tracking', async () => {
    const g = await clipFrames(c, m, fps, ANALYSIS_W);
    const n = g.frames.length;
    const k = Math.max(0, Math.min(n - 1, Math.round((srcT - c.in) * fps)));
    const [cx, cy, bw, bh] = [((u0 + u1) / 2) * g.w, ((v0 + v1) / 2) * g.h, (u1 - u0) * g.w, (v1 - v0) * g.h];
    // forwards and backwards at the same time, each on its own share of the frames
    const [fwd, back] = await Promise.all([
      inWorker<TrackPoint[]>({ kind: 'track', w: g.w, h: g.h, buf: framesBuffer(g, k, n), start: 0, cx, cy, bw, bh, dir: 1 }, () => trackBox({ ...g, frames: g.frames.slice(k) }, 0, cx, cy, bw, bh, 1)).then((t) => t.map(([f, x, y, q]) => [f + k, x, y, q] as TrackPoint)),
      inWorker<TrackPoint[]>({ kind: 'track', w: g.w, h: g.h, buf: framesBuffer(g, 0, k + 1), start: k, cx, cy, bw, bh, dir: -1 }, () => trackBox({ ...g, frames: g.frames.slice(0, k + 1) }, k, cx, cy, bw, bh, -1)),
    ]);
    const all = [...back.slice(0, -1), ...fwd];
    // rounded: well under a pixel, and the project (and every undo step) stays small
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    return { pts: all.map(([f, x, y]) => [r4(c.in + f / fps), r4(x / g.w), r4(y / g.h)] as [number, number, number]), whole: all[0][0] === 0 && all[all.length - 1][0] === n - 1, len: n / fps };
  });
  const { pts } = res;
  if (pts.length < 2) return store.toast('Could not follow that: draw the box snugly around something with detail (an edge, a pattern, a face).', 'error');
  const name = `Track ${(c.paths?.length ?? 0) + 1}`;
  const pathId = uid();
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === id);
    if (x) x.paths = [...(x.paths ?? []), { id: pathId, name, pts, size: [Math.round((u1 - u0) * 1e4) / 1e4, Math.round((v1 - v0) * 1e4) / 1e4] }];
  });
  if (then === 'mark') {
    markTracked(id, pathId, box[2] - box[0], box[3] - box[1]);
    return pathId;
  }
  const got = pts[pts.length - 1][0] - pts[0][0];
  if (res.whole) store.toast(`${name}: followed it through the whole clip.`, 'ok');
  else store.toast(`${name}: followed it for ${got.toFixed(1)} s of ${res.len.toFixed(1)} s, then lost it (hidden, blurred or out of frame).`, 'info', 5000);
}

/**
 * Where a clip's own picture is in the output frame at timeline time `t`: points of the picture
 * (0..1) to points of the frame (0..1, on the card when there is a canvas) and back.
 */
export function pictureMap(clipId: string, t = store.ui.time) {
  const p = store.project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return null;
  const local = Math.max(0, Math.min(clipLen(c), t - clipStart(p, c)));
  const m = placement(p, c, local);
  const inv = invert(m);
  const [W, H] = frameSize(p);
  return {
    toFrame: (u: number, v: number): [number, number] => framed(p, ...apply(m, u, v)),
    toPicture: (x: number, y: number): [number, number] => apply(inv, ...offCard(p.canvas, W, H, x, y)),
  };
}

/** The corners picked for a surface start as a rectangle in the middle of the picture. */
const DEFAULT_SURFACE: [number, number][] = [[0.3, 0.28], [0.7, 0.28], [0.7, 0.72], [0.3, 0.72]];

/** Start (or stop) picking a surface to track: four corners to drag onto it on the player, with the playhead on the clip. */
export function toggleSurfacePick(id: string, then: null | 'title' = null) {
  if (store.ui.surfacePick === id) return void ((store.ui.surfacePick = null), (store.ui.surfaceThen = null));
  const c = store.project.clips.find((x) => x.id === id);
  if (!c) return;
  store.ui.playing = false;
  store.ui.trackPick = null;
  store.ui.trackThen = null;
  const start = clipStart(store.project, c);
  const len = clipLen(c);
  if (store.ui.time < start || store.ui.time >= start + len - 1e-3) store.seek(start + Math.min(len / 2, 0.5));
  store.ui.surfaceQuad = DEFAULT_SURFACE.map(([x, y]) => [x, y]);
  store.ui.surfaceThen = then;
  store.ui.surfacePick = id;
}

/** Track the surface whose corners were dragged onto the player. */
export async function confirmSurface() {
  const id = store.ui.surfacePick;
  if (!id) return;
  const corners = store.ui.surfaceQuad.map(([x, y]) => [x, y] as [number, number]);
  const then = store.ui.surfaceThen;
  store.ui.surfacePick = null;
  store.ui.surfaceThen = null;
  try {
    const planeId = await trackSurface(id, corners);
    if (planeId && then === 'title') titleOnSurface(id, planeId);
    return planeId;
  } catch (err) {
    store.toast('Tracking failed: ' + (err as Error).message, 'error');
  }
}

/**
 * Pin a new title where the picture was pointed at: on a tracked surface that is there at the
 * playhead, or, when none is, by picking one (four corners round the point) and tracking it first.
 */
export function pinHere(u: number, v: number) {
  const p = $state.snapshot(store.project) as Project;
  const t = store.ui.time;
  const inside = (q: number[]) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const cr = (q[j * 2] - q[i * 2]) * (v - q[i * 2 + 1]) - (q[j * 2 + 1] - q[i * 2 + 1]) * (u - q[i * 2]);
      if (Math.abs(cr) < 1e-12) continue;
      if (sign && Math.sign(cr) !== sign) return false;
      sign = Math.sign(cr);
    }
    return true;
  };
  for (const c of p.clips)
    for (const pl of c.planes ?? []) {
      const keys = planeOnTimeline(p, c, pl.id);
      if (keys.length < 2 || t < keys[0][0] - 1e-6 || t > keys[keys.length - 1][0] + 1e-6) continue;
      const q = quadAt(keys, t);
      if (!q || !inside(q)) continue;
      addText();
      // (the new title is the selection)
      const id = store.ui.selectedClips[0];
      store.edit((x) => {
        const l = x.layers.find((y) => y.id === id);
        if (l) Object.assign(l, { x: Math.round(u * 1e4) / 1e4, y: Math.round(v * 1e4) / 1e4 });
      });
      return pinToSurface([id], c.id, pl.id);
    }
  const c = trackableAt(t);
  if (!c) return store.toast('Put the playhead on a video clip first: the surface is followed in it.', 'error');
  toggleSurfacePick(c.id, 'title');
  // the corners start as a rectangle round the point
  const rx = 0.16;
  const ry = 0.14;
  const cl = (n: number) => Math.max(0, Math.min(1, n));
  store.ui.surfaceQuad = [[cl(u - rx), cl(v - ry)], [cl(u + rx), cl(v - ry)], [cl(u + rx), cl(v + ry)], [cl(u - rx), cl(v + ry)]];
  store.toast('Drag the corners onto the surface and press Track it: a title is pinned to it.', 'info', 5000);
}

/** Pick a surface to track in the video clip under the playhead (for the palette and menus). */
export function startSurface() {
  if (store.ui.surfacePick) return void (store.ui.surfacePick = null);
  const c = trackableAt(store.ui.time);
  if (!c) return store.toast('Put the playhead on a video clip first: the surface is followed in it.', 'error');
  toggleSurfacePick(c.id);
}

/**
 * Track a surface (a screen, a wall, a sign) through the selected clip, from the playhead forwards
 * and backwards. `corners` are its four corners on the player, clockwise from the top left, as
 * shares of the output frame. The result is kept on the clip as a plane.
 */
export async function trackSurface(id: string, corners: [number, number][]): Promise<string | void> {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m || corners.length !== 4) return;
  const fps = p.encoder.fps;
  const local = Math.max(0, Math.min(clipLen(c) - 1e-3, store.ui.time - clipStart(p, c)));
  const srcT = sourceTime(c, local);
  // the corners from the output frame into the clip's own picture (undoing the canvas, and its zoom, move, turn and stabilization)
  const inv = invert(placement(p, c, local));
  const [W, H] = frameSize(p);
  const pic = corners.map(([x, y]) => apply(inv, ...offCard(p.canvas, W, H, x, y)));
  if (pic.some(([u, v]) => u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02)) return store.toast('Put all four corners on the clip’s picture.', 'error');
  store.ui.playing = false;
  const res = await busy('Tracking the surface', async () => {
    const g = await clipFrames(c, m, fps, ANALYSIS_W);
    const n = g.frames.length;
    const k = Math.max(0, Math.min(n - 1, Math.round((srcT - c.in) * fps)));
    const quad = pic.flatMap(([u, v]) => [Math.max(0, Math.min(1, u)) * g.w, Math.max(0, Math.min(1, v)) * g.h]);
    // forwards and backwards at the same time, each on its own share of the frames
    const [fwd, back] = await Promise.all([
      inWorker<PlaneFrame[]>({ kind: 'plane', w: g.w, h: g.h, buf: framesBuffer(g, k, n), start: 0, quad, dir: 1 }, () => trackPlane({ ...g, frames: g.frames.slice(k) }, 0, quad, 1)).then((t) => t.map((x) => ({ ...x, f: x.f + k }))),
      inWorker<PlaneFrame[]>({ kind: 'plane', w: g.w, h: g.h, buf: framesBuffer(g, 0, k + 1), start: k, quad, dir: -1 }, () => trackPlane({ ...g, frames: g.frames.slice(0, k + 1) }, k, quad, -1)),
    ]);
    const all = [...back.slice(1).reverse(), ...fwd];
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    const keys = all.map((x) => [r4(c.in + x.f / fps), ...x.q.map((v, i) => r4(v / (i % 2 ? g.h : g.w)))]);
    return { keys: simplifyKeys(keys, 0.0004), whole: all.length > 0 && all[0].f === 0 && all[all.length - 1].f === n - 1, len: n / fps, got: all.length / fps };
  });
  if (res.keys.length < 2) return store.toast('Could not follow that surface: put the corners on something flat with detail (a screen with content, a poster, a wall with marks).', 'error');
  const name = `Surface ${(c.planes?.length ?? 0) + 1}`;
  const planeId = uid();
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === id);
    if (x) x.planes = [...(x.planes ?? []), { id: planeId, name, quads: res.keys }];
  });
  if (res.whole) store.toast(`${name}: followed it through the whole clip.`, 'ok');
  else store.toast(`${name}: followed it for ${res.got.toFixed(1)} s of ${res.len.toFixed(1)} s, then lost it (hidden, blurred or out of frame).`, 'info', 5000);
  return planeId;
}

/** A tracked surface as timeline positions [timeline seconds, the four corners as shares of the output frame]. */
export function planeOnTimeline(p: Project, c: Clip, planeId: string): number[][] {
  const plane = c.planes?.find((x) => x.id === planeId);
  if (!plane) return [];
  const start = clipStart(p, c);
  const len = clipLen(c);
  const out: number[][] = [];
  for (const [s, ...q] of plane.quads) {
    const local = localTime(c, s);
    // parts trimmed off the clip aren't on the timeline
    if (local < -1e-6 || local > len + 1e-6) continue;
    const m = placement(p, c, local);
    const key: number[] = [start + local];
    for (let i = 0; i < 4; i++) key.push(...framed(p, ...apply(m, q[i * 2], q[i * 2 + 1])));
    out.push(key);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Pin layers to a tracked surface: each stays as it is now (at the playhead) and from then on
 * moves, turns and leans with the surface. Several layers can share one surface.
 */
export function pinToSurface(layerIds: string[], clipId: string, planeId: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  const quads = planeOnTimeline(p, c, planeId);
  if (quads.length < 2) return store.toast('That surface is in a part of the clip that has been trimmed off.', 'error');
  const refT = store.ui.time;
  store.edit((q) => {
    for (const l of q.layers) {
      if (!layerIds.includes(l.id)) continue;
      l.surface = { quads, refT };
      // a layer is carried by a path or by a surface, not both
      delete l.follow;
    }
  });
  store.toast(layerIds.length > 1 ? `Pinned ${layerIds.length} layers to the surface.` : 'Pinned to the surface: it moves, turns and leans with it.', 'ok');
}

/**
 * Put a clip on an upper track onto a tracked surface: its whole picture is carried to the
 * surface's corners (cropped, not squashed, to the surface's shape at the playhead), frame by frame.
 */
export function putClipOnSurface(clipId: string, planeClipId: string, planeId: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  const pc = p.clips.find((x) => x.id === planeClipId);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !pc || !m) return;
  if (c.track === VIDEO_TRACK) return store.toast('Put the clip on a track above the main one first: it is laid over the surface.', 'error');
  const quads = planeOnTimeline(p, pc, planeId);
  const { w, h } = outputSize(p, p.encoder.previewWidth);
  const refT = Math.max(c.start, Math.min(c.start + clipLen(c), store.ui.time));
  const screen = screenFromPlane(quads, c.start, w, h, (m.width || 16) / (m.height || 9), refT);
  if (!screen) return store.toast('That surface is in a part of the clip that has been trimmed off.', 'error');
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === clipId);
    if (x) x.screen = screen;
  });
  store.toast('The clip now plays on the surface and follows it.', 'ok');
}

/** Take a clip off its surface (it goes back to being placed by its own position, zoom and turn). */
export function takeClipOffSurface(clipId: string) {
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === clipId);
    if (x) delete x.screen;
  });
}

/** A title on a tracked surface: laid across the surface as it is at the playhead, and pinned to it. */
export function titleOnSurface(clipId: string, planeId: string, text = 'Your words') {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  const quads = planeOnTimeline(p, c, planeId);
  const q = quadAt(quads, store.ui.time);
  if (!q) return store.toast('That surface is in a part of the clip that has been trimmed off.', 'error');
  const { w, h } = outputSize(p, p.encoder.previewWidth);
  const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
  const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
  // how tall the surface is on screen, in pixels
  const tall = (Math.hypot((q[6] - q[0]) * w, (q[7] - q[1]) * h) + Math.hypot((q[4] - q[2]) * w, (q[5] - q[3]) * h)) / 2;
  const t0 = quads[0][0];
  const t1 = quads[quads.length - 1][0];
  const tx: TextLayer = { id: uid(), kind: 'text', row: freeRow(p.layers, t0, t1), text, start: t0, duration: Math.max(0.5, t1 - t0), size: Math.max(0.03, Math.min(0.5, (tall / h) * 0.3)), color: '#ffffff', font: 'sans', bold: true, x: cx, y: cy, align: 'center', shadow: true, box: false, fade: 0, moshed: false, surface: { quads, refT: store.ui.time } };
  store.edit((x) => x.layers.push(tx));
  store.ui.selectedClips = [tx.id];
  store.toast('Added a title on the surface: change its words in the inspector.', 'ok');
}

/** Let layers go from their surface (they go back to where they were when pinned). */
export function unpinSurface(layerIds: string[]) {
  store.edit((q) => {
    for (const l of q.layers) if (layerIds.includes(l.id)) delete l.surface;
  });
}

/**
 * A path as timeline positions [timeline seconds, x, y in the output frame 0..1], simplified.
 * 'picture': where it is in the picture before a canvas sets it in (for moving clips with it).
 */
export function pathOnTimeline(p: Project, c: Clip, pathId: string, space: 'frame' | 'picture' = 'frame'): [number, number, number][] {
  const path = c.paths?.find((x) => x.id === pathId);
  if (!path) return [];
  const start = clipStart(p, c);
  const len = clipLen(c);
  const pts: [number, number, number][] = [];
  for (const [s, x, y] of path.pts) {
    const local = localTime(c, s);
    // parts trimmed off the clip aren't on the timeline
    if (local < -1e-6 || local > len + 1e-6) continue;
    const [u, v] = apply(placement(p, c, local), x, y);
    pts.push([start + local, ...(space === 'frame' ? framed(p, u, v) : [u, v])] as [number, number, number]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (!pts.length) return [];
  const xs = simplify(pts.map(([t, x]) => [t, x] as [number, number]), 0.0015);
  const ys = simplify(pts.map(([t, , y]) => [t, y] as [number, number]), 0.0015);
  const times = [...new Set([...xs, ...ys].map(([t]) => t))].sort((a, b) => a - b);
  const at = (q: [number, number][], t: number) => {
    for (let i = 0; i < q.length - 1; i++) if (t <= q[i + 1][0]) return q[i][1] + ((q[i + 1][1] - q[i][1]) * (t - q[i][0])) / Math.max(1e-9, q[i + 1][0] - q[i][0]);
    return q[q.length - 1][1];
  };
  return times.map((t) => [t, at(xs, t), at(ys, t)]);
}

/** Size of a tracked box in the output frame [w, h] (shares of it), or null for old tracks without one. */
export function pathSize(p: Project, c: Clip, pathId: string): [number, number] | null {
  const path = c.paths?.find((x) => x.id === pathId);
  if (!path?.size) return null;
  const m = placement(p, c, 0);
  const [kx, ky] = cardScale(p.canvas, ...frameSize(p));
  return [path.size[0] * Math.hypot(m[0], m[1]) * kx, path.size[1] * Math.hypot(m[2], m[3]) * ky];
}

/** Value of [t, x, y] points at t (binary search; held at the ends). */
export function pathAt(pts: [number, number, number][], t: number): [number, number] {
  if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return [last[1], last[2]];
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const k = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * The tracked object a Subject Guard follows: the one picked for it, or, while none is picked,
 * the newest track in the project (so a guard added before or after tracking just works).
 */
export function guardPath(p: Pick<Project, 'clips'>, data: Record<string, unknown> | undefined): { clipId: string; pathId: string } | null {
  const all = p.clips.flatMap((c) => (c.paths ?? []).map((x) => ({ clipId: c.id, pathId: x.id })));
  if (data?.pathId) return all.find((x) => x.pathId === data.pathId) ?? null;
  return all.at(-1) ?? null;
}

/** Add a title that follows a tracked path. */
export function titleFollows(clipId: string, pathId: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  const follow = pathOnTimeline(p, c, pathId);
  if (!follow.length) return store.toast('That track is in a part of the clip that has been trimmed off.', 'error');
  const tx: TextLayer = { id: uid(), kind: 'text', row: FIRST_ROW, text: 'Label', start: follow[0][0], duration: Math.max(0.5, follow.at(-1)![0] - follow[0][0]), size: 0.06, color: '#ffffff', font: 'sans', bold: true, x: follow[0][1], y: follow[0][2], align: 'center', shadow: true, box: true, fade: 0.1, moshed: false, follow };
  store.edit((q) => q.layers.push(tx));
  store.ui.selectedClips = [tx.id];
  store.toast('Added a title that follows it: change its words in the inspector.', 'ok');
}

/** The video clip on top at the playhead that can be tracked (stills and freeze frames can't). */
export function trackableAt(t: number): Clip | undefined {
  const p = store.project;
  const ok = (c: Clip) => {
    const m = mediaOf(p, c.mediaId);
    return !!m && m.source.kind === 'file' && !m.source.isImage && !!m.hasVideo && !c.freeze;
  };
  const upper = layers(p).filter((l) => t >= l.start && t < l.end && ok(l.clip));
  if (upper.length) return upper[upper.length - 1].clip;
  return layoutVideo(p).find((pl) => t >= pl.start && t < pl.end && ok(pl.clip))?.clip;
}

/** Mark something moving: draw a box round it on the player, then it's tracked, boxed, arrowed and labelled. */
export function startMark() {
  if (store.ui.trackPick) return void ((store.ui.trackPick = null), (store.ui.trackThen = null));
  const c = trackableAt(store.ui.time);
  if (!c) return store.toast('Put the playhead on a video clip first: the mark follows something in it.', 'error');
  toggleTrackPick(c.id, 'mark');
}

/** How often faces are looked for (a second): enough to follow them, quick to find. */
const FACE_FPS = 6;

/** Find the faces in a clip: one track per face, kept on the clip like tracked objects. */
export async function findFaces(id: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  store.ui.playing = false;
  const tracks = await busy('Finding faces', async () => {
    const g = await clipFrames(c, m, FACE_FPS, 320);
    const cv = document.createElement('canvas');
    cv.width = g.w;
    cv.height = g.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(g.w, g.h);
    const found = [];
    for (const f of g.frames) {
      for (let i = 0; i < f.length; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = f[i];
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      found.push(await detectFaces(cv));
    }
    return linkFaces(found, FACE_FPS, 3);
  });
  if (!tracks.length) return store.toast('No faces found in this clip.', 'info');
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === id);
    if (!x) return;
    const n0 = (x.paths ?? []).filter((pp) => pp.name.startsWith('Face')).length;
    x.paths = [...(x.paths ?? []), ...tracks.map((t, i) => ({ id: uid(), name: `Face ${n0 + i + 1}`, pts: t.pts.map(([f, px, py]) => [r4(c.in + f / FACE_FPS), px, py] as [number, number, number]), size: t.size }))];
  });
  store.toast(`Found ${tracks.length} face${tracks.length > 1 ? 's' : ''}: put a sticker on each, or a label, from its row in Motion.`, 'ok', 5000);
}

/** An emoji over a tracked face (or object), its size, following it. */
export function emojiFollows(clipId: string, pathId: string, emoji = '😎') {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  const follow = pathOnTimeline(p, c, pathId);
  if (!follow.length) return store.toast('That track is in a part of the clip that has been trimmed off.', 'error');
  const [, bh] = pathSize(p, c, pathId) ?? [0.15, 0.15];
  const t0 = follow[0][0];
  const tx: TextLayer = { id: uid(), kind: 'text', row: freeRow(p.layers, t0, follow.at(-1)![0]), text: emoji, start: t0, duration: Math.max(0.5, follow.at(-1)![0] - t0), size: Math.min(0.9, Math.max(0.04, bh * 1.25)), color: '#ffffff', font: 'sans', bold: false, x: follow[0][1], y: follow[0][2], align: 'center', shadow: false, box: false, fade: 0, moshed: false, follow };
  store.edit((q) => q.layers.push(tx));
  store.ui.selectedClips = [tx.id];
}

/** Mark a tracked object: a box round it (`bw`×`bh` of the frame), an arrow at it and a label, all following it. */
export function markTracked(clipId: string, pathId: string, bw?: number, bh?: number) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  // a path tracked earlier: the size of its box on screen
  if (bw === undefined || bh === undefined) [bw, bh] = pathSize(p, c, pathId) ?? [0.2, 0.2];
  const follow = pathOnTimeline(p, c, pathId);
  if (!follow.length) return store.toast('That track is in a part of the clip that has been trimmed off.', 'error');
  const { w, h } = outputSize(p, p.encoder.previewWidth);
  const marks = markLayers(follow, Math.abs(bw), Math.abs(bh), w / h, shapeLook(), p.layers, uid);
  store.edit((q) => q.layers.push(...marks));
  store.ui.selectedClips = [marks[marks.length - 1].id];
  store.toast('Marked it: a box, an arrow and a label that follow it. Double-click the label to change it.', 'ok', 5000);
}

/** Make a clip on a track above move with a tracked path (its position keyframes). */
export function clipFollows(clipId: string, pathId: string, followerId: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  const f = p.clips.find((x) => x.id === followerId);
  if (!c || !f) return;
  const path = pathOnTimeline(p, c, pathId, 'picture').filter(([t]) => t >= f.start - 1e-6 && t <= f.start + clipLen(f) + 1e-6);
  if (!path.length) return store.toast("That clip isn't on screen while the object is tracked.", 'error');
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === followerId);
    if (!x) return;
    // straight lines between tracked points (eased keys would stop at every point)
    x.keys = { ...(x.keys ?? {}), x: path.map(([t, px]) => [t - f.start, px - 0.5, 0]), y: path.map(([t, , py]) => [t - f.start, py - 0.5, 0]) };
  });
  store.toast('The clip now moves with the tracked object (its position keyframes).', 'ok');
}
