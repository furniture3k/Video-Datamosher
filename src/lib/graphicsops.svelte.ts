// Operations on several layers at once: reveal them one per beat.
import { store } from './store.svelte';
import { beatInfo } from './beatinfo.svelte';
import { beatPoints } from '../engine/wordbeats';
import { revealOrder, revealPlan, revealPoints } from '../engine/reveal';

/**
 * Make the selected titles and shapes come in one after another on the beat grid (`every` beats
 * apart: ¼, ½, 1…), starting at the first beat at or after the earliest of them, each staying up
 * until the last one's end. With no beats, in even steps of half a second.
 */
export function revealOnBeats(every = 1) {
  const ids = store.ui.selectedClips.filter((id) => store.project.layers.some((l) => l.id === id));
  if (ids.length < 2) return store.toast('Select two or more titles or shapes first: they come in one per beat.', 'info');
  const layers = store.project.layers;
  const order = revealOrder(layers, ids);
  const from = Math.min(...layers.filter((l) => ids.includes(l.id)).map((l) => l.start));
  const points = beatInfo.status === 'ready' ? beatPoints(beatInfo.beats, every) : [];
  const plan = revealPlan(layers, order, revealPoints(order.length, points, from, 0.5 * every));
  store.edit((p) => {
    for (const r of plan) {
      const l = p.layers.find((x) => x.id === r.id);
      if (l) {
        l.start = r.start;
        l.duration = r.duration;
      }
    }
  });
  store.toast(beatInfo.status === 'ready' ? `Revealed ${plan.length} layers, one per ${every === 1 ? 'beat' : every + ' beats'}.` : `Revealed ${plan.length} layers half a second apart (no beat found: put music on an audio track to land them on it).`, 'ok', 5000);
}
