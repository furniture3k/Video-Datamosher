// Timeline model: layout of the magnetic video track, audio tracks, segments for rendering,
// pure edit operations and the mapping that keeps effects attached to footage across edits.
import { CLIP_AUDIO, VIDEO_TRACK, type Clip, type EffectInstance, type MediaItem, type Project, type Track, type Transition, type TransitionType } from './types';
import { EFFECTS, defaultParams } from './effects';
import { hashSeed } from './rng';

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Transitions that blend two shots (both are on screen at once, so the clips overlap). */
export const BLEND_TRANSITIONS: Record<string, { name: string; xfade: string }> = {
  dissolve: { name: 'Cross dissolve', xfade: 'fade' },
  dip: { name: 'Dip to black', xfade: 'fadeblack' },
  dipwhite: { name: 'Dip to white', xfade: 'fadewhite' },
  wipeleft: { name: 'Wipe left', xfade: 'wipeleft' },
  wiperight: { name: 'Wipe right', xfade: 'wiperight' },
  wipeup: { name: 'Wipe up', xfade: 'wipeup' },
  wipedown: { name: 'Wipe down', xfade: 'wipedown' },
  slideleft: { name: 'Slide left', xfade: 'slideleft' },
  slideright: { name: 'Slide right', xfade: 'slideright' },
  circleopen: { name: 'Circle open', xfade: 'circleopen' },
  pixelize: { name: 'Pixelize', xfade: 'pixelize' },
};

/** Transitions made by the mosh engine at a hard cut. */
export const MOSH_TRANSITIONS: Record<string, { name: string; description: string }> = {
  melt: { name: 'Melt', description: 'The keyframe at the cut is removed, so the next shot moves on top of the last picture.' },
  bloom: { name: 'Bloom melt', description: 'Melt, then the first motion of the next shot repeats and smears outward.' },
  glitch: { name: 'Glitch cut', description: 'Melt with a burst of corrupted data around the cut.' },
  stutter: { name: 'Stutter melt', description: 'Melt, then the motion rocks back and forth in loops.' },
  liquid: { name: 'Liquid melt', description: 'Melt with flow-warped, amplified motion.' },
};

export const transitionName = (t: TransitionType) => BLEND_TRANSITIONS[t]?.name ?? MOSH_TRANSITIONS[t]?.name ?? t;
export const isBlend = (t?: Transition) => !!t && t.type in BLEND_TRANSITIONS && t.duration > 0;
export const isMoshTransition = (t?: Transition) => !!t && t.type in MOSH_TRANSITIONS;

export const clipLen = (c: Pick<Clip, 'in' | 'out' | 'speed'>) => Math.max(0.04, (c.out - c.in) / Math.max(0.01, c.speed));

export interface Placed {
  clip: Clip;
  media: MediaItem;
  index: number;
  start: number;
  end: number;
  /** seconds this clip overlaps the previous one (blend transition) */
  overlap: number;
}

export const mediaOf = (p: Pick<Project, 'media'>, id: string) => p.media.find((m) => m.id === id);
export const videoClips = (p: Pick<Project, 'clips'>) => p.clips.filter((c) => c.track === VIDEO_TRACK);
export const audioClips = (p: Pick<Project, 'clips'>) => p.clips.filter((c) => c.track !== VIDEO_TRACK);

/** Effective overlap of a blend transition: never more than half of either clip. */
export function overlapOf(prev: Clip | undefined, c: Clip): number {
  if (!prev || !isBlend(c.transition)) return 0;
  return Math.max(0, Math.min(c.transition!.duration, clipLen(prev) / 2, clipLen(c) / 2));
}

export function layoutVideo(p: Pick<Project, 'clips' | 'media'>): Placed[] {
  const out: Placed[] = [];
  let t = 0;
  let prev: Clip | undefined;
  let index = 0;
  for (const clip of videoClips(p)) {
    const media = mediaOf(p, clip.mediaId);
    if (!media) continue;
    const overlap = overlapOf(prev, clip);
    const start = Math.max(0, t - overlap);
    const end = start + clipLen(clip);
    out.push({ clip, media, index: index++, start, end, overlap });
    t = end;
    prev = clip;
  }
  return out;
}

