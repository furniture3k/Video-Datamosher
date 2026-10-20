// Planar tracking (pure: frames in, quads out): follow a flat surface through a clip as a
// homography, so titles, shapes and pictures can be pinned to a screen, a wall or a sign.
import { blur3, half, type Gray } from './track';

export type Pt = [number, number];
/** A 3×3 matrix, row by row. */
export type Mat3 = number[];
/** A four-cornered surface: x0,y0 … x3,y3, clockwise from the top left. */
export type Quad = number[];
/** A stored position of a tracked surface: [source seconds, x0,y0 … x3,y3] (0..1 of the clip's picture). */
export type PlaneKey = number[];
/** One tracked frame: its index, where the corners are (pixels of the analysis frames) and how sure it is (0..1). */
export interface PlaneFrame {
  f: number;
  q: Quad;
  conf: number;
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

export function inv3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [A * k, (c * h - b * i) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, (c * d - a * f) * k, C * k, (b * g - a * h) * k, (a * e - b * d) * k];
}

/** A point through a homography. NaN where the point goes to infinity. */
export function applyH(H: Mat3, x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-12) return [NaN, NaN];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Hartley normalisation: centre the points on zero, mean distance √2. */
function normalise(p: Pt[]): { T: Mat3; q: Pt[] } {
  let mx = 0;
  let my = 0;
  for (const [x, y] of p) ((mx += x), (my += y));
  mx /= p.length;
  my /= p.length;
  let d = 0;
  for (const [x, y] of p) d += Math.hypot(x - mx, y - my);
  d /= p.length;
  const s = d > 1e-9 ? Math.SQRT2 / d : 1;
  return { T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1], q: p.map(([x, y]) => [(x - mx) * s, (y - my) * s] as Pt) };
}

/** Solve A·x = b by Gaussian elimination with pivoting (A is square, rows of numbers). Null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    if (p !== c) ([A[p], A[c]] = [A[c], A[p]]), ([b[p], b[c]] = [b[c], b[p]]);
    for (let r = c + 1; r < n; r++) {
      const k = A[r][c] / A[c][c];
      if (k === 0) continue;
      for (let j = c; j < n; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  const x = new Array<number>(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let j = r + 1; j < n; j++) s -= A[r][j] * x[j];
    x[r] = s / A[r][r];
  }
  return x;
}

/**
 * The homography taking `src` points to `dst` (four or more pairs): the normalised direct linear
 * transform, solved in the least-squares sense. Null if the points are degenerate.
 */
