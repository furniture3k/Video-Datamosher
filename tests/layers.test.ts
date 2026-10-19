import { describe, expect, it } from 'vitest';
import { drawOrder, isStill, layerAlpha, layerPos, layerRows, layersIn, nextRow, type TextLayer } from '../src/engine/layers';
import { migrate } from '../src/engine/migrate';

const text = (o: Partial<TextLayer> = {}): TextLayer => ({ id: 't', kind: 'text', row: 'g1', text: 'Hi', start: 2, duration: 4, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 1, moshed: false, ...o });

describe('layer timing', () => {
  it('fades in and out and is off screen outside its time', () => {
    const l = text();
    expect(layerAlpha(l, 1.9)).toBe(0);
    expect(layerAlpha(l, 2.5)).toBeCloseTo(0.5);
    expect(layerAlpha(l, 4)).toBe(1);
    expect(layerAlpha(l, 5.5)).toBeCloseTo(0.5);
    expect(layerAlpha(l, 6)).toBe(0);
    // a fade longer than half the layer is capped
    expect(layerAlpha(text({ fade: 9 }), 4)).toBeCloseTo(1);
  });

  it('follows a tracked path, held at its ends', () => {
    const l = text({ follow: [[2, 0.1, 0.2], [4, 0.5, 0.6]] });
    expect(layerPos(l, 1)).toEqual([0.1, 0.2]);
    const [x, y] = layerPos(l, 3);
    expect(x).toBeCloseTo(0.3);
    expect(y).toBeCloseTo(0.4);
    expect(layerPos(l, 9)).toEqual([0.5, 0.6]);
    expect(layerPos(text(), 3)).toEqual([0.5, 0.5]);
  });

  it('knows which layers can be drawn once for every frame', () => {
    expect(isStill(text())).toBe(true);
    expect(isStill(text({ anim: 'none' }))).toBe(true);
    expect(isStill(text({ anim: 'type' }))).toBe(false);
    expect(isStill(text({ follow: [[0, 0, 0]] }))).toBe(false);
    expect(isStill(text({ words: [{ t0: 0, t1: 1, text: 'Hi' }], highlight: '#ff0' }))).toBe(false);
  });

  it('finds the layers on screen in a range', () => {
    const ls = [text({ id: 'a', start: 0, duration: 1 }), text({ id: 'b', start: 1, duration: 1 })];
    expect(layersIn(ls, 0.5, 1).map((l) => l.id)).toEqual(['a']);
    expect(layersIn(ls, 0.5, 1.5).map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('graphics rows', () => {
  it('draws lower rows first, in list order within a row', () => {
    const ls = [text({ id: 'a', row: 'g2' }), text({ id: 'b', row: 'g10' }), text({ id: 'c', row: 'g1' }), text({ id: 'd', row: 'g2' })];
    expect(drawOrder(ls).map((l) => l.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('lists the rows in use and makes a new one on top', () => {
    expect(layerRows([])).toEqual(['g1']);
    expect(layerRows([text({ row: 'g3' })])).toEqual(['g1', 'g3']);
    expect(nextRow([text({ row: 'g3' })])).toBe('g4');
    expect(nextRow([])).toBe('g2');
  });
});

describe('v2 projects', () => {
  const v2text = { id: 't1', text: 'Hello', start: 1, duration: 2, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0.3, moshed: true };
  const v2 = {
    version: 2,
    name: 'old',
    media: [{ id: 'm1', source: { kind: 'file', fileId: 'f', name: 'c.mp4', mime: '', isImage: false, ext: 'mp4', compound: { clips: [], tracks: [], texts: [{ ...v2text, id: 't2' }], effects: [] } }, duration: 5, width: 320, height: 240, fps: 24, hasAudio: false, hasVideo: true }],
    clips: [],
    tracks: [],
    texts: [v2text],
    encoder: {},
    decoder: {},
    effects: [],
    audio: {},
    globalSeed: 1,
  };

  it('become v3 with their titles as text layers on the first row', () => {
    const p = migrate(JSON.parse(JSON.stringify(v2)));
    expect(p.version).toBe(3);
    expect('texts' in p).toBe(false);
    expect(p.layers).toEqual([{ ...v2text, kind: 'text', row: 'g1' }]);
  });

  it('convert the titles inside compound clips too', () => {
    const p = migrate(JSON.parse(JSON.stringify(v2)));
    const src = p.media[0].source;
    if (src.kind !== 'file' || !src.compound) throw new Error('lost the compound');
    expect(src.compound.layers.map((l) => [l.id, l.kind, l.row])).toEqual([['t2', 'text', 'g1']]);
    expect('texts' in src.compound).toBe(false);
  });

  it('migrate again without change', () => {
    const p = migrate(JSON.parse(JSON.stringify(v2)));
    expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
