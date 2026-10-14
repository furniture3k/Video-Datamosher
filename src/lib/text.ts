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

export function drawText(ctx: CanvasRenderingContext2D, tx: TextClip, w: number, h: number, alpha: number) {
  if (alpha <= 0 || !tx.text.trim()) return;
  const size = Math.max(4, tx.size * h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${tx.bold ? 700 : 400} ${size}px ${FONTS[tx.font] ?? FONTS.sans}`;
  ctx.textAlign = tx.align;
  ctx.textBaseline = 'middle';
  const lines = tx.text.split('\n');
  const lh = size * 1.2;
  const cx = tx.x * w;
  const cy = tx.y * h - ((lines.length - 1) * lh) / 2;
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
  lines.forEach((l, i) => ctx.fillText(l, cx, cy + i * lh));
  ctx.restore();
}

/** Draw every title visible at time t. `which` picks clean or burned-in ones. */
export function drawTexts(ctx: CanvasRenderingContext2D, texts: TextClip[], t: number, w: number, h: number, which: 'all' | 'clean' | 'moshed' = 'all') {
  for (const tx of texts) {
    if (which === 'clean' && tx.moshed) continue;
    if (which === 'moshed' && !tx.moshed) continue;
    drawText(ctx, tx, w, h, textAlpha(tx, t));
  }
}
