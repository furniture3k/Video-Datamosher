// Draws text layers onto a 2D canvas (for the graphics renderer in ./layers): the layout and the
// animation come from ../engine/textlayout, this turns them into fills, outlines and copies.
import { layerPos, type BuiltinFont, type TextAnim, type TextLayer } from '../engine/layers';
import { fontCss, fontState } from './fonts.svelte';
import { gradientLine, layoutText, lettersShown, noise, onCurve, textLookAt, type TextLayout } from '../engine/textlayout';

export const TEXT_ANIMS: { value: TextAnim; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Just appears (or fades, with Fade).' },
  { value: 'type', label: 'Typewriter', hint: 'Letter by letter.' },
  { value: 'words', label: 'Word by word', hint: 'One word after another.' },
  { value: 'glitch', label: 'Glitch in', hint: 'Scrambled, jumping letters that settle into the words.' },
  { value: 'slide', label: 'Slide up', hint: 'Rises into place.' },
  { value: 'pop', label: 'Pop', hint: 'Grows in with a little bounce.' },
  { value: 'slam', label: 'Slam', hint: 'Comes at you big and hits its place hard.' },
  { value: 'stamp', label: 'Stamp', hint: 'Set down in one go, like a rubber stamp.' },
  { value: 'drop', label: 'Drop', hint: 'Falls in from above and bounces.' },
];

const GLYPHS = '!<>-_\\/[]{}=+*^?#%&@$01';

export const FONTS: Record<BuiltinFont, string> = {
  sans: "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
  impact: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif",
};

const fontOf = (tx: TextLayer, size: number) => `${tx.bold ? 700 : 400} ${size}px ${fontCss(tx.font, FONTS)}`;

let measurer: CanvasRenderingContext2D | null = null;
/** the font last set on the measurer (setting one is slow; the canvas gives it back reworded) */
let measuring = '';
/** recent layouts, by everything that sizes and places the letters (laying out measures every letter) */
const layouts = new Map<string, TextLayout>();
/** The title laid out in a w×h frame, measured in its font. */
export function textLayout(tx: TextLayer, w: number, h: number): TextLayout {
  // (a font that finishes loading measures differently)
  const key = JSON.stringify([tx.text, tx.lines, tx.size, tx.fit, tx.spacing, tx.lineHeight, tx.align, tx.box, tx.curve, tx.font, tx.bold, w, h, fontState.loaded]);
  const hit = layouts.get(key);
  if (hit) return hit;
  measurer ??= document.createElement('canvas').getContext('2d')!;
  const m = measurer;
  // a line may have a typeface or weight of its own
  const L = layoutText(tx, w, h, (s, line) => {
    const font = fontOf(line?.font || line?.bold !== undefined ? { ...tx, font: line.font ?? tx.font, bold: line.bold ?? tx.bold } : tx, 100);
    if (font !== measuring) m.font = measuring = font;
    return m.measureText(s).width;
  });
  if (layouts.size > 256) layouts.delete(layouts.keys().next().value!);
  layouts.set(key, L);
  return L;
}

/**
 * The box the title takes up in a w×h frame (pixels, before turning), and how far its centre is
 * across (and, for bent text, down) from the title's position (aligned left or right, the position is an edge).
 */
export function textBox(tx: TextLayer, w: number, h: number): { w: number; h: number; dx: number; dy: number } {
  const b = textLayout(tx, w, h).box;
  return { w: b.w, h: b.h, dx: b.x + b.w / 2, dy: b.y + b.h / 2 };
}

export function drawText(ctx: CanvasRenderingContext2D, tx: TextLayer, w: number, h: number, alpha: number, t = tx.start) {
  if (alpha <= 0 || !tx.text.trim()) return;
  const look = textLookAt(tx, t);
  alpha *= look.alpha;
  if (alpha <= 0 || !look.visible) return;
  const L = textLayout(tx, w, h);
  const size = L.size;
  const [px, py] = layerPos(tx, t);
  ctx.save();
  ctx.globalAlpha = alpha;
  // about the title's position: move, turn and scale
  ctx.translate(px * w + look.dx * size, py * h + look.dy * size);
  const turn = (tx.rotate ?? 0) + look.turn;
  if (turn) ctx.rotate((turn * Math.PI) / 180);
  if (look.scale !== 1) ctx.scale(look.scale, look.scale);
  ctx.font = fontOf(tx, size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // copies filling the frame (and scrolling), else just the one
  for (const [ox, oy] of copies(tx, L, w, h, t)) {
    ctx.save();
    if (ox || oy) ctx.translate(ox, oy);
    drawOne(ctx, tx, L, look, t);
    ctx.restore();
  }
  ctx.restore();
}

/** Where the copies go (offsets from the title), enough to cover the frame however it's turned. */
function copies(tx: TextLayer, L: TextLayout, w: number, h: number, t: number): [number, number][] {
  if (!tx.repeat) return [[0, 0]];
  const gap = (tx.repeatGap ?? 0.5) * L.size;
  const sx = L.box.w + gap;
  const sy = L.box.h + gap;
  const reach = Math.hypot(w, h);
  const run = (t - tx.start) * (tx.scroll ?? 0);
  const across = tx.repeat !== 'down';
  const down = tx.repeat !== 'across';
  // the scroll goes along the copies (across when they're side by side)
  const shiftX = across ? (((run * w) % sx) + sx) % sx : 0;
  const shiftY = !across ? (((run * h) % sy) + sy) % sy : 0;
  const nx = across ? Math.ceil(reach / sx) + 1 : 0;
  const ny = down ? Math.ceil(reach / sy) + 1 : 0;
  const out: [number, number][] = [];
  for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) out.push([i * sx + shiftX, j * sy + shiftY]);
  return out;
}

