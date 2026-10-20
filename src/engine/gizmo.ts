// Geometry for the handles on the player: boxes around what's on screen, hit testing, and turning
// drags and pinches into moves, scales and turns (pure, in pixels of the output frame).
import { apply, type Affine } from './placement';
import { keyedValue, withKeyAt } from './keys';
import { layerPos, moveGroupMates } from './layers';
import { clipLen, layoutVideo } from './timeline';
import { VIDEO_TRACK, transformOf, type Clip, type Project } from './types';

export type Pt = [number, number];
/** Corners in order: top left, top right, bottom right, bottom left (before any turn). */
export type Quad = [Pt, Pt, Pt, Pt];

/** A w×h box centred on (cx, cy), turned `deg` degrees clockwise about its centre. */
export function boxQuad(cx: number, cy: number, w: number, h: number, deg: number): Quad {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const at = (x: number, y: number): Pt => [cx + x * c - y * s, cy + x * s + y * c];
  return [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)];
}

/** The part u0..u1 × v0..v1 of a picture placed by `m` (0..1 in, 0..1 out), in pixels of a W×H frame. */
export function pictureQuad(m: Affine, W: number, H: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1): Quad {
  const at = (u: number, v: number): Pt => {
    const [x, y] = apply(m, u, v);
    return [x * W, y * H];
  };
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

export const centre = (q: Quad): Pt => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];

/** Is p inside the (convex) quad, either way round? */
export function inQuad(p: Pt, q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const cross = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Where the turn handle sits: `gap` pixels out from the middle of the top edge. */
export function turnHandle(q: Quad, gap: number): Pt {
  const mx = (q[0][0] + q[1][0]) / 2;
  const my = (q[0][1] + q[1][1]) / 2;
  const [cx, cy] = centre(q);
  const d = Math.hypot(mx - cx, my - cy) || 1;
  return [mx + ((mx - cx) / d) * gap, my + ((my - cy) / d) * gap];
}

/** How much a drag from p0 to p1 scales something about c (distance from c after / before). */
export function scaleBy(c: Pt, p0: Pt, p1: Pt, min = 0.02, max = 50): number {
  const d0 = Math.hypot(p0[0] - c[0], p0[1] - c[1]);
  if (d0 < 1e-6) return 1;
  return Math.max(min, Math.min(max, Math.hypot(p1[0] - c[0], p1[1] - c[1]) / d0));
}

/** How far a drag from p0 to p1 turns something about c, in degrees clockwise (−180..180). */
export function turnBy(c: Pt, p0: Pt, p1: Pt): number {
  const a = Math.atan2(p1[1] - c[1], p1[0] - c[0]) - Math.atan2(p0[1] - c[1], p0[0] - c[0]);
  return normDeg((a * 180) / Math.PI);
}

/** An angle in degrees brought into −180..180. */
export const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Two fingers moved from (a0, b0) to (a1, b1): the scale, turn (degrees) and move of their midpoint. */
export function pinch(a0: Pt, b0: Pt, a1: Pt, b1: Pt): { scale: number; turn: number; move: Pt } {
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const t0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  const t1 = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
  const m0 = mid(a0, b0);
  const m1 = mid(a1, b1);
  return { scale: d0 > 1e-6 ? d1 / d0 : 1, turn: normDeg(((t1 - t0) * 180) / Math.PI), move: [m1[0] - m0[0], m1[1] - m0[1]] };
}

/** v pulled onto the nearest of `targets` within `tol`, and the target it snapped to (if any). */
export function snapTo(v: number, targets: number[], tol: number): { v: number; to: number | null } {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) <= tol && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return best === null ? { v, to: null } : { v: best, to: best };
}

/** An angle (degrees) snapped to whole steps of `step` (free with step 0), or to the nearest quarter turn within `tol`. */
export function snapTurn(deg: number, step: number, tol = 4): number {
  if (step > 0) return normDeg(Math.round(deg / step) * step);
  const q = Math.round(deg / 90) * 90;
  return Math.abs(deg - q) <= tol ? normDeg(q) : deg;
}