export function homographyLS(src: Pt[], dst: Pt[]): Mat3 | null {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const S = normalise(src.slice(0, n));
  const D = normalise(dst.slice(0, n));
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  const add = (row: number[], v: number) => {
    for (let i = 0; i < 8; i++) {
      if (row[i] === 0) continue;
      Atb[i] += row[i] * v;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < n; k++) {
    const [x, y] = S.q[k];
    const [u, v] = D.q[k];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Dinv = inv3(D.T);
  if (!Dinv) return null;
  const H = mul3(mul3(Dinv, [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]), S.T);
  const k = Math.abs(H[8]) > 1e-12 ? 1 / H[8] : 1;
  const out = H.map((v) => v * k);
  return out.every(Number.isFinite) ? out : null;
}

const corners4 = (q: Quad): Pt[] => [
  [q[0], q[1]],
  [q[2], q[3]],
  [q[4], q[5]],
  [q[6], q[7]],
];

/** The homography taking the corners of one quad to the corners of another. */
export function quadHomography(from: Quad, to: Quad): Mat3 | null {
  return homographyLS(corners4(from), corners4(to));
}

/** A quad through a homography. */
export function mapQuad(H: Mat3, q: Quad): Quad {
  return corners4(q).flatMap(([x, y]) => applyH(H, x, y));
}

/** The unit square as a quad, for turning a picture's own coordinates (0..1) into a surface. */
export const UNIT_QUAD: Quad = [0, 0, 1, 0, 1, 1, 0, 1];

/** Whether a quad is convex, upright-wound (either way) and not collapsed: the shape a real surface keeps. */
export function quadOk(q: Quad): boolean {
  if (!q.every(Number.isFinite)) return false;
  let sign = 0;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const k = (i + 2) % 4;
    const cr = (q[j * 2] - q[i * 2]) * (q[k * 2 + 1] - q[j * 2 + 1]) - (q[j * 2 + 1] - q[i * 2 + 1]) * (q[k * 2] - q[j * 2]);
    if (Math.abs(cr) < 1e-9) return false;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
    area += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
  }
  return Math.abs(area) > 1e-9;
}

/**
 * Fewer keys that say the same thing: drops every key that straight lines between its neighbours
 * would put within `tol` of where it is (in every number, Ramer–Douglas–Peucker).
 */
export function simplifyKeys(keys: number[][], tol: number): number[][] {
  if (keys.length <= 2) return keys.map((k) => k.slice());
  const [a, b] = [keys[0], keys[keys.length - 1]];
  let idx = -1;
  let dmax = 0;
  for (let i = 1; i < keys.length - 1; i++) {
    const k = (keys[i][0] - a[0]) / Math.max(1e-9, b[0] - a[0]);
    let d = 0;
    for (let j = 1; j < a.length; j++) d = Math.max(d, Math.abs(keys[i][j] - (a[j] + (b[j] - a[j]) * k)));
    if (d > dmax) ((dmax = d), (idx = i));
  }
  if (dmax <= tol) return [a.slice(), b.slice()];
  return [...simplifyKeys(keys.slice(0, idx + 1), tol).slice(0, -1), ...simplifyKeys(keys.slice(idx), tol)];
}

/** The corners at `t` seconds: linear between stored positions, held at the ends. */
export function quadAt(keys: PlaneKey[], t: number): Quad | null {
  if (!keys.length) return null;
  if (t <= keys[0][0]) return keys[0].slice(1);
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last.slice(1);
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const k = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * k);
}

// ---------------------------------------------------------------------------------------------
// Robust fitting

/** A small seeded generator, so a track gives the same answer every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const err = (H: Mat3, s: Pt, d: Pt) => {
  const [x, y] = applyH(H, s[0], s[1]);
  return Math.hypot(x - d[0], y - d[1]);
};

/** Three of these points in a line (or nearly) make a poor sample for a homography. */
function spread(p: Pt[], idx: number[]): boolean {
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 4; b++)
      for (let c = b + 1; c < 4; c++) {
        const [pa, pb, pc] = [p[idx[a]], p[idx[b]], p[idx[c]]];
        const cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * Math.hypot(pc[0] - pa[0], pc[1] - pa[1]);
        if (l < 1e-9 || Math.abs(cr) / l < 0.08) return false;
      }
  return true;
}

/**
 * The homography that most of the pairs agree on: RANSAC over four-point samples (and the
 * previous frame's answer, if given), then a least-squares fit to the points that agree.
 */
