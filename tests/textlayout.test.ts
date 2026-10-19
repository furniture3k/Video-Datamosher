import { describe, expect, it } from 'vitest';
import { FIT_WIDTH, layoutText, lettersShown, textLookAt } from '../src/engine/textlayout';
import { isStill, type TextLayer } from '../src/engine/layers';

/** a font where every letter is half as wide as it is tall */
const measure = (s: string) => [...s].length * 50;
const title = (o: Partial<TextLayer> = {}): TextLayer => ({ id: 't', kind: 'text', row: 'g1', text: 'ABCD', start: 1, duration: 4, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, ...o });

describe('title layout', () => {
  it('centres lines on the position, letter by letter', () => {
    const L = layoutText(title({ text: 'AB\nCDEF' }), 1000, 500, measure);
    expect(L.size).toBe(50);
    expect(L.lineHeight).toBe(60);
    expect(L.lines.map((l) => [l.x, l.y, l.width])).toEqual([[-25, -30, 50], [-50, 30, 100]]);
    expect(L.lines[1].letters).toEqual([0, 25, 50, 75]);
    expect(L.box).toEqual({ x: -50, y: -60, w: 100, h: 120 });
  });

  it('aligns to the left or right of the position', () => {
    expect(layoutText(title({ align: 'left' }), 1000, 500, measure).lines[0].x).toBe(0);
    expect(layoutText(title({ align: 'right' }), 1000, 500, measure).lines[0].x).toBe(-100);
  });

  it('spaces letters and lines out', () => {
    const L = layoutText(title({ spacing: 0.2, lineHeight: 2 }), 1000, 500, measure);
    // 4 letters of 25 px, 3 gaps of 10 px
    expect(L.lines[0].width).toBe(130);
    expect(L.lines[0].letters).toEqual([0, 35, 70, 105]);
    expect(L.lineHeight).toBe(100);
  });

  it('fits to the frame width, spacing and all', () => {
    const L = layoutText(title({ fit: 'width', spacing: 0.2, text: 'AB\nABCD' }), 1000, 500, measure);
    expect(L.lines[1].width).toBeCloseTo(1000 * FIT_WIDTH, 6);
    expect(L.size).toBeCloseTo((1000 * FIT_WIDTH) / 2.6, 6);
  });

  it('pads the background box', () => {
    const L = layoutText(title({ box: true }), 1000, 500, measure);
    expect(L.box).toEqual({ x: -70, y: -40, w: 140, h: 80 });
  });
});

describe('title animation', () => {
  it('is settled outside its entrance and exit', () => {
    const look = textLookAt(title({ anim: 'slam', exit: 'slide' }), 3);
    expect([look.visible, look.alpha, look.scale, look.dx, look.dy, look.letters]).toEqual([true, 1, 1, 0, 0, 1]);
  });

  it('comes in: slam starts big, slide starts low and clear, type shows some letters', () => {
    expect(textLookAt(title({ anim: 'slam', animIn: 1 }), 1).scale).toBeCloseTo(2.4);
    const slide = textLookAt(title({ anim: 'slide', animIn: 1 }), 1);
    expect([slide.alpha, slide.dy]).toEqual([0, 1.2]);
    expect(textLookAt(title({ anim: 'type', animIn: 1 }), 1.5).letters).toBeCloseTo(0.5);
    expect(textLookAt(title({ anim: 'drop', animIn: 1 }), 1).dy).toBeCloseTo(-2.2);
  });

  it('goes out: the exit is the entrance backwards, ending at the end', () => {
    const l = title({ exit: 'type', animOut: 1 });
    expect(textLookAt(l, 4.5).letters).toBeCloseTo(0.5);
    expect(textLookAt(l, 4.999).letters).toBeLessThan(0.01);
  });

  it('strobes on and off', () => {
    const l = title({ strobe: 2 });
    // two blinks a second: on for a quarter second, off for a quarter
    expect([1, 1.3, 1.55, 1.8].map((t) => textLookAt(l, t).visible)).toEqual([true, false, true, false]);
  });

  it('boils between a few drawings', () => {
    const l = title({ boil: 1 });
    const at = (t: number) => JSON.stringify(textLookAt(l, t));
    expect(at(1)).toBe(at(1 + 3 / 8));
    expect(at(1)).not.toBe(at(1 + 1 / 8));
  });

  it('shows whole words only, word by word', () => {
    expect(lettersShown('HELLO WORLD', 0, 11, 7 / 11, false)).toBe(7);
    expect(lettersShown('HELLO WORLD', 0, 11, 7 / 11, true)).toBe(5);
    expect(lettersShown('SECOND', 6, 12, 0.25, false)).toBe(0);
  });

  it('moving looks are drawn for every frame when they melt', () => {
    expect(isStill(title())).toBe(true);
    for (const o of [{ exit: 'pop' as const }, { strobe: 4 }, { boil: 0.5 }, { repeat: 'across' as const, scroll: 0.2 }]) expect(isStill(title(o))).toBe(false);
    expect(isStill(title({ repeat: 'both' }))).toBe(true);
  });
});
