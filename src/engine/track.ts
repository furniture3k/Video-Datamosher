// Object tracking and stabilization on small grayscale frames (pure: frames in, paths out).

export interface Gray {
  w: number;
  h: number;
  frames: Uint8Array[];
}

/** A tracked path: [frame index, centre x, centre y (pixels of the analysis frames), confidence 0..1]. */
export type TrackPoint = [number, number, number, number];

/** 3×3 box blur (separable): gives fine texture some spatial spread so the coarse search can find it. */
export function blur3(f: Uint8Array, w: number, h: number): Uint8Array {
  const tmp = new Uint16Array(f.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    if (w === 1) {
      tmp[r] = f[r] * 3;
      continue;
    }
    tmp[r] = ((f[r] + f[r + 1]) * 3) >> 1;
    for (let x = 1; x < w - 1; x++) tmp[r + x] = f[r + x - 1] + f[r + x] + f[r + x + 1];
    tmp[r + w - 1] = ((f[r + w - 2] + f[r + w - 1]) * 3) >> 1;
  }
  const out = new Uint8Array(f.length);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    const r = y * w;
    for (let x = 0; x < w; x++) out[r + x] = (tmp[up + x] + tmp[r + x] + tmp[dn + x]) / 9;
  }
  return out;
}

/** Half size (2×2 average). */
export function half(f: Uint8Array, w: number, h: number): Uint8Array {
  const hw = w >> 1;
  const hh = h >> 1;
  const out = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * hw + x] = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) >> 2;
    }
  return out;
}

/** A frame ready for matching: its pixels plus integral images of the values and their squares. */
export interface Level {
  f: Uint8Array;
  w: number;
  h: number;
  s: Float64Array;
  q: Float64Array;
}

export function level(f: Uint8Array, w: number, h: number): Level {
  const W = w + 1;
  const s = new Float64Array(W * (h + 1));
  const q = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < w; x++) {
      const v = f[y * w + x];
      rs += v;
      rq += v * v;
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + rs;
      q[(y + 1) * W + x + 1] = q[y * W + x + 1] + rq;
    }
  }
  return { f, w, h, s, q };
}

/** A zero-mean template (its values minus their mean) and its energy. */
interface Tpl {
  z: Float32Array;
  w: number;
  h: number;
  norm: number;
}

function zeroMean(t: Float32Array, w: number, h: number): Tpl {
  let m = 0;
  for (let i = 0; i < t.length; i++) m += t[i];
  m /= t.length;
  const z = new Float32Array(t.length);
  let norm = 0;
  for (let i = 0; i < t.length; i++) ((z[i] = t[i] - m), (norm += z[i] * z[i]));
  return { z, w, h, norm };
}

/** Zero-mean normalised cross-correlation of the template against the frame at top-left (x, y). */
function ncc(L: Level, x: number, y: number, t: Tpl): number {
  if (t.norm <= 0) return 0;
  const W = L.w + 1;
  const a = y * W + x;
  const b = (y + t.h) * W + x;
  const n = t.w * t.h;
  const sum = L.s[b + t.w] - L.s[b] - L.s[a + t.w] + L.s[a];
  const den = L.q[b + t.w] - L.q[b] - L.q[a + t.w] + L.q[a] - (sum * sum) / n;
  if (den <= 1e-6) return 0;
  // the template has zero mean, so the frame's own mean drops out of the numerator
  let num = 0;
  const f = L.f;
  for (let j = 0; j < t.h; j++) {
    const r = (y + j) * L.w + x;
    const tr = j * t.w;
    for (let i = 0; i < t.w; i++) num += f[r + i] * t.z[tr + i];
  }
  return num / Math.sqrt(den * t.norm);
}

/** Offset of a parabola's peak through three scores (−0.5..0.5). */
function peak(l: number, c: number, r: number): number {
  const d = l - 2 * c + r;
  return d < 0 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))) : 0;
}

/**
 * Follow the box (centre cx, cy; size bw × bh) from frame `start`, forwards (dir 1) or
 * backwards (-1), until the end or until it's lost. Coarse-to-fine template matching (a half-size
 * search, then every pixel, then sub-pixel) with a slowly updated template, so it copes with
 * gradual changes in look. It coasts through up to `maxMiss` frames where the object is hidden
 * or blurred and picks it up again (those frames are left out of the path).
 */
