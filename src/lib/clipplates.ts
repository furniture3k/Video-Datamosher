// Drawing a clip's card and mask: the paper, shadow and caption behind the picture, and the shape the
// picture shows through. The preview draws them live; for the render the same drawing is made into
// pictures (a "plate" for the card, grey pictures for the mask) that the filter graph puts on the clip.
import { encodeFrames } from './encodeframes';
import { maskGeometry, maskPoints, paperRect, captionHeight, maskAnimated, type ClipCard, type ClipMask, type Rect } from '../engine/cardmask';
import { fitRect } from '../engine/placement';
import { clipLen } from '../engine/timeline';
import type { Clip, MediaItem } from '../engine/types';

type Ctx = CanvasRenderingContext2D;

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The rounded corners of the picture: a share of its shorter side. */
const cornerOf = (card: ClipCard | undefined, R: Rect) => (card ? card.radius * Math.min(R[2], R[3]) : 0);

/** The paper, the shadow and the caption, behind the picture (which is drawn over it). */
export function drawCardBack(g: Ctx, card: ClipCard, R: Rect, H: number) {
  const paper = paperRect(card, R, H);
  const b = card.border * H;
  const r = cornerOf(card, R);
  g.save();
  if (card.shadow > 0) {
    g.shadowColor = `rgba(0,0,0,${0.55 * card.shadow})`;
    g.shadowBlur = H * 0.035 * card.shadow;
    g.shadowOffsetY = H * 0.012 * card.shadow;
  }
  g.fillStyle = card.borderColor;
  // with no border and no caption the shadow comes from the picture's own shape
  const [x, y, w, h] = card.border > 0 || card.caption !== undefined ? paper : R;
  roundRect(g, x, y, w, h, card.border > 0 || card.caption !== undefined ? r + b : r);
  g.fill();
  g.restore();
  if (card.caption !== undefined) {
    const strip = captionHeight(card, H);
    g.save();
    g.fillStyle = card.captionColor ?? '#2a2a2a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 600 ${Math.round(strip * 0.42)}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive, sans-serif`;
    g.fillText(card.caption, paper[0] + paper[2] / 2, R[1] + R[3] + b + strip / 2, paper[2] * 0.9);
    g.restore();
  }
}

function fillMask(g: Ctx, m: ClipMask, R: Rect, local: number) {
  const { cx, cy, rx, ry, rot } = maskGeometry(m, local, R);
  g.fillStyle = '#fff';
  if (m.shape === 'text') {
    g.save();
    g.translate(cx, cy);
    g.rotate((rot * Math.PI) / 180);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.max(4, Math.round(ry * 1.7))}px Impact, "Arial Black", sans-serif`;
    g.fillText(m.text ?? 'MOSH', 0, 0, Math.max(4, R[2] * 2));
    g.restore();
    return;
  }
  g.beginPath();
  const pts = maskPoints(m.shape, cx, cy, rx, ry, rot);
  if (pts) pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  else g.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), (rot * Math.PI) / 180, 0, Math.PI * 2);
  g.closePath();
  g.fill();
}

/**
 * The shape the picture shows through, as white on transparent over the whole frame: the picture's
 * rounded rectangle (if it has a card), cut by the mask (if it has one), at `local` seconds into the clip.
 */
export function drawPictureShape(g: Ctx, c: Pick<Clip, 'card' | 'mask'>, R: Rect, local: number, W: number, H: number, scratch: () => Ctx) {
  g.clearRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff';
  roundRect(g, R[0], R[1], R[2], R[3], cornerOf(c.card, R));
  g.fill();
  if (c.mask) {
    const s = scratch();
    s.clearRect(0, 0, W, H);
    s.globalCompositeOperation = 'source-over';
    fillMask(s, c.mask, R, local);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(s.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
}

/** Where a clip's picture sits in the output frame, before any zoom or move. */
export const pictureRectOf = (c: Pick<Clip, 'fit'>, m: Pick<MediaItem, 'width' | 'height'>, W: number, H: number): Rect => fitRect(c.fit, m.width || W, m.height || H, W, H);

const canvasOf = (w: number, h: number) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
};
const toPng = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('drawing a card failed'))), 'image/png'));

/** What a render needs for one clip's card and mask. */
export interface BuiltPlates {
  back?: Blob;
  /** a grey picture (white where the picture shows), or one for each frame of the clip */
  mask?: Blob;
  maskFrames?: number;
}

/** Draw a clip's plates at the output size (W × H). */
export async function buildPlates(c: Clip, m: MediaItem, W: number, H: number, fps: number, onFrame?: (done: number, total: number) => void): Promise<BuiltPlates> {
  const R = pictureRectOf(c, m, W, H);
  const out: BuiltPlates = {};
  if (c.card) {
    const cv = canvasOf(W, H);
    drawCardBack(cv.getContext('2d')!, c.card, R, H);
    out.back = await toPng(cv);
  }
  if (c.card || c.mask) {
    const shape = canvasOf(W, H);
    const sg = shape.getContext('2d')!;
    const tmp = canvasOf(W, H);
    const tg = tmp.getContext('2d')!;
    const grey = canvasOf(W, H);
    const gg = grey.getContext('2d')!;
    const draw = (local: number) => {
      drawPictureShape(sg, c, R, local, W, H, () => tg);
      gg.globalCompositeOperation = 'source-over';
      gg.fillStyle = '#000';
      gg.fillRect(0, 0, W, H);
      gg.drawImage(shape, 0, 0);
    };
    if (c.mask && maskAnimated(c.mask)) {
      const n = Math.max(1, Math.ceil(clipLen(c) * fps));
      const pngs = await encodeFrames(grey, n, (k) => {
        if (k % 8 === 0) onFrame?.(k, n);
        draw(k / fps);
      });
      out.mask = new Blob(pngs);
      out.maskFrames = n;
    } else {
      draw(0);
      out.mask = await toPng(grey);
    }
  }
  return out;
}
