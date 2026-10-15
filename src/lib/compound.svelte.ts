// Compound clips: make, open, close (re-render) and keep up to date.
import { store } from './store.svelte';
import { exportVideo, Cancelled } from './renderer';
import { putFile } from './storage';
import { readEngineFile, removeEngineFile } from './ffmpeg-native';
import { takeSnapshot } from './snapshots.svelte';
import { buildCompound, compoundOf, innerProject, renderProject, sequenceOf, staleCompounds, withSequence } from '../engine/compound';
import { defaultExport, outputSize } from '../engine/args';
import { audioSources, timelineDuration } from '../engine/timeline';
import { uid } from '../engine/presets';
import type { MediaItem, Project, Sequence } from '../engine/types';

/** Progress of the compound render (shown in a small dialog). */
export const compoundJob = $state({ running: false, stage: '', progress: 0, error: '' });
let signal = { cancelled: false };

export function cancelCompound() {
  signal.cancelled = true;
}

/** Render a sequence to a stored MP4 (with its sound). */
async function renderSequence(parent: Project, seq: Sequence): Promise<{ fileId: string; duration: number; width: number; height: number; hasAudio: boolean }> {
  const p = renderProject(parent, seq);
  signal = { cancelled: false };
  compoundJob.running = true;
  compoundJob.error = '';
  try {
    // no recipe inside: a compound is footage, not a shareable mosh
    const r = await exportVideo(p, { ...defaultExport(), format: 'mp4', crf: 12, preset: 'veryfast', width: 0, audio: true, comment: '' }, (s, x) => ((compoundJob.stage = s), (compoundJob.progress = x)), signal);
    let blob = r.blob;
    if (!blob && r.file) {
      blob = await readEngineFile(r.file, 'video/mp4');
      removeEngineFile(r.file);
    }
    if (!blob) throw new Error('The compound render produced nothing.');
    const fileId = 'cmp_' + uid();
    await putFile(fileId, blob);
    const { w, h } = outputSize(p, p.encoder.width);
    return { fileId, duration: timelineDuration(p), width: w, height: h, hasAudio: audioSources(p).length > 0 };
  } finally {
    compoundJob.running = false;
  }
}

/** Fold the selected main-track clips into one compound clip. */
export async function makeCompound(): Promise<boolean> {
  const ids = store.ui.selectedClips;
  const parent = $state.snapshot(store.project) as Project;
  const n = parent.media.filter((m) => compoundOf(m)).length + 1;
  const media: MediaItem = { id: uid(), source: { kind: 'file', fileId: '', name: `Compound ${n}`, mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration: 1, width: 0, height: 0, fps: parent.encoder.fps, hasAudio: true, hasVideo: true };
  try {
    const { seq, project } = buildCompound(parent, ids, media);
    store.ui.dialog = 'compound';
    const file = await renderSequence(parent, seq);
    const first = parent.media.find((m) => m.id === seq.clips[0]?.mediaId);
    const item: MediaItem = { ...media, source: { ...media.source, fileId: file.fileId, compound: seq } as MediaItem['source'], duration: file.duration, width: file.width, height: file.height, hasAudio: file.hasAudio, thumb: first?.thumb };
    await takeSnapshot('Before making ' + media.source.name, true);
    store.set({ ...project, media: [...project.media, item] });
    store.ui.selectedClips = project.clips.filter((c) => c.mediaId === item.id).map((c) => c.id);
    store.ui.dialog = null;
    store.toast(`${media.source.name} made. Double-click it to edit inside.`, 'ok', 4000);
    return true;
  } catch (e) {
    if (e instanceof Cancelled) store.ui.dialog = null;
    else compoundJob.error = (e as Error).message;
    return false;
  }
}

/** Edit inside a compound clip. */
export function openCompound(mediaId: string) {
  const m = store.project.media.find((x) => x.id === mediaId);
  const seq = compoundOf(m);
  if (!m || !seq) return;
  store.enterSequence(mediaId, m.source.name, innerProject($state.snapshot(store.project) as Project, JSON.parse(JSON.stringify(seq))));
}

/** Leave the compound being edited: render it again if it changed, then show the parent. */
export async function closeCompound(): Promise<boolean> {
  const top = store.seqStack.at(-1);
  if (!top) return false;
  const inner = $state.snapshot(store.project) as Project;
  const old = compoundOf(top.parent.media.find((m) => m.id === top.mediaId));
  const seq = sequenceOf(inner, old?.moshInside);
  // media imported inside joins the parent's library
  const parent: Project = { ...top.parent, media: [...top.parent.media, ...inner.media.filter((m) => !top.parent.media.some((p) => p.id === m.id))] };
  if (old && JSON.stringify(sequenceOf(old, old.moshInside)) === JSON.stringify(seq)) {
    store.leaveSequence(parent);
    return true;
  }
  try {
    store.ui.dialog = 'compound';
    const file = await renderSequence(parent, seq);
    store.ui.dialog = null;
    store.leaveSequence(withSequence(parent, top.mediaId, seq, file));
    return true;
  } catch (e) {
    if (e instanceof Cancelled) store.ui.dialog = null;
    else compoundJob.error = (e as Error).message;
    return false;
  }
}

/** Mosh inside: the compound's own effects are rendered into it (or left out). */
export async function setMoshInside(mediaId: string, on: boolean) {
  const p = $state.snapshot(store.project) as Project;
  const seq = compoundOf(p.media.find((m) => m.id === mediaId));
  if (!seq) return;
  const next = { ...seq, moshInside: on };
  store.ui.dialog = 'compound';
  try {
    const file = await renderSequence(p, next);
    store.ui.dialog = null;
    store.set(withSequence(p, mediaId, next, file));
  } catch (e) {
    if (e instanceof Cancelled) store.ui.dialog = null;
    else compoundJob.error = (e as Error).message;
  }
}

/** Render compounds that were edited but not rendered (e.g. the app closed while inside one). */
export async function ensureCompounds() {
  for (const m of staleCompounds(store.project)) {
    const p = $state.snapshot(store.project) as Project;
    const seq = compoundOf(p.media.find((x) => x.id === m.id))!;
    const file = await renderSequence(p, seq);
    store.set(withSequence($state.snapshot(store.project) as Project, m.id, seq, file), false);
  }
}