export const videoEnd = (p: Pick<Project, 'clips' | 'media'>) => layoutVideo(p).at(-1)?.end ?? 0;

export function timelineDuration(p: Pick<Project, 'clips' | 'media' | 'texts'>): number {
  let d = videoEnd(p);
  for (const c of audioClips(p)) if (mediaOf(p, c.mediaId)) d = Math.max(d, c.start + clipLen(c));
  for (const t of p.texts ?? []) d = Math.max(d, t.start + t.duration);
  return d;
}

export const timelineFrames = (p: Pick<Project, 'clips' | 'media' | 'texts'>, fps: number) => Math.max(1, Math.round(timelineDuration(p) * fps));

/** Source time shown at `local` seconds into a clip. */
export function sourceTime(c: Clip, local: number): number {
  const l = Math.max(0, Math.min(clipLen(c), local));
  return c.reverse ? c.out - l * c.speed : c.in + l * c.speed;
}

/** Inverse of sourceTime (may fall outside the clip). */
export function localTime(c: Clip, src: number): number {
  return c.reverse ? (c.out - src) / c.speed : (src - c.in) / c.speed;
}

export interface Segment {
  start: number;
  end: number;
  /** first and last frame (exclusive) on the timeline */
  f0: number;
  f1: number;
  clips: Placed[];
}

/**
 * Split the timeline into independently encoded pieces. Clips joined by a blend transition
 * must be encoded together; everything else starts a new piece (each piece starts with a
 * keyframe, which is exactly what melts need). With `whole`, everything is one piece.
 */
export function segments(p: Pick<Project, 'clips' | 'media' | 'texts'>, fps: number, whole = false): Segment[] {
  const placed = layoutVideo(p);
  const total = timelineDuration(p);
  const runs: Placed[][] = [];
  for (const pl of placed) {
    if (!runs.length || (!whole && pl.overlap <= 0)) runs.push([pl]);
    else runs.at(-1)!.push(pl);
  }
  const segs: Segment[] = runs.map((clips) => ({ start: clips[0].start, end: clips.at(-1)!.end, f0: 0, f1: 0, clips }));
  const vEnd = segs.at(-1)?.end ?? 0;
  if (total - vEnd > 0.02) {
    if (whole && segs.length) segs[0].end = total;
    else segs.push({ start: vEnd, end: total, f0: 0, f1: 0, clips: [] });
  }
  for (const s of segs) {
    s.f0 = Math.round(s.start * fps);
    s.f1 = Math.max(s.f0 + 1, Math.round(s.end * fps));
  }
  // close rounding gaps so frame ranges tile the timeline
  for (let i = 1; i < segs.length; i++) segs[i].f0 = segs[i - 1].f1;
  for (const s of segs) s.f1 = Math.max(s.f0 + 1, s.f1);
  return segs;
}

/** First frame of every video clip after the first (where the cuts are). */
export function cutFrames(p: Pick<Project, 'clips' | 'media'>, fps: number): number[] {
  return layoutVideo(p)
    .slice(1)
    .map((pl) => Math.round(pl.start * fps));
}

// ---------------------------------------------------------------- mosh transitions

function trEffect(c: Clip, k: number, type: string, start: number, end: number, params: Record<string, unknown>): EffectInstance {
  return {
    id: `tr:${c.id}:${k}`,
    type,
    enabled: true,
    solo: false,
    start: Math.max(0, start),
    end: Math.max(start + 1, end),
    seed: hashSeed(7, k, c.id),
    params: { ...defaultParams(EFFECTS[type].params), ...params } as EffectInstance['params'],
    auto: {},
    locks: [],
    transition: c.id,
  };
}

