// Timeline model: layout of the magnetic video track, audio tracks, segments for rendering,
// pure edit operations and the mapping that keeps effects attached to footage across edits.
import { CLIP_AUDIO, VIDEO_TRACK, clipOn, type Clip, type EffectInstance, type MediaItem, type Project, type Track, type Transition, type TransitionType } from './types';
import { EFFECTS, defaultParams } from './effects';
import { hashSeed } from './rng';

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Transitions that blend two shots (both are on screen at once, so the clips overlap). */
export const BLEND_TRANSITIONS: Record<string, { name: string; xfade: string; description: string }> = {
  dissolve: { name: 'Cross dissolve', xfade: 'fade', description: 'The two shots overlap and fade into each other.' },
  dip: { name: 'Dip to black', xfade: 'fadeblack', description: 'Fades out to black, then in to the next shot.' },
  dipwhite: { name: 'Dip to white', xfade: 'fadewhite', description: 'Flashes to white between the shots.' },
  wipeleft: { name: 'Wipe left', xfade: 'wipeleft', description: 'The next shot slides in behind an edge moving left.' },
  wiperight: { name: 'Wipe right', xfade: 'wiperight', description: 'The next shot is revealed by an edge moving right.' },
  wipeup: { name: 'Wipe up', xfade: 'wipeup', description: 'The next shot is revealed from the bottom up.' },
  wipedown: { name: 'Wipe down', xfade: 'wipedown', description: 'The next shot is revealed from the top down.' },
  slideleft: { name: 'Slide left', xfade: 'slideleft', description: 'Both shots slide left together, like turning a page.' },
  slideright: { name: 'Slide right', xfade: 'slideright', description: 'Both shots slide right together.' },
  circleopen: { name: 'Circle open', xfade: 'circleopen', description: 'The next shot opens out from a growing circle in the middle.' },
  pixelize: { name: 'Pixelize', xfade: 'pixelize', description: 'The picture breaks into big pixels and re-forms as the next shot.' },
};

/** Transitions made by the mosh engine at a hard cut. */
export const MOSH_TRANSITIONS: Record<string, { name: string; description: string }> = {
  melt: { name: 'Melt', description: 'The keyframe at the cut is removed, so the next shot\'s movement drags the last picture around until it resolves.' },
  bloom: { name: 'Bloom melt', description: 'Melt, then the first movement of the next shot repeats, so the old picture smears and erupts outward.' },
  glitch: { name: 'Glitch cut', description: 'Melt with a burst of corrupted data around the cut: blocks tear and rain.' },
  stutter: { name: 'Stutter melt', description: 'Melt, then the motion rocks back and forth in short loops.' },
  liquid: { name: 'Liquid melt', description: 'Melt with flow-warped, amplified motion for a silky, liquid smear.' },
  ghost: { name: 'Ghost melt', description: 'Melt with echoed motion, so the movement doubles up like a ghost trail.' },
  rewind: { name: 'Rewind melt', description: 'Melt with the next shot\'s motion played backwards, so the old picture folds and un-melts.' },
};

export const transitionName = (t: TransitionType) => BLEND_TRANSITIONS[t]?.name ?? MOSH_TRANSITIONS[t]?.name ?? t;
export const isBlend = (t?: Transition) => !!t && t.type in BLEND_TRANSITIONS && t.duration > 0;
export const isMoshTransition = (t?: Transition) => !!t && t.type in MOSH_TRANSITIONS;

export const clipLen = (c: Pick<Clip, 'in' | 'out' | 'speed' | 'freeze'>) => Math.max(0.04, c.freeze ? c.out - c.in : (c.out - c.in) / Math.max(0.01, c.speed));

/** Track ids: 'v1' is the main (magnetic) video track, 'v2'… are video tracks above it, 'a…' are audio. */
export const isVideoTrack = (id: string) => id.startsWith('v');
export const isOverlayTrack = (id: string) => id !== VIDEO_TRACK && isVideoTrack(id);

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
/** Clips on audio tracks. */
export const audioClips = (p: Pick<Project, 'clips'>) => p.clips.filter((c) => !isVideoTrack(c.track));
/** Clips on the video tracks above the main one (placed freely, drawn on top). */
export const overlayClips = (p: Pick<Project, 'clips'>) => p.clips.filter((c) => isOverlayTrack(c.track));
/** Clips placed by their own start time (everything except the main video track). */
export const freeClips = (p: Pick<Project, 'clips'>) => p.clips.filter((c) => c.track !== VIDEO_TRACK);
export const clipEnd = (c: Clip) => c.start + clipLen(c);

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
  for (const c of freeClips(p)) if (mediaOf(p, c.mediaId)) d = Math.max(d, c.start + clipLen(c));
  for (const t of p.texts ?? []) d = Math.max(d, t.start + t.duration);
  return d;
}

