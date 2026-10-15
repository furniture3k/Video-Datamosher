// Auto-edit to the beat: cut a set of clips onto the music's beat grid, with melts on the
// downbeats and blooms on the drops.
import type { AudioFeatures } from './beats';
import { makeClip } from './timeline';
import { makeEffect, uid } from './presets';
import { makeRng } from './rng';
import { CLIP_AUDIO, VIDEO_TRACK, type Clip, type MediaItem, type Project, type TransitionType } from './types';

export interface BeatEditOptions {
  /** media to cut between, in order */
  media: string[];
  /** a cut every this many beats */
  every: number;
  /** cut on bars (downbeats) instead of beats */
  onBars: boolean;
  order: 'sequence' | 'random';
  /** mosh transitions: none, on the first beat of each bar, or on every cut */
  melts: 'none' | 'bars' | 'all';
  melt: TransitionType;
  /** add a Bloom where the music drops (big jumps in loudness) */
  blooms: boolean;
  /** mute the clips' own sound so only the music plays */
  muteClips: boolean;
  seed: number;
}

export const defaultBeatEdit = (media: string[]): BeatEditOptions => ({ media, every: 2, onBars: false, order: 'sequence', melts: 'bars', melt: 'melt', blooms: true, muteClips: true, seed: 1 });

/**
 * Frames where the music "drops": hits after which it gets much louder than it was. At most
 * one per 8 beats, strongest first, up to `max`.
 */
export function findDrops(f: AudioFeatures, max = 4): number[] {
  const full = f.bands.full;
  const win = Math.max(4, Math.round(f.fps));
  const mean = (a: number, b: number) => {
    let s = 0;
    let n = 0;
    for (let i = Math.max(0, a); i < Math.min(full.length, b); i++) ((s += full[i]), n++);
    return n ? s / n : 0;
  };
  const scored = f.onsets
    .map((o) => ({ o, jump: mean(o, o + win) - mean(o - 2 * win, o) }))
    .filter((x) => x.jump > 0.25)
    .sort((a, b) => b.jump - a.jump);
  const gap = f.beats.length > 1 ? 8 * ((f.beats.at(-1)! - f.beats[0]) / (f.beats.length - 1)) : 8 * f.fps;
  const out: number[] = [];
  for (const s of scored) {
    if (out.length >= max) break;
    if (out.every((d) => Math.abs(d - s.o) >= gap)) out.push(s.o);
  }
  return out.sort((a, b) => a - b);
}

/** A new project whose main track is cut to the music. Other tracks, titles and settings stay. */
export function beatEdit(project: Project, f: AudioFeatures, o: BeatEditOptions): Project {
  const fps = f.fps;
  const media = o.media.map((id) => project.media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m && m.hasVideo);
  if (!media.length) throw new Error('Pick at least one video or picture to cut between.');
  const grid = o.onBars ? f.downbeats : f.beats;
  if (grid.length < 2) throw new Error('No beat found in the music.');
  const every = Math.max(1, Math.round(o.every));
  const bars = new Set(f.downbeats);
  // cut points in frames: the start, then every Nth beat, to the end of the music
  const cuts = [0, ...grid.filter((_, i) => i % every === 0).filter((b) => b > 0)];
  const end = f.frames;
  if (cuts.at(-1)! >= end) cuts.pop();
  const rng = makeRng(o.seed);
  // where each piece of footage has got to, so cuts move through it instead of repeating
  const cursor = new Map<string, number>();
  let last = -1;
  const clips: Clip[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i];
    const b = i + 1 < cuts.length ? cuts[i + 1] : end;
    if (b <= a) continue;
    const len = (b - a) / fps;
    let k = o.order === 'random' ? rng.int(0, media.length - 1) : i % media.length;
    if (o.order === 'random' && media.length > 1 && k === last) k = (k + 1) % media.length;
    last = k;
    const m = media[k];
    const still = m.source.kind === 'file' && m.source.isImage;
    let start = still ? 0 : (cursor.get(m.id) ?? 0);
    let speed = 1;
    if (!still) {
      if (start + len > m.duration) start = 0;
      // footage shorter than the piece: slow it down to fill it
      if (len > m.duration) speed = Math.max(0.05, m.duration / len);
      cursor.set(m.id, start + len * speed);
    }
    const c = makeClip(m, VIDEO_TRACK, { in: start, out: start + len * speed, speed, muted: o.muteClips, fit: 'fill' });
    const melt = i > 0 && (o.melts === 'all' || (o.melts === 'bars' && bars.has(a)));
    if (melt) c.transition = { type: o.melt, duration: Math.min(1.5, len * 0.8), intensity: 1, resolve: true };
    clips.push(c);
  }
  const others = project.clips.filter((c) => c.track !== VIDEO_TRACK);
  const effects = [...project.effects];
  const markers = [...(project.markers ?? [])];
  if (o.blooms) {
    const beat = f.beats.length > 1 ? Math.round((f.beats.at(-1)! - f.beats[0]) / (f.beats.length - 1)) : fps;
    for (const d of findDrops(f)) {
      effects.push(makeEffect('bloom', d, Math.min(end, d + beat * 2), { target: 'first' }, rng.int(0, 1e9)));
      markers.push({ id: uid(), t: d / fps, color: '#e0a046', name: 'drop' });
    }
  }
  const tracks = o.muteClips ? project.tracks : project.tracks.map((t) => (t.id === CLIP_AUDIO ? { ...t, muted: false } : t));
  return { ...project, clips: [...clips, ...others], effects, tracks, markers };
}