/** The effects a mosh transition stands for (positioned at its cut). */
export function transitionEffects(p: Pick<Project, 'clips' | 'media'>, fps: number): EffectInstance[] {
  const out: EffectInstance[] = [];
  for (const pl of layoutVideo(p)) {
    const t = pl.clip.transition;
    if (pl.index === 0 || !isMoshTransition(t)) continue;
    const cut = Math.round(pl.start * fps);
    const d = Math.max(2, Math.round(t!.duration * fps));
    const I = Math.max(0, Math.min(1, t!.intensity));
    const c = pl.clip;
    out.push(trEffect(c, 0, 'kill', cut - 1, cut + (t!.type === 'melt' ? d : 2), { mode: 'all' }));
    if (t!.type === 'bloom') out.push(trEffect(c, 1, 'bloom', cut, cut + d, { target: 'first', repeats: Math.round(4 + I * 44) }));
    if (t!.type === 'glitch') out.push(trEffect(c, 1, 'glitch', cut - Math.round(d / 3), cut + d, { mode: 'replace', amount: Math.round((1 + I * 10) * 10) / 10, probability: 0.5 + I * 0.5, target: 'all' }));
    if (t!.type === 'stutter') out.push(trEffect(c, 1, 'stutter', cut, cut + d, { group: 4, loops: Math.round(1 + I * 5), every: 0, pingpong: true }));
    if (t!.type === 'liquid') out.push(trEffect(c, 1, 'vectorWarp', cut, cut + d, { amplify: 1 + I * 2.5, smooth: true, residual: 0.05 }));
  }
  return out;
}

/** Times (s) that need a keyframe: mosh-transition cuts, so the melt has something to remove. */
export function transitionKeyTimes(p: Pick<Project, 'clips' | 'media'>): number[] {
  return layoutVideo(p)
    .filter((pl) => pl.index > 0 && isMoshTransition(pl.clip.transition))
    .map((pl) => pl.start);
}

// ---------------------------------------------------------------- audio sources

export interface AudioSource {
  clip: Clip;
  media: MediaItem;
  start: number;
  len: number;
  fadeIn: number;
  fadeOut: number;
  gain: number;
  bus: 'mosh' | 'clean';
}

export function audibleTracks(p: Pick<Project, 'tracks'>): Set<string> {
  const audio = p.tracks.filter((t) => t.kind === 'audio');
  const solo = audio.some((t) => t.solo);
  return new Set(audio.filter((t) => !t.muted && (!solo || t.solo)).map((t) => t.id));
}

export const trackOf = (p: Pick<Project, 'tracks'>, id: string): Track | undefined => p.tracks.find((t) => t.id === id);

/** Every piece of sound on the timeline, with fades (blend transitions crossfade clip audio). */
export function audioSources(p: Pick<Project, 'clips' | 'media' | 'tracks'>): AudioSource[] {
  const on = audibleTracks(p);
  const out: AudioSource[] = [];
  const placed = layoutVideo(p);
  const ca = trackOf(p, CLIP_AUDIO);
  if (ca && on.has(CLIP_AUDIO))
    placed.forEach((pl, i) => {
      if (!pl.media.hasAudio || pl.clip.muted || pl.clip.volume <= 0) return;
      const len = pl.end - pl.start;
      const next = placed[i + 1]?.overlap ?? 0;
      out.push({ clip: pl.clip, media: pl.media, start: pl.start, len, fadeIn: Math.max(pl.clip.fadeIn, pl.overlap), fadeOut: Math.max(pl.clip.fadeOut, next), gain: pl.clip.volume * ca.volume, bus: ca.mosh ? 'mosh' : 'clean' });
    });
  for (const c of audioClips(p)) {
    const tr = trackOf(p, c.track);
    const media = mediaOf(p, c.mediaId);
    if (!tr || !media || !media.hasAudio || !on.has(c.track) || c.muted || c.volume <= 0) continue;
    out.push({ clip: c, media, start: c.start, len: clipLen(c), fadeIn: c.fadeIn, fadeOut: c.fadeOut, gain: c.volume * tr.volume, bus: tr.mosh ? 'mosh' : 'clean' });
  }
  return out;
}

// ---------------------------------------------------------------- edit operations

