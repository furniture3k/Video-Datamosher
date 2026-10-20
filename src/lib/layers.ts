// The graphics renderer: draws layers over the picture the same way everywhere they appear (the
// edit preview, clean layers on the mosh and in exports, and layers burned in before moshing).
import { drawOrder, layerAlpha, layerPos, surfaceMatrix, trailSteps, type Layer } from '../engine/layers';
import { applyH, type Mat3 } from '../engine/planar';
import { affineBetween, growTri, warpTriangles } from '../engine/warp';
import { boxQuad, type Quad } from '../engine/gizmo';
import { drawText, textBox } from './text';
import { drawShape } from './shapes';
import { particlesAt } from '../engine/particles';

/** Which layers to draw: all of them, the ones on top of the mosh, or the ones that melt with it. */
export type LayerSet = 'all' | 'clean' | 'moshed';

const inSet = (l: Layer, which: LayerSet) => which === 'all' || (which === 'moshed') === l.moshed;

type Cx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Two scratch pictures the size of the frame, kept between calls: the layer as drawn flat, then as warped. */
const scratch: { w: number; h: number; flat?: Cx; warped?: Cx; flatC?: CanvasImageSource; warpedC?: CanvasImageSource } = { w: 0, h: 0 };
function scratches(w: number, h: number) {
  if (scratch.w !== w || scratch.h !== h || !scratch.flat) {
    const make = (): [CanvasImageSource, Cx] => {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      return [c, c.getContext('2d') as Cx];
    };
    [scratch.flatC, scratch.flat] = make();
    [scratch.warpedC, scratch.warped] = make();
    scratch.w = w;
    scratch.h = h;
  }
  return scratch as Required<typeof scratch>;
}

/** The part of the frame a flat layer can have drawn on, so only that is warped (with room for glows and shadows). */
function drawnRegion(l: Layer, t: number, w: number, h: number): [number, number, number, number] {
  if (l.particles || l.trail || (l.kind === 'text' && (l.repeat || l.fit))) return [0, 0, w, h];
  const q = poseQuad(l, t, w, h);
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const pad = Math.max(w, h) * 0.04 + 0.25 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return [Math.max(0, Math.min(...xs) - pad), Math.max(0, Math.min(...ys) - pad), Math.min(w, Math.max(...xs) + pad), Math.min(h, Math.max(...ys) + pad)];
}

/**
 * A pinned layer: drawn flat (where it is on the moment it was pinned), then carried onto the
 * surface as it is now by a grid of small triangles, each moved by its own affine transform.
 */
function drawWarped(ctx: CanvasRenderingContext2D, l: Layer, H: Mat3, w: number, h: number, alpha: number, t: number) {
  const s = scratches(w, h);
  s.flat.clearRect(0, 0, w, h);
  s.warped.clearRect(0, 0, w, h);
  // flat and warped at full strength, then faded as one: overlapping triangles would show as lines in a see-through layer
  drawFlat(s.flat as CanvasRenderingContext2D, l, w, h, 1, t);
  const [x0, y0, x1, y1] = drawnRegion(l, t, w, h);
  const nx = 16;
  const ny = Math.max(4, Math.min(24, Math.round((nx * (y1 - y0)) / Math.max(1, x1 - x0))));
  for (const { src, dst } of warpTriangles(H, x0, y0, x1, y1, nx, ny)) {
    const m = affineBetween(src, dst);
    if (!m) continue;
    const g = growTri(dst, 0.5);
    s.warped.save();
    s.warped.beginPath();
    s.warped.moveTo(g[0][0], g[0][1]);
    s.warped.lineTo(g[1][0], g[1][1]);
    s.warped.lineTo(g[2][0], g[2][1]);
    s.warped.closePath();
    s.warped.clip();
    s.warped.transform(...m);
    s.warped.drawImage(s.flatC, 0, 0);
    s.warped.restore();
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(s.warpedC, 0, 0);
  ctx.restore();
}

/** Draw one layer at timeline time t with opacity `alpha` (its fades are the caller's). */
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number, alpha: number, t: number) {
  const H = surfaceMatrix(l, t, w, h);
  if (H) return drawWarped(ctx, l, H, w, h, alpha, t);
  drawFlat(ctx, l, w, h, alpha, t);
}

function drawFlat(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number, alpha: number, t: number) {
  const one = (a: number) => {
    switch (l.kind) {
      case 'text':
        return drawText(ctx, l, w, h, a, t);
      case 'shape':
        return drawShape(ctx, l, w, h, a, t);
    }
  };
  // particles: copies of it rising, falling or bursting out, each turned and sized about where it is
  if (l.particles) {
    const [px, py] = layerPos(l, t);
    for (const q of particlesAt(l.particles, t - l.start)) {
      if (q.alpha <= 0) continue;
      ctx.save();
      ctx.translate((px + q.dx) * w, (py + q.dy) * h);
      if (q.turn) ctx.rotate((q.turn * Math.PI) / 180);
      ctx.scale(q.scale, q.scale);
      ctx.translate(-px * w, -py * h);
      one(alpha * q.alpha);
      ctx.restore();
    }
    return;
  }
  // a stamp trail: the copies left behind, then the layer where it is now
  for (const [dx, dy] of trailSteps(l, t)) {
    ctx.save();
    if (dx || dy) ctx.translate(dx * w, dy * h);
    one(alpha);
    ctx.restore();
  }
}

/** Draw every layer of `which` on screen at timeline time t, bottom row first. */
export function drawLayers(ctx: CanvasRenderingContext2D, layers: Layer[], t: number, w: number, h: number, which: LayerSet = 'all') {
  for (const l of drawOrder(layers)) if (inSet(l, which)) drawLayer(ctx, l, w, h, layerAlpha(l, t), t);
}

/** Is any layer of `which` on screen at timeline time t? */
export const anyLayerAt = (layers: Layer[], t: number, which: LayerSet = 'all') => layers.some((l) => inSet(l, which) && layerAlpha(l, t) > 0);

/** Where a layer is, unwarped, at timeline time t in pixels of a w×h frame: the box it's laid out in. */
export function poseQuad(l: Layer, t: number, w: number, h: number): Quad {
  const [lx, ly] = layerPos(l, t);
  // the handles go on the newest copy of a stamp trail
  const [ox, oy] = trailSteps(l, t).at(-1)!;
  const [px, py] = [lx + ox, ly + oy];
  // a shape's box is its size (a little bigger for thin lines, so there's something to grab)
  if (l.kind === 'shape') return boxQuad(px * w, py * h, Math.max(l.w * w, 12), Math.max(l.h * h, 12), l.rotate ?? 0);
  const b = textBox(l, w, h);
  const r = ((l.rotate ?? 0) * Math.PI) / 180;
  // the box's centre is across from the position along the turned baseline
  return boxQuad(px * w + b.dx * Math.cos(r), py * h + b.dx * Math.sin(r), b.w, b.h, l.rotate ?? 0);
}

/** Where a layer is on screen at timeline time t, in pixels of a w×h frame (for the handles): carried with its surface if it is pinned. */
export function layerQuad(l: Layer, t: number, w: number, h: number): Quad {
  const q = poseQuad(l, t, w, h);
  const H = surfaceMatrix(l, t, w, h);
  if (!H) return q;
  return q.map(([x, y]) => applyH(H, x, y)) as Quad;
}
