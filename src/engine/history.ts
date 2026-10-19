// Names for undo steps ("Add Bloom", "Trim Test pattern", "Melt a cut"), worked out by comparing the
// project before and after, so no edit has to label itself.
import type { TextLayer } from './layers';
import type { Project, Clip, EffectInstance } from './types';
import { EFFECTS } from './effects';
import { MOSH_TRANSITIONS, BLEND_TRANSITIONS } from './timeline';

const fxName = (e: EffectInstance) => e.name || EFFECTS[e.type]?.name || e.type;
const clipName = (p: Project, c: Clip) => {
  const m = p.media.find((x) => x.id === c.mediaId);
  return m?.source.name.replace(/\.[^.]+$/, '') || 'clip';
};
const plural = (n: number, one: string, many = one + 's') => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

function effects(a: Project, b: Project): string | null {
  const A = byId(a.effects);
  const B = byId(b.effects);
  const added = b.effects.filter((e) => !A.has(e.id));
  const removed = a.effects.filter((e) => !B.has(e.id));
  if (added.length && removed.length && added.length + removed.length > 2) return 'Replace the effects';
  if (added.length) return added.length === 1 ? `Add ${fxName(added[0])}` : `Add ${plural(added.length, 'effect')}`;
  if (removed.length) return removed.length === 1 ? `Remove ${fxName(removed[0])}` : `Remove ${plural(removed.length, 'effect')}`;
  for (const e of b.effects) {
    const o = A.get(e.id)!;
    if (same(o, e)) continue;
    if (o.start !== e.start || o.end !== e.end) return o.end - o.start === e.end - e.start ? `Move ${fxName(e)}` : `Resize ${fxName(e)}`;
    if (o.enabled !== e.enabled) return `${e.enabled ? 'Turn on' : 'Turn off'} ${fxName(e)}`;
    if (!same(o.auto, e.auto)) return `Automate ${fxName(e)}`;
    if (o.seed !== e.seed) return `New seed for ${fxName(e)}`;
    return `Change ${fxName(e)}`;
  }
  if (!same(a.effects.map((e) => e.id), b.effects.map((e) => e.id))) return 'Reorder the effects';
  return null;
}

function clips(a: Project, b: Project): string | null {
  const A = byId(a.clips);
  const B = byId(b.clips);
  const added = b.clips.filter((c) => !A.has(c.id));
  const removed = a.clips.filter((c) => !B.has(c.id));
  // a split: one clip shortened (a reversed clip loses its in point) and one new clip of the same media
  if (added.length === 1 && !removed.length) {
    const n = added[0];
    const cut = b.clips.find((c) => c.id !== n.id && c.mediaId === n.mediaId && A.has(c.id) && (A.get(c.id)!.out !== c.out || A.get(c.id)!.in !== c.in));
    if (cut) return `Split ${clipName(b, n)}`;
    return `Add ${clipName(b, n)}`;
  }
  if (added.length && !removed.length) return `Add ${plural(added.length, 'clip')}`;
  if (removed.length && !added.length) return removed.length === 1 ? `Delete ${clipName(a, removed[0])}` : `Delete ${plural(removed.length, 'clip')}`;
  if (added.length || removed.length) return 'Rearrange clips';
  const changed = b.clips.filter((c) => !same(A.get(c.id), c));
  if (!changed.length) return same(a.clips.map((c) => c.id), b.clips.map((c) => c.id)) ? null : 'Reorder clips';
  if (changed.length > 1) {
    if (changed.every((c) => c.start !== A.get(c.id)!.start && c.in === A.get(c.id)!.in && c.out === A.get(c.id)!.out)) return `Move ${plural(changed.length, 'clip')}`;
    if (changed.every((c) => !same(c.transition, A.get(c.id)!.transition))) return 'Change transitions';
    return `Edit ${plural(changed.length, 'clip')}`;
  }
  const c = changed[0];
  const o = A.get(c.id)!;
  const name = clipName(b, c);
  if (!same(o.transition, c.transition)) {
    if (!c.transition) return 'Remove a transition';
    const t = MOSH_TRANSITIONS[c.transition.type]?.name ?? BLEND_TRANSITIONS[c.transition.type]?.name ?? 'transition';
    return o.transition?.type === c.transition.type ? `Change the ${t}` : `${t} on a cut`;
  }
  // a slip moves both source edges by the same amount (the clip keeps its place and length)
  if (o.in !== c.in || o.out !== c.out) return o.in !== c.in && o.start === c.start && Math.abs(o.out - o.in - (c.out - c.in)) < 1e-6 ? `Slip ${name}` : `Trim ${name}`;
  if (o.start !== c.start || o.track !== c.track) return `Move ${name}`;
  if (o.speed !== c.speed || !same(o.ramp, c.ramp)) return `Speed of ${name}`;
  if (o.reverse !== c.reverse) return `Reverse ${name}`;
  if (o.enabled !== c.enabled) return `${c.enabled === false ? 'Turn off' : 'Turn on'} ${name}`;
  if (o.volume !== c.volume || o.muted !== c.muted || o.fadeIn !== c.fadeIn || o.fadeOut !== c.fadeOut) return `Sound of ${name}`;
  if (!same(o.transform, c.transform) || !same(o.keys, c.keys)) return `Transform ${name}`;
  if (!same(o.grade, c.grade) || !same(o.key, c.key)) return `Colour of ${name}`;
  return `Edit ${name}`;
}

function texts(a: Project, b: Project): string | null {
  const A = byId<TextLayer>(a.layers);
  const added = b.layers.filter((t) => !A.has(t.id));
  const removedN = a.layers.length - (b.layers.length - added.length);
  if (added.length) return added.length === 1 ? 'Add a title' : `Add ${plural(added.length, 'title')}`;
  if (removedN > 0) return removedN === 1 ? 'Delete a title' : `Delete ${plural(removedN, 'title')}`;
  const t = b.layers.find((x) => !same(A.get(x.id), x));
  if (!t) return null;
  const o = A.get(t.id)!;
  if (o.text !== t.text) return `Title: “${t.text.slice(0, 24)}”`;
  if (o.start !== t.start || o.duration !== t.duration) return 'Move a title';
  return 'Style a title';
}

/** A short name for what changed between two versions of a project. */
export function describeChange(a: Project, b: Project): string {
  if (a.name !== b.name) return `Rename to “${b.name}”`;
  if (!same(a.media.map((m) => m.id), b.media.map((m) => m.id))) {
    const n = b.media.length - a.media.length;
    if (n > 0) return `Import ${plural(n, 'file')}`;
    if (n < 0) return `Remove ${plural(-n, 'file')} from the library`;
  }
  const fx = effects(a, b);
  const cl = clips(a, b);
  // a template, preset or auto-edit changes clips and effects at once
  if (fx && cl) return 'Edit clips and effects';
  if (cl) return cl;
  if (fx) return fx;
  const tx = texts(a, b);
  if (tx) return tx;
  if ((a.chaos ?? 1) !== (b.chaos ?? 1)) return `Chaos ${Math.round((b.chaos ?? 1) * 100)}%`;
  if (!same(a.encoder, b.encoder)) return a.encoder.keyMarkers.length !== b.encoder.keyMarkers.length ? 'Force a keyframe' : 'Encode settings';
  if (!same(a.decoder, b.decoder)) return 'Decode settings';
  if (!same(a.audio, b.audio) || !same(a.tracks, b.tracks)) return 'Tracks and sound';
  if (!same(a.markers, b.markers)) return 'Markers';
  if (a.globalSeed !== b.globalSeed) return 'New seed';
  return 'Edit';
}