export function ransacH(src: Pt[], dst: Pt[], thresh = 1.5, prior: Mat3 | null = null, iters = 160, seed = 1): { H: Mat3; inliers: number[] } | null {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const rand = rng(seed);
  const count = (H: Mat3) => {
    let c = 0;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const d = err(H, src[i], dst[i]);
      if (d < thresh) ((c += 1), (e += d));
    }
    return { c, e };
  };
  let best: Mat3 | null = null;
  let bc = -1;
  let be = Infinity;
  const consider = (H: Mat3 | null) => {
    if (!H) return;
    const { c, e } = count(H);
    if (c > bc || (c === bc && e < be)) ((best = H), (bc = c), (be = e));
  };
  consider(prior);
  for (let it = 0; it < iters; it++) {
    if (bc >= Math.max(8, n * 0.9)) break;
    const idx: number[] = [];
    let guard = 0;
    while (idx.length < 4 && guard++ < 40) {
      const k = Math.floor(rand() * n);
      if (!idx.includes(k)) idx.push(k);
    }
    if (idx.length < 4 || !spread(src, idx) || !spread(dst, idx)) continue;
    consider(homographyLS(idx.map((i) => src[i]), idx.map((i) => dst[i])));
  }
  if (!best || bc < 4) return null;
  // refine on everything that agrees, twice (the set grows as the fit improves)
  let H: Mat3 = best;
  let inliers: number[] = [];
  for (let r = 0; r < 3; r++) {
    inliers = [];
    for (let i = 0; i < n; i++) if (err(H, src[i], dst[i]) < thresh) inliers.push(i);
    if (inliers.length < 4) return null;
    const fit = homographyLS(inliers.map((i) => src[i]), inliers.map((i) => dst[i]));
    if (!fit) break;
    H = fit;
  }
  inliers = [];
  for (let i = 0; i < n; i++) if (err(H, src[i], dst[i]) < thresh) inliers.push(i);
  return inliers.length >= 4 ? { H, inliers } : null;
}

// ---------------------------------------------------------------------------------------------
// Corners and flow

function inPoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Shi-Tomasi corners (the points a window can be followed from) inside a polygon: the best
 * minimum eigenvalue of the local gradient matrix, no two closer than `minDist`.
 */
export function corners(f: Uint8Array, w: number, h: number, poly: Pt[], max = 150, minDist = 5, margin = 8, win = 3, quality = 0.02): Pt[] {
  const W = w + 1;
  const sxx = new Float64Array(W * (h + 1));
  const sxy = new Float64Array(W * (h + 1));
  const syy = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rx = 0;
    let rxy = 0;
    let ry = 0;
    for (let x = 0; x < w; x++) {
      const ix = x > 0 && x < w - 1 ? (f[y * w + x + 1] - f[y * w + x - 1]) / 2 : 0;
      const iy = y > 0 && y < h - 1 ? (f[(y + 1) * w + x] - f[(y - 1) * w + x]) / 2 : 0;
      rx += ix * ix;
      rxy += ix * iy;
      ry += iy * iy;
      const o = (y + 1) * W + x + 1;
      sxx[o] = sxx[o - W] + rx;
      sxy[o] = sxy[o - W] + rxy;
      syy[o] = syy[o - W] + ry;
    }
  }
  const box = (s: Float64Array, x: number, y: number) => s[(y + win + 1) * W + x + win + 1] - s[(y - win) * W + x + win + 1] - s[(y + win + 1) * W + x - win] + s[(y - win) * W + x - win];
  const score = new Float32Array(w * h);
  let top = 0;
  for (let y = margin; y < h - margin; y++)
    for (let x = margin; x < w - margin; x++) {
      if (!inPoly(poly, x, y)) continue;
      const a = box(sxx, x, y);
      const b = box(sxy, x, y);
      const c = box(syy, x, y);
      const l = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
      score[y * w + x] = l;
      if (l > top) top = l;
    }
  if (top <= 0) return [];
  const cand: [number, number, number][] = [];
  for (let y = margin; y < h - margin; y++)
    for (let x = margin; x < w - margin; x++) {
      const s = score[y * w + x];
      if (s < top * quality) continue;
      // a local maximum of its 3×3 neighbourhood
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && score[(y + dy) * w + x + dx] > s) ok = false;
      if (ok) cand.push([s, x, y]);
    }
  cand.sort((p, q) => q[0] - p[0]);
  const out: Pt[] = [];
  const d2 = minDist * minDist;
  for (const [, x, y] of cand) {
    if (out.length >= max) break;
    if (out.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 >= d2)) out.push([x, y]);
  }
  return out;
}

/** A frame at several sizes (finest first), the finest lightly blurred so fine texture has some reach. */
export interface Pyr {
  w: number;
  h: number;
  f: Uint8Array;
}
export function pyramid(f: Uint8Array, w: number, h: number, levels = 3): Pyr[] {
  const out: Pyr[] = [{ w, h, f: blur3(f, w, h) }];
  for (let l = 1; l < levels; l++) {
    const p = out[l - 1];
    if (p.w < 32 || p.h < 32) break;
    out.push({ w: p.w >> 1, h: p.h >> 1, f: half(p.f, p.w, p.h) });
  }
  return out;
}

