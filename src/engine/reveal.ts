// Revealing layers one per beat: several layers selected, and they come in one after another on the
// beat grid, each staying until the end (pure: the beat points come in).
import type { Layer } from './layers';

/** The points a reveal steps through: from the first at or after `from`, `n` of them, then the end. Even steps of `fallback` seconds when there are no beats. */
export function revealPoints(n: number, points: number[], from: number, fallback = 0.5): number[] {
  const sorted = [...points].sort((a, b) => a - b);
  const first = sorted.findIndex((p) => p >= from - 1e-3);
  if (first < 0 || sorted.length - first < n) {
    // not enough beats: carry on in even steps from the last one (or from where it starts)
    const have = first < 0 ? [] : sorted.slice(first);
    const out = [...have];
    let t = have.length ? have[have.length - 1] : from;
    while (out.length < n) out.push((t += fallback));
    return out;
  }
  return sorted.slice(first, first + n);
}

/**
 * New starts and durations for layers revealed one per point, in the order given. Each stays on
 * until `end` (the latest end any of them had, or a little after the last start).
 */
export function revealPlan(layers: Pick<Layer, 'id' | 'start' | 'duration'>[], order: string[], points: number[]): { id: string; start: number; duration: number }[] {
  const chosen = order.map((id) => layers.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l);
  if (!chosen.length) return [];
  const last = points[Math.min(points.length, chosen.length) - 1];
  const end = Math.max(last + 0.5, ...chosen.map((l) => l.start + l.duration));
  return chosen.map((l, i) => {
    const start = Math.round(points[i] * 1000) / 1000;
    return { id: l.id, start, duration: Math.round(Math.max(0.1, end - start) * 1000) / 1000 };
  });
}

/** The order to reveal selected layers in: by when they start now, then top to bottom on the screen. */
export function revealOrder(layers: Pick<Layer, 'id' | 'start' | 'y'>[], ids: string[]): string[] {
  return layers
    .filter((l) => ids.includes(l.id))
    .map((l, i) => [l, i] as const)
    .sort((a, b) => a[0].start - b[0].start || a[0].y - b[0].y || a[1] - b[1])
    .map(([l]) => l.id);
}
