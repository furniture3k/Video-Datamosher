// Draws shape layers onto a 2D canvas (for the graphics renderer in ./layers): the lines come from
// ../engine/shapes, this strokes and fills them.
import { layerPos, type ShapeLayer } from '../engine/layers';
import { boilStrokes, drawnShare, progressShare, rippleRings, shapeStrokes, trimStrokes } from '../engine/shapes';

export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeLayer, w: number, h: number, alpha: number, t = s.start) {
  if (alpha <= 0) return;
  if (s.shape === 'ripple') {
    // rings spreading out from its middle, over its time
    const [qx, qy] = layerPos(s, t);
    ctx.save();
    ctx.translate(qx * w, qy * h);
    ctx.lineWidth = Math.max(1, s.width * h);
    ctx.strokeStyle = s.color;
    for (const { r, alpha: a } of rippleRings(Math.max(0, Math.min(1, (t - s.start) / Math.max(0.05, s.duration))))) {
      ctx.globalAlpha = alpha * a;
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(0.5, (s.w * w * r) / 2), Math.max(0.5, (s.h * h * r) / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // a loading bar is always drawn whole: it fills instead
  const share = s.shape === 'progress' ? 1 : drawnShare(s, t);
  if (share <= 0) return;
  const whole = shapeStrokes(s, w, h);
  const line = Math.max(1, s.width * h);
  const strokes = boilStrokes(trimStrokes(whole, share), s.boil ?? 0, Math.max(line * 2, h * 0.012), t);
  if (!strokes.length) return;
  const [px, py] = layerPos(s, t);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px * w, py * h);
  if (s.rotate) ctx.rotate((s.rotate * Math.PI) / 180);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = (closedOnly: boolean) => {
    ctx.beginPath();
    for (const st of strokes) {
      if (closedOnly && !st.closed) continue;
      st.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (st.closed) ctx.closePath();
    }
  };
  // the fill comes in with the line once it's drawn all the way round
  if (s.fill && share >= 1 && s.shape !== 'progress') {
    path(true);
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (s.glow) {
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.glow * h * 0.05;
  }
  ctx.strokeStyle = s.color;
  if (s.shape === 'highlight') {
    // a marker: a wide, see-through stripe with square ends
    ctx.globalAlpha = alpha * 0.45;
    ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(2, s.h * h);
  } else ctx.lineWidth = line;
  path(false);
  ctx.stroke();
  if (s.shape === 'progress') {
    // the bar inside, filling up from the left
    const W = s.w * w;
    const H = s.h * h;
    const pad = Math.max(line * 1.5, H * 0.18);
    const full = progressShare(s, t) * (W - 2 * pad);
    if (full > 0) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = s.fill ?? s.color;
      ctx.beginPath();
      ctx.roundRect(-W / 2 + pad, -H / 2 + pad, full, H - 2 * pad, (H - 2 * pad) / 2);
      ctx.fill();
    }
  }
  // a glow drawn twice reads as light, not a shadow
  if (s.glow && s.glow > 0.5) ctx.stroke();
  ctx.restore();
}