function bilinear(P: Pyr, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = Math.max(0, Math.min(P.w - 1, x0));
  const cx1 = Math.max(0, Math.min(P.w - 1, x0 + 1));
  const cy0 = Math.max(0, Math.min(P.h - 1, y0));
  const cy1 = Math.max(0, Math.min(P.h - 1, y0 + 1));
  const f = P.f;
  const a = f[cy0 * P.w + cx0] * (1 - fx) + f[cy0 * P.w + cx1] * fx;
  const b = f[cy1 * P.w + cx0] * (1 - fx) + f[cy1 * P.w + cx1] * fx;
  return a * (1 - fy) + b * fy;
}

/** Grey-level difference past which a pixel of a window counts for less. */
const HUBER = 16;

/**
 * Pyramidal Lucas-Kanade for one point: where the window round `p` in frame A has gone in frame
 * B, starting the search at `guess`. Returns the new position and the mean grey-level difference
 * of the matched windows (small = a good match), or null if the point can't be followed.
 */
export function lkTrack(A: Pyr[], B: Pyr[], p: Pt, guess: Pt, win = 5, iters = 12): { pos: Pt; err: number } | null {
  const L = Math.min(A.length, B.length);
  const n = (2 * win + 1) ** 2;
  const patch = new Float32Array(n);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  let dx = (guess[0] - p[0]) / 2 ** (L - 1);
  let dy = (guess[1] - p[1]) / 2 ** (L - 1);
  for (let l = L - 1; l >= 0; l--) {
    const s = 2 ** l;
    const ax = p[0] / s;
    const ay = p[1] / s;
    const PA = A[l];
    const PB = B[l];
    if (ax < win + 1 || ay < win + 1 || ax >= PA.w - win - 2 || ay >= PA.h - win - 2) {
      if (l === 0) return null;
      dx *= 2;
      dy *= 2;
      continue;
    }
    let gxx = 0;
    let gxy = 0;
    let gyy = 0;
    let k = 0;
    let mean = 0;
    for (let j = -win; j <= win; j++)
      for (let i = -win; i <= win; i++, k++) {
        const x = ax + i;
        const y = ay + j;
        patch[k] = bilinear(PA, x, y);
        gx[k] = (bilinear(PA, x + 1, y) - bilinear(PA, x - 1, y)) / 2;
        gy[k] = (bilinear(PA, x, y + 1) - bilinear(PA, x, y - 1)) / 2;
        gxx += gx[k] * gx[k];
        gxy += gx[k] * gy[k];
        gyy += gy[k] * gy[k];
        mean += patch[k];
      }
    mean /= n;
    const det = gxx * gyy - gxy * gxy;
    // a window with no corner in it can't be followed
    if (det < 1e-6 * n * n || (gxx + gyy) / 2 - Math.sqrt(((gxx - gyy) / 2) ** 2 + gxy * gxy) < 0.5 * n * 0.02) {
      if (l === 0) return null;
      dx *= 2;
      dy *= 2;
      continue;
    }
    for (let it = 0; it < iters; it++) {
      const bx0 = ax + dx - win;
      const by0 = ay + dy - win;
      if (bx0 < -win || by0 < -win || bx0 > PB.w || by0 > PB.h) return null;
      let mb = 0;
      k = 0;
      for (let j = -win; j <= win; j++) for (let i = -win; i <= win; i++, k++) mb += bilinear(PB, ax + dx + i, ay + dy + j);
      mb /= n;
      // Pixels that differ a lot (something in front of part of the window) count for less, so a
      // half-covered window still follows the half that is showing.
      let hxx = 0;
      let hxy = 0;
      let hyy = 0;
      let bx = 0;
      let by = 0;
      k = 0;
      for (let j = -win; j <= win; j++)
        for (let i = -win; i <= win; i++, k++) {
          // the windows' own brightness is taken out, so a slow fade or a flash doesn't push the match
          const e = patch[k] - mean - (bilinear(PB, ax + dx + i, ay + dy + j) - mb);
          const wt = Math.abs(e) <= HUBER ? 1 : HUBER / Math.abs(e);
          hxx += wt * gx[k] * gx[k];
          hxy += wt * gx[k] * gy[k];
          hyy += wt * gy[k] * gy[k];
          bx += wt * gx[k] * e;
          by += wt * gy[k] * e;
        }
      const hd = hxx * hyy - hxy * hxy;
      if (hd < 1e-6) break;
      const ux = (hyy * bx - hxy * by) / hd;
      const uy = (hxx * by - hxy * bx) / hd;
      dx += ux;
      dy += uy;
      if (Math.abs(ux) < 0.01 && Math.abs(uy) < 0.01) break;
    }
    if (l > 0) {
      dx *= 2;
      dy *= 2;
    }
  }
  const px = p[0] + dx;
  const py = p[1] + dy;
  const B0 = B[0];
  if (px < win + 1 || py < win + 1 || px >= B0.w - win - 2 || py >= B0.h - win - 2) return null;
  let mb = 0;
  let ma = 0;
  const A0 = A[0];
  for (let j = -win; j <= win; j++)
    for (let i = -win; i <= win; i++) {
      mb += bilinear(B0, px + i, py + j);
      ma += bilinear(A0, p[0] + i, p[1] + j);
    }
  mb /= n;
  ma /= n;
  let sad = 0;
  for (let j = -win; j <= win; j++) for (let i = -win; i <= win; i++) sad += Math.abs(bilinear(A0, p[0] + i, p[1] + j) - ma - (bilinear(B0, px + i, py + j) - mb));
  return { pos: [px, py], err: sad / n };
}

