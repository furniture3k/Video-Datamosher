// Flow painting: brush strokes become a vector field (how far, and which way, the picture flows
// each frame). Coordinates are shares of the frame (y down); vectors are shares of the frame width.

export type FlowTool = 'push' | 'swirl' | 'unswirl' | 'pinch' | 'bulge' | 'erase';

export interface Stroke {
  tool: FlowTool;
  /** [x, y] shares of the frame */
  pts: [number, number][];
  /** brush radius, share of the frame width */
  radius: number;
  /** flow per frame at the brush centre, share of the frame width */
  strength: number;
}

export const FLOW_TOOLS: { id: FlowTool; name: string; hint: string }[] = [
  { id: 'push', name: 'Push', hint: 'Flows along the stroke.' },
  { id: 'swirl', name: 'Swirl', hint: 'Spins clockwise around the stroke.' },
  { id: 'unswirl', name: 'Swirl back', hint: 'Spins anticlockwise.' },
  { id: 'pinch', name: 'Pinch', hint: 'Sucks the picture into the stroke.' },
  { id: 'bulge', name: 'Bulge', hint: 'Pushes the picture out from the stroke.' },
  { id: 'erase', name: 'Erase', hint: 'Removes flow under the brush.' },
];

/** Nearest point of a polyline to (x, y), with the direction of the segment it's on. */
function nearest(pts: [number, number][], x: number, y: number, aspect: number) {
  let best = Infinity;
  let px = pts[0][0];
  let py = pts[0][1];
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    // work in width units (y scaled by the frame's height / width)
    const dx = bx - ax;
    const dy = (by - ay) / aspect;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + ((y - ay) / aspect) * dy) / l2)) : 0;
    const qx = ax + dx * u;
    const qy = ay + (by - ay) * u;
    const d = Math.hypot(x - qx, (y - qy) / aspect);
    if (d < best) {
      best = d;
      px = qx;
      py = qy;
      const l = Math.sqrt(l2) || 1;
      tx = dx / l;
      ty = dy / l;
    }
  }
  return { d: best, px, py, tx, ty };
}

/**
 * The field on a gw × gh grid: [vx, vy] per cell (row by row, top first), in shares of the
 * frame width per frame. `aspect` = frame width / height.
 */
export function rasterizeField(strokes: Stroke[], gw: number, gh: number, aspect: number): Float32Array {
  const f = new Float32Array(gw * gh * 2);
  for (const s of strokes) {
    if (!s.pts.length) continue;
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const x = (i + 0.5) / gw;
        const y = (j + 0.5) / gh;
        const n = nearest(s.pts, x, y, aspect);
        const w = Math.exp(-((n.d / Math.max(1e-4, s.radius)) ** 2));
        if (w < 0.01) continue;
        const o = (j * gw + i) * 2;
        if (s.tool === 'erase') {
          f[o] *= 1 - w;
          f[o + 1] *= 1 - w;
          continue;
        }
        let vx = 0;
        let vy = 0;
        // vector from the stroke to this cell (width units)
        const rx = x - n.px;
        const ry = (y - n.py) / aspect;
        const rl = Math.hypot(rx, ry) || 1;
        if (s.tool === 'push') ((vx = n.tx), (vy = n.ty));
        else if (s.tool === 'swirl' || s.tool === 'unswirl') {
          const sgn = s.tool === 'swirl' ? 1 : -1;
          vx = (-ry / rl) * sgn;
          vy = (rx / rl) * sgn;
        } else if (s.tool === 'pinch') ((vx = -rx / rl), (vy = -ry / rl));
        else ((vx = rx / rl), (vy = ry / rl));
        f[o] += vx * s.strength * w;
        f[o + 1] += vy * s.strength * w;
      }
  }
  return f;
}

/** Largest flow the texture encoding holds (share of the width per frame). */
export const FIELD_MAX = 0.04;

/** The field as RGBA bytes for a texture (R, G = x, y around 128). */
export function encodeField(f: Float32Array, gw: number, gh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gw * gh * 4);
  for (let k = 0; k < gw * gh; k++) {
    out[k * 4] = 128 + (f[k * 2] / FIELD_MAX) * 127;
    out[k * 4 + 1] = 128 + (f[k * 2 + 1] / FIELD_MAX) * 127;
    out[k * 4 + 2] = 128;
    out[k * 4 + 3] = 255;
  }
  return out;
}
