// Object tracking and stabilization on small grayscale frames (pure: frames in, paths out).

export interface Gray {
  w: number;
  h: number;
  frames: Uint8Array[];
}

/** A tracked path: [frame index, centre x, centre y (pixels of the analysis frames), confidence 0..1]. */
export type TrackPoint = [number, number, number, number];

/** Zero-mean normalised cross-correlation of the template against frame `f` at top-left (x, y). */
function ncc(f: Uint8Array, fw: number, x: number, y: number, tpl: Float32Array, tw: number, th: number, tMean: number, tNorm: number, step: number): number {
  let sum = 0;
  let n = 0;
  for (let j = 0; j < th; j += step) for (let i = 0; i < tw; i += step) ((sum += f[(y + j) * fw + x + i]), n++);
  const mean = sum / n;
  let num = 0;
  let den = 0;
  for (let j = 0; j < th; j += step)
    for (let i = 0; i < tw; i += step) {
      const a = f[(y + j) * fw + x + i] - mean;
      num += a * (tpl[j * tw + i] - tMean);
      den += a * a;
    }
  return den > 0 && tNorm > 0 ? num / Math.sqrt(den * tNorm) : 0;
}

function stats(tpl: Float32Array, tw: number, th: number, step: number) {
  let s = 0;
  let n = 0;
  for (let j = 0; j < th; j += step) for (let i = 0; i < tw; i += step) ((s += tpl[j * tw + i]), n++);
  const mean = s / n;
  let v = 0;
  for (let j = 0; j < th; j += step) for (let i = 0; i < tw; i += step) v += (tpl[j * tw + i] - mean) ** 2;
  return { mean, norm: v };
}

/**
 * Follow the box (centre cx, cy; size bw × bh) from frame `start`, forwards (dir 1) or
 * backwards (-1), until the end or until it's lost. Coarse-to-fine template matching with a
 * slowly updated template, so it copes with gradual changes in look.
 */
/** 3×3 box blur: gives fine texture some spatial spread so the coarse search can find it. */
function blur3(f: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const yy = y + j;
          const xx = x + i;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) ((s += f[yy * w + xx]), n++);
        }
      out[y * w + x] = s / n;
    }
  return out;
}

export function trackBox(g: Gray, start: number, cx: number, cy: number, bw: number, bh: number, dir: 1 | -1 = 1, minConfidence = 0.45): TrackPoint[] {
  // matching runs on lightly blurred frames, made as they're needed
  const cache = new Map<number, Uint8Array>();
  const frame = (k: number) => {
    let f = cache.get(k);
    if (!f) cache.set(k, (f = blur3(g.frames[k], g.w, g.h)));
    return f;
  };
  const tw = Math.max(6, Math.min(g.w - 2, Math.round(bw)));
  const th = Math.max(6, Math.min(g.h - 2, Math.round(bh)));
  const clampX = (x: number) => Math.max(0, Math.min(g.w - tw, Math.round(x)));
  const clampY = (y: number) => Math.max(0, Math.min(g.h - th, Math.round(y)));
  let x = clampX(cx - tw / 2);
  let y = clampY(cy - th / 2);
  const tpl = new Float32Array(tw * th);
  const grab = (f: Uint8Array, ox: number, oy: number, into: Float32Array, mix: number) => {
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) into[j * tw + i] = into[j * tw + i] * (1 - mix) + f[(oy + j) * g.w + ox + i] * mix;
  };
  grab(frame(start), x, y, tpl, 1);
  const out: TrackPoint[] = [[start, x + tw / 2, y + th / 2, 1]];
  let vx = 0;
  let vy = 0;
  const R = Math.max(6, Math.round(Math.max(tw, th) * 0.6));
  for (let k = start + dir; k >= 0 && k < g.frames.length; k += dir) {
    const f = frame(k);
    // predict with the last motion, then search around it: coarse grid, then every pixel
    const px = clampX(x + vx);
    const py = clampY(y + vy);
    const coarse = stats(tpl, tw, th, 2);
    let best = -2;
    let bx = px;
    let by = py;
    for (let dy = -R; dy <= R; dy += 2)
      for (let dx = -R; dx <= R; dx += 2) {
        const sx = clampX(px + dx);
        const sy = clampY(py + dy);
        const s = ncc(f, g.w, sx, sy, tpl, tw, th, coarse.mean, coarse.norm, 2);
        if (s > best) ((best = s), (bx = sx), (by = sy));
      }
    // refine around the coarse winner, scoring every pixel this time
    const fine = stats(tpl, tw, th, 1);
    const cx0 = bx;
    const cy0 = by;
    best = -2;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const sx = clampX(cx0 + dx);
        const sy = clampY(cy0 + dy);
        const s = ncc(f, g.w, sx, sy, tpl, tw, th, fine.mean, fine.norm, 1);
        if (s > best) ((best = s), (bx = sx), (by = sy));
      }
    if (best < minConfidence) break;
    vx = (bx - x) * 0.7 + vx * 0.3;
    vy = (by - y) * 0.7 + vy * 0.3;
    x = bx;
    y = by;
    // let the template follow slow changes, but only when the match is good
    if (best > 0.8) grab(f, x, y, tpl, 0.08);
    out.push([k, x + tw / 2, y + th / 2, Math.max(0, best)]);
  }
  return dir > 0 ? out : out.reverse();
}

// ---------- stabilization ----------

/** Frame-to-frame camera motion: translation (px) and rotation (radians) from block matching. */
export function frameMotion(a: Uint8Array, b: Uint8Array, w: number, h: number, block = 16, range = 8): { dx: number; dy: number; da: number } {
  const vecs: { x: number; y: number; dx: number; dy: number }[] = [];
  const cols = Math.max(2, Math.floor((w - 2 * range) / (block * 1.5)));
  const rows = Math.max(2, Math.floor((h - 2 * range) / (block * 1.5)));
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
      let best = Infinity;
      let bdx = 0;
      let bdy = 0;
      for (let dy = -range; dy <= range; dy++)
        for (let dx = -range; dx <= range; dx++) {
          // stop early only once this candidate can't win or tie (a partial sum must never pass as a tie)
          let sad = 0;
          for (let j = 0; j < block && sad <= best; j++) for (let i = 0; i < block; i++) sad += Math.abs(a[(y0 + j) * w + x0 + i] - b[(y0 + j + dy) * w + x0 + i + dx]);
          if (sad < best || (sad === best && dx * dx + dy * dy < bdx * bdx + bdy * bdy)) ((best = sad), (bdx = dx), (bdy = dy));
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
  for (let k = 1; k < n; k++) {
    const m = frameMotion(g.frames[k - 1], g.frames[k], g.w, g.h);
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
