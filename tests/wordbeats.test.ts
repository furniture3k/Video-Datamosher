import { describe, expect, it } from 'vitest';
import { beatPoints, splitWords, wordSlots, wordTitles } from '../src/engine/wordbeats';
import type { TextLayer } from '../src/engine/layers';

describe('words on the beat', () => {
  it('cuts text into words or lines', () => {
    expect(splitWords('  everything works\nin my   favor ', 'word')).toEqual(['everything', 'works', 'in', 'my', 'favor']);
    expect(splitWords('first line\n\n  second line  \n', 'line')).toEqual(['first line', 'second line']);
  });

  it('takes every beat, every other, or halves and quarters between them', () => {
    const beats = [0, 0.5, 1, 1.5, 2];
    expect(beatPoints(beats, 1)).toEqual(beats);
    expect(beatPoints(beats, 2)).toEqual([0, 1, 2]);
    expect(beatPoints([0, 1], 0.5)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('gives each piece the time from one point to the next, from the playhead on', () => {
    expect(wordSlots(3, [0, 1, 2, 3, 4], 0.9)).toEqual([[1, 2], [2, 3], [3, 4]]);
    // more words than points: the ones that don't fit are left out
    expect(wordSlots(5, [0, 1, 2], 0)).toEqual([[0, 1], [1, 2]]);
    expect(wordSlots(2, [0, 1], 5)).toEqual([]);
  });

  it('makes one title per word in the chosen look', () => {
    const like = { kind: 'text', font: 'impact', bold: false, size: 0.3, color: '#f3a8f0', x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: true, fit: 'width' } as Omit<TextLayer, 'id' | 'text' | 'start' | 'duration' | 'row'>;
    let n = 0;
    const out = wordTitles(['EVERYTHING', 'WORKS'], [[1, 1.25], [1.25, 1.5]], like, 'g3', () => 'w' + n++);
    expect(out.map((l) => [l.id, l.text, l.start, l.duration, l.row, l.fit, l.moshed])).toEqual([
      ['w0', 'EVERYTHING', 1, 0.25, 'g3', 'width', true],
      ['w1', 'WORKS', 1.25, 0.25, 'g3', 'width', true],
    ]);
  });
});