export function trackBox(g: Gray, start: number, cx: number, cy: number, bw: number, bh: number, dir: 1 | -1 = 1, minConfidence = 0.45, maxMiss = 8): TrackPoint[] {
  const tw = Math.max(6, Math.min(g.w - 2, Math.round(bw)));
  const th = Math.max(6, Math.min(g.h - 2, Math.round(bh)));
  const clampX = (x: number) => Math.max(0, Math.min(g.w - tw, Math.round(x)));
  const clampY = (y: number) => Math.max(0, Math.min(g.h - th, Math.round(y)));
  // the half-size search needs a template and a frame of some size: small boxes search at full size
  const pyramid = tw >= 12 && th >= 12 && g.w >= 24 && g.h >= 24;
  const tw1 = tw >> 1;
  const th1 = th >> 1;
  const prep = (k: number) => {
    const f = blur3(g.frames[k], g.w, g.h);
    return { L0: level(f, g.w, g.h), L1: pyramid ? level(half(f, g.w, g.h), g.w >> 1, g.h >> 1) : null };
  };
  let x = clampX(cx - tw / 2);
  let y = clampY(cy - th / 2);
  const tpl = new Float32Array(tw * th);
  const grab = (f: Uint8Array, ox: number, oy: number) => {
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) tpl[j * tw + i] = f[(oy + j) * g.w + ox + i];
  };
  grab(prep(start).L0.f, x, y);
  const orig = tpl.slice();
  const out: TrackPoint[] = [[start, x + tw / 2, y + th / 2, 1]];
  let vx = 0;
  let vy = 0;
  let miss = 0;
  // the search follows the predicted motion, so it only needs to cover changes in speed
  const R0 = Math.max(6, Math.min(24, Math.round(Math.max(tw, th) * 0.45)));
  for (let k = start + dir; k >= 0 && k < g.frames.length; k += dir) {
    const { L0, L1 } = prep(k);
    // predict with the last motion, then search around it (wider while the object is lost)
    const R = miss ? R0 * 2 : R0;
    const px = clampX(x + vx);
    const py = clampY(y + vy);
    const T0 = zeroMean(tpl, tw, th);
    let bx = px;
    let by = py;
    if (L1) {
      // half size: every position within the search radius
      const t1 = new Float32Array(tw1 * th1);
      for (let j = 0; j < th1; j++) for (let i = 0; i < tw1; i++) t1[j * tw1 + i] = (tpl[2 * j * tw + 2 * i] + tpl[2 * j * tw + 2 * i + 1] + tpl[(2 * j + 1) * tw + 2 * i] + tpl[(2 * j + 1) * tw + 2 * i + 1]) / 4;
      const T1 = zeroMean(t1, tw1, th1);
      const mx = L1.w - tw1;
      const my = L1.h - th1;
      const r = Math.ceil(R / 2);
      const x0 = Math.max(0, (px >> 1) - r);
      const x1 = Math.min(mx, (px >> 1) + r);
      const y0 = Math.max(0, (py >> 1) - r);
      const y1 = Math.min(my, (py >> 1) + r);
      let best = -2;
      for (let sy = y0; sy <= y1; sy++)
        for (let sx = x0; sx <= x1; sx++) {
          const s = ncc(L1, sx, sy, T1);
          if (s > best) ((best = s), (bx = sx * 2), (by = sy * 2));
        }
    } else {
      let best = -2;
      for (let dy = -R; dy <= R; dy += 2)
        for (let dx = -R; dx <= R; dx += 2) {
          const sx = clampX(px + dx);
          const sy = clampY(py + dy);
          const s = ncc(L0, sx, sy, T0);
          if (s > best) ((best = s), (bx = sx), (by = sy));
        }
    }
    // full size: climb to the best pixel near the coarse winner, then fit a parabola for sub-pixel
    const memo = new Map<number, number>();
    const score = (sx: number, sy: number) => {
      if (sx < 0 || sy < 0 || sx > g.w - tw || sy > g.h - th) return -2;
      const key = sy * g.w + sx;
      let s = memo.get(key);
      if (s === undefined) memo.set(key, (s = ncc(L0, sx, sy, T0)));
      return s;
    };
    let best = score(bx, by);
    for (let it = 0; it < 6; it++) {
      let nx = bx;
      let ny = by;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const s = score(bx + dx, by + dy);
          if (s > best) ((best = s), (nx = bx + dx), (ny = by + dy));
        }
      if (nx === bx && ny === by) break;
      bx = nx;
      by = ny;
    }
    if (best < minConfidence + (miss ? 0.1 : 0)) {
      // lost for now: carry on along the last motion, slowing down
      if (++miss > maxMiss) break;
      x = px;
      y = py;
      vx *= 0.8;
      vy *= 0.8;
      continue;
    }
    const ox = bx > 0 && bx < g.w - tw ? peak(score(bx - 1, by), best, score(bx + 1, by)) : 0;
    const oy = by > 0 && by < g.h - th ? peak(score(bx, by - 1), best, score(bx, by + 1)) : 0;
    // (while it was lost, x and y moved on with the prediction)
    vx = (bx - x) * 0.7 + vx * 0.3;
    vy = (by - y) * 0.7 + vy * 0.3;
    x = bx;
    y = by;
    miss = 0;
    // let the template follow slow changes, but only when the match is good, and keep a little
    // of the first look in it so it can't drift off onto the background
    if (best > 0.8) for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const q = j * tw + i;
      tpl[q] = tpl[q] * 0.9 + L0.f[(y + j) * g.w + x + i] * 0.08 + orig[q] * 0.02;
    }
    out.push([k, x + ox + tw / 2, y + oy + th / 2, Math.max(0, best)]);
  }
  return dir > 0 ? out : out.reverse();
}

