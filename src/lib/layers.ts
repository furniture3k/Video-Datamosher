// The graphics renderer: draws layers over the picture the same way everywhere they appear (the
// edit preview, clean layers on the mosh and in exports, and layers burned in before moshing).
import { drawOrder, layerAlpha, type Layer } from '../engine/layers';
import { drawText } from './text';

/** Which layers to draw: all of them, the ones on top of the mosh, or the ones that melt with it. */
export type LayerSet = 'all' | 'clean' | 'moshed';

const inSet = (l: Layer, which: LayerSet) => which === 'all' || (which === 'moshed') === l.moshed;

/** Draw one layer at timeline time t with opacity `alpha` (its fades are the caller's). */
export function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number, alpha: number, t: number) {
  switch (l.kind) {
    case 'text':
      return drawText(ctx, l, w, h, alpha, t);
  }
}

/** Draw every layer of `which` on screen at timeline time t, bottom row first. */
export function drawLayers(ctx: CanvasRenderingContext2D, layers: Layer[], t: number, w: number, h: number, which: LayerSet = 'all') {
  for (const l of drawOrder(layers)) if (inSet(l, which)) drawLayer(ctx, l, w, h, layerAlpha(l, t), t);
}

/** Is any layer of `which` on screen at timeline time t? */
export const anyLayerAt = (layers: Layer[], t: number, which: LayerSet = 'all') => layers.some((l) => inSet(l, which) && layerAlpha(l, t) > 0);
