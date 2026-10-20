// The graphics renderer: draws layers over the picture the same way everywhere they appear (the
// edit preview, clean layers on the mosh and in exports, and layers burned in before moshing).
import { drawOrder, layerAlpha, layerMatrix, layerPos, trailSteps, type Layer } from '../engine/layers';
import { applyH, quadHomography, type Mat3 } from '../engine/planar';
import { affineBetween, growTri, warpTriangles, type WarpTri } from '../engine/warp';
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

/** Draw `src` onto `ctx` triangle by triangle: each piece of the source moved by its own affine transform, a hair larger than it is so no seams show. */
function paintTriangles(ctx: Cx, src: CanvasImageSource, tris: WarpTri[]) {
  for (const { src: s, dst } of tris) {
    const m = affineBetween(s, dst);
    if (!m) continue;
    const g = growTri(dst, 0.5);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g[0][0], g[0][1]);
    ctx.lineTo(g[1][0], g[1][1]);
    ctx.lineTo(g[2][0], g[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(...m);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }
}

/** A picture (iw × ih pixels) put onto a four-cornered place (x0,y0 … x3,y3 clockwise from the top left, in pixels). */
export function drawWarpedImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, quad: number[], cells = 16) {
  const H = quadHomography([0, 0, iw, 0, iw, ih, 0, ih], quad);
  if (H) paintTriangles(ctx, img, warpTriangles(H, 0, 0, iw, ih, cells, cells));
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
  paintTriangles(s.warped, s.flatC, warpTriangles(H, x0, y0, x1, y1, nx, ny));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(s.warpedC, 0, 0);
  ctx.restore();
}

/** The matte of the footage on screen at timeline time t, as a w×h picture whose opacity is the subject; null when there is none. */
export type MatteSource = (t: number, w: number, h: number) => CanvasImageSource | null;

let behind: { w: number; h: number; c?: CanvasImageSource; g?: Cx } = { w: 0, h: 0 };

/**
 * Draw one layer at timeline time t with opacity `alpha` (its fades are the caller's). A layer that
 * is behind the subject is drawn on a picture of its own, the subject's matte cuts it out of that,
 * and the rest goes on.
 */
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number, alpha: number, t: number, matte?: MatteSource) {
  const cut = l.depth === 'behind' && matte ? matte(t, w, h) : null;
  if (!cut) return drawBent(ctx, l, w, h, alpha, t);
  if (behind.w !== w || behind.h !== h || !behind.g) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    behind = { w, h, c, g: c.getContext('2d') as Cx };
  }
  const g = behind.g!;
  g.clearRect(0, 0, w, h);
  drawBent(g as CanvasRenderingContext2D, l, w, h, alpha, t);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(cut, 0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  ctx.drawImage(behind.c!, 0, 0);
}

/** A layer as it is drawn flat or, if it is tilted or pinned to a surface, warped. */
function drawBent(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number, alpha: number, t: number) {
  const H = layerMatrix(l, t, w, h);
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
export function drawLayers(ctx: CanvasRenderingContext2D, layers: Layer[], t: number, w: number, h: number, which: LayerSet = 'all', matte?: MatteSource) {
  for (const l of drawOrder(layers)) if (inSet(l, which)) drawLayer(ctx, l, w, h, layerAlpha(l, t), t, matte);
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
  // the box's centre is across from the position along the turned baseline (and, for bent text, a little off it)
  return boxQuad(px * w + b.dx * Math.cos(r) - b.dy * Math.sin(r), py * h + b.dx * Math.sin(r) + b.dy * Math.cos(r), b.w, b.h, l.rotate ?? 0);
}

/** Where a layer is on screen at timeline time t, in pixels of a w×h frame (for the handles): carried with its surface if it is pinned. */
export function layerQuad(l: Layer, t: number, w: number, h: number): Quad {
  const q = poseQuad(l, t, w, h);
  const H = layerMatrix(l, t, w, h);
  if (!H) return q;
  return q.map(([x, y]) => applyH(H, x, y)) as Quad;
}
