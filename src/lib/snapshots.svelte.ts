// Snapshots: named versions of the project with a thumbnail, kept across sessions. Taken by hand
// (Ctrl+Shift+S) and automatically before anything that replaces the whole effect stack.
import { store } from './store.svelte';
import { kvRead, kvSet } from './storage';
import { uid } from '../engine/presets';
import { migrate } from '../engine/migrate';
import type { Project } from '../engine/types';

export interface Snapshot {
  id: string;
  name: string;
  /** ms since epoch */
  at: number;
  auto: boolean;
  project: Project;
  /** small JPEG data URL of the player frame */
  thumb: string;
  /** the saved project it belongs to */
  projectId?: string;
}

const KEY = 'snapshots';
/** automatic snapshots kept (manual ones are never dropped) */
const MAX_AUTO = 20;

export const snapshots = $state<{ list: Snapshot[]; loaded: boolean }>({ list: [], loaded: false });

let loading: Promise<void> | null = null;
/** the saved list couldn't be read: it is read again next time, and never written over meanwhile */
let unread = false;
export function loadSnapshots(): Promise<void> {
  loading ??= kvRead<Snapshot[]>(KEY).then((l) => {
    unread = false;
    // snapshots taken by older versions are in older project formats
    snapshots.list = (l ?? []).flatMap((s) => {
      try {
        return [{ ...s, project: migrate(s.project) }];
      } catch {
        return [];
      }
    });
    snapshots.loaded = true;
  }, (e) => {
    console.warn('snapshots not read', e);
    unread = true;
    loading = null;
    snapshots.loaded = true;
  });
  return loading;
}

const save = () => (unread ? Promise.resolve(false) : kvSet(KEY, $state.snapshot(snapshots.list)));

/** The player registers this so snapshots get a thumbnail of what's on screen. */
let grabber: (() => string) | null = null;
export function setFrameGrabber(fn: (() => string) | null) {
  grabber = fn;
}
/** A small JPEG of what the player shows now ('' when there's no player or nothing on it). */
export function grabFrame(): string {
  try {
    return grabber?.() ?? '';
  } catch {
    return '';
  }
}

/** This project's snapshots. */
export const ofProject = (list: Snapshot[]) => list.filter((s) => !s.projectId || s.projectId === store.projectId);

/** Forget a deleted project's snapshots. */
export async function deleteProjectSnapshots(projectId: string) {
  await loadSnapshots();
  snapshots.list = snapshots.list.filter((s) => s.projectId !== projectId);
  await save();
}

/** Media and LUT files referenced by snapshots (kept when unused files are cleaned up). */
export async function snapshotFileIds(): Promise<string[]> {
  await loadSnapshots();
  // what they use isn't known: whoever asked must not take the list as complete
  if (unread) throw new Error('The snapshots could not be read.');
  return snapshots.list.flatMap((s) => [...s.project.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.fileId] : [])), ...(s.project.luts ?? []).map((l) => 'lut:' + l.id), ...(s.project.fonts ?? []).map((f) => 'font:' + f.id), ...s.project.media.flatMap((m) => (m.mattes ?? []).map((x) => x.fileId))]);
}

export async function takeSnapshot(name?: string, auto = false): Promise<Snapshot | null> {
  await loadSnapshots();
  // the whole project, also while a compound clip is open
  const live = store.rootProject();
  if (!live.clips.length && !live.effects.length) return null;
  // the project gets its place in the list first, so the snapshot can belong to it
  await store.flush();
  // stored without media thumbnails (they're big and come back with the media)
  const project: Project = { ...live, media: live.media.map((m) => ({ ...m, thumb: undefined })) };
  // nothing changed since the last snapshot: don't pile up copies
  const json = JSON.stringify(project);
  const last = ofProject(snapshots.list)[0];
  if (last && JSON.stringify(last.project) === json) return last;
  const thumb = grabFrame();
  const s: Snapshot = {
    id: uid(),
    name: name ?? `Snapshot ${ofProject(snapshots.list).filter((x) => !x.auto).length + 1}`,
    at: Date.now(),
    auto,
    project,
    thumb,
    projectId: store.projectId ?? undefined,
  };
  // the automatic ones are capped per project
  const autos = ofProject(snapshots.list).filter((x) => x.auto);
  const dropped = auto && autos.length >= MAX_AUTO ? new Set(autos.slice(MAX_AUTO - 1).map((x) => x.id)) : null;
  snapshots.list = [s, ...snapshots.list.filter((x) => !dropped?.has(x.id))];
  await save();
  return s;
}

/** Restore a snapshot (undoable). Media that has since been removed from the library is put back. */
export async function restoreSnapshot(id: string) {
  const s = snapshots.list.find((x) => x.id === id);
  if (!s) return;
  // a snapshot is the whole project: it can't go in place of a compound's timeline
  if (store.seqStack.length) return void store.toast('Close the compound clip first (Done, top left), then restore the snapshot.', 'error', 6000);
  await takeSnapshot('Before restoring ' + s.name, true);
  const cur = store.project.media;
  const media = [...cur, ...s.project.media.filter((m) => !cur.some((c) => c.id === m.id))].map((m) => cur.find((c) => c.id === m.id) ?? m);
  store.set({ ...(JSON.parse(JSON.stringify(s.project)) as Project), media });
  store.toast(`Restored ${s.name}.`, 'ok');
}

export async function renameSnapshot(id: string, name: string) {
  const s = snapshots.list.find((x) => x.id === id);
  if (!s) return;
  s.name = name;
  s.auto = false;
  await save();
}

export async function deleteSnapshot(id: string) {
  snapshots.list = snapshots.list.filter((x) => x.id !== id);
  if (store.ui.compareSnap === id) store.ui.compareSnap = null;
  await save();
}

/** Delete every automatic snapshot (named ones stay). Returns how many went. */
export async function deleteAutoSnapshots(): Promise<number> {
  await loadSnapshots();
  const n = snapshots.list.filter((s) => s.auto).length;
  snapshots.list = snapshots.list.filter((s) => !s.auto);
  if (store.ui.compareSnap && !snapshots.list.some((s) => s.id === store.ui.compareSnap)) store.ui.compareSnap = null;
  await save();
  return n;
}