export function makeClip(media: MediaItem, track: string, extra: Partial<Clip> = {}): Clip {
  const len = media.source.kind === 'file' && media.source.isImage ? 3 : media.duration;
  return {
    id: uid(),
    mediaId: media.id,
    track,
    start: 0,
    in: 0,
    out: Math.max(0.1, len),
    speed: 1,
    reverse: false,
    fit: 'fit',
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    ...extra,
  };
}

/** Index among the video clips of the cut nearest to time t (0..n). */
export function nearestCut(p: Pick<Project, 'clips' | 'media'>, t: number): number {
  const placed = layoutVideo(p);
  let best = placed.length;
  let bd = Infinity;
  const edges = [0, ...placed.map((pl) => pl.end)];
  edges.forEach((e, i) => {
    if (Math.abs(e - t) < bd) ((bd = Math.abs(e - t)), (best = i));
  });
  return best;
}

/** Insert a clip on the video track before the video clip at `index` (end if index >= n). */
export function insertVideo(p: Project, clip: Clip, index: number) {
  clip.track = VIDEO_TRACK;
  const vids = videoClips(p);
  if (index >= vids.length) p.clips.push(clip);
  else p.clips.splice(p.clips.indexOf(vids[Math.max(0, index)]), 0, clip);
}

export function moveVideo(p: Project, id: string, toIndex: number) {
  const vids = videoClips(p);
  const from = vids.findIndex((c) => c.id === id);
  if (from < 0) return;
  const [c] = p.clips.splice(p.clips.indexOf(vids[from]), 1);
  const rest = videoClips(p);
  const j = toIndex > from ? toIndex - 1 : toIndex;
  if (j >= rest.length) p.clips.push(c);
  else p.clips.splice(p.clips.indexOf(rest[Math.max(0, j)]), 0, c);
  // nothing comes before the first clip, so it can't have a transition into it
  const first = videoClips(p)[0];
  if (first) first.transition = undefined;
}

/** Split a clip at timeline time t. Returns the new (right-hand) clip, or null. */
export function splitClip(p: Project, id: string, t: number): Clip | null {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return null;
  const start = c.track === VIDEO_TRACK ? layoutVideo(p).find((pl) => pl.clip.id === id)?.start : c.start;
  if (start === undefined) return null;
  const local = t - start;
  const len = clipLen(c);
  if (local < 0.05 || local > len - 0.05) return null;
  const at = sourceTime(c, local);
  const b: Clip = { ...c, id: uid(), transition: undefined, fadeIn: 0, start: c.start + local };
  if (c.reverse) {
    b.out = at;
    c.in = at;
  } else {
    b.in = at;
    c.out = at;
  }
  c.fadeOut = 0;
  p.clips.splice(p.clips.indexOf(c) + 1, 0, b);
  return b;
}

export function clipsAt(p: Project, t: number): Clip[] {
  const out: Clip[] = [];
  for (const pl of layoutVideo(p)) if (t > pl.start + 0.01 && t < pl.end - 0.01) out.push(pl.clip);
  for (const c of audioClips(p)) if (t > c.start + 0.01 && t < c.start + clipLen(c) - 0.01) out.push(c);
  return out;
}

export function deleteClips(p: Project, ids: string[]) {
  const set = new Set(ids);
  p.clips = p.clips.filter((c) => !set.has(c.id));
  // the first video clip can't have a transition into it
  const first = videoClips(p)[0];
  if (first) first.transition = undefined;
}

/** Media-bounded trim. edge 'l' moves the clip's start, 'r' its end. dt in timeline seconds. */
export function trimClip(p: Project, id: string, edge: 'l' | 'r', dt: number, orig: Clip) {
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  const maxSrc = m.source.kind === 'file' && m.source.isImage ? 3600 : m.source.kind === 'generator' ? 3600 : m.duration;
  const ds = dt * orig.speed;
  const minLen = 0.1 * orig.speed;
  // which source edge moves depends on direction of play
  const moveIn = (edge === 'l') !== orig.reverse;
  if (moveIn) {
    const delta = edge === 'l' ? ds : -ds;
    c.in = Math.max(0, Math.min(orig.out - minLen, orig.in + delta));
  } else {
    const delta = edge === 'r' ? ds : -ds;
    c.out = Math.min(maxSrc, Math.max(orig.in + minLen, orig.out + delta));
  }
  if (edge === 'l' && c.track !== VIDEO_TRACK) {
    // keep the right edge where it was
    c.start = Math.max(0, orig.start + clipLen(orig) - clipLen(c));
  }
}

