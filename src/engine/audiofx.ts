// Audio-reactive effects: which sound an effect listens to, and turning audio automation and
// beat triggers into plain per-frame data before the effects run.
import { audioEnvelope, type AudioFeatures } from './beats';
import { CLIP_AUDIO, type Automation, type EffectInstance, type ParamValue, type Project } from './types';
import { inRange, posOf } from './effects/util';
import type { Frame } from './types';

/** The analysed sound a render can use: per source ('mix' or a track id), plus the beat source. */
export interface MoshAudio {
  sources: Record<string, AudioFeatures>;
  /** key of the source beat triggers use */
  beatKey: string;
}

/** 'auto' means the music: the first audio track (not clip audio) with sound on it, else the mix. */
export function audioKey(p: Pick<Project, 'tracks' | 'clips'>, track: string | undefined): string {
  if (track && track !== 'auto') return track === 'mix' || p.tracks.some((t) => t.id === track && t.kind === 'audio') ? track : 'mix';
  const music = p.tracks.find((t) => t.kind === 'audio' && t.id !== CLIP_AUDIO && !t.muted && p.clips.some((c) => c.track === t.id && c.enabled !== false));
  return music?.id ?? 'mix';
}

/** Parameters that switch an effect to beat triggers, by effect type. */
const BEAT_MODES: Record<string, (params: Record<string, ParamValue>) => boolean> = {
  bloom: (p) => p.target === 'beats',
  stutter: (p) => p.mode === 'beats',
  drop: (p) => p.mode === 'beats',
  glitch: (p) => p.gate === 'beats',
};

export const usesBeats = (e: Pick<EffectInstance, 'type' | 'params' | 'enabled'>) => e.enabled && !!BEAT_MODES[e.type]?.(e.params);

/** The sound sources a project's effects listen to (empty: nothing needs analysing). */
export function audioKeysNeeded(p: Project): string[] {
  const keys = new Set<string>();
  for (const e of p.effects) {
    if (!e.enabled) continue;
    for (const a of Object.values(e.auto ?? {})) if (a.kind === 'audio') keys.add(audioKey(p, a.track));
    if (usesBeats(e)) keys.add(audioKey(p, p.beatSource));
  }
  return [...keys];
}

/** Replace audio automation with per-frame samples over the effect's range. */
export function bakeAudio(e: EffectInstance, audio: MoshAudio | undefined, p: Pick<Project, 'tracks' | 'clips'>): EffectInstance {
  let auto: Record<string, Automation> | null = null;
  for (const [k, a] of Object.entries(e.auto ?? {})) {
    if (a.kind !== 'audio') continue;
    auto ??= { ...e.auto };
    const f = audio?.sources[audioKey(p, a.track)];
    if (!f) {
      auto[k] = { kind: 'samples', values: [], min: a.min };
      continue;
    }
    const env = audioEnvelope(f, a, e.start, e.end);
    auto[k] = { kind: 'samples', values: Array.from(env, (v) => a.min + (a.max - a.min) * v), min: a.min };
  }
  return auto ? { ...e, auto } : e;
}

// ---------- beat triggers inside effects ----------

/** Shared settings of beat-triggered effects. */
export const beatParams = (show: (p: Record<string, ParamValue>) => boolean) =>
  [
    {
      show,
      key: 'beatOn',
      label: 'On',
      type: 'select' as const,
      default: 'beats',
      options: [
        { value: 'beats', label: 'Every beat', hint: 'The steady pulse of the music.' },
        { value: 'downbeats', label: 'First beat of each bar', hint: 'Once a bar: the "one" of one-two-three-four.' },
        { value: 'onsets', label: 'Every hit', hint: 'Each drum hit or note start, including off-beats. Busier and less regular.' },
      ],
      help: 'Which moments of the music trigger it. The music is the track picked under Audio → Beats.',
    },
    { show, key: 'beatEvery', label: 'Every Nth', type: 'int' as const, min: 1, max: 16, default: 1, intensity: 'down' as const, help: 'Only every Nth beat (2 = every other beat).' },
  ];

/** Timeline frames inside the effect's range where its beat trigger fires. */
export function beatHits(e: EffectInstance, f: AudioFeatures | undefined): number[] {
  if (!f) return [];
  const kind = String(e.params.beatOn ?? 'beats');
  const list = kind === 'downbeats' ? f.downbeats : kind === 'onsets' ? f.onsets : f.beats;
  const every = Math.max(1, Math.round(Number(e.params.beatEvery ?? 1)));
  return list.filter((b) => b >= e.start && b < e.end).filter((_, i) => i % every === 0);
}

/** For each hit, the first frame of the list (in range, passing `ok`) shown at or after it. */
export function framesAtHits(frames: Frame[], e: EffectInstance, hits: number[], ok: (f: Frame) => boolean = () => true): Set<Frame> {
  const out = new Set<Frame>();
  const cand = frames.filter((f) => inRange(f, e) && ok(f));
  let k = 0;
  for (const h of hits) {
    while (k < cand.length && posOf(cand[k]) < h) k++;
    if (k < cand.length) out.add(cand[k]);
  }
  return out;
}