/** The frame as the surface sees it: pixel (x, y) of the result is the frame at H·(x, y). */
export function warpBack(f: Uint8Array, w: number, h: number, H: Mat3): Uint8Array {
  const P: Pyr = { w, h, f };
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [u, v] = applyH(H, x, y);
      out[y * w + x] = u >= 0 && v >= 0 && u <= w - 1 && v <= h - 1 ? Math.round(bilinear(P, u, v)) : 128;
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The tracker

export interface PlaneOptions {
  /** most corners to follow */
  features?: number;
  /** look all the way back at the first frame every this many frames (so it doesn't drift) */
  rematch?: number;
  /** how far (pixels) a corner may be from the surface's motion and still count */
  thresh?: number;
  /** a window is thrown out when its grey levels differ from the match by more than this */
  maxErr?: number;
  /** frames to carry on through when the surface is hidden, before giving up */
  maxMiss?: number;
  /** share of the corners that must agree on the surface's motion before a frame is believed */
  minShare?: number;
}

/**
 * Follow a flat surface from frame `start`, forwards (dir 1) or backwards (-1), until the end or
 * until it's lost. Corners are picked inside the quad on the first frame, followed frame to
 * frame (pyramidal Lucas-Kanade), and the surface's homography is the one most of them agree
 * on (RANSAC, then least squares). Every `rematch` frames every corner is looked for again in
 * the first frame's view of the surface, which stops drift and brings back corners that were
 * hidden for a while. It carries on through up to `maxMiss` frames where the surface is hidden
 * (those frames are left out) and picks it up again.
 */
export function trackPlane(g: Gray, start: number, quad: Quad, dir: 1 | -1 = 1, opts: PlaneOptions = {}): PlaneFrame[] {
  const { features = 150, rematch = 1, thresh = 1.5, maxErr = 14, maxMiss = 8, minShare = 0.2 } = opts;
  const { w, h, frames } = g;
  if (start < 0 || start >= frames.length) return [];
  const refPyr = pyramid(frames[start], w, h, 3);
  const ref = corners(refPyr[0].f, w, h, corners4(quad), features);
  if (ref.length < 8) return [];
  // too few agreeing corners is a coincidence, not a surface
  const enough = (inl: number, offered: number) => inl >= Math.max(8, minShare * ref.length) && inl >= offered * 0.5;
  const out: PlaneFrame[] = [{ f: start, q: quad.slice(), conf: 1 }];
  let H: Mat3 = IDENTITY;
  let cur: Pt[] = ref.map((p) => [p[0], p[1]]);
  let alive = ref.map(() => true);
  let prevPyr = refPyr;
  let miss = 0;
  let sinceMatch = 0;
  for (let t = start + dir; t >= 0 && t < frames.length; t += dir) {
    const curPyr = pyramid(frames[t], w, h, 3);
    sinceMatch++;
    // frame to frame: each corner that's still being followed
    const src: Pt[] = [];
    const dst: Pt[] = [];
    const who: number[] = [];
    for (let i = 0; i < ref.length; i++) {
      if (!alive[i]) continue;
      const guess = applyH(H, ref[i][0], ref[i][1]);
      const r = lkTrack(prevPyr, curPyr, cur[i], guess[0] === guess[0] ? guess : cur[i]);
      if (r && r.err <= maxErr) (src.push(ref[i]), dst.push(r.pos), who.push(i));
    }
    let fit = src.length >= 6 ? ransacH(src, dst, thresh, H, 160, t + 1) : null;
    let ok = !!fit && enough(fit.inliers.length, src.length) && quadOk(mapQuad(fit.H, quad));
    if (ok && fit) {
      H = fit.H;
      alive = alive.map(() => false);
      for (const k of fit.inliers) {
        alive[who[k]] = true;
        cur[who[k]] = dst[k];
      }
    }
    // look at the first frame's view of the surface again (also when too few corners are left)
    const alives = alive.filter(Boolean).length;
    if (sinceMatch >= rematch || !ok || alives < ref.length * 0.5) {
      const back = warpBack(frames[t], w, h, H);
      const backPyr = pyramid(back, w, h, 3);
      const s2: Pt[] = [];
      const d2: Pt[] = [];
      const w2: number[] = [];
      for (let i = 0; i < ref.length; i++) {
        const r = lkTrack(refPyr, backPyr, ref[i], ref[i], 5, 14);
        if (r && r.err <= maxErr && Math.hypot(r.pos[0] - ref[i][0], r.pos[1] - ref[i][1]) < 8) (s2.push(ref[i]), d2.push(applyH(H, r.pos[0], r.pos[1])), w2.push(i));
      }
      const f2 = s2.length >= 6 ? ransacH(s2, d2, thresh, H, 160, t + 7) : null;
      if (f2 && enough(f2.inliers.length, s2.length) && quadOk(mapQuad(f2.H, quad))) {
        H = f2.H;
        alive = alive.map(() => false);
        for (const k of f2.inliers) {
          alive[w2[k]] = true;
          cur[w2[k]] = d2[k];
        }
        fit = f2;
        ok = true;
        sinceMatch = 0;
      }
    }
    if (!ok) {
      if (++miss > maxMiss) break;
      prevPyr = curPyr;
      // the corners moved with the surface while it was hidden; carry them with the last motion
      cur = ref.map((p) => (applyH(H, p[0], p[1]) as Pt));
      continue;
    }
    miss = 0;
    prevPyr = curPyr;
    out.push({ f: t, q: mapQuad(H, quad), conf: Math.min(1, alive.filter(Boolean).length / ref.length) });
  }
  return out;
}

/** Track both ways from frame `start`: the whole run, in frame order, the first frame once. */
export function trackPlaneBoth(g: Gray, start: number, quad: Quad, opts: PlaneOptions = {}): PlaneFrame[] {
  const fwd = trackPlane(g, start, quad, 1, opts);
  const back = trackPlane(g, start, quad, -1, opts).slice(1).reverse();
  return [...back, ...fwd];
}
