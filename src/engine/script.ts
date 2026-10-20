// A script: lines (or words) that become titles one after another, or on the beats, and stay
// linked to the text you wrote, so editing it changes the titles (pure: the look and beats come in).
import { splitWords } from './wordbeats';
import { FIRST_ROW, type Layer, type TextLayer } from './layers';

export interface Script {
  /** what is written */
  text: string;
  /** a title for each line or for each word */
  per: 'line' | 'word';
  /** 'after': each for `hold` seconds, one after another; 'beats': each from one beat to the next */
  mode: 'after' | 'beats';
  /** seconds each stays up in 'after' mode */
  hold: number;
  /** beats between titles in 'beats' mode (¼, ½, 1, 2…) */
  every: number;
  /** seconds: when the first appears */
  start: number;
  /** the titles it made, in order */
  ids: string[];
}

export const newScript = (start = 0): Script => ({ text: '', per: 'line', mode: 'after', hold: 1.5, every: 1, start, ids: [] });

/** The pieces of the script: its lines, or its words. */
export const scriptPieces = (s: Pick<Script, 'text' | 'per'>) => splitWords(s.text, s.per);

/** When each of `n` titles starts and how long it stays. `points`: the beat points (every `s.every` beats), for 'beats'. */
export function scriptSlots(n: number, s: Pick<Script, 'mode' | 'hold' | 'start'>, points: number[] = []): [number, number][] {
  if (s.mode === 'after') return Array.from({ length: n }, (_, i) => [s.start + i * s.hold, s.hold] as [number, number]);
  const sorted = [...points].sort((a, b) => a - b);
  const first = sorted.findIndex((p) => p >= s.start - 1e-3);
  const out: [number, number][] = [];
  if (first < 0) return out;
  for (let i = 0; i < n && first + i + 1 < sorted.length; i++) out.push([sorted[first + i], Math.max(0.04, sorted[first + i + 1] - sorted[first + i])]);
  return out;
}

/**
 * Make the layers match the script: the titles it made get the new words and times (keeping every
 * look change made to them since), new lines get new titles in the look of the last one (or `like`),
 * and titles whose lines are gone are removed. Returns the new layer list and the script with its ids.
 */
export function applyScript(layers: Layer[], s: Script, points: number[], like: Omit<TextLayer, 'id' | 'text' | 'start' | 'duration' | 'row'>, newId: () => string, row: string = FIRST_ROW): { layers: Layer[]; script: Script } {
  const pieces = scriptPieces(s);
  const slots = scriptSlots(pieces.length, s, points);
  const made = s.ids.map((id) => layers.find((l): l is TextLayer => l.id === id && l.kind === 'text')).filter((l): l is TextLayer => !!l);
  const base = made.length ? made[made.length - 1] : undefined;
  const ids: string[] = [];
  const out = layers.filter((l) => !s.ids.includes(l.id) || slots.some((_, i) => made[i]?.id === l.id));
  slots.forEach(([at, dur], i) => {
    const mine = made[i];
    if (mine) {
      const l = out.find((x) => x.id === mine.id) as TextLayer;
      l.text = pieces[i];
      l.start = Math.round(at * 1000) / 1000;
      l.duration = Math.round(dur * 1000) / 1000;
      ids.push(l.id);
    } else {
      const look = base ? (({ id: _i, text: _t, start: _s, duration: _d, row: _r, ...rest }) => rest)(JSON.parse(JSON.stringify(base)) as TextLayer) : like;
      const id = newId();
      out.push({ ...JSON.parse(JSON.stringify(look)), id, kind: 'text', text: pieces[i], start: Math.round(at * 1000) / 1000, duration: Math.round(dur * 1000) / 1000, row: base?.row ?? row } as TextLayer);
      ids.push(id);
    }
  });
  return { layers: out, script: { ...s, ids } };
}
