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
  const R = cardRect(c, W, H);
  const ctx = out.getContext('2d')!;
  const b = (c.border ?? 0) * H;
  if (b > 0) {
    ctx.fillStyle = c.borderColor ?? '#ffffff';
    roundRect(ctx, R.x - b, R.y - b, R.w + 2 * b, R.h + 2 * b, R.r ? R.r + b : 0);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    roundRect(ctx, R.x, R.y, R.w, R.h, R.r);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  if (c.device) drawDevice(ctx, c.device, R, W, H, b);
  return out;
}

/** A generic device round the card (`b`: the border already drawn round it). */
function drawDevice(ctx: CanvasRenderingContext2D, device: NonNullable<Canvas['device']>, R: CardRect, W: number, H: number, b: number) {
  const u = Math.min(W, H);
  /** a frame of width `f` round the card, all outside it */
  const bezel = (f: number, colour: string, r: number) => {
    const s = document.createElement('canvas');
    s.width = W;
    s.height = H;
    const g = s.getContext('2d')!;
    g.fillStyle = colour;
    roundRect(g, R.x - b - f, R.y - b - f, R.w + 2 * (b + f), R.h + 2 * (b + f), r);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    roundRect(g, R.x - b, R.y - b, R.w + 2 * b, R.h + 2 * b, R.r ? R.r + b : 0);
    g.fill();
    ctx.drawImage(s, 0, 0);
  };
  if (device === 'phone') {
    const f = u * 0.022;
    bezel(f, '#111114', (R.r || u * 0.05) + b + f);
    // the camera pill at the top of the screen
    ctx.fillStyle = '#000';
    const pw = Math.min(R.w * 0.3, u * 0.2);
    roundRect(ctx, R.x + (R.w - pw) / 2, R.y + u * 0.018, pw, u * 0.04, u * 0.02);
    ctx.fill();
  } else if (device === 'browser' || device === 'window') {
    // a title bar above the card, with the three window dots (and an address bar in a browser)
    const bar = u * 0.055;
    const dark = device === 'window';
    ctx.fillStyle = dark ? '#2b2b31' : '#e9e9ec';
    const top = R.y - b - bar;
    const rr = Math.max(R.r, u * 0.012);
    ctx.beginPath();
    ctx.roundRect(R.x - b, top, R.w + 2 * b, bar, [rr, rr, 0, 0]);
    ctx.fill();
    const d = bar * 0.22;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(R.x + bar * 0.5 + i * d * 2.8, top + bar / 2, d, 0, Math.PI * 2);
      ctx.fill();
    });
    if (!dark) {
      ctx.fillStyle = '#ffffff';
      const aw = R.w * 0.5;
      roundRect(ctx, R.x + (R.w - aw) / 2, top + bar * 0.22, aw, bar * 0.56, bar * 0.28);
      ctx.fill();
    }
  } else if (device === 'music' || device === 'chat') {
    // a panel round the picture that goes on under it: a music player's controls, or a chat bubble with its tail
    const music = device === 'music';
    const side = u * 0.026;
    const below = music ? u * 0.25 : u * 0.05;
    const s = document.createElement('canvas');
    s.width = W;
    s.height = H;
    const g = s.getContext('2d')!;
    g.fillStyle = music ? 'rgba(20,20,26,0.93)' : '#1982fc';
    const px = R.x - b - side;
    const py = R.y - b - side;
    const pw = R.w + 2 * (b + side);
    const ph = R.h + 2 * (b + side) + below;
    roundRect(g, px, py, pw, ph, u * (music ? 0.045 : 0.06));
    g.fill();
    if (!music) {
      // the tail, bottom right
      g.beginPath();
      g.moveTo(px + pw - u * 0.1, py + ph - u * 0.02);
      g.quadraticCurveTo(px + pw - u * 0.03, py + ph + u * 0.01, px + pw + u * 0.012, py + ph + u * 0.035);
      g.quadraticCurveTo(px + pw - u * 0.012, py + ph - u * 0.012, px + pw - u * 0.012, py + ph - u * 0.1);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    roundRect(g, R.x - b, R.y - b, R.w + 2 * b, R.h + 2 * b, R.r ? R.r + b : 0);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    if (music) {
      const y0 = R.y + R.h + b + side;
      g.fillStyle = '#f2f2f5';
      roundRect(g, R.x, y0, R.w * 0.46, u * 0.02, u * 0.01);
      g.fill();
      g.fillStyle = 'rgba(242,242,245,0.5)';
      roundRect(g, R.x, y0 + u * 0.032, R.w * 0.3, u * 0.014, u * 0.007);
      g.fill();
      // the progress line and its knob
      const ly = y0 + u * 0.085;
      g.fillStyle = 'rgba(255,255,255,0.28)';
      roundRect(g, R.x, ly, R.w, u * 0.008, u * 0.004);
      g.fill();
      g.fillStyle = '#ffffff';
      roundRect(g, R.x, ly, R.w * 0.38, u * 0.008, u * 0.004);
      g.fill();
      g.beginPath();
      g.arc(R.x + R.w * 0.38, ly + u * 0.004, u * 0.012, 0, Math.PI * 2);
      g.fill();
      // previous, play, next
      const cy = y0 + u * 0.16;
      const cx = R.x + R.w / 2;
      const tri = (x: number, dir: number, size: number) => {
        g.beginPath();
        g.moveTo(x + dir * size, cy);
        g.lineTo(x - dir * size * 0.6, cy - size * 0.8);
        g.lineTo(x - dir * size * 0.6, cy + size * 0.8);
        g.closePath();
        g.fill();
      };
      tri(cx - R.w * 0.2, -1, u * 0.02);
      tri(cx + R.w * 0.2, 1, u * 0.02);
      g.beginPath();
      g.arc(cx, cy, u * 0.036, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(20,20,26,0.95)';
      tri(cx + u * 0.004, 1, u * 0.02);
    } else {
      // "Delivered" under the bubble, in the corner
      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.font = `${Math.round(u * 0.022)}px sans-serif`;
      g.textAlign = 'right';
      g.fillText('Delivered', px + pw - u * 0.03, py + ph + u * 0.042);
    }
    ctx.drawImage(s, 0, 0);
  } else if (device === 'laptop') {
    const f = u * 0.02;
    bezel(f, '#1b1b1f', (R.r || u * 0.01) + b + f);
    // the base: a flat slab a little wider than the screen, with a thumb notch
    const y = R.y + R.h + b + f;
    const over = R.w * 0.08;
    const h = u * 0.028;
    ctx.fillStyle = '#c9cbd1';
    ctx.beginPath();
    ctx.moveTo(R.x - b - f - over * 0.4, y);
    ctx.lineTo(R.x + R.w + b + f + over * 0.4, y);
    ctx.lineTo(R.x + R.w + b + f + over, y + h);
    ctx.lineTo(R.x - b - f - over, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9fa2aa';
    roundRect(ctx, R.x + R.w / 2 - R.w * 0.07, y, R.w * 0.14, h * 0.35, h * 0.15);
    ctx.fill();
  }
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
