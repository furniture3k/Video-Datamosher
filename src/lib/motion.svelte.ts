// Tracking and stabilization on the timeline: analyse a clip, then store or use the result.
import { store } from './store.svelte';
import { clipFrames } from './analysis';
import { trackBox, stabilize, simplify, type Gray, type Stabilized, type TrackPoint } from '../engine/track';
import { clipLen, layoutVideo, localTime, sourceTime, mediaOf } from '../engine/timeline';
import { apply, fitRect, invert, pictureMatrix } from '../engine/placement';
import { outputSize } from '../engine/args';
import { uid } from '../engine/presets';
import { VIDEO_TRACK, type Clip, type Project } from '../engine/types';
import { FIRST_ROW, type TextLayer } from '../engine/layers';
import type { TrackJob } from './track.worker';

export const motionJob = $state({ running: false, stage: '' });

const ANALYSIS_W = 256;

/** Where a clip's source picture sits in the output frame (pixels), for its fit mode (no transform). */
export function pictureRect(c: Clip, p: Project): { x: number; y: number; w: number; h: number; W: number; H: number } {
  const { w: W, h: H } = outputSize(p, p.encoder.previewWidth);
  const m = mediaOf(p, c.mediaId);
  const [x, y, w, h] = fitRect(c.fit, m?.width || W, m?.height || H, W, H);
  return { x, y, w, h, W, H };
}

/** Map from a clip's source picture (0..1) to the output frame (0..1) at `local` seconds into it. */
function placement(p: Project, c: Clip, local: number) {
  const { w: W, h: H } = outputSize(p, p.encoder.previewWidth);
  const m = mediaOf(p, c.mediaId);
  return pictureMatrix(c, local, m?.width || W, m?.height || H, W, H);
}

export const clipStart = (p: Project, c: Clip) => (c.track === VIDEO_TRACK ? (layoutVideo(p).find((pl) => pl.clip.id === c.id)?.start ?? 0) : c.start);

async function busy<T>(stage: string, fn: () => Promise<T>): Promise<T> {
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
function framesBuffer(g: Gray, from: number, to: number): ArrayBuffer {
  const n = g.w * g.h;
  const out = new Uint8Array(n * (to - from));
  for (let k = from; k < to; k++) out.set(g.frames[k], (k - from) * n);
  return out.buffer;
}

/** Run an analysis in its own worker (so two can run side by side); on the page if workers fail. */
function inWorker<T>(job: TrackJob, inline: () => T): Promise<T> {
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

/** Start (or stop) drawing a box to track on the player, with the playhead on the clip. */
export function toggleTrackPick(id: string) {
  if (store.ui.trackPick === id) return void (store.ui.trackPick = null);
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
export async function trackClip(id: string, box: [number, number, number, number]) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  const fps = p.encoder.fps;
  const local = Math.max(0, Math.min(clipLen(c) - 1e-3, store.ui.time - clipStart(p, c)));
  const srcT = sourceTime(c, local);
  // the box from the output frame into the clip's own picture (undoing its zoom, move, turn and stabilization)
  const inv = invert(placement(p, c, local));
  const corners = [apply(inv, box[0], box[1]), apply(inv, box[2], box[1]), apply(inv, box[0], box[3]), apply(inv, box[2], box[3])];
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
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === id);
    if (x) x.paths = [...(x.paths ?? []), { id: uid(), name, pts, size: [Math.round((u1 - u0) * 1e4) / 1e4, Math.round((v1 - v0) * 1e4) / 1e4] }];
  });
  const got = pts[pts.length - 1][0] - pts[0][0];
  if (res.whole) store.toast(`${name}: followed it through the whole clip.`, 'ok');
  else store.toast(`${name}: followed it for ${got.toFixed(1)} s of ${res.len.toFixed(1)} s, then lost it (hidden, blurred or out of frame).`, 'info', 5000);
}

/** A path as timeline positions [timeline seconds, x, y in the output frame 0..1], simplified. */
export function pathOnTimeline(p: Project, c: Clip, pathId: string): [number, number, number][] {
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
    pts.push([start + local, u, v]);
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
  return [path.size[0] * Math.hypot(m[0], m[1]), path.size[1] * Math.hypot(m[2], m[3])];
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

/** Make a clip on a track above move with a tracked path (its position keyframes). */
export function clipFollows(clipId: string, pathId: string, followerId: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  const f = p.clips.find((x) => x.id === followerId);
  if (!c || !f) return;
  const path = pathOnTimeline(p, c, pathId).filter(([t]) => t >= f.start - 1e-6 && t <= f.start + clipLen(f) + 1e-6);
  if (!path.length) return store.toast("That clip isn't on screen while the object is tracked.", 'error');
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === followerId);
    if (!x) return;
    // straight lines between tracked points (eased keys would stop at every point)
    x.keys = { ...(x.keys ?? {}), x: path.map(([t, px]) => [t - f.start, px - 0.5, 0]), y: path.map(([t, , py]) => [t - f.start, py - 0.5, 0]) };
  });
  store.toast('The clip now moves with the tracked object (its position keyframes).', 'ok');
}