/** One copy of the title, around the origin. */
function drawOne(ctx: CanvasRenderingContext2D, tx: TextLayer, L: TextLayout, look: ReturnType<typeof textLookAt>, t: number) {
  const size = L.size;
  if (tx.box) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(L.box.x, L.box.y, L.box.w, L.box.h);
  }
  if (tx.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = size * 0.15;
    ctx.shadowOffsetY = size * 0.05;
  }
  const stroke = (tx.stroke ?? 0) > 0 || tx.strokeOnly;
  ctx.strokeStyle = tx.strokeColor ?? '#000000';
  // the colour that runs across the whole title, if it has one
  const grad = tx.gradient ? (() => { const [x0, y0, x1, y1] = gradientLine(L.box, tx.gradient.angle); const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, tx.color); g.addColorStop(1, tx.gradient.to); return g; })() : null;
  // the outline goes behind the fill (so it grows outwards); outline-only titles draw it centred
  let strokeW = Math.max(1, (tx.stroke || 0.04) * size);
  const paint = (s: string, x: number, y: number, colour: string | CanvasGradient) => {
    ctx.lineWidth = tx.strokeOnly ? strokeW : strokeW * 2;
    if (stroke) ctx.strokeText(s, x, y);
    if (!tx.strokeOnly) {
      ctx.fillStyle = colour;
      ctx.fillText(s, x, y);
    }
  };
  // word highlighting only while the words still match the text (an edited caption draws as typed)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const karaoke = !!(tx.words?.length && tx.highlight && L.lines.length === 1 && norm(tx.words.map((w) => w.text).join(' ')) === norm(tx.text));
  const total = L.lines.reduce((n, l) => n + [...l.text].length, 0);
  const frame = Math.floor(t * 24);
  // letter by letter when anything needs single letters; whole lines keep the font's kerning
  const byLetter = karaoke || look.letters < 1 || look.glitch > 0 || L.spacing !== 0 || !!tx.curve || !!tx.colourRuns?.length;
  let before = 0;
  let k = 0;
  for (const line of L.lines) {
    const chars = [...line.text];
    // this line's own typeface, size and colour
    ctx.font = fontOf(line.font || line.bold !== undefined ? { ...tx, font: line.font ?? tx.font, bold: line.bold ?? tx.bold } : tx, line.size);
    strokeW = Math.max(1, (tx.stroke || 0.04) * line.size);
    const base: string | CanvasGradient = line.color ?? grad ?? tx.color;
    if (!byLetter) {
      paint(line.text, line.x, line.y, base);
      before += chars.length;
      continue;
    }
    const shown = lettersShown(line.text, before, total, look.letters, look.wholeWords);
    // which word each letter is in (karaoke)
    let word = 0;
    const local = t - tx.start;
    for (let i = 0; i < chars.length; i++, k++) {
      const ch = chars[i];
      if (karaoke && i > 0 && !ch.trim() && chars[i - 1].trim()) word++;
      if (i >= shown) continue;
      let colour: string | CanvasGradient = base;
      // a stretch of the words in a colour of its own
      const run = tx.colourRuns?.find((r) => before + i >= r.from && before + i < r.to);
      if (run) colour = run.color;
      if (karaoke) {
        const wd = tx.words![word];
        if (wd && local >= wd.t0 && local < wd.t1 + 0.05) colour = tx.highlight!;
      }
      let glyph = ch;
      let dx = 0;
      let dy = 0;
      if (look.glitch > 0) {
        // each letter jumps about and flickers between symbols, less and less until it settles
        const amt = look.glitch;
        const r = noise(k, frame);
        if (ch.trim() && r < amt * 0.8) glyph = GLYPHS[Math.floor(noise(k + 0.5, frame) * GLYPHS.length)];
        dx = (noise(k, frame + 0.3) - 0.5) * size * amt * 0.6;
        dy = (noise(k, frame + 0.7) - 0.5) * size * amt * 0.8;
        if (r > 1 - amt * 0.15) {
          // a split colour copy, like a bad signal
          ctx.save();
          ctx.fillStyle = noise(k, frame + 0.9) > 0.5 ? '#ff2a6d' : '#05d9e8';
          ctx.fillText(glyph, line.x + line.letters[i] + dx + size * 0.08, line.y + dy);
          ctx.restore();
        }
      }
      if (tx.curve) {
        // on a bent baseline: each letter set on the arc by its middle and turned to the slope there
        const adv = (i + 1 < chars.length ? line.letters[i + 1] - line.spacing : line.width) - line.letters[i];
        const at = onCurve(line.width, line.letters[i] + adv / 2, tx.curve);
        ctx.save();
        ctx.translate(line.x + line.width / 2 + at.x + dx, line.y + at.y + dy);
        ctx.rotate((at.a * Math.PI) / 180);
        paint(glyph, -adv / 2, 0, colour);
        ctx.restore();
      } else paint(glyph, line.x + line.letters[i] + dx, line.y + dy, colour);
    }
    before += chars.length;
  }
}
