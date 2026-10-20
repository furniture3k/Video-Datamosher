// Subject effects: what is done to the subject cut out of the footage (its matte), drawn as a layer.
// Fill, outline, glow and echo are pictures drawn over the footage in the subject's shape; blur and
// grade change the footage under them (so they work on layers drawn over the picture, not melted in).
import type { ShapeLayer } from '../engine/layers';
import type { MatteSource } from './layers';

let tmp: HTMLCanvasElement | null = null;
let tmp2: HTMLCanvasElement | null = null;
const scratch = (c: HTMLCanvasElement | null, w: number, h: number) => {
  const cv = c ?? document.createElement('canvas');
  if (cv.width !== w || cv.height !== h) ((cv.width = w), (cv.height = h));
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.shadowColor = 'transparent';
  g.clearRect(0, 0, w, h);
  return cv;
};

/** The subject as a flat colour: the matte's shape in `colour`, on a picture of its own. */
function silhouette(into: HTMLCanvasElement, matte: CanvasImageSource, colour: string, w: number, h: number) {
  const g = into.getContext('2d')!;
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(matte, 0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

export function drawSubject(ctx: CanvasRenderingContext2D, l: ShapeLayer, w: number, h: number, alpha: number, t: number, source?: MatteSource) {
  const fx = l.subject;
  const matte = source?.(t, w, h);
  if (!fx || !matte || alpha <= 0) return;
  const colour = l.color;
  const px = Math.max(1, fx.amount * h * 0.04);
  ctx.save();
  switch (fx.effect) {
    case 'fill': {
      tmp = scratch(tmp, w, h);
      silhouette(tmp, matte, colour, w, h);
      ctx.globalAlpha = alpha;
      ctx.drawImage(tmp, 0, 0);
      break;
    }
    case 'outline':
    case 'glow': {
      // the subject's shape spread out (a ring of copies, or blurred), then the subject itself taken out of it
      tmp = scratch(tmp, w, h);
      const sil = scratch(tmp2, w, h);
      tmp2 = sil;
      silhouette(sil, matte, colour, w, h);
      const g = tmp.getContext('2d')!;
      if (fx.effect === 'outline') {
        const n = 16;
        for (let i = 0; i < n; i++) g.drawImage(sil, Math.cos((i / n) * Math.PI * 2) * px, Math.sin((i / n) * Math.PI * 2) * px);
      } else {
        g.filter = `blur(${px * 2}px)`;
        g.drawImage(sil, 0, 0);
        g.filter = 'none';
      }
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(matte, 0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.drawImage(tmp, 0, 0);
      break;
    }
    case 'echo': {
      // copies of the subject's shape stepping away, fading, drawn only outside the subject
      tmp = scratch(tmp, w, h);
      const sil = scratch(tmp2, w, h);
      tmp2 = sil;
      silhouette(sil, matte, colour, w, h);
      const g = tmp.getContext('2d')!;
      const n = Math.max(1, Math.round(fx.copies ?? 3));
      for (let k = n; k >= 1; k--) {
        g.globalAlpha = 1 - (k - 1) / (n + 1);
        g.drawImage(sil, k * (fx.dx ?? 0.04) * w, k * (fx.dy ?? 0) * h);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(matte, 0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.drawImage(tmp, 0, 0);
      break;
    }
    case 'blur':
    case 'grade': {
      // the picture so far, changed, and put back where it is wanted (the subject, or all but it)
      const here = ctx.canvas as HTMLCanvasElement;
      const orig = scratch(tmp2, here.width, here.height);
      tmp2 = orig;
      orig.getContext('2d')!.drawImage(here, 0, 0);
      const out = scratch(tmp, here.width, here.height);
      tmp = out;
      const g = out.getContext('2d')!;
      g.filter =
        fx.effect === 'blur'
          ? `blur(${px * 1.5}px)`
          : `brightness(${fx.brightness ?? 1}) saturate(${fx.saturation ?? 1}) contrast(${fx.contrast ?? 1})`;
      g.drawImage(orig, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = (fx.part ?? 'background') === 'subject' ? 'destination-in' : 'destination-out';
      g.drawImage(matte, 0, 0, here.width, here.height);
      g.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.drawImage(out, 0, 0);
      break;
    }
  }
  ctx.restore();
}