// ---------- stabilization ----------

/** Sum of absolute differences of a block of `a` at (x, y) and `b` shifted by (dx, dy); stops past `limit`. */
function sad(a: Uint8Array, b: Uint8Array, w: number, x: number, y: number, dx: number, dy: number, size: number, limit: number): number {
  let s = 0;
  for (let j = 0; j < size && s <= limit; j++) {
    const ra = (y + j) * w + x;
    const rb = (y + j + dy) * w + x + dx;
    for (let i = 0; i < size; i++) s += Math.abs(a[ra + i] - b[rb + i]);
  }
  return s;
}

/**
 * Frame-to-frame camera motion: translation (px) and rotation (radians) from block matching,
 * searched on half-size frames first and then refined at full size.
 */
export function frameMotion(a: Uint8Array, b: Uint8Array, w: number, h: number, block = 16, range = 8, halves?: [Uint8Array, Uint8Array]): { dx: number; dy: number; da: number } {
  const vecs: { x: number; y: number; dx: number; dy: number }[] = [];
  const cols = Math.max(2, Math.floor((w - 2 * range) / (block * 1.5)));
  const rows = Math.max(2, Math.floor((h - 2 * range) / (block * 1.5)));
  const hw = w >> 1;
  const hh = h >> 1;
  const [a2, b2] = halves ?? [half(a, w, h), half(b, w, h)];
  const hb = block >> 1;
  const hr = Math.ceil(range / 2);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(range + (c + 0.5) * ((w - 2 * range) / cols) - block / 2);
      const y0 = Math.round(range + (r + 0.5) * ((h - 2 * range) / rows) - block / 2);
      // skip flat blocks: they match anywhere
      let mn = 255;
      let mx = 0;
      for (let j = 0; j < block; j += 2) for (let i = 0; i < block; i += 2) {
        const v = a[(y0 + j) * w + x0 + i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx - mn < 12) continue;
      // stop early only once a candidate can't win or tie (a partial sum must never pass as a tie)
      const better = (s: number, best: number, dx: number, dy: number, bdx: number, bdy: number) => s < best || (s === best && dx * dx + dy * dy < bdx * bdx + bdy * bdy);
      // half size: the whole range, keeping the best few (repeating patterns can fool one)
      const hx = x0 >> 1;
      const hy = y0 >> 1;
      const top: [number, number, number][] = [];
      for (let dy = -hr; dy <= hr; dy++)
        for (let dx = -hr; dx <= hr; dx++) {
          if (hx + dx < 0 || hy + dy < 0 || hx + dx + hb > hw || hy + dy + hb > hh) continue;
          const worst = top.length < 3 ? Infinity : top[2][0];
          const s = sad(a2, b2, hw, hx, hy, dx, dy, hb, worst);
          if (s > worst) continue;
          top.push([s, dx, dy]);
          top.sort((p, q) => p[0] - q[0] || p[1] * p[1] + p[2] * p[2] - q[1] * q[1] - q[2] * q[2]);
          if (top.length > 3) top.pop();
        }
      // full size: around each of them
      let best = Infinity;
      let bdx = 0;
      let bdy = 0;
      const seen = new Set<number>();
      for (const [, cdx, cdy] of top)
        for (let dy = cdy * 2 - 2; dy <= cdy * 2 + 2; dy++)
          for (let dx = cdx * 2 - 2; dx <= cdx * 2 + 2; dx++) {
            if (Math.abs(dx) > range || Math.abs(dy) > range || x0 + dx < 0 || y0 + dy < 0 || x0 + dx + block > w || y0 + dy + block > h) continue;
            const id = (dy + 64) * 128 + dx + 64;
            if (seen.has(id)) continue;
            seen.add(id);
            const s = sad(a, b, w, x0, y0, dx, dy, block, best);
            if (better(s, best, dx, dy, bdx, bdy)) ((best = s), (bdx = dx), (bdy = dy));
          }
      vecs.push({ x: x0 + block / 2 - w / 2, y: y0 + block / 2 - h / 2, dx: bdx, dy: bdy });
    }
  if (!vecs.length) return { dx: 0, dy: 0, da: 0 };
  const med = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  const dx = med(vecs.map((v) => v.dx));
  const dy = med(vecs.map((v) => v.dy));
  // rotation: what's left after the translation, around the centre (least squares)
  let num = 0;
  let den = 0;
  for (const v of vecs) {
    const rx = v.dx - dx;
    const ry = v.dy - dy;
    num += v.x * ry - v.y * rx;
    den += v.x * v.x + v.y * v.y;
  }
  return { dx, dy, da: den > 0 ? num / den : 0 };
}

