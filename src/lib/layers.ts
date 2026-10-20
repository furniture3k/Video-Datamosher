// The graphics renderer: draws layers over the picture the same way everywhere they appear (the
// edit preview, clean layers on the mosh and in exports, and layers burned in before moshing).
import { drawOrder, layerAlpha, layerPos, trailSteps, type Layer } from '../engine/layers';
import { boxQuad, type Quad } from '../engine/gizmo';
import { drawText, textBox } from './text';
import { drawShape } from './shapes';
import { particlesAt } from '../engine/particles';

/** Which layers to draw: all of them, the ones on top of the mosh, or the ones that melt with it. */
export type LayerSet = 'all' | 'clean' | 'moshed';

const inSet = (l: Layer, which: LayerSet) => which === 'all' || (which === 'moshed') === l.moshed;

/** Draw one layer at timeline time t with opacity `alpha` (its fades are the caller's). */
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number, alpha: number, t: number) {
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

/** Where a layer is on screen at timeline time t, in pixels of a w×h frame (for the handles). */
export function layerQuad(l: Layer, t: number, w: number, h: number): Quad {
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
