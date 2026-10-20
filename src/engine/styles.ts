// Title styles: everything about how a title is drawn apart from its words, place and timing,
// saved under a name so one look can go on every title. The built-in ones come from edits
// people post (word-per-cut slams, tour posters, film lyrics, red notes on the street, storybook).
import type { ShapeLayer, TextLayer } from './layers';

/** The settings every style has. */
const CORE = ['font', 'bold', 'size', 'color', 'shadow', 'box'] as const;
/** Settings a style may have; a title without them in its style goes back to plain. */
const EXTRA = ['highlight', 'anim', 'animIn', 'exit', 'animOut', 'spacing', 'lineHeight', 'stroke', 'strokeColor', 'strokeOnly', 'fit', 'repeat', 'repeatGap', 'scroll', 'strobe', 'boil', 'gradient', 'fx'] as const;
export const STYLE_KEYS = [...CORE, ...EXTRA] as const;

export type TitleStyle = { id: string; name: string } & Pick<TextLayer, (typeof CORE)[number]> & Partial<Pick<TextLayer, (typeof EXTRA)[number]>>;

export const BUILTIN_STYLES: TitleStyle[] = [
  { id: 'clean', name: 'Clean', font: 'sans', bold: true, size: 0.12, color: '#ffffff', shadow: true, box: false },
  { id: 'slam', name: 'Word slam', font: 'impact', bold: false, size: 0.32, color: '#f3a8f0', shadow: false, box: false, fit: 'width' },
  { id: 'poster', name: 'Poster', font: 'sans', bold: true, size: 0.14, color: '#1f3f72', shadow: false, box: false, anim: 'type', animIn: 0.3, spacing: -0.02 },
  { id: 'hollow', name: 'Hollow', font: 'sans', bold: true, size: 0.2, color: '#ffffff', shadow: false, box: false, stroke: 0.02, strokeColor: '#ffffff', strokeOnly: true },
  { id: 'bleed', name: 'Film lyric', font: 'impact', bold: false, size: 0.16, color: '#ffffff', highlight: '#e11d2b', shadow: false, box: false, strobe: 5, spacing: -0.02, lineHeight: 0.95 },
  { id: 'ticker', name: 'Ticker', font: 'impact', bold: false, size: 0.13, color: '#e11d2b', shadow: false, box: false, repeat: 'across', repeatGap: 0.3, scroll: 0.25 },
  { id: 'notes', name: 'Red notes', font: 'sans', bold: true, size: 0.05, color: '#ff1f1f', highlight: '#2a3bff', shadow: false, box: false, anim: 'type', animIn: 0.25, boil: 0.6 },
  { id: 'story', name: 'Storybook', font: 'serif', bold: false, size: 0.08, color: '#161616', shadow: false, box: false, anim: 'slide', animIn: 0.6 },
  { id: 'sticker', name: 'Sticker', font: 'impact', bold: false, size: 0.16, color: '#ffffff', shadow: false, box: false, fx: { outline: { width: 0.007, color: '#111111' }, shadow: { dx: 0, dy: 0.006, blur: 0.012, color: 'rgba(0,0,0,0.55)' } }, anim: 'pop', animIn: 0.35 },
  { id: 'sunset', name: 'Sunset', font: 'impact', bold: false, size: 0.2, color: '#ffd23f', gradient: { to: '#ff2a6d', angle: 90 }, shadow: false, box: false },
  { id: 'glitch', name: 'Glitch caption', font: 'mono', bold: true, size: 0.06, color: '#ffffff', shadow: false, box: true, anim: 'glitch', animIn: 0.4 },
];

/** A title's look as a style called `name`. */
export function styleOf(l: TextLayer, id: string, name: string): TitleStyle {
  const s: Record<string, unknown> = { id, name };
  for (const k of STYLE_KEYS) if (l[k] !== undefined) s[k] = l[k];
  return s as TitleStyle;
}

/** Give a title a style's look (its words, place and timing stay); settings the style leaves out go back to plain. */
export function applyStyle(l: TextLayer, s: TitleStyle) {
  const t = l as unknown as Record<string, unknown>;
  for (const k of STYLE_KEYS) {
    // karaoke captions keep their highlight under a style without one
    if (k === 'highlight' && !s.highlight && l.words?.length) continue;
    if (s[k] !== undefined) t[k] = s[k];
    else delete t[k];
  }
}

/** Does the title look exactly like the style? */
export function hasStyle(l: TextLayer, s: TitleStyle): boolean {
  return STYLE_KEYS.every((k) => {
    if (k === 'anim' || k === 'exit') return (l[k] ?? 'none') === (s[k] ?? 'none');
    if (k === 'highlight' && !s.highlight && l.words?.length) return true;
    return (l[k] ?? null) === (s[k] ?? null);
  });
}

// ---------- styles for shapes and stickers ----------

/** The settings a shape style carries (its kind, size and place stay). */
export const SHAPE_STYLE_KEYS = ['color', 'width', 'fill', 'glow', 'drawOn', 'boil', 'fx'] as const;

export type ShapeStyle = { id: string; name: string } & Partial<Pick<ShapeLayer, (typeof SHAPE_STYLE_KEYS)[number]>>;

export const BUILTIN_SHAPE_STYLES: ShapeStyle[] = [
  { id: 'notes', name: 'Red notes', color: '#ff1f1f', width: 0.006, boil: 0.6, drawOn: 0.4 },
  { id: 'neon', name: 'Neon', color: '#22d3ee', width: 0.006, glow: 0.8 },
  { id: 'chalk', name: 'Chalk', color: '#f5f0e6', width: 0.005, boil: 0.9, drawOn: 0.5 },
  { id: 'marker', name: 'Marker', color: '#ffe600', width: 0.012, fx: { shadow: { dx: 0.002, dy: 0.004, blur: 0.004, color: 'rgba(0,0,0,0.5)' } } },
  { id: 'sticker', name: 'Sticker', color: '#ffffff', width: 0.01, fx: { outline: { width: 0.006, color: '#ffffff' }, shadow: { dx: 0, dy: 0.006, blur: 0.01, color: 'rgba(0,0,0,0.5)' } } },
  { id: 'plain', name: 'Plain', color: '#ffffff', width: 0.004 },
];

/** A shape's look as a style called `name`. */
export function shapeStyleOf(l: ShapeLayer, id: string, name: string): ShapeStyle {
  const s: Record<string, unknown> = { id, name };
  for (const k of SHAPE_STYLE_KEYS) if (l[k] !== undefined) s[k] = JSON.parse(JSON.stringify(l[k]));
  return s as ShapeStyle;
}

/** Give a shape a style's look; what the style leaves out goes back to plain (a filled shape keeps a fill, in the new colour). */
export function applyShapeStyle(l: ShapeLayer, s: ShapeStyle) {
  const t = l as unknown as Record<string, unknown>;
  const filled = !!l.fill;
  for (const k of SHAPE_STYLE_KEYS) {
    if (k === 'fill') continue;
    if (s[k] !== undefined) t[k] = JSON.parse(JSON.stringify(s[k]));
    else delete t[k];
  }
  if (s.fill !== undefined) l.fill = s.fill;
  else if (filled && s.color) l.fill = s.color;
}

/** Does the shape look exactly like the style? */
export function hasShapeStyle(l: ShapeLayer, s: ShapeStyle): boolean {
  return SHAPE_STYLE_KEYS.every((k) => k === 'fill' || JSON.stringify(l[k] ?? null) === JSON.stringify(s[k] ?? null));
}
