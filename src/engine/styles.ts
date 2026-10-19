// Title styles: everything about how a title is drawn apart from its words, place and timing,
// saved under a name so one look can go on every title. The built-in ones come from edits
// people post (word-per-cut slams, tour posters, film lyrics, red notes on the street, storybook).
import type { TextLayer } from './layers';

/** The settings a style carries. */
export const STYLE_KEYS = ['font', 'bold', 'size', 'color', 'highlight', 'shadow', 'box', 'anim', 'animIn'] as const;
type StyleKey = (typeof STYLE_KEYS)[number];

export type TitleStyle = { id: string; name: string } & Pick<TextLayer, Exclude<StyleKey, 'highlight' | 'anim' | 'animIn'>> & Partial<Pick<TextLayer, 'highlight' | 'anim' | 'animIn'>>;

export const BUILTIN_STYLES: TitleStyle[] = [
  { id: 'clean', name: 'Clean', font: 'sans', bold: true, size: 0.12, color: '#ffffff', shadow: true, box: false, anim: 'none' },
  { id: 'slam', name: 'Word slam', font: 'impact', bold: false, size: 0.32, color: '#f3a8f0', shadow: false, box: false, anim: 'pop', animIn: 0.12 },
  { id: 'poster', name: 'Poster', font: 'sans', bold: true, size: 0.14, color: '#1f3f72', shadow: false, box: false, anim: 'type', animIn: 0.3 },
  { id: 'bleed', name: 'Film lyric', font: 'impact', bold: false, size: 0.16, color: '#ffffff', highlight: '#e11d2b', shadow: false, box: false, anim: 'none' },
  { id: 'notes', name: 'Red notes', font: 'sans', bold: true, size: 0.05, color: '#ff1f1f', highlight: '#2a3bff', shadow: false, box: false, anim: 'type', animIn: 0.25 },
  { id: 'story', name: 'Storybook', font: 'serif', bold: false, size: 0.08, color: '#161616', shadow: false, box: false, anim: 'slide', animIn: 0.6 },
  { id: 'glitch', name: 'Glitch caption', font: 'mono', bold: true, size: 0.06, color: '#ffffff', shadow: false, box: true, anim: 'glitch', animIn: 0.4 },
];

/** A title's look as a style called `name`. */
export function styleOf(l: TextLayer, id: string, name: string): TitleStyle {
  const s: TitleStyle = { id, name, font: l.font, bold: l.bold, size: l.size, color: l.color, shadow: l.shadow, box: l.box };
  if (l.highlight) s.highlight = l.highlight;
  if (l.anim) s.anim = l.anim;
  if (l.animIn !== undefined) s.animIn = l.animIn;
  return s;
}

/** Give a title a style's look (its words, place and timing stay); settings the style leaves out go back to plain. */
export function applyStyle(l: TextLayer, s: TitleStyle) {
  l.font = s.font;
  l.bold = s.bold;
  l.size = s.size;
  l.color = s.color;
  l.shadow = s.shadow;
  l.box = s.box;
  l.anim = s.anim ?? 'none';
  if (s.animIn !== undefined) l.animIn = s.animIn;
  else delete l.animIn;
  // karaoke captions keep a highlight colour; others take the style's
  if (s.highlight) l.highlight = s.highlight;
  else if (!l.words?.length) delete l.highlight;
}

/** Does the title look exactly like the style? */
export function hasStyle(l: TextLayer, s: TitleStyle): boolean {
  return STYLE_KEYS.every((k) => {
    if (k === 'anim') return (l.anim ?? 'none') === (s.anim ?? 'none');
    // karaoke captions keep their own highlight under a style without one
    if (k === 'highlight' && !s.highlight && l.words?.length) return true;
    return l[k] === s[k];
  });
}
