import { describe, expect, it } from 'vitest';
import { BUILTIN_STYLES, applyStyle, hasStyle, styleOf } from '../src/engine/styles';
import type { TextLayer } from '../src/engine/layers';

const title = (o: Partial<TextLayer> = {}): TextLayer => ({ id: 't', kind: 'text', row: 'g1', text: 'Hi', start: 1, duration: 2, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.3, y: 0.7, align: 'center', shadow: true, box: false, fade: 0.2, moshed: true, ...o });

describe('title styles', () => {
  it('change the look, not the words, place, timing or melting', () => {
    const l = title();
    const slam = BUILTIN_STYLES.find((s) => s.id === 'slam')!;
    applyStyle(l, slam);
    expect([l.font, l.size, l.color, l.shadow, l.anim, l.animIn]).toEqual(['impact', 0.32, '#f3a8f0', false, 'pop', 0.12]);
    expect([l.text, l.x, l.y, l.start, l.duration, l.fade, l.moshed]).toEqual(['Hi', 0.3, 0.7, 1, 2, 0.2, true]);
    expect(hasStyle(l, slam)).toBe(true);
  });

  it('put plain settings back for what the style leaves out', () => {
    const l = title({ anim: 'glitch', animIn: 2, highlight: '#ff0' });
    const clean = BUILTIN_STYLES.find((s) => s.id === 'clean')!;
    applyStyle(l, clean);
    expect(l.anim).toBe('none');
    expect('animIn' in l).toBe(false);
    expect('highlight' in l).toBe(false);
  });

  it("keep a karaoke caption's highlight under a style without one", () => {
    const l = title({ words: [{ t0: 0, t1: 1, text: 'Hi' }], highlight: '#ffd23f' });
    const clean = BUILTIN_STYLES.find((s) => s.id === 'clean')!;
    applyStyle(l, clean);
    expect(l.highlight).toBe('#ffd23f');
    expect(hasStyle(l, clean)).toBe(true);
  });

  it('save a title as a style and put it on another', () => {
    const s = styleOf(title({ font: 'serif', color: '#123456', anim: 'slide', animIn: 0.4 }), 'mine', 'Mine');
    const other = title({ id: 'o', text: 'Other' });
    applyStyle(other, s);
    expect(hasStyle(other, s)).toBe(true);
    expect(other.text).toBe('Other');
    expect(BUILTIN_STYLES.filter((b) => hasStyle(other, b))).toEqual([]);
  });

  it('built-in styles have distinct ids and names', () => {
    expect(new Set(BUILTIN_STYLES.map((s) => s.id)).size).toBe(BUILTIN_STYLES.length);
    expect(new Set(BUILTIN_STYLES.map((s) => s.name)).size).toBe(BUILTIN_STYLES.length);
  });
});
