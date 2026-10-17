// Draws text titles onto a 2D canvas (edit preview, clean titles on the mosh, burned-in titles).
import type { TextClip, TextAnim } from '../engine/types';

export const TEXT_ANIMS: { value: TextAnim; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Just appears (or fades, with Fade).' },
  { value: 'type', label: 'Typewriter', hint: 'Letter by letter.' },
  { value: 'glitch', label: 'Glitch in', hint: 'Scrambled, jumping letters that settle into the words.' },
  { value: 'slide', label: 'Slide up', hint: 'Rises into place.' },
  { value: 'pop', label: 'Pop', hint: 'Grows in with a little bounce.' },
];

/** How far a title is through coming in (0..1) at timeline time t. */
export function animProgress(tx: TextClip, t: number): number {
  if (!tx.anim || tx.anim === 'none' || tx.moshed) return 1;
  const d = Math.max(0.05, tx.animIn ?? 0.6);
  return Math.max(0, Math.min(1, (t - tx.start) / d));
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
/** Repeatable noise for the glitch: the same letter, frame and title give the same jump. */
const noise = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const GLYPHS = '!<>-_\\/[]{}=+*^?#%&@$01';

const FONTS: Record<TextClip['font'], string> = {
  sans: "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
  impact: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif",
};

/** Opacity of a title at timeline time t (0 when not on screen). */
export function textAlpha(tx: TextClip, t: number): number {
  if (t < tx.start || t >= tx.start + tx.duration) return 0;
  const f = Math.min(tx.fade, tx.duration / 2);
  if (f <= 0) return 1;
  return Math.max(0, Math.min(1, (t - tx.start) / f, (tx.start + tx.duration - t) / f));
}

/** Where a title sits at timeline time t (following a tracked object if it has one). */
export function textPos(tx: TextClip, t: number): [number, number] {
  if (!tx.follow?.length) return [tx.x, tx.y];
  const f = tx.follow;
  if (t <= f[0][0]) return [f[0][1], f[0][2]];
  for (let i = 0; i < f.length - 1; i++) {
    const [a, ax, ay] = f[i];
    const [b, bx, by] = f[i + 1];
    if (t <= b) {
      const u = b > a ? (t - a) / (b - a) : 1;
      return [ax + (bx - ax) * u, ay + (by - ay) * u];
    }
  }
  const l = f[f.length - 1];
  return [l[1], l[2]];
}

export function drawText(ctx: CanvasRenderingContext2D, tx: TextClip, w: number, h: number, alpha: number, t = tx.start) {
  if (alpha <= 0 || !tx.text.trim()) return;
  const [px, py] = textPos(tx, t);
  const size = Math.max(4, tx.size * h);
  const p = animProgress(tx, t);
  const anim = p < 1 ? tx.anim : 'none';
  if (anim === 'slide') alpha *= easeOut(p);
  if (anim === 'pop') alpha *= Math.min(1, p * 3);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${tx.bold ? 700 : 400} ${size}px ${FONTS[tx.font] ?? FONTS.sans}`;
  ctx.textAlign = tx.align;
  ctx.textBaseline = 'middle';
  const lines = tx.text.split('\n');
  const lh = size * 1.2;
  const cx = px * w;
  let cy = py * h - ((lines.length - 1) * lh) / 2;
  if (anim === 'slide') cy += (1 - easeOut(p)) * size * 1.2;
  if (anim === 'pop') {
    const k = 0.4 + 0.6 * easeOutBack(p);
    ctx.translate(cx, py * h);
    ctx.scale(k, k);
    ctx.translate(-cx, -py * h);
  }
  if (tx.box) {
    const widths = lines.map((l) => ctx.measureText(l).width);
    const bw = Math.max(...widths) + size * 0.8;
    const bh = lines.length * lh + size * 0.4;
    const bx = tx.align === 'left' ? cx - size * 0.4 : tx.align === 'right' ? cx - bw + size * 0.4 : cx - bw / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, cy - lh / 2 - size * 0.2, bw, bh);
  }
  if (tx.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = size * 0.15;
    ctx.shadowOffsetY = size * 0.05;
  }
  ctx.fillStyle = tx.color;
  // word highlighting only while the words still match the text (an edited caption draws as typed)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  if (tx.words?.length && tx.highlight && lines.length === 1 && norm(tx.words.map((w) => w.text).join(' ')) === norm(tx.text)) {
    // word by word: the word being spoken lights up
    const local = t - tx.start;
    const space = ctx.measureText(' ').width;
    const widths = tx.words.map((wd) => ctx.measureText(wd.text).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (tx.words.length - 1);
    let x = tx.align === 'left' ? cx : tx.align === 'right' ? cx - total : cx - total / 2;
    ctx.textAlign = 'left';
    tx.words.forEach((wd, i) => {
      ctx.fillStyle = local >= wd.t0 && local < wd.t1 + 0.05 ? tx.highlight! : tx.color;
      ctx.fillText(wd.text, x, cy);
      x += widths[i] + space;
    });
  } else if (anim === 'type') {
    // the letters so far, line after line, laid out where the whole text will sit
    let left = Math.floor(p * lines.reduce((n, l) => n + l.length, 0));
    lines.forEach((l, i) => {
      const shown = l.slice(0, Math.max(0, left));
      left -= l.length;
      if (!shown) return;
      const full = ctx.measureText(l).width;
      const x = tx.align === 'left' ? cx : tx.align === 'right' ? cx - full : cx - full / 2;
      ctx.textAlign = 'left';
      ctx.fillText(shown, x, cy + i * lh);
    });
  } else if (anim === 'glitch') {
    // each letter jumps about and flickers between symbols, less and less until it settles
    const frame = Math.floor(t * 24);
    const amt = 1 - easeOut(p);
    ctx.textAlign = 'left';
    let k = 0;
    lines.forEach((l, i) => {
      const full = ctx.measureText(l).width;
      let x = tx.align === 'left' ? cx : tx.align === 'right' ? cx - full : cx - full / 2;
      for (const ch of l) {
        const cw = ctx.measureText(ch).width;
        const r = noise(k, frame);
        const swap = ch.trim() && r < amt * 0.8;
        const glyph = swap ? GLYPHS[Math.floor(noise(k + 0.5, frame) * GLYPHS.length)] : ch;
        const dx = (noise(k, frame + 0.3) - 0.5) * size * amt * 0.6;
        const dy = (noise(k, frame + 0.7) - 0.5) * size * amt * 0.8;
        if (r > 1 - amt * 0.15) {
          // a split colour copy, like a bad signal
          ctx.save();
          ctx.fillStyle = noise(k, frame + 0.9) > 0.5 ? '#ff2a6d' : '#05d9e8';
          ctx.fillText(glyph, x + dx + size * 0.08, cy + i * lh + dy);
          ctx.restore();
        }
        ctx.fillText(glyph, x + dx, cy + i * lh + dy);
        x += cw;
        k++;
      }
    });
  } else lines.forEach((l, i) => ctx.fillText(l, cx, cy + i * lh));
  ctx.restore();
}

/** Draw every title visible at time t. `which` picks clean or burned-in ones. */
export function drawTexts(ctx: CanvasRenderingContext2D, texts: TextClip[], t: number, w: number, h: number, which: 'all' | 'clean' | 'moshed' = 'all') {
  for (const tx of texts) {
    if (which === 'clean' && tx.moshed) continue;
    if (which === 'moshed' && !tx.moshed) continue;
    drawText(ctx, tx, w, h, textAlpha(tx, t), t);
  }
}
