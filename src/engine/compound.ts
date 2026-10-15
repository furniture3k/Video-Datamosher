// Compound (nested) clips: a run of clips folded into one clip whose picture and sound are its
// own little timeline, rendered to a file. Pure functions over projects.
import { layoutVideo, timelineDuration } from './timeline';
import { uid } from './presets';
import { CLIP_AUDIO, VIDEO_TRACK, defaultTracks, type Clip, type MediaItem, type Project, type Sequence } from './types';

export const compoundOf = (m: MediaItem | undefined): Sequence | undefined => (m?.source.kind === 'file' ? m.source.compound : undefined);

/** The timeline inside a compound, with the project's settings and media. */
export function innerProject(parent: Project, seq: Sequence): Project {
  return { ...parent, clips: seq.clips, tracks: seq.tracks, texts: seq.texts, effects: seq.effects, markers: seq.markers ?? [] };
}

/** What gets rendered into the compound's file (its own mosh only when `moshInside`). */
export const renderProject = (parent: Project, seq: Sequence): Project => ({ ...innerProject(parent, seq), effects: seq.moshInside ? seq.effects : [] });

export const sequenceOf = (inner: Pick<Project, 'clips' | 'tracks' | 'texts' | 'effects' | 'markers'>, moshInside = false): Sequence => ({
  clips: inner.clips,
  tracks: inner.tracks,
  texts: inner.texts,
  effects: inner.effects,
  markers: inner.markers ?? [],
  moshInside,
});

/** The parent with a compound's sequence (and its file, once rendered) updated. */
export function withSequence(parent: Project, mediaId: string, seq: Sequence, file?: { fileId: string; duration: number }): Project {
  const media = parent.media.map((m) => {
    if (m.id !== mediaId || m.source.kind !== 'file') return m;
    const source: typeof m.source = { ...m.source, compound: seq, stale: !file };
    if (file) source.fileId = file.fileId;
    return { ...m, source, duration: file?.duration ?? m.duration };
  });
  // clips of the compound can't run past the end of a shorter new version
  // (only once it's rendered: until then the new length isn't known)
  const dur = file ? file.duration : Infinity;
  const clips = parent.clips.map((c) => (c.mediaId === mediaId && c.out > dur ? { ...c, out: dur, in: Math.min(c.in, Math.max(0, dur - 0.1)) } : c));
  return { ...parent, media, clips };
}

/**
 * Fold clips of the main track into a compound. The run goes from the first to the last
 * selected clip. Returns the sequence and the parent with one clip (of `media`) in their place.
 */
export function buildCompound(parent: Project, ids: string[], media: MediaItem): { seq: Sequence; project: Project } {
  const placed = layoutVideo(parent);
  const idx = placed.map((p, i) => (ids.includes(p.clip.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) throw new Error('Select clips on the main video track first.');
  const run = placed.slice(Math.min(...idx), Math.max(...idx) + 1);
  if (run.some((p) => compoundOf(p.media)?.clips.some((c) => c.mediaId === media.id))) throw new Error('A compound clip can\'t contain itself.');
  const t0 = run[0].start;
  const t1 = run.at(-1)!.end;
  const fps = parent.encoder.fps;
  const [f0, f1] = [Math.round(t0 * fps), Math.round(t1 * fps)];
  const clips: Clip[] = run.map((p, i) => ({ ...p.clip, ...(i === 0 ? { transition: undefined } : {}) }));
  // effects that sit wholly inside the run move in with it (they keep working out here too)
  const effects = parent.effects.filter((e) => e.start >= f0 && e.end <= f1).map((e) => ({ ...e, id: uid(), start: e.start - f0, end: e.end - f0 }));
  const seq: Sequence = {
    clips,
    tracks: defaultTracks().filter((t) => t.id === VIDEO_TRACK || t.id === CLIP_AUDIO),
    texts: [],
    effects,
    markers: [],
    moshInside: false,
  };
  const first = run[0].clip;
  const len = timelineDuration({ clips, media: parent.media, texts: [] });
  const clip: Clip = {
    id: uid(),
    mediaId: media.id,
    track: VIDEO_TRACK,
    start: 0,
    in: 0,
    out: len,
    speed: 1,
    reverse: false,
    fit: 'fill',
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    ...(first.transition ? { transition: first.transition } : {}),
  };
  const runIds = new Set(run.map((p) => p.clip.id));
  const out: Clip[] = [];
  for (const c of parent.clips) {
    if (!runIds.has(c.id)) out.push(c);
    else if (c.id === first.id) out.push(clip);
  }
  return { seq, project: { ...parent, clips: out } };
}

/**
 * While editing inside compounds: the outermost project with every open level's current
 * edit written back into its compound (marked stale until it's rendered again).
 */
export function rootWithInner(stack: { parent: Project; mediaId: string }[], current: Project): Project {
  let inner = current;
  for (let i = stack.length - 1; i >= 0; i--) {
    const { parent, mediaId } = stack[i];
    const old = compoundOf(parent.media.find((m) => m.id === mediaId));
    // media imported inside joins the parent's library
    const media = [...parent.media, ...inner.media.filter((m) => !parent.media.some((p) => p.id === m.id))];
    inner = withSequence({ ...parent, media }, mediaId, sequenceOf(inner, old?.moshInside));
  }
  return inner;
}

export const staleCompounds = (p: Project) => p.media.filter((m) => m.source.kind === 'file' && m.source.compound && m.source.stale);
