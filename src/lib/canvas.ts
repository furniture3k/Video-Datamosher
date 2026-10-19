// Draws the canvas (../engine/canvas): the backdrop with the card's shadow, the card's rounded
// shape and its border. The edit preview draws with these, and exports use them as pictures in
// the FFmpeg graph, so both look the same.
import { blurRadius, cardRect, type Canvas, type CardRect } from '../engine/canvas';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

const sheet = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** A picture for an image backdrop, and its size. */
export interface BackdropImage {
  src: CanvasImageSource;
  w: number;
  h: number;
}

/** The backdrop (colour, gradient or picture; clear for a blurred one, which comes from the picture) and the card's shadow. */
export function backdropPlate(c: Canvas, W: number, H: number, img?: BackdropImage): HTMLCanvasElement {
  const out = sheet(W, H);
  const ctx = out.getContext('2d')!;
  if (c.bg === 'image') {
    ctx.fillStyle = c.color;
    ctx.fillRect(0, 0, W, H);
    if (img && img.w && img.h) {
      // covering the frame, its middle shown
      const k = Math.max(W / img.w, H / img.h);
      ctx.drawImage(img.src, (W - img.w * k) / 2, (H - img.h * k) / 2, img.w * k, img.h * k);
    }
  } else if (c.bg === 'color') {
    ctx.fillStyle = c.color;
    ctx.fillRect(0, 0, W, H);
  } else if (c.bg === 'gradient') {
    // across the frame at the angle, corner to corner
    const a = ((c.angle ?? 0) * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    const half = (Math.abs(dx) * W + Math.abs(dy) * H) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
    g.addColorStop(0, c.color);
    g.addColorStop(1, c.color2 ?? c.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const R = cardRect(c, W, H);
  if (c.shadow) {
    // the shadow only: the card's own place is cut out again, so round corners show the backdrop
    const s = sheet(W, H);
    const sx = s.getContext('2d')!;
    sx.shadowColor = `rgba(0,0,0,${Math.min(0.9, 0.35 + c.shadow * 0.5)})`;
    sx.shadowBlur = c.shadow * H * 0.06;
    sx.shadowOffsetY = c.shadow * H * 0.015;
    sx.fillStyle = '#000';
    const b = (c.border ?? 0) * H;
    roundRect(sx, R.x - b, R.y - b, R.w + 2 * b, R.h + 2 * b, R.r ? R.r + b : 0);
    sx.fill();
    sx.shadowColor = 'transparent';
    sx.globalCompositeOperation = 'destination-out';
    roundRect(sx, R.x - b, R.y - b, R.w + 2 * b, R.h + 2 * b, R.r ? R.r + b : 0);
    sx.fill();
    ctx.drawImage(s, 0, 0);
  }
  return out;
}

/** The card's shape, white on black, card-sized (for its round corners). */
export function maskPlate(R: CardRect): HTMLCanvasElement {
  const out = sheet(R.w, R.h);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, R.w, R.h);
  ctx.fillStyle = '#fff';
  roundRect(ctx, 0, 0, R.w, R.h, R.r);
  ctx.fill();
  return out;
}

/** The border round the card, all outside it (clear elsewhere). */
export function borderPlate(c: Canvas, W: number, H: number): HTMLCanvasElement {
  const out = sheet(W, H);
  const b = (c.border ?? 0) * H;
  if (b <= 0) return out;
  const R = cardRect(c, W, H);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = c.borderColor ?? '#ffffff';
  roundRect(ctx, R.x - b, R.y - b, R.w + 2 * b, R.h + 2 * b, R.r ? R.r + b : 0);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  roundRect(ctx, R.x, R.y, R.w, R.h, R.r);
  ctx.fill();
  return out;
}

const cache = new Map<string, { bg: HTMLCanvasElement; border: HTMLCanvasElement }>();
/** the picture, copied aside while the card is drawn (kept: a new one every frame is slow) */
let scratch: HTMLCanvasElement | null = null;

/**
 * Turn the picture drawn on `ctx` (W×H) into the card on its backdrop, as exports draw it
 * (the blur is the browser's, near enough FFmpeg's box blur).
 */
export function drawCanvas(ctx: CanvasRenderingContext2D, c: Canvas, W: number, H: number, img?: BackdropImage) {
  const key = JSON.stringify([c, W, H, !!img]);
  let plates = cache.get(key);
  if (!plates) {
    if (cache.size > 8) cache.clear();
    plates = { bg: backdropPlate(c, W, H, img), border: borderPlate(c, W, H) };
    cache.set(key, plates);
  }
  if (!scratch || scratch.width !== W || scratch.height !== H) scratch = sheet(W, H);
  const pic = scratch;
  const px = pic.getContext('2d')!;
  px.clearRect(0, 0, W, H);
  px.drawImage(ctx.canvas, 0, 0);
  const R = cardRect(c, W, H);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (c.bg === 'blur') {
    ctx.filter = `blur(${blurRadius(c, H)}px)`;
    ctx.drawImage(pic, 0, 0);
    ctx.filter = 'none';
  }
  ctx.drawImage(plates.bg, 0, 0);
  roundRect(ctx, R.x, R.y, R.w, R.h, R.r);
  ctx.clip();
  ctx.drawImage(pic, R.crop.x, R.crop.y, R.crop.w, R.crop.h, R.x, R.y, R.w, R.h);
  ctx.restore();
  ctx.drawImage(plates.border, 0, 0);
}
