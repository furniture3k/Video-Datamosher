// Saved projects: each project is kept under `project:<id>` in IndexedDB, with a small index
// (name, thumbnail, length, which stored files it uses) under `projects` for the home screen.
// Storage only: no app state here, so the store can use it without an import cycle.
import { kvGet, kvRead, kvSet, kvDelete, localGet, localSet } from './storage';
import { migrate } from '../engine/migrate';
import { timelineDuration } from '../engine/timeline';
import { proxyKey } from './renderer';
import type { Project } from '../engine/types';

export interface ProjectMeta {
  id: string;
  name: string;
  /** ms since epoch */
  created: number;
  updated: number;
  /** small JPEG data URL of the player */
  thumb?: string;
  seconds: number;
  clips: number;
  /** stored files the project uses (media, preview copies, LUTs): kept when unused files are cleaned up */
  files: string[];
}

const INDEX = 'projects';
const CURRENT = 'currentProject';
export const projectKey = (id: string) => 'project:' + id;
export const newProjectId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Stored files a project needs. */
export function filesOf(p: Project): string[] {
  return [
    ...p.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.fileId, proxyKey(m.id)] : [])),
    ...(p.luts ?? []).map((l) => 'lut:' + l.id),
    ...(p.fonts ?? []).map((f) => 'font:' + f.id),
    ...p.media.flatMap((m) => (m.mattes ?? []).map((x) => x.fileId)),
  ];
}

/** A project worth keeping in the list: anything on it at all. */
export const hasContent = (p: Project) => p.clips.length > 0 || p.media.length > 0 || p.layers.length > 0 || p.effects.length > 0;

export function metaOf(p: Project, id: string, prev?: ProjectMeta): ProjectMeta {
  let seconds = 0;
  try {
    seconds = timelineDuration(p);
  } catch {
    /* a half-migrated project: no length */
  }
  return {
    id,
    name: p.name || 'Untitled mosh',
    created: prev?.created ?? Date.now(),
    updated: Date.now(),
    thumb: prev?.thumb,
    seconds,
    clips: p.clips.length,
    files: filesOf(p),
  };
}

// index writes are queued so autosaves from quick edits can't interleave
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(job: () => Promise<T>): Promise<T> => {
  const p = chain.then(job, job);
  chain = p.catch(() => {});
  return p;
};

export async function loadIndex(): Promise<ProjectMeta[]> {
  return (await kvGet<ProjectMeta[]>(INDEX)) ?? [];
}

/** The index, or an error if it can't be read (for clean-ups, which must not take a failed read as "no projects"). */
export async function loadIndexStrict(): Promise<ProjectMeta[]> {
  return (await kvRead<ProjectMeta[]>(INDEX)) ?? [];
}

/** Change the index (load, edit, save, in order with every other change). */
export function updateIndex(fn: (list: ProjectMeta[]) => ProjectMeta[] | void): Promise<ProjectMeta[]> {
  return queue(async () => {
    // (a list that can't be read throws: writing back an empty one would lose every other project)
    const list = await loadIndexStrict();
    const next = fn(list) ?? list;
    next.sort((a, b) => b.updated - a.updated);
    await kvSet(INDEX, next);
    return next;
  });
}

/** Save a project body and refresh its entry in the index. Resolves false when it could not be saved. */
export async function saveProject(id: string, p: Project): Promise<boolean> {
  const ok = await kvSet(projectKey(id), p);
  try {
    await updateIndex((list) => {
      const i = list.findIndex((m) => m.id === id);
      const meta = metaOf(p, id, list[i]);
      if (i >= 0) list[i] = meta;
      else list.push(meta);
    });
  } catch (e) {
    console.warn('project list not updated', e);
    return false;
  }
  return ok;
}

export const loadProject = (id: string) => kvGet<Project>(projectKey(id));

export async function removeProject(id: string) {
  await kvDelete(projectKey(id));
  await updateIndex((list) => list.filter((m) => m.id !== id));
}

/** The project open last time (per device). */
export const currentProjectId = () => localGet<string | null>(CURRENT, null);
export const setCurrentProjectId = (id: string | null) => localSet(CURRENT, id);

/**
 * Before 1.6 there was one autosaved project. Move it into the list once (the old copy is left
 * where it was, unused) and hand its id back, with the snapshots marked as belonging to it.
 */
export async function migrateAutosave(): Promise<string | null> {
  if (await kvGet<ProjectMeta[]>(INDEX)) return null;
  const saved = await kvGet<unknown>('autosave');
  let old: Project | undefined;
  try {
    old = saved ? migrate(saved) : undefined;
  } catch {
    /* from a format this version can't read: nothing to move */
  }
  if (!old || !hasContent(old)) {
    await kvSet(INDEX, []);
    return null;
  }
  const id = newProjectId();
  await kvSet(projectKey(id), old);
  await kvSet(INDEX, [metaOf(old, id)]);
  const snaps = await kvGet<{ projectId?: string }[]>('snapshots');
  if (snaps?.length) await kvSet('snapshots', snaps.map((s) => ({ ...s, projectId: s.projectId ?? id })));
  setCurrentProjectId(id);
  return id;
}
