// Operations on several layers at once: reveal them one per beat.
import { store } from './store.svelte';
import { beatInfo } from './beatinfo.svelte';
import { beatPoints } from '../engine/wordbeats';
import { revealOrder, revealPlan, revealPoints } from '../engine/reveal';
import { popKeys, type Keys, type PopOptions } from '../engine/keys';
import { transformOf, VIDEO_TRACK, type Clip } from '../engine/types';
import { swapKeys } from '../engine/keys';
import { layoutVideo, layers as upperLayers, clipLen } from '../engine/timeline';
import { mediaOf } from '../engine/timeline';
import { flashLayers } from '../engine/flash';
import { nextRow } from '../engine/layers';
import { uid } from '../engine/timeline';
import { timelineDuration } from '../engine/timeline';

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

/** Move an upper-track clip so it starts on the nearest beat. */
export function startOnBeat(clipId: string) {
  const c = store.project.clips.find((x) => x.id === clipId);
  if (!c || c.track === 'v1') return;
  if (beatInfo.status !== 'ready' || !beatInfo.beats.length) return store.toast('No beat found yet: put music on an audio track first.', 'info');
  const at = beatInfo.beats.reduce((b, p) => (Math.abs(p - c.start) < Math.abs(b - c.start) ? p : b), beatInfo.beats[0]);
  store.edit((p) => {
    const x = p.clips.find((y) => y.id === clipId);
    if (x) x.start = Math.round(at * 1000) / 1000;
  });
}

/** Give an upper-track clip a pop-in at its start (or, with null, take it off): the keys are written to its position, size and opacity. */
export function setPop(clipId: string, pop: PopOptions | null) {
  store.edit((p) => {
    const c = p.clips.find((y) => y.id === clipId);
    if (!c) return;
    const T = transformOf(c);
    const keys: Keys = { ...(c.keys ?? {}) };
    // what an earlier pop wrote goes first
    for (const k of ['zoom', 'x', 'y', 'opacity'] as const) delete keys[k];
    if (pop) Object.assign(keys, popKeys({ zoom: T.zoom, x: T.x, y: T.y }, pop));
    if (Object.keys(keys).length) c.keys = keys;
    else delete c.keys;
    if (pop) c.pop = pop;
    else delete c.pop;
  });
}

/**
 * Make the clips of a split screen swap places on the beat (every `every` beats, half a second
 * apart with no beat): the selected clips, or the ones under the playhead, trade cells in turn.
 * It works for layouts whose cells are all the same size (side by side, stacked, 2 × 2, 3 × 3), where only
 * the position and size need to move.
 */
export function swapCellsOnBeat(every = 1) {
  const p = store.project;
  const t = store.ui.time;
  const picture = (c: Clip) => !!mediaOf(p, c.mediaId)?.hasVideo && mediaOf(p, c.mediaId)!.source.kind !== 'adjust';
  const start = (c: Clip) => (c.track === VIDEO_TRACK ? (layoutVideo(p).find((pl) => pl.clip.id === c.id)?.start ?? 0) : c.start);
  const sel = store.ui.selectedClips.map((id) => p.clips.find((c) => c.id === id)).filter((c): c is Clip => !!c && picture(c));
  const under = [...layoutVideo(p).filter((pl) => t >= pl.start && t < pl.end).map((pl) => pl.clip), ...upperLayers(p).filter((l) => t >= l.start && t < l.end).map((l) => l.clip)].filter(picture);
  const clips = sel.length >= 2 ? sel : under;
  if (clips.length < 2) return store.toast('Put two or more clips in a split screen first (Canvas panel › Split screen), then select them.', 'error', 5000);
  const crop = (c: Clip) => JSON.stringify([c.transform?.cropL ?? 0, c.transform?.cropR ?? 0, c.transform?.cropT ?? 0, c.transform?.cropB ?? 0].map((v) => Math.round(v * 1e4)));
  if (new Set(clips.map(crop)).size > 1) return store.toast('Swapping needs cells that are all the same size: side by side, stacked, 2 × 2 or 3 × 3.', 'error', 6000);
  const places = clips.map((c) => {
    const T = transformOf(c);
    return { zoom: T.zoom, x: T.x, y: T.y };
  });
  // the moments to swap, on the timeline: from the first at or after the playhead through the end of the shortest clip
  const end = Math.min(...clips.map((c) => start(c) + clipLen(c)));
  const from = Math.max(t, Math.max(...clips.map(start)));
  const pts = beatInfo.status === 'ready' ? beatPoints(beatInfo.beats, every) : [];
  let times = pts.filter((x) => x > from + 1e-3 && x < end - 1e-3);
  if (!times.length) {
    times = [];
    for (let x = from + 0.5 * every; x < end - 1e-3; x += 0.5 * every) times.push(x);
  }
  const frame = 1 / store.project.encoder.fps;
  store.edit((q) => {
    clips.forEach((c, i) => {
      const x = q.clips.find((y) => y.id === c.id)!;
      const local = times.map((v) => v - start(c));
      x.keys = { ...(x.keys ?? {}), ...swapKeys(places, i, local, frame) };
    });
  });
  store.toast(`${clips.length} clips swap places ${beatInfo.status === 'ready' ? 'on the beat' : 'every ' + 0.5 * every + ' s (no beat found)'}.`, 'ok', 5000);
}

/** Flash a flat colour for a couple of frames on every beat from the playhead on (a few seconds of it, or `seconds`). */
export function flashOnBeats(colour = '#ffffff', frames = 2, seconds = 8) {
  if (beatInfo.status !== 'ready' || !beatInfo.beats.length) return store.toast('No beat found yet: put music on an audio track first.', 'info');
  const from = store.ui.time;
  const to = Math.min(from + seconds, Math.max(from + 0.5, timelineDuration(store.project) || from + seconds));
  const row = nextRow(store.project.layers);
  const made = flashLayers(beatInfo.beats, from, to, { colour, frames, fps: store.project.encoder.fps }, row, uid, uid());
  if (!made.length) return store.toast('No beats between the playhead and the end.', 'info');
  store.edit((p) => p.layers.push(...made));
  store.toast(`${made.length} flashes on the beat. They are one group.`, 'ok');
}

/** Make titles and shapes appear on the nearest beat (their length stays what it is). */
export function layersOnBeat(ids: string[]) {
  if (beatInfo.status !== 'ready' || !beatInfo.beats.length) return store.toast('No beat found yet: put music on an audio track first.', 'info');
  const near = (t: number) => beatInfo.beats.reduce((b, p) => (Math.abs(p - t) < Math.abs(b - t) ? p : b), beatInfo.beats[0]);
  store.edit((p) => {
    for (const l of p.layers) if (ids.includes(l.id)) l.start = Math.round(near(l.start) * 1000) / 1000;
  });
}