export const timelineFrames = (p: Pick<Project, 'clips' | 'media' | 'texts'>, fps: number) => Math.max(1, Math.round(timelineDuration(p) * fps));

/** Source time shown at `local` seconds into a clip. */
export function sourceTime(c: Clip, local: number): number {
  if (c.freeze) return c.in;
  const l = Math.max(0, Math.min(clipLen(c), local));
  return c.reverse ? c.out - l * c.speed : c.in + l * c.speed;
}

/** Inverse of sourceTime (may fall outside the clip). */
export function localTime(c: Clip, src: number): number {
  if (c.freeze) return 0;
  return c.reverse ? (c.out - src) / c.speed : (src - c.in) / c.speed;
}

export interface Segment {
  start: number;
  end: number;
  /** first and last frame (exclusive) on the timeline */
  f0: number;
  f1: number;
  clips: Placed[];
  /** clips on upper video tracks that show during this piece */
  layers: Layer[];
  /** the main video track is hidden */
  hideBase: boolean;
}

/** A clip on an upper video track, drawn over the main track. */
export interface Layer {
  clip: Clip;
  media: MediaItem;
  start: number;
  end: number;
  track: string;
}

const trackNum = (id: string) => parseInt(id.slice(1), 10) || 0;

/** Visible clips on the upper video tracks, bottom track first. */
export function layers(p: Pick<Project, 'clips' | 'media'> & { tracks?: Track[] }): Layer[] {
  const hidden = new Set((p.tracks ?? []).filter((t) => t.kind === 'video' && t.muted).map((t) => t.id));
  const out: Layer[] = [];
  for (const c of overlayClips(p)) {
    const media = mediaOf(p, c.mediaId);
    if (!media || !media.hasVideo || !clipOn(c) || hidden.has(c.track)) continue;
    out.push({ clip: c, media, start: c.start, end: c.start + clipLen(c), track: c.track });
  }
  return out.sort((a, b) => trackNum(a.track) - trackNum(b.track) || a.start - b.start);
}

/** The main video track is hidden. */
export const baseHidden = (p: { tracks?: Track[] }) => !!p.tracks?.find((t) => t.id === VIDEO_TRACK)?.muted;

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
  const hideBase = baseHidden(p as { tracks?: Track[] });
  const segs: Segment[] = runs.map((clips) => ({ start: clips[0].start, end: clips.at(-1)!.end, f0: 0, f1: 0, clips, layers: [], hideBase }));
  const vEnd = segs.at(-1)?.end ?? 0;
  if (total - vEnd > 0.02) {
    if (whole && segs.length) segs[0].end = total;
    else segs.push({ start: vEnd, end: total, f0: 0, f1: 0, clips: [], layers: [], hideBase });
  }
  for (const s of segs) {
    s.f0 = Math.round(s.start * fps);
    s.f1 = Math.max(s.f0 + 1, Math.round(s.end * fps));
  }
  // close rounding gaps so frame ranges tile the timeline
  for (let i = 1; i < segs.length; i++) segs[i].f0 = segs[i - 1].f1;
  for (const s of segs) s.f1 = Math.max(s.f0 + 1, s.f1);
  const all = layers(p as Pick<Project, 'clips' | 'media'>);
  for (const s of segs) {
    const t0 = s.f0 / fps;
    const t1 = s.f1 / fps;
    s.layers = all.filter((l) => l.start < t1 - 1e-6 && l.end > t0 + 1e-6);
  }
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

/** Frames (cut, length, end of the clip) of the mosh transition into each clip. */
function moshCuts(p: Pick<Project, 'clips' | 'media'>, fps: number) {
  return layoutVideo(p)
    .filter((pl) => pl.index > 0 && isMoshTransition(pl.clip.transition))
    .map((pl) => {
      const cut = Math.round(pl.start * fps);
      const end = Math.round(pl.end * fps);
      const d = Math.max(2, Math.min(end - cut, Math.round(pl.clip.transition!.duration * fps)));
      return { pl, t: pl.clip.transition!, cut, d, end };
    });
}

