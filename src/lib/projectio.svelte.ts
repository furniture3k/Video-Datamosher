import { store } from './store.svelte';
import { download, localGet, localSet } from './storage';
import { type MediaItem, type Project } from '../engine/types';
import { migrate } from '../engine/migrate';
import { uid, type Preset } from '../engine/presets';
import { applyRecipe, decodeRecipe, encodeRecipe } from '../engine/recipe';

export function saveProjectFile() {
  const p = $state.snapshot(store.project) as Project;
  const data = { ...p, media: p.media.map((m) => ({ ...m, thumb: undefined })) };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${(p.name || 'mosh').replace(/[^\w-]+/g, '_')}.mosh.json`);
  store.toast('Saved. Media files are not included in the project file.', 'ok');
}

/** Load a project file. Media already in this session is matched by file name. */
export async function loadProjectFile(file: File) {
  try {
    const p = migrate(JSON.parse(await file.text()));
    const current = store.project.media;
    const media: MediaItem[] = [];
    const idMap = new Map<string, string>();
    for (const m of p.media) {
      if (m.source.kind !== 'file') {
        media.push(m);
        continue;
      }
      const match = current.find((x) => x.source.kind === 'file' && x.source.name === (m.source as { name: string }).name);
      if (!match) continue;
      idMap.set(m.id, match.id);
      if (!media.includes(match)) media.push(match);
    }
    const known = new Set(media.map((m) => m.id));
    const clips = p.clips.map((c) => ({ ...c, mediaId: idMap.get(c.mediaId) ?? c.mediaId })).filter((c) => known.has(c.mediaId));
    const missing = p.media.filter((m) => m.source.kind === 'file').length - idMap.size;
    store.set({ ...p, media: [...media, ...current.filter((m) => !known.has(m.id))], clips });
    if (missing > 0) store.toast(`${missing} media file(s) are missing. Import them and open the project again.`, 'error', 7000);
    else store.toast('Opened.', 'ok');
  } catch (e) {
    store.toast('Could not load project: ' + (e as Error).message, 'error');
  }
}

// ---------- share codes: effects + settings, compressed ----------
export async function shareCode(): Promise<string> {
  return encodeRecipe($state.snapshot(store.project) as Project, store.totalFrames);
}

export async function applyShareCode(code: string) {
  const data = await decodeRecipe(code);
  store.set(applyRecipe(store.project, data, store.totalFrames));
}

// ---------- user presets ----------
export const userPresets = {
  list(): Preset[] {
    return localGet<Preset[]>('userPresets', []);
  },
  save(p: Preset) {
    localSet('userPresets', [...this.list(), p]);
  },
  remove(id: string) {
    localSet('userPresets', this.list().filter((p) => p.id !== id));
  },
};
