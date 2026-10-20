// Colour flashes on the beat: a few frames of one flat colour, for the hit of a cut or a drop.
// Each is a full-frame box on its own layer, in one group, so they move, copy and delete together.
import { newShape } from './shapes';
import type { ShapeLayer } from './layers';

export interface FlashOptions {
  /** the colour of the flash */
  colour: string;
  /** how many frames each lasts */
  frames: number;
  fps: number;
  /** flash on every this many beats (the first beat in range, then every nth) */
  every?: number;
  /** most flashes made (a whole song is a lot of layers) */
  max?: number;
}

/** Flashes at the beats between `from` and `to` (seconds). `row` and `id` say where each goes and how it is named. */
export function flashLayers(beats: number[], from: number, to: number, o: FlashOptions, row: string, newId: () => string, group: string): ShapeLayer[] {
  const every = Math.max(1, Math.round(o.every ?? 1));
  const hit = beats.filter((b) => b >= from - 1e-6 && b < to).filter((_, i) => i % every === 0).slice(0, o.max ?? 64);
  const dur = Math.max(1, Math.round(o.frames)) / o.fps;
  return hit.map((t) => {
    const s = newShape('rect', newId(), row, Math.round(t * 1000) / 1000, 1, { color: o.colour, width: 0.001, fill: o.colour });
    // the whole frame, with nothing drawn on and a plain edge
    Object.assign(s, { x: 0.5, y: 0.5, w: 1.02, h: 1.02, duration: Math.round(dur * 1000) / 1000, group });
    delete s.drawOn;
    return s;
  });
}