/** Detach a video clip's sound onto an audio track (as its own clip). */
export function detachAudio(p: Project, id: string, track: string): Clip | null {
  const pl = layoutVideo(p).find((x) => x.clip.id === id);
  if (!pl || !pl.media.hasAudio || pl.clip.muted) return null;
  const a: Clip = { ...pl.clip, id: uid(), track, start: pl.start, transition: undefined };
  p.clips.push(a);
  pl.clip.muted = true;
  return a;
}

// ---------------------------------------------------------------- keep effects on their footage

/**
 * Map a frame position from one version of the timeline to another, following the footage:
 * a point inside a clip stays on the same source moment of that clip (or the clip it was split
 * into). Points in deleted clips land on the cut that replaced them.
 */
export function mapTime(a: Project, b: Project, t: number): number {
  const la = layoutVideo(a);
  const lb = layoutVideo(b);
  const aEnd = la.at(-1)?.end ?? 0;
  const bEnd = lb.at(-1)?.end ?? 0;
  if (t <= 0) return 0;
  // the clip at t (later one wins inside an overlap)
  let hit: Placed | undefined;
  for (const pl of la) if (t >= pl.start - 1e-6 && t < pl.end - 1e-6) hit = pl;
  if (!hit) {
    if (t >= aEnd) return Math.max(0, t - aEnd + bEnd);
    return t;
  }
  const src = sourceTime(hit.clip, t - hit.start);
  const cands = lb.filter((pl) => pl.clip.id === hit!.clip.id || pl.clip.mediaId === hit!.clip.mediaId);
  let best: number | null = null;
  let bd = Infinity;
  for (const pl of cands) {
    const loc = localTime(pl.clip, src);
    const len = pl.end - pl.start;
    const inside = loc >= -1e-6 && loc <= len + 1e-6;
    const same = pl.clip.id === hit.clip.id;
    if (!inside && !same) continue;
    const nt = pl.start + Math.max(0, Math.min(len, loc));
    const score = (inside ? 0 : 1e6) + (same ? 0 : 1e3) + Math.abs(nt - t);
    if (score < bd) ((bd = score), (best = nt));
  }
  if (best !== null) return best;
  // clip was deleted: land on the start of the next surviving clip
  for (const pl of la.slice(hit.index + 1)) {
    const nb = lb.find((x) => x.clip.id === pl.clip.id);
    if (nb) return nb.start;
  }
  return bEnd;
}

/** After an edit, move effects, forced keyframes and Motion Transfer sources with their footage. */
export function remapToFootage(before: Project, after: Project) {
  const fps = after.encoder.fps;
  const totalA = timelineFrames(before, before.encoder.fps);
  const totalB = timelineFrames(after, fps);
  const map = (f: number) => Math.round(mapTime(before, after, f / before.encoder.fps) * fps);
  for (const e of after.effects) {
    const whole = e.start <= 0 && e.end >= totalA;
    if (whole) {
      e.start = 0;
      e.end = totalB;
    } else {
      const s = map(e.start);
      const en = e.end >= totalA ? totalB : map(e.end);
      e.start = Math.max(0, Math.min(totalB - 1, s));
      e.end = Math.max(e.start + 1, Math.min(totalB, en));
    }
    if (e.type === 'splice' && typeof e.params.from === 'number') e.params.from = Math.max(0, Math.min(totalB - 1, map(e.params.from)));
  }
  after.encoder.keyMarkers = [...new Set(after.encoder.keyMarkers.map(map).filter((m) => m > 0 && m < totalB))];
}
