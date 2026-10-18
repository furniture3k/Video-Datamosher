// Bring saved projects (autosave, project files) up to the current format.
import { CLIP_AUDIO, VIDEO_TRACK, defaultTracks, newProject, type Clip, type EffectInstance, type MediaItem, type Project } from './types';

interface V1Clip {
  id: string;
  source: MediaItem['source'];
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  in: number;
  out: number;
  speed: number;
  reverse: boolean;
  fit: Clip['fit'];
  thumb?: string;
}

/** v1 projects were a flat list of clips played back to back. */
function fromV1(p: Record<string, unknown>): Project {
  const base = newProject();
  const clips = (p.clips as V1Clip[]) ?? [];
  const audio = (p.audio ?? {}) as { source?: string; clipId?: string | null };
  const media: MediaItem[] = [];
  const out: Clip[] = [];
  for (const c of clips) {
    const mid = c.source.kind === 'file' ? c.source.fileId : c.id;
    if (!media.some((m) => m.id === mid))
      media.push({ id: mid, source: c.source, duration: c.duration, width: c.width, height: c.height, fps: c.fps, hasAudio: c.hasAudio, hasVideo: true, thumb: c.thumb });
    out.push({
      id: c.id,
      mediaId: mid,
      track: VIDEO_TRACK,
      start: 0,
      in: c.in,
      out: c.out,
      speed: c.speed,
      reverse: c.reverse,
      fit: c.fit,
      volume: 1,
      muted: audio.source === 'clip' ? c.id !== audio.clipId : false,
      fadeIn: 0,
      fadeOut: 0,
    });
  }
  const tracks = defaultTracks();
  if (audio.source === 'none') tracks.find((t) => t.id === CLIP_AUDIO)!.muted = true;
  return {
    ...base,
    ...(p as object),
    version: 2,
    media,
    clips: out,
    tracks,
    texts: [],
  } as Project;
}

export function migrate(raw: unknown): Project {
  const p = (raw ?? {}) as Record<string, unknown>;
  const base = newProject();
  const v2 = p.version === 1 ? fromV1(p) : (p as unknown as Project);
  if (v2.version !== 2) throw new Error('Unknown project version');
  const audio = { ...base.audio, ...(v2.audio ?? {}) } as Project['audio'] & Record<string, unknown>;
  delete audio.source;
  delete audio.clipId;
  // a copy: the tracks missing from old projects are added without touching the saved data
  const tracks = v2.tracks?.length ? [...v2.tracks] : base.tracks;
  if (!tracks.some((t) => t.id === VIDEO_TRACK)) tracks.unshift(base.tracks[0]);
  if (!tracks.some((t) => t.id === CLIP_AUDIO)) tracks.splice(1, 0, base.tracks[1]);
  return {
    ...base,
    ...v2,
    media: v2.media ?? [],
    clips: (v2.clips ?? []).map((c) => ({ ...{ volume: 1, muted: false, fadeIn: 0, fadeOut: 0, start: 0, speed: 1, reverse: false, fit: 'fit' as const }, ...c })),
    tracks,
    texts: v2.texts ?? [],
    encoder: { ...base.encoder, ...v2.encoder },
    decoder: { ...base.decoder, ...v2.decoder },
    audio,
    effects: (v2.effects ?? []).filter((e) => !e.transition).map(upgradeEffect),
  };
}

/**
 * Effects saved before effects kept their length (and Bloom could fill its bar) keep the look
 * they were made with: inserted repeats, fixed repeat counts, one-shot stutters.
 */
function upgradeEffect(e: EffectInstance): EffectInstance {
  const p = { ...e.params };
  if (['bloom', 'stutter', 'echo', 'splice', 'drop'].includes(e.type) && p.timing === undefined) p.timing = 'stretch';
  if (e.type === 'bloom' && p.length === undefined) p.length = 'count';
  if (e.type === 'kill' && p.replace === undefined) p.replace = 'drop';
  if (e.type === 'stutter' && p.mode === undefined) {
    p.mode = Number(p.every) > 0 ? 'every' : 'once';
    if (!(Number(p.every) > 0)) p.every = 24;
  }
  if (e.type === 'splice' && p.length === undefined) p.length = 48;
  // Subject Guard's oval is now sized against the tracked box (old tracks keep their Oval size: see PostRunner)
  if (e.type === 'mask' && p.scale === undefined) p.scale = 1.4;
  return { ...e, params: p };
}
