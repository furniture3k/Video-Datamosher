// Snapshots: named versions of the project with a thumbnail, kept across sessions. Taken by hand
// (Ctrl+Shift+S) and automatically before anything that replaces the whole effect stack.
import { store } from './store.svelte';
import { kvGet, kvSet } from './storage';
import { uid } from '../engine/presets';
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
}

const KEY = 'snapshots';
/** automatic snapshots kept (manual ones are never dropped) */
const MAX_AUTO = 20;

export const snapshots = $state<{ list: Snapshot[]; loaded: boolean }>({ list: [], loaded: false });

let loading: Promise<void> | null = null;
export function loadSnapshots(): Promise<void> {
  loading ??= kvGet<Snapshot[]>(KEY).then((l) => {
    snapshots.list = l ?? [];
    snapshots.loaded = true;
  });
  return loading;
}

const save = () => kvSet(KEY, $state.snapshot(snapshots.list));

/** The player registers this so snapshots get a thumbnail of what's on screen. */
let grabber: (() => string) | null = null;
export function setFrameGrabber(fn: (() => string) | null) {
  grabber = fn;
}

/** Media files referenced by snapshots (kept when unused media is cleaned up). */
export async function snapshotFileIds(): Promise<string[]> {
  await loadSnapshots();
  return snapshots.list.flatMap((s) => s.project.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.fileId] : [])));
}

export async function takeSnapshot(name?: string, auto = false): Promise<Snapshot | null> {
  await loadSnapshots();
  const project = $state.snapshot(store.project) as Project;
  if (!project.clips.length && !project.effects.length) return null;
  // nothing changed since the last snapshot: don't pile up copies
  const json = JSON.stringify(project);
  const last = snapshots.list[0];
  if (last && JSON.stringify(last.project) === json) return last;
  let thumb = '';
  try {
    thumb = grabber?.() ?? '';
  } catch {
    /* thumbnail optional */
  }
  const s: Snapshot = {
    id: uid(),
    name: name ?? `Snapshot ${snapshots.list.filter((x) => !x.auto).length + 1}`,
    at: Date.now(),
    auto,
    project: { ...project, media: project.media.map((m) => ({ ...m, thumb: undefined })) },
    thumb,
  };
  const autos = snapshots.list.filter((x) => x.auto);
  const dropped = auto && autos.length >= MAX_AUTO ? new Set(autos.slice(MAX_AUTO - 1).map((x) => x.id)) : null;
  snapshots.list = [s, ...snapshots.list.filter((x) => !dropped?.has(x.id))];
  await save();
  return s;
}

/** Restore a snapshot (undoable). Media that has since been removed from the library is put back. */
export async function restoreSnapshot(id: string) {
  const s = snapshots.list.find((x) => x.id === id);
  if (!s) return;
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
