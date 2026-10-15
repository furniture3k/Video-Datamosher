// The beats of the project's music, for the UI: the beat grid on the ruler (also snap points),
// the BPM readout and auto-edit to the beat. Renders analyse the music themselves.
import { store } from './store.svelte';
import { localGet, localSet } from './storage';
import { audioFeatures } from './renderer';
import { audioKey } from '../engine/audiofx';
import type { AudioFeatures } from '../engine/beats';
import type { Project } from '../engine/types';

export const beatInfo = $state({
  /** show the beat grid on the ruler (and snap to it) */
  grid: localGet('beatGrid', false),
  status: 'idle' as 'idle' | 'working' | 'ready' | 'none' | 'error',
  key: '',
  bpm: 0,
  confidence: 0,
  /** seconds */
  beats: [] as number[],
  downbeats: [] as number[],
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

export function setBeatGrid(on: boolean) {
  beatInfo.grid = on;
  localSet('beatGrid', on);
  if (on) refreshBeats();
}

/** What the beat analysis depends on: re-run the grid when it changes. */
export function beatInputs(p: Project): string {
  const key = audioKey(p, p.beatSource);
  const all = key === 'mix' || key === 'a0';
  return JSON.stringify([key, p.clips.filter((c) => all || c.track === key).map((c) => [c.mediaId, c.start, c.in, c.out, c.speed, c.reverse, c.enabled, c.track]), p.tracks.filter((t) => t.kind === 'audio').map((t) => [t.id, t.muted]), p.encoder.fps]);
}