export interface Stabilized {
  /** per frame: correction to apply (shift in px of the analysis frame, rotation in radians) */
  corr: { x: number; y: number; a: number }[];
  /** zoom that hides the borders the corrections uncover */
  zoom: number;
}

/**
 * Smooth the camera path: corrections move each frame from where the camera shook to where a
 * smooth (Gaussian, `radius` frames) camera would have been.
 */
export function stabilize(g: Gray, radius = 15, maxZoom = 1.3): Stabilized {
  const n = g.frames.length;
  const path = [{ x: 0, y: 0, a: 0 }];
  let prev = n ? half(g.frames[0], g.w, g.h) : new Uint8Array(0);
  for (let k = 1; k < n; k++) {
    const cur = half(g.frames[k], g.w, g.h);
    const m = frameMotion(g.frames[k - 1], g.frames[k], g.w, g.h, 16, 8, [prev, cur]);
    prev = cur;
    const p = path[k - 1];
    path.push({ x: p.x + m.dx, y: p.y + m.dy, a: p.a + m.da });
  }
  const sigma = Math.max(1, radius / 2);
  const smooth = path.map((_, i) => {
    let sx = 0;
    let sy = 0;
    let sa = 0;
    let wsum = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(n - 1, i + radius); k++) {
      const wgt = Math.exp(-((k - i) ** 2) / (2 * sigma * sigma));
      sx += path[k].x * wgt;
      sy += path[k].y * wgt;
      sa += path[k].a * wgt;
      wsum += wgt;
    }
    return { x: sx / wsum, y: sy / wsum, a: sa / wsum };
  });
  const corr = path.map((p, i) => ({ x: smooth[i].x - p.x, y: smooth[i].y - p.y, a: smooth[i].a - p.a }));
  // zoom enough to cover the biggest shift (and a bit for rotation)
  let need = 1;
  for (const c of corr) need = Math.max(need, 1 + (2 * Math.abs(c.x)) / g.w + Math.abs(c.a) * 0.6, 1 + (2 * Math.abs(c.y)) / g.h + Math.abs(c.a) * 0.6);
  return { corr, zoom: Math.min(maxZoom, need) };
}

// ---------- curve simplification ----------

/** Ramer–Douglas–Peucker on [t, v] points: keeps the shape within `tol`. */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  let idx = -1;
  let dmax = 0;
  const [t0, v0] = pts[0];
  const [t1, v1] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const [t, v] = pts[i];
    const lerp = t1 === t0 ? v0 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    const d = Math.abs(v - lerp);
    if (d > dmax) ((dmax = d), (idx = i));
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

/** Value of a straight-line path at t (held at the ends). */
export function linearAt(pts: [number, number][], t: number): number {
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, va] = pts[i];
    const [b, vb] = pts[i + 1];
    if (t <= b) return b > a ? va + ((vb - va) * (t - a)) / (b - a) : vb;
  }
  return pts[pts.length - 1][1];
}

/** FFmpeg expression for a straight-line path of time expression T. */
export function linearExpr(pts: [number, number][], T: string): string {
  const n6 = (x: number) => String(Math.round(x * 1e6) / 1e6);
  if (!pts.length) return '0';
  let e = n6(pts[pts.length - 1][1]);
  for (let i = pts.length - 2; i >= 0; i--) {
    const [a, va] = pts[i];
    const [b, vb] = pts[i + 1];
    e = `if(lt(${T},${n6(b)}),${n6(va)}+(${T}-${n6(a)})*${n6((vb - va) / Math.max(1e-9, b - a))},${e})`;
  }
  return `if(lt(${T},${n6(pts[0][0])}),${n6(pts[0][1])},${e})`;
}