/** The effects a mosh transition stands for (positioned at its cut). */
export function transitionEffects(p: Pick<Project, 'clips' | 'media'>, fps: number): EffectInstance[] {
  const out: EffectInstance[] = [];
  for (const { pl, t, cut, d } of moshCuts(p, fps)) {
    const I = Math.max(0, Math.min(1, t.intensity));
    const c = pl.clip;
    // the melt itself: no keyframe from just before the cut to the end of the transition
    out.push(trEffect(c, 0, 'kill', cut - 1, cut + d, { mode: 'all', replace: 'prev' }));
    if (t.type === 'bloom') out.push(trEffect(c, 1, 'bloom', cut, cut + Math.max(2, Math.round(d * (0.3 + 0.7 * I))), { target: 'first', length: 'fill', timing: 'fit' }));
    if (t.type === 'glitch') out.push(trEffect(c, 1, 'glitch', cut - Math.round(d / 3), cut + d, { mode: 'replace', amount: Math.round((1 + I * 10) * 10) / 10, probability: 0.5 + I * 0.5, target: 'all' }));
    if (t.type === 'stutter') out.push(trEffect(c, 1, 'stutter', cut, cut + d, { mode: 'repeat', group: Math.round(6 - I * 3), loops: Math.round(2 + I * 4), pingpong: true, timing: 'fit' }));
    if (t.type === 'liquid') out.push(trEffect(c, 1, 'vectorWarp', cut, cut + d, { amplify: 1 + I * 2.5, smooth: true, residual: 0.05 }));
    if (t.type === 'ghost') out.push(trEffect(c, 1, 'echo', cut, cut + d, { delay: 3, taps: 1 + Math.round(I * 3), probability: 0.5 + I * 0.5, timing: 'fit' }));
    if (t.type === 'rewind') out.push(trEffect(c, 1, 'reverse', cut, cut + d, { window: Math.round(d * (1 - I * 0.7)) }));
  }
  return out;
}

/**
 * Times (s) that need a keyframe: each mosh-transition cut (so the melt has something to remove)
 * and, unless turned off, the end of the transition, where the next shot comes back clean.
 */
export function transitionKeyTimes(p: Pick<Project, 'clips' | 'media' | 'encoder'>): number[] {
  const fps = p.encoder.fps;
  const out: number[] = [];
  for (const { t, cut, d, end } of moshCuts(p, fps)) {
    out.push(cut / fps);
    if (t.resolve !== false && cut + d < end - 1) out.push((cut + d) / fps);
  }
  return out;
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
      if (!pl.media.hasAudio || pl.clip.muted || pl.clip.volume <= 0 || !clipOn(pl.clip) || pl.clip.freeze) return;
      const len = pl.end - pl.start;
      const next = placed[i + 1]?.overlap ?? 0;
      out.push({ clip: pl.clip, media: pl.media, start: pl.start, len, fadeIn: Math.max(pl.clip.fadeIn, pl.overlap), fadeOut: Math.max(pl.clip.fadeOut, next), gain: pl.clip.volume * ca.volume, bus: ca.mosh ? 'mosh' : 'clean' });
    });
  for (const c of freeClips(p)) {
    // the sound of clips on upper video tracks plays with the clip audio
    const tr = trackOf(p, isOverlayTrack(c.track) ? CLIP_AUDIO : c.track);
    const media = mediaOf(p, c.mediaId);
    if (!tr || !media || !media.hasAudio || !on.has(tr.id) || c.muted || c.volume <= 0 || !clipOn(c) || c.freeze) continue;
    if (isOverlayTrack(c.track) && trackOf(p, c.track)?.muted) continue;
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
  const b: Clip = { ...c, id: uid(), transition: undefined, fadeIn: 0, vfadeIn: 0, start: c.start + local };
  if (c.freeze) {
    b.out = c.in + (len - local);
    c.out = c.in + local;
  } else if (c.reverse) {
    b.out = at;
    c.in = at;
  } else {
    b.in = at;
    c.out = at;
  }
  c.fadeOut = 0;
  c.vfadeOut = 0;
  p.clips.splice(p.clips.indexOf(c) + 1, 0, b);
  return b;
}

export function clipsAt(p: Project, t: number): Clip[] {
  const out: Clip[] = [];
  for (const pl of layoutVideo(p)) if (t > pl.start + 0.01 && t < pl.end - 0.01) out.push(pl.clip);
  for (const c of freeClips(p)) if (t > c.start + 0.01 && t < c.start + clipLen(c) - 0.01) out.push(c);
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
  if (orig.freeze) {
    // a freeze frame only changes how long it lasts
    const len = Math.max(0.1, clipLen(orig) + (edge === 'r' ? dt : -dt));
    c.out = c.in + len;
    if (edge === 'l' && c.track !== VIDEO_TRACK) c.start = Math.max(0, orig.start + clipLen(orig) - len);
    return;
  }
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
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m || !m.hasAudio || c.muted || c.freeze) return null;
  const start = c.track === VIDEO_TRACK ? layoutVideo(p).find((x) => x.clip.id === id)?.start ?? 0 : c.start;
  const a: Clip = { ...c, id: uid(), track, start, transition: undefined, transform: undefined, grade: undefined, opacity: undefined, blend: undefined, vfadeIn: undefined, vfadeOut: undefined };
  p.clips.push(a);
  c.muted = true;
  return a;
}

