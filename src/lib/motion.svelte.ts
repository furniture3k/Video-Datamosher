// Tracking and stabilization on the timeline: analyse a clip, then store or use the result.
import { store } from './store.svelte';
import { clipFrames } from './analysis';
import { trackBox, stabilize, simplify } from '../engine/track';
import { clipLen, layoutVideo, localTime, sourceTime, mediaOf } from '../engine/timeline';
import { outputSize } from '../engine/args';
import { uid } from '../engine/presets';
import { VIDEO_TRACK, type Clip, type Project, type TextClip } from '../engine/types';

export const motionJob = $state({ running: false, stage: '' });

const ANALYSIS_W = 256;

/** Where a clip's source picture sits in the output frame (pixels), for its fit mode. */
export function pictureRect(c: Clip, p: Project): { x: number; y: number; w: number; h: number; W: number; H: number } {
  const { w: W, h: H } = outputSize(p, p.encoder.previewWidth);
  const m = mediaOf(p, c.mediaId);
  const iw = m?.width || W;
  const ih = m?.height || H;
  if (c.fit === 'stretch') return { x: 0, y: 0, w: W, h: H, W, H };
  const s = c.fit === 'fill' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  return { x: (W - iw * s) / 2, y: (H - ih * s) / 2, w: iw * s, h: ih * s, W, H };
}

const clipStart = (p: Project, c: Clip) => (c.track === VIDEO_TRACK ? (layoutVideo(p).find((pl) => pl.clip.id === c.id)?.start ?? 0) : c.start);

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

/** Analyse a clip's camera shake and store a smoothed correction. `strength`: smoothing in frames. */
export async function stabilizeClip(id: string, strength = 20) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  const fps = p.encoder.fps;
  const result = await busy('Measuring the shake', async () => {
    const g = await clipFrames(c, m, fps, ANALYSIS_W);
    return { s: stabilize(g, strength), g };
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
  const r = pictureRect(c, p);
  const pts = await busy('Tracking', async () => {
    const g = await clipFrames(c, m, fps, ANALYSIS_W);
    // box from the output frame into the analysis frame
    const toG = (u: number, v: number): [number, number] => [((u * r.W - r.x) / r.w) * g.w, ((v * r.H - r.y) / r.h) * g.h];
    const [x0, y0] = toG(Math.min(box[0], box[2]), Math.min(box[1], box[3]));
    const [x1, y1] = toG(Math.max(box[0], box[2]), Math.max(box[1], box[3]));
    const k = Math.max(0, Math.min(g.frames.length - 1, Math.round((srcT - c.in) * fps)));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const fwd = trackBox(g, k, cx, cy, x1 - x0, y1 - y0, 1);
    const back = trackBox(g, k, cx, cy, x1 - x0, y1 - y0, -1);
    return [...back.slice(0, -1), ...fwd].map(([f, x, y]) => [c.in + f / fps, x / g.w, y / g.h] as [number, number, number]);
  });
  if (pts.length < 2) {
    store.toast('Could not follow that: draw the box around something with detail.', 'error');
    return;
  }
  const n = (c.paths?.length ?? 0) + 1;
  store.edit((q) => {
    const x = q.clips.find((y) => y.id === id);
    if (x) x.paths = [...(x.paths ?? []), { id: uid(), name: `Track ${n}`, pts }];
  });
  store.toast(`Tracked for ${(pts.at(-1)![0] - pts[0][0]).toFixed(1)} s.`, 'ok');
}

/** A path as timeline positions [timeline seconds, x, y in the output frame 0..1], simplified. */
export function pathOnTimeline(p: Project, c: Clip, pathId: string): [number, number, number][] {
  const path = c.paths?.find((x) => x.id === pathId);
  if (!path) return [];
  const r = pictureRect(c, p);
  const start = clipStart(p, c);
  const pts = path.pts.map(([s, x, y]) => [start + localTime(c, s), (r.x + x * r.w) / r.W, (r.y + y * r.h) / r.H] as [number, number, number]).sort((a, b) => a[0] - b[0]);
  const xs = simplify(pts.map(([t, x]) => [t, x] as [number, number]), 0.002);
  const ys = simplify(pts.map(([t, , y]) => [t, y] as [number, number]), 0.002);
  const times = [...new Set([...xs, ...ys].map(([t]) => t))].sort((a, b) => a - b);
  const at = (q: [number, number][], t: number) => {
    for (let i = 0; i < q.length - 1; i++) if (t <= q[i + 1][0]) return q[i][1] + ((q[i + 1][1] - q[i][1]) * (t - q[i][0])) / Math.max(1e-9, q[i + 1][0] - q[i][0]);
    return q[q.length - 1][1];
  };
  return times.map((t) => [t, at(xs, t), at(ys, t)]);
}

/** Add a title that follows a tracked path. */
export function titleFollows(clipId: string, pathId: string) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return;
  const follow = pathOnTimeline(p, c, pathId);
  if (!follow.length) return;
  const tx: TextClip = { id: uid(), text: 'Label', start: follow[0][0], duration: Math.max(0.5, follow.at(-1)![0] - follow[0][0]), size: 0.06, color: '#ffffff', font: 'sans', bold: true, x: follow[0][1], y: follow[0][2], align: 'center', shadow: true, box: true, fade: 0.1, moshed: false, follow };
  store.edit((q) => q.texts.push(tx));
  store.ui.selectedClips = [tx.id];
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
}
