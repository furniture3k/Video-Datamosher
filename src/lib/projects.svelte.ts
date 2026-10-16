// The project list on the home screen: open, start, duplicate, rename and delete projects.
import { store } from './store.svelte';
import { loadIndex, loadProject, saveProject, removeProject, updateIndex, newProjectId, type ProjectMeta } from './projectindex';
import { grabFrame, deleteProjectSnapshots } from './snapshots.svelte';
import { newProject, type Project } from '../engine/types';
import { migrate } from '../engine/migrate';
import { forgetProjectFile } from './projectio.svelte';

export const projects = $state<{ list: ProjectMeta[]; loaded: boolean }>({ list: [], loaded: false });

export async function refreshProjects() {
  projects.list = await loadIndex();
  projects.loaded = true;
}

/** Keep the open project's card picture up to date (called when leaving it, and now and then). */
export async function refreshThumb() {
  const id = store.projectId;
  if (!id) return;
  const thumb = grabFrame();
  if (!thumb) return;
  await updateIndex((list) => {
    const m = list.find((x) => x.id === id);
    if (m) m.thumb = thumb;
  });
}

/** Back to the home screen: the open project is saved with a fresh picture first. */
export async function goHome() {
  store.ui.playing = false;
  await store.flush();
  await refreshThumb();
  await refreshProjects();
  store.ui.home = true;
}

/** Start a new project (empty, or the one given) and show the editor. */
export async function startProject(p?: Project) {
  forgetProjectFile();
  await store.openProject(null, p ?? { ...newProject(), name: 'Untitled mosh' });
  store.ui.home = false;
}

export async function openSavedProject(id: string) {
  if (id === store.projectId) {
    store.ui.home = false;
    return;
  }
  const p = await loadProject(id);
  if (!p) {
    store.toast('That project could not be found. It may have been deleted in another tab.', 'error');
    await refreshProjects();
    return;
  }
  forgetProjectFile();
  try {
    await store.openProject(id, p);
  } catch (e) {
    store.toast('Could not open the project: ' + (e as Error).message, 'error');
    return;
  }
  store.ui.home = false;
}

export async function duplicateProject(id: string) {
  if (id === store.projectId) await store.flush();
  const p = await loadProject(id);
  if (!p) return;
  const meta = projects.list.find((m) => m.id === id);
  const copy = migrate(JSON.parse(JSON.stringify(p)));
  copy.name = `${p.name || 'Untitled mosh'} copy`;
  const nid = newProjectId();
  await saveProject(nid, copy);
  if (meta?.thumb) await updateIndex((list) => void (list.find((m) => m.id === nid)!.thumb = meta.thumb));
  await refreshProjects();
}

export async function renameProject(id: string, name: string) {
  name = name.trim() || 'Untitled mosh';
  if (id === store.projectId) {
    store.edit((p) => (p.name = name));
    await store.flush();
  } else {
    const p = await loadProject(id);
    if (!p) return;
    await saveProject(id, { ...p, name });
  }
  await refreshProjects();
}

/** Delete a project and its snapshots. Its media goes at the next start (or Storage → Clean up). */
export async function deleteProject(id: string) {
  if (id === store.projectId) {
    // don't let the open project save itself back into the list
    await store.openProject(null, newProject());
    store.projectId = null;
  }
  await removeProject(id);
  await deleteProjectSnapshots(id);
  await refreshProjects();
}
