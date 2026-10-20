import { describe, expect, it } from 'vitest';
import { moveGroupMates, regroup, withGroups, type Layer, type TextLayer } from '../src/engine/layers';
import { revealOrder, revealPlan, revealPoints } from '../src/engine/reveal';
import { applyScript, newScript, scriptPieces, scriptSlots } from '../src/engine/script';
import { setPose } from '../src/engine/gizmo';

const text = (id: string, extra: Partial<TextLayer> = {}): TextLayer => ({ id, kind: 'text', row: 'g1', text: id, start: 0, duration: 2, size: 0.1, color: '#fff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, ...extra });
let n = 0;
const newId = () => 'n' + ++n;

describe('groups', () => {
  const layers: Layer[] = [text('a', { group: 'g' }), text('b', { group: 'g' }), text('c'), text('d', { group: 'h' })];
  it('picks up everything grouped with what is chosen', () => {
    expect(withGroups(layers, ['a'])).toEqual(['a', 'b']);
    expect(withGroups(layers, ['c'])).toEqual(['c']);
    expect(withGroups(layers, ['b', 'd'])).toEqual(['a', 'b', 'd']);
    expect(withGroups(layers, [])).toEqual([]);
  });
  it('gives copies of a group a group of their own, and leaves loose layers alone', () => {
    const copies = regroup([{ group: 'g' }, { group: 'g' }, { group: undefined }, { group: 'h' }], newId);
    expect(copies[0].group).toBe(copies[1].group);
    expect(copies[0].group).not.toBe('g');
    expect(copies[2].group).toBeUndefined();
    expect(copies[3].group).not.toBe(copies[0].group);
  });
  it('moves the rest of the group when one layer moves (and what they follow)', () => {
    const ls: Layer[] = [text('a', { group: 'g', x: 0.3 }), text('b', { group: 'g', x: 0.5, follow: [[0, 0.5, 0.5], [1, 0.6, 0.5]] }), text('c', { x: 0.7 })];
    moveGroupMates(ls, 'a', 0.1, -0.05);
    expect([ls[1].x, ls[1].y]).toEqual([0.6, 0.45]);
    expect(ls[1].follow!.map((f) => f.map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[0, 0.6, 0.45], [1, 0.7, 0.45]]);
    expect(ls[2].x).toBe(0.7);
    expect(ls[0].x).toBe(0.3);
  });
  it('is what the handles do: dragging one layer takes its group with it, in one go', () => {
    const p = { clips: [], media: [], layers: [text('a', { group: 'g', x: 0.3, y: 0.4 }), text('b', { group: 'g', x: 0.5, y: 0.6 }), text('c', { x: 0.7, y: 0.2 })] } as never;
    setPose(p, 'a', 0, { x: 0.4, y: 0.4, scale: 0.1, turn: 0 }, 0.01);
    const ls = (p as { layers: Layer[] }).layers;
    expect(ls[0].x).toBeCloseTo(0.4, 9);
    expect(ls[1].x).toBeCloseTo(0.6, 9);
    expect(ls[2].x).toBe(0.7);
  });
});

describe('reveal one per beat', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  it('steps through the beat points from the first at or after where it starts', () => {
    expect(revealPoints(3, beats, 0.6)).toEqual([1, 1.5, 2]);
    expect(revealPoints(2, beats, 0)).toEqual([0, 0.5]);
  });
  it('carries on in even steps when the beats run out, or there are none', () => {
    expect(revealPoints(4, beats, 2.5)).toEqual([2.5, 3, 3.5, 4]);
    expect(revealPoints(3, [], 1, 0.4).map((v) => Math.round(v * 10) / 10)).toEqual([1.4, 1.8, 2.2]);
  });
  it('starts each layer on its point and keeps them all up to one end', () => {
    const ls = [{ id: 'a', start: 0, duration: 2 }, { id: 'b', start: 0, duration: 3 }, { id: 'c', start: 1, duration: 1 }];
    const plan = revealPlan(ls, ['a', 'b', 'c'], [1, 1.5, 2]);
    expect(plan.map((p) => p.start)).toEqual([1, 1.5, 2]);
    // the latest end any had (3 s) is where they all end
    expect(plan.map((p) => Math.round((p.start + p.duration) * 100) / 100)).toEqual([3, 3, 3]);
    expect(revealPlan(ls, ['zzz'], [1])).toEqual([]);
  });
  it('orders what is selected by start time, then from the top of the picture down', () => {
    const ls = [{ id: 'a', start: 2, y: 0.5 }, { id: 'b', start: 1, y: 0.8 }, { id: 'c', start: 1, y: 0.2 }, { id: 'd', start: 0, y: 0.1 }];
    expect(revealOrder(ls, ['a', 'b', 'c'])).toEqual(['c', 'b', 'a']);
  });
});

describe('a script', () => {
  const like = (({ id: _a, text: _b, start: _c, duration: _d, row: _e, ...rest }) => rest)(text('x'));
  it('is cut into lines or words', () => {
    expect(scriptPieces({ text: 'one two\n\n three ', per: 'word' })).toEqual(['one', 'two', 'three']);
    expect(scriptPieces({ text: 'one two\n\n three ', per: 'line' })).toEqual(['one two', 'three']);
  });
  it('is timed one after another, or from beat to beat', () => {
    const s = { ...newScript(1), hold: 2 };
    expect(scriptSlots(3, s)).toEqual([[1, 2], [3, 2], [5, 2]]);
    const b = { ...s, mode: 'beats' as const };
    expect(scriptSlots(3, b, [0, 0.5, 1, 1.5, 2, 2.5])).toEqual([[1, 0.5], [1.5, 0.5], [2, 0.5]]);
    // not enough beats: fewer titles
    expect(scriptSlots(5, b, [0, 0.5, 1, 1.5, 2]).length).toBe(2);
  });
  it('makes a title for each line, in order', () => {
    const r = applyScript([], { ...newScript(0), text: 'first\nsecond\nthird', hold: 1 }, [], like, newId);
    const ts = r.layers as TextLayer[];
    expect(ts.map((t) => t.text)).toEqual(['first', 'second', 'third']);
    expect(ts.map((t) => t.start)).toEqual([0, 1, 2]);
    expect(r.script.ids).toEqual(ts.map((t) => t.id));
  });
  it('edits the titles it made when the text changes, keeping the looks changed since', () => {
    const first = applyScript([], { ...newScript(0), text: 'first\nsecond', hold: 1 }, [], like, newId);
    (first.layers[0] as TextLayer).color = '#ff0000';
    // a word changed, a line added, in a project with another title too
    const other = text('other');
    const second = applyScript([...first.layers, other], { ...first.script, text: 'first!\nsecond\nthird' }, [], like, newId);
    const ts = second.layers.filter((l) => second.script.ids.includes(l.id)) as TextLayer[];
    expect(ts.map((t) => t.text)).toEqual(['first!', 'second', 'third']);
    expect(ts[0].id).toBe(first.script.ids[0]);
    expect(ts[0].color).toBe('#ff0000');
    expect(second.layers.find((l) => l.id === 'other')).toBeTruthy();
  });
  it('takes titles away when lines are deleted, and puts new ones in the look of the last', () => {
    const first = applyScript([], { ...newScript(0), text: 'a\nb\nc', hold: 1 }, [], like, newId);
    (first.layers[2] as TextLayer).size = 0.33;
    const fewer = applyScript(first.layers, { ...first.script, text: 'a' }, [], like, newId);
    expect(fewer.layers.length).toBe(1);
    const more = applyScript(first.layers, { ...first.script, text: 'a\nb\nc\nd' }, [], like, newId);
    expect((more.layers[3] as TextLayer).size).toBe(0.33);
    expect(more.layers.length).toBe(4);
  });
  it('re-times everything when it is switched to the beats', () => {
    const first = applyScript([], { ...newScript(0), text: 'a\nb', hold: 1 }, [], like, newId);
    const r = applyScript(first.layers, { ...first.script, mode: 'beats' }, [0, 0.5, 1, 1.5], like, newId);
    expect((r.layers as TextLayer[]).map((t) => [t.start, t.duration])).toEqual([[0, 0.5], [0.5, 0.5]]);
  });
});

describe('the depth stack', async () => {
  const { depthStack, swapDrawOrder, drawOrder } = await import('../src/engine/layers');
  const ls: Layer[] = [text('a', { row: 'g1' }), text('b', { row: 'g2', depth: 'behind' }), text('c', { row: 'g3' }), text('d', { row: 'g1', depth: 'inside' }), text('e', { row: 'g4', start: 5, duration: 1 })];
  it('splits what is on screen by which side of the subject it is drawn on, back to front', () => {
    const s = depthStack(ls, 1);
    expect(s.behind.map((l) => l.id)).toEqual(['d', 'b']);
    expect(s.front.map((l) => l.id)).toEqual(['a', 'c']);
    // 'e' is not on screen yet
    expect(depthStack(ls, 5.5).front.map((l) => l.id)).toEqual(['e']);
  });
  it('swaps two layers on different rows by swapping their rows', () => {
    const l2: Layer[] = ls.map((l) => ({ ...l }));
    swapDrawOrder(l2, 'a', 'c');
    expect(l2.find((l) => l.id === 'a')!.row).toBe('g3');
    expect(l2.find((l) => l.id === 'c')!.row).toBe('g1');
    expect(drawOrder(l2).map((l) => l.id).indexOf('c')).toBeLessThan(drawOrder(l2).map((l) => l.id).indexOf('a'));
  });
  it('swaps two layers on one row by their places in the list, and ignores nonsense', () => {
    const l2: Layer[] = [text('x', { row: 'g1' }), text('y', { row: 'g1' })];
    swapDrawOrder(l2, 'x', 'y');
    expect(l2.map((l) => l.id)).toEqual(['y', 'x']);
    swapDrawOrder(l2, 'x', 'nope');
    swapDrawOrder(l2, 'x', 'x');
    expect(l2.map((l) => l.id)).toEqual(['y', 'x']);
  });
});
