// Where a clip's source picture lands in the output frame: fit, stabilization and transform
// (with its keyframes), in the same order the preview and the render apply them.
import { keyedValue } from './keys';
import { linearAt } from './track';
import { sourceTime } from './timeline';
import { transformOf, type Clip } from './types';

/** 2D affine map, as canvas `setTransform(a, b, c, d, e, f)`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [number, number, number, number, number, number];

const mul = (m: Affine, n: Affine): Affine => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const translate = (m: Affine, x: number, y: number) => mul(m, [1, 0, 0, 1, x, y]);
const scale = (m: Affine, x: number, y: number) => mul(m, [x, 0, 0, y, 0, 0]);
const rotate = (m: Affine, rad: number) => mul(m, [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);

export const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** The fitted picture rectangle (pixels of a W×H frame) for a source of iw×ih. */
export function fitRect(fit: Clip['fit'], iw: number, ih: number, W: number, H: number): [number, number, number, number] {
  if (fit === 'stretch' || !iw || !ih) return [0, 0, W, H];
  const s = fit === 'fill' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  return [(W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s];
}

/**
 * Map from the clip's source picture (0..1 across and down) to the output frame (0..1), at
 * `local` seconds into the clip. `iw`×`ih`: the source size; `W`×`H`: the output size.
 */
export function pictureMatrix(c: Clip, local: number, iw: number, ih: number, W: number, H: number): Affine {
  const T0 = transformOf(c);
  const T = { ...T0, x: keyedValue(c.keys, 'x', local, T0.x), y: keyedValue(c.keys, 'y', local, T0.y), zoom: keyedValue(c.keys, 'zoom', local, T0.zoom), rotate: keyedValue(c.keys, 'rotate', local, T0.rotate) };
  let m: Affine = [1 / W, 0, 0, 1 / H, 0, 0];
  m = translate(m, W / 2 + T.x * W, H / 2 + T.y * H);
  m = rotate(m, (T.rotate * Math.PI) / 180);
  m = scale(m, T.zoom * (T.flipH ? -1 : 1), T.zoom * (T.flipV ? -1 : 1));
  m = translate(m, -W / 2, -H / 2);
  const [x, y, dw, dh] = fitRect(c.fit, iw, ih, W, H);
  if (c.stab && !c.freeze) {
    const st = sourceTime(c, local);
    const z = Math.max(1, Math.min(1.5, c.stab.zoom));
    m = translate(m, x + dw / 2 + linearAt(c.stab.x, st) * dw * z, y + dh / 2 + linearAt(c.stab.y, st) * dh * z);
    m = rotate(m, (linearAt(c.stab.r, st) * Math.PI) / 180);
    m = scale(m, z, z);
    m = translate(m, -(x + dw / 2), -(y + dh / 2));
  }
  m = translate(m, x, y);
  return scale(m, dw, dh);
}
