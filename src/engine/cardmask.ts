// A card style and an animated shape mask for a picture on an upper track (pure geometry; the page
// draws them, see lib/clipplates.ts). Both live in the clip's own space: the picture fitted to the
// frame, before it is zoomed, moved or turned, so they travel with it.

/** A card round the picture: a border (a polaroid's paper), rounded corners, a shadow and a caption under it. */
export interface ClipCard {
  /** width of the border as a share of the frame height (0: none) */
  border: number;
  borderColor: string;
  /** corner rounding, as a share of the picture's shorter side (0.5: as round as it gets) */
  radius: number;
  /** drop shadow, 0..1 */
  shadow: number;
  /** a caption on the paper under the picture (a polaroid) */
  caption?: string;
  captionColor?: string;
}

export type MaskShape = 'circle' | 'rect' | 'triangle' | 'star' | 'text';

/** A shape the picture shows through, which can grow, spin or pulse. */
export interface ClipMask {
  shape: MaskShape;
  /** its size as a share of the picture's shorter side (1: as wide as the picture is tall) */
  size: number;
  /** its middle, as shares of the picture (0.5, 0.5: the middle) */
  x: number;
  y: number;
  /** the words, for `shape: 'text'` */
  text?: string;
  /** a turn, degrees, and how fast it spins (degrees a second) */
  rotate?: number;
  spin?: number;
  /** grows from nothing over this many seconds */
  grow?: number;
  /** breathes in and out by this share of its size, twice a second */
  pulse?: number;
}

export type Rect = [number, number, number, number];

/** Does the mask change over time (so it needs a picture for each frame)? */
export const maskAnimated = (m: ClipMask) => !!(m.grow || m.spin || m.pulse);

/** Pixels the caption strip under a polaroid takes, for a frame `H` tall. */
export const captionHeight = (card: ClipCard, H: number) => (card.caption !== undefined ? Math.max(card.border, 0.04) * H * 2.6 : 0);

/** The paper behind the picture: its rectangle grown by the border all round and by the caption strip below. */
export function paperRect(card: ClipCard, R: Rect, H: number): Rect {
  const b = card.border * H;
  const cap = captionHeight(card, H);
  return [R[0] - b, R[1] - b, R[2] + 2 * b, R[3] + 2 * b + cap];
}

/** A mask at `local` seconds into the clip, in pixels of the picture's rectangle `R`: its middle, half-sizes and turn (degrees). */
export function maskGeometry(m: ClipMask, local: number, R: Rect): { cx: number; cy: number; rx: number; ry: number; rot: number } {
  const base = (Math.min(R[2], R[3]) * m.size) / 2;
  const grow = m.grow ? Math.max(0, Math.min(1, local / m.grow)) : 1;
  // an overshoot as it settles, so growing has some life in it
  const eased = m.grow ? 1 - (1 - grow) ** 3 : 1;
  const pulse = m.pulse ? 1 + m.pulse * Math.sin(local * Math.PI * 4) * 0.5 : 1;
  const r = base * eased * pulse;
  return { cx: R[0] + R[2] * m.x, cy: R[1] + R[3] * m.y, rx: r, ry: r, rot: (m.rotate ?? 0) + (m.spin ?? 0) * local };
}

/** The corners of a polygon mask shape (null for a circle or text, which are drawn another way). */
export function maskPoints(shape: MaskShape, cx: number, cy: number, rx: number, ry: number, rot: number): [number, number][] | null {
  const a0 = (rot * Math.PI) / 180;
  const at = (a: number, k = 1): [number, number] => {
    const x = Math.sin(a) * rx * k;
    const y = -Math.cos(a) * ry * k;
    return [cx + x * Math.cos(a0) - y * Math.sin(a0), cy + x * Math.sin(a0) + y * Math.cos(a0)];
  };
  if (shape === 'rect')
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => {
      const px = x * rx;
      const py = y * ry;
      return [cx + px * Math.cos(a0) - py * Math.sin(a0), cy + px * Math.sin(a0) + py * Math.cos(a0)] as [number, number];
    });
  if (shape === 'triangle') return [0, 1, 2].map((i) => at((i / 3) * Math.PI * 2));
  if (shape === 'star') return Array.from({ length: 10 }, (_, i) => at((i / 10) * Math.PI * 2, i % 2 ? 0.42 : 1));
  return null;
}