/** Media bounds of a clip's source (stills and generators can run as long as wanted). */
export function maxSource(m: MediaItem): number {
  return (m.source.kind === 'file' && m.source.isImage) || m.source.kind === 'generator' ? 3600 : m.duration;
}

/**
 * Roll edit: move the cut between two neighbouring clips on the main track. The left clip gets
 * longer by dt (timeline seconds), the right one shorter by the same amount, so nothing moves.
 */
export function rollEdit(p: Project, leftId: string, rightId: string, dt: number, origL: Clip, origR: Clip) {
  const l = p.clips.find((c) => c.id === leftId);
  const r = p.clips.find((c) => c.id === rightId);
  const ml = l && mediaOf(p, l.mediaId);
  const mr = r && mediaOf(p, r.mediaId);
  if (!l || !r || !ml || !mr) return;
  const lo = -(clipLen(origL) - 0.1);
  const hi = clipLen(origR) - 0.1;
  let d = Math.max(lo, Math.min(hi, dt));
  // media limits: the left clip's tail and the right clip's head must exist in the source
  if (!origL.freeze) {
    const spare = origL.reverse ? origL.in : maxSource(ml) - origL.out;
    d = Math.min(d, spare / origL.speed);
  }
  if (!origR.freeze) {
    const spare = origR.reverse ? maxSource(mr) - origR.out : origR.in;
    d = Math.max(d, -spare / origR.speed);
  }
  trimClip(p, leftId, 'r', d, origL);
  trimClip(p, rightId, 'l', d, origR);
}

/** Slip: keep a clip's place and length on the timeline but show an earlier or later part of its source. */
export function slipClip(p: Project, id: string, dt: number, orig: Clip) {
  const c = p.clips.find((x) => x.id === id);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  const max = maxSource(m);
  if (orig.freeze) {
    c.in = Math.max(0, Math.min(max - 0.04, orig.in - dt));
    c.out = c.in + (orig.out - orig.in);
    return;
  }
  // dragging right shows earlier footage (the picture follows the mouse)
  let ds = -dt * orig.speed * (orig.reverse ? -1 : 1);
  ds = Math.max(-orig.in, Math.min(max - orig.out, ds));
  c.in = orig.in + ds;
  c.out = orig.out + ds;
}

/** Delete clips and close the gaps they leave (the main track always closes up). */
export function rippleDelete(p: Project, ids: string[]) {
  const gone = p.clips.filter((c) => ids.includes(c.id) && c.track !== VIDEO_TRACK);
  deleteClips(p, ids);
  // later clips on the same track move left by the deleted length
  for (const g of gone.sort((a, b) => b.start - a.start)) {
    const len = clipLen(g);
    for (const c of p.clips) if (c.track === g.track && c.start >= g.start + len - 1e-6) c.start = Math.max(0, c.start - len);
  }
}

/** Insert a freeze frame of `dur` seconds at timeline time t (splitting the clip there). */
export function insertFreeze(p: Project, id: string, t: number, dur = 2): Clip | null {
  const c = p.clips.find((x) => x.id === id);
  if (!c || c.freeze) return null;
  const start = c.track === VIDEO_TRACK ? layoutVideo(p).find((pl) => pl.clip.id === id)?.start : c.start;
  if (start === undefined) return null;
  const local = Math.max(0, Math.min(clipLen(c) - 0.01, t - start));
  const at = sourceTime(c, local);
  const right = splitClip(p, id, t);
  const f: Clip = { ...c, id: uid(), freeze: true, in: at, out: at + dur, speed: 1, reverse: false, transition: undefined, fadeIn: 0, fadeOut: 0, vfadeIn: 0, vfadeOut: 0, muted: true, start: start + local };
  if (c.track === VIDEO_TRACK) {
    p.clips.splice(p.clips.indexOf(c) + 1, 0, f);
  } else {
    // upper tracks: push the rest of the clip later to make room
    if (right) right.start += dur;
    p.clips.push(f);
  }
  return f;
}

/** Move a clip from the main track onto an upper video track at time t, or back. */
export function changeVideoTrack(p: Project, id: string, track: string, t: number, insertAt?: number) {
  const c = p.clips.find((x) => x.id === id);
  if (!c || c.track === track) return;
  if (track === VIDEO_TRACK) {
    p.clips.splice(p.clips.indexOf(c), 1);
    c.start = 0;
    c.transition = undefined;
    insertVideo(p, c, insertAt ?? nearestCut(p, t));
  } else {
    if (c.track === VIDEO_TRACK) c.transition = undefined;
    c.track = track;
    c.start = Math.max(0, t);
    const vids = videoClips(p);
    if (vids[0]) vids[0].transition = undefined;
  }
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
