// Words on the beat: a sentence or lyrics cut into words (or lines), each its own title from one
// beat (or cut) to the next, so the words land on the music one after another.
import { FIRST_ROW, type TextLayer } from './layers';
import { subdivide } from './beattime';

/** The pieces of a text: its words, or its non-empty lines. */
export function splitWords(text: string, per: 'word' | 'line'): string[] {
  return per === 'line'
    ? text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : text.split(/\s+/).filter(Boolean);
}

/** The points of a beat grid every `every` beats (¼ and ½ fall between beats). */
export function beatPoints(beats: number[], every: number): number[] {
  if (every < 1) return subdivide(beats, Math.round(1 / every));
  const step = Math.max(1, Math.round(every));
  return beats.filter((_, i) => i % step === 0);
}

/**
 * Where each of `n` pieces goes: from one point to the next, starting at the first point at or
 * after `from` (seconds). Pieces past the last point are left out.
 */
export function wordSlots(n: number, points: number[], from: number): [number, number][] {
  const sorted = [...points].sort((a, b) => a - b);
  const first = sorted.findIndex((p) => p >= from - 1e-3);
  if (first < 0) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < n && first + i + 1 < sorted.length; i++) out.push([sorted[first + i], sorted[first + i + 1]]);
  return out;
}

/** One title per piece in its slot, all in the look of `like`, on graphics row `row`. */
export function wordTitles(pieces: string[], slots: [number, number][], like: Omit<TextLayer, 'id' | 'text' | 'start' | 'duration' | 'row'>, row: string = FIRST_ROW, newId: () => string): TextLayer[] {
  return slots.map(([a, b], i) => ({ ...JSON.parse(JSON.stringify(like)), id: newId(), text: pieces[i], start: a, duration: Math.max(0.04, b - a), row }));
}
