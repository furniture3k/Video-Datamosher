// Bring saved projects (autosave, project files) up to the current format.
import { CLIP_AUDIO, VIDEO_TRACK, defaultTracks, newProject, type Clip, type EffectInstance, type MediaItem, type Project, type Sequence } from './types';
import { FIRST_ROW, type Layer, type TextLayer } from './layers';

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
    version: 3,
    media,
    clips: out,
    tracks,
    layers: [],
  } as Project;
}

type V2Text = Omit<TextLayer, 'kind' | 'row'>;
type V2Sequence = Omit<Sequence, 'layers'> & { texts?: V2Text[]; layers?: Layer[] };

/** v2 kept titles in `texts`; v3 keeps them (and other graphics) as layers on graphics rows. */
const textsToLayers = (texts: V2Text[] | undefined): Layer[] => (texts ?? []).map((t) => ({ ...t, kind: 'text', row: FIRST_ROW }) as Layer);

function sequenceToV3(seq: V2Sequence): Sequence {
  const { texts, ...rest } = seq;
  return { ...rest, layers: seq.layers ?? textsToLayers(texts) };
}

function fromV2(p: Record<string, unknown>): Project {
  const { texts, ...rest } = p as Record<string, unknown> & { texts?: V2Text[]; media?: MediaItem[] };
  // compound clips keep a timeline of their own, with its own titles
  const media = rest.media?.map((m) => (m.source.kind === 'file' && m.source.compound ? { ...m, source: { ...m.source, compound: sequenceToV3(m.source.compound as V2Sequence) } } : m));
  return { ...(rest as unknown as Project), ...(media ? { media } : {}), version: 3, layers: textsToLayers(texts) };
}

export function migrate(raw: unknown): Project {
  const p = (raw ?? {}) as Record<string, unknown>;
  const base = newProject();
  const cur = p.version === 1 ? fromV1(p) : p.version === 2 ? fromV2(p) : (p as unknown as Project);
  if (cur.version !== 3) throw new Error('Unknown project version');
  const audio = { ...base.audio, ...(cur.audio ?? {}) } as Project['audio'] & Record<string, unknown>;
  delete audio.source;
  delete audio.clipId;
  // a copy: the tracks missing from old projects are added without touching the saved data
  const tracks = cur.tracks?.length ? [...cur.tracks] : base.tracks;
  if (!tracks.some((t) => t.id === VIDEO_TRACK)) tracks.unshift(base.tracks[0]);
  if (!tracks.some((t) => t.id === CLIP_AUDIO)) tracks.splice(1, 0, base.tracks[1]);
  return {
    ...base,
    ...cur,
    media: cur.media ?? [],
    clips: (cur.clips ?? []).map((c) => ({ ...{ volume: 1, muted: false, fadeIn: 0, fadeOut: 0, start: 0, speed: 1, reverse: false, fit: 'fit' as const }, ...c })),
    tracks,
    layers: cur.layers ?? [],
    encoder: { ...base.encoder, ...cur.encoder },
    decoder: { ...base.decoder, ...cur.decoder },
    audio,
    effects: (cur.effects ?? []).filter((e) => !e.transition).map(upgradeEffect),
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
