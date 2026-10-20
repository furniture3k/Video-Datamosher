// Warping a picture through a homography with a grid of triangles, each drawn with a plain affine
// transform (what a 2D canvas can do). Pure maths: the page does the drawing.
import { applyH, mul3, type Mat3, type Pt } from './planar';

export type Tri = [Pt, Pt, Pt];

/** A cell of the source grid and where it lands. */
export interface WarpTri {
  src: Tri;
  dst: Tri;
}

/**
 * The triangles that carry the source rectangle (x0,y0)–(x1,y1) through `H`: a grid of
 * `nx` × `ny` cells, two triangles each. Cells that land on a point at infinity are left out.
 */
export function warpTriangles(H: Mat3, x0: number, y0: number, x1: number, y1: number, nx = 12, ny = 12): WarpTri[] {
  const out: WarpTri[] = [];
  const grid: Pt[][] = [];
  for (let j = 0; j <= ny; j++) {
    const row: Pt[] = [];
    for (let i = 0; i <= nx; i++) row.push(applyH(H, x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny));
    grid.push(row);
  }
  const ok = (p: Pt) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const s = (a: number, b: number): Pt => [x0 + ((x1 - x0) * a) / nx, y0 + ((y1 - y0) * b) / ny];
      const [d00, d10, d01, d11] = [grid[j][i], grid[j][i + 1], grid[j + 1][i], grid[j + 1][i + 1]];
      if (![d00, d10, d01, d11].every(ok)) continue;
      out.push({ src: [s(i, j), s(i + 1, j), s(i, j + 1)], dst: [d00, d10, d01] });
      out.push({ src: [s(i + 1, j), s(i + 1, j + 1), s(i, j + 1)], dst: [d10, d11, d01] });
    }
  return out;
}

/** The canvas transform [a, b, c, d, e, f] (x′ = ax + cy + e, y′ = bx + dy + f) taking one triangle onto another; null if the source is flat. */
export function affineBetween(s: Tri, d: Tri): [number, number, number, number, number, number] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(det) < 1e-12) return null;
  const solve = (v0: number, v1: number, v2: number): [number, number, number] => [
    (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / det,
    (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / det,
    (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / det,
  ];
  const [a, c, e] = solve(d[0][0], d[1][0], d[2][0]);
  const [b, dd, f] = solve(d[0][1], d[1][1], d[2][1]);
  return [a, b, c, dd, e, f];
}

/** A triangle pushed out from its middle by `px` pixels, so neighbours overlap and no seam shows between them. */
export function growTri(t: Tri, px: number): Tri {
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
  const cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
  return t.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / d) * px, y + ((y - cy) / d) * px] as Pt;
  }) as Tri;
}

/**
 * The homography of leaning a flat picture back (`ax` degrees about the horizontal axis through
 * (cx, cy): the top goes away for positive) and to the side (`ay` about the vertical axis: the
 * right edge goes away for positive), seen from a camera `f` pixels in front of it.
 */
export function tiltMatrix(ax: number, ay: number, cx: number, cy: number, f: number): Mat3 {
  const a = (ax * Math.PI) / 180;
  const b = (ay * Math.PI) / 180;
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  // a point (x, y, 0) leans back about x (the top, where y is negative, goes away), then about y
  // (the right goes away); z is the distance behind the picture's plane, and it is seen from f in front
  //   x2 = x·cb + y·sa·sb,  y2 = y·ca,  z2 = x·sb − y·sa·cb,  and lands at f·(x2, y2) / (f + z2)
  const M: Mat3 = [f * cb, f * sa * sb, 0, 0, f * ca, 0, sb, -sa * cb, f];
  // about (cx, cy): move it to the origin, tilt, move it back
  return mul3(mul3([1, 0, cx, 0, 1, cy, 0, 0, 1], M), [1, 0, -cx, 0, 1, -cy, 0, 0, 1]);
}
