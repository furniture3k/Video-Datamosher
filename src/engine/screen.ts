// Screen replacement: a clip on an upper track put onto a tracked surface (a phone, a monitor, a
// sign). The clip's whole picture is carried to where the surface's four corners are, frame by
// frame: by FFmpeg's perspective filter in the render and by a triangle grid in the preview.
import { applyH, quadAt, quadHomography, simplifyKeys, type Quad } from './planar';
import { linearExpr } from './track';

/** Where the clip's picture goes: [clip seconds, then where its four corners are (clockwise from the top left), as shares of the frame]. */
export interface Screen {
  quads: number[][];
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** The corners as pixels of a w×h frame. */
const px = (q: number[], w: number, h: number): Quad => q.map((v, i) => v * (i % 2 ? h : w));

/**
 * Fit a picture onto a tracked surface. `plane`: the surface over the timeline (seconds, then its
 * corners as shares of the frame), `clipStart`: when the clip starts on the timeline, `aspect`:
 * the picture's width over its height, `refT`: the moment whose shape of the surface the picture
 * should fill exactly (it is cropped, not squashed, so it keeps its proportions there).
 */
export function screenFromPlane(plane: number[][], clipStart: number, w: number, h: number, aspect: number, refT: number): Screen | null {
  const ref = quadAt(plane, refT);
  if (!ref || plane.length < 2) return null;
  const r = px(ref, w, h);
  const across = (Math.hypot(r[2] - r[0], r[3] - r[1]) + Math.hypot(r[4] - r[6], r[5] - r[7])) / 2;
  const down = (Math.hypot(r[6] - r[0], r[7] - r[1]) + Math.hypot(r[4] - r[2], r[5] - r[3])) / 2;
  if (across < 1 || down < 1) return null;
  const want = across / down;
  // the part of the picture that shows: all of it one way, centred and cut to the surface's shape the other
  let [u0, v0, u1, v1] = [0, 0, 1, 1];
  if (aspect > want) ((u0 = (1 - want / aspect) / 2), (u1 = 1 - u0));
  else ((v0 = (1 - aspect / want) / 2), (v1 = 1 - v0));
  const shown: Quad = [u0, v0, u1, v0, u1, v1, u0, v1];
  const whole = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const quads: number[][] = [];
  for (const [t, ...q] of plane) {
    const H = quadHomography(shown, px(q, w, h));
    if (!H) continue;
    // where the whole picture lands when its shown part sits on the surface
    const c = whole.flatMap(([x, y]) => applyH(H, x, y));
    if (!c.every(Number.isFinite)) continue;
    quads.push([r5(t - clipStart), ...c.map((v, i) => r5(v / (i % 2 ? h : w)))]);
  }
  return quads.length >= 2 ? { quads: simplifyKeys(quads, 0.0002) } : null;
}

/** The picture's corners at clip time `local`, as pixels of a w×h frame (held at the ends). */
export function screenCorners(s: Screen, local: number, w: number, h: number): Quad | null {
  const q = quadAt(s.quads, local);
  return q ? px(q, w, h) : null;
}

/**
 * The filters that put a w×h picture onto its surface: a border of the background so what lands
 * outside the picture is background, then FFmpeg's perspective filter fed for every frame the
 * place each corner of the picture goes to (`in` counts the frames of this piece, which starts
 * `offset` seconds into the clip), then the border off again.
 */
export function screenFilters(s: Screen, w: number, h: number, fps: number, offset: number, bg: string): string[] {
  const t = `(in/${fps}+${Math.round(offset * 1000) / 1000})`;
  // the filter wants top left, top right, bottom left, bottom right; the corners are kept clockwise
  const order = [0, 1, 3, 2];
  const opts = order.flatMap((ci, i) =>
    [0, 1].map((axis) => {
      const pts = s.quads.map((k) => [k[0], k[1 + ci * 2 + axis] * (axis ? h : w) + 2] as [number, number]);
      // quoted, so the commas inside the expressions don't split the filter graph
      return `${axis ? 'y' : 'x'}${i}='${linearExpr(pts, t)}'`;
    }),
  );
  return [`pad=${w + 4}:${h + 4}:2:2:color=${bg}`, `perspective=${opts.join(':')}:interpolation=linear:sense=destination:eval=frame`, `crop=${w}:${h}:2:2`];
}
