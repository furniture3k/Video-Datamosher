// Draws text titles onto a 2D canvas (edit preview, clean titles on the mosh, burned-in titles).
import type { TextClip } from '../engine/types';

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
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${tx.bold ? 700 : 400} ${size}px ${FONTS[tx.font] ?? FONTS.sans}`;
  ctx.textAlign = tx.align;
  ctx.textBaseline = 'middle';
  const lines = tx.text.split('\n');
  const lh = size * 1.2;
  const cx = px * w;
  const cy = py * h - ((lines.length - 1) * lh) / 2;
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
