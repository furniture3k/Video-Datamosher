// The beats of the project's music, for the UI: the beat grid on the ruler (also snap points),
// the BPM readout and auto-edit to the beat. Renders analyse the music themselves.
import { store } from './store.svelte';
import { localGet, localSet } from './storage';
import { audioFeatures } from './renderer';
import { audioKey } from '../engine/audiofx';
import type { AudioFeatures } from '../engine/beats';
import { subdivide } from '../engine/beattime';
import { audioSources } from '../engine/timeline';
import type { Project } from '../engine/types';

export const beatInfo = $state({
  /** show the beat grid on the ruler (and snap to it) */
  grid: localGet('beatGrid', false),
  /** grid points per beat: 1, 2 (halves) or 4 (quarters) */
  div: localGet('beatDiv', 1),
  status: 'idle' as 'idle' | 'working' | 'ready' | 'none' | 'error',
  key: '',
  bpm: 0,
  confidence: 0,
  /** seconds */
  beats: [] as number[],
  downbeats: [] as number[],
});

/** Times in the inspector are shown in seconds or in beats of the music. */
export const timeUnit = $state({ beats: localGet('timeBeats', false) });
$effect.root(() => {
  $effect(() => localSet('timeBeats', timeUnit.beats));
});

let latest: AudioFeatures | null = null;
let job = 0;

/** Analyse the beat source now (cached: cheap when nothing changed). */
export async function refreshBeats(): Promise<AudioFeatures | null> {
  const my = ++job;
  const p = $state.snapshot(store.project) as Project;
  const key = audioKey(p, p.beatSource);
  beatInfo.status = 'working';
  try {
    const f = await audioFeatures(p, key);
    if (my !== job) return f;
    latest = f;
    beatInfo.key = key;
    if (!f || !f.beats.length) {
      beatInfo.status = 'none';
      beatInfo.beats = beatInfo.downbeats = [];
      beatInfo.bpm = 0;
      return f;
    }
    beatInfo.status = 'ready';
    beatInfo.bpm = f.bpm;
    beatInfo.confidence = f.confidence;
    beatInfo.beats = f.beats.map((b) => b / f.fps);
    beatInfo.downbeats = f.downbeats.map((b) => b / f.fps);
    return f;
  } catch (e) {
    if (my === job) beatInfo.status = 'error';
    console.warn('beat analysis failed', e);
    return null;
  }
}

export const lastBeats = () => latest;

/** Why there's no beat to use, for a message. */
export const noBeatText = () => (audioSources(store.project).length ? 'No steady beat found in the music.' : 'No beat found yet: put music on an audio track first.');

/**
 * The beats are known (true), analysing the music first if that hasn't happened yet: the beat grid
 * and beat effects keep them up to date as the music is edited, but a beat command can come first.
 * False when there's no beat (or no sound at all, which is answered straight away).
 */
export async function ensureBeats(): Promise<boolean> {
  if (beatInfo.status === 'ready' && beatInfo.beats.length) return true;
  if (!audioSources(store.project).length) return false;
  store.toast('Listening for the beat…', 'info', 2500);
  await refreshBeats();
  return beatInfo.status === 'ready' && beatInfo.beats.length > 0;
}

export function setBeatGrid(on: boolean) {
  beatInfo.grid = on;
  localSet('beatGrid', on);
  if (on) refreshBeats();
}

export function setBeatDiv(div: number) {
  beatInfo.div = div;
  localSet('beatDiv', div);
}

/** The grid's points in seconds: the beats, and their halves or quarters when chosen. */
export const gridTimes = () => subdivide(beatInfo.beats, beatInfo.div);

/** What the beat analysis depends on: re-run the grid when it changes. */
export function beatInputs(p: Project): string {
  const key = audioKey(p, p.beatSource);
  const all = key === 'mix' || key === 'a0';
  return JSON.stringify([key, p.clips.filter((c) => all || c.track === key).map((c) => [c.mediaId, c.start, c.in, c.out, c.speed, c.reverse, c.enabled, c.track]), p.tracks.filter((t) => t.kind === 'audio').map((t) => [t.id, t.muted]), p.encoder.fps]);
}