// ---------- poses: what the handles change ----------

/**
 * Where something on screen is and how big and turned it is, at one moment: its anchor (the
 * point it turns and scales about, as shares of the frame), its size (a title's letter size, a
 * clip's zoom) and its turn in degrees.
 */
export interface Pose {
  x: number;
  y: number;
  scale: number;
  turn: number;
}

/** When a clip starts on the timeline. */
const clipStart = (p: Pick<Project, 'clips' | 'media'>, c: Clip) => (c.track === VIDEO_TRACK ? (layoutVideo(p).find((pl) => pl.clip.id === c.id)?.start ?? 0) : c.start);

/** The pose of a layer or clip at timeline time t (null when there's no such thing). */
export function poseOf(p: Pick<Project, 'clips' | 'media' | 'layers'>, id: string, t: number): Pose | null {
  const l = p.layers.find((x) => x.id === id);
  if (l) {
    const [x, y] = layerPos(l, t);
    return { x, y, scale: l.kind === 'text' ? l.size : Math.max(l.w, l.h), turn: l.rotate ?? 0 };
  }
  const c = p.clips.find((x) => x.id === id);
  if (!c) return null;
  const local = Math.max(0, Math.min(clipLen(c), t - clipStart(p, c)));
  const T = transformOf(c);
  return { x: 0.5 + keyedValue(c.keys, 'x', local, T.x), y: 0.5 + keyedValue(c.keys, 'y', local, T.y), scale: keyedValue(c.keys, 'zoom', local, T.zoom), turn: keyedValue(c.keys, 'rotate', local, T.rotate) };
}

/**
 * Give a layer or clip a new pose at timeline time t. Only what changed is written. A clip's
 * keyframed properties get a key at t (`tol`: how close an existing key must be to be replaced),
 * the others their plain setting; a title that follows a tracked object moves its whole path.
 */
export function setPose(p: Pick<Project, 'clips' | 'media' | 'layers'>, id: string, t: number, to: Pose, tol: number) {
  const now = poseOf(p, id, t);
  if (!now) return;
  const changed = (a: number, b: number) => Math.abs(a - b) > 1e-6;
  const l = p.layers.find((x) => x.id === id);
  if (l) {
    const dx = to.x - now.x;
    const dy = to.y - now.y;
    if (changed(dx, 0) || changed(dy, 0)) {
      // a layer in a group takes the rest of the group with it
      moveGroupMates(p.layers, l.id, dx, dy);
      l.x += dx;
      l.y += dy;
      if (l.follow) l.follow = l.follow.map(([ft, fx, fy]) => [ft, fx + dx, fy + dy]);
    }
    if (changed(to.scale, now.scale)) {
      if (l.kind === 'text') l.size = to.scale;
      else {
        // a shape keeps its proportions
        const k = to.scale / now.scale;
        l.w *= k;
        l.h *= k;
      }
    }
    if (changed(to.turn, now.turn)) l.rotate = to.turn;
    return;
  }
  const c = p.clips.find((x) => x.id === id)!;
  const local = Math.max(0, Math.min(clipLen(c), t - clipStart(p, c)));
  const set = (k: 'x' | 'y' | 'zoom' | 'rotate', v: number) => {
    if (c.keys?.[k]?.length) c.keys = { ...c.keys, [k]: withKeyAt(c.keys[k]!, local, v, tol) };
    else c.transform = { ...(c.transform ?? {}), [k]: v };
  };
  if (changed(to.x, now.x)) set('x', to.x - 0.5);
  if (changed(to.y, now.y)) set('y', to.y - 0.5);
  if (changed(to.scale, now.scale)) set('zoom', to.scale);
  if (changed(to.turn, now.turn)) set('rotate', to.turn);
}
