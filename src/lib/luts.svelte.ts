// Imported LUTs: stored with the media, parsed on demand, shared by the preview and the render.
import { store } from './store.svelte';
import { getFile, putFile } from './storage';
import { cubeText, lutFile, lutKey, parseCube, type Lut3D } from '../engine/lut';
import { uid } from '../engine/presets';
import { isVideoTrack } from '../engine/timeline';
import type { Project } from '../engine/types';

const parsed = new Map<string, Promise<Lut3D | null>>();
const ready = new Map<string, Lut3D>();
/** bumped when a LUT finishes loading (the preview redraws) */
export const lutState = $state({ loaded: 0 });

export function getLut(id: string): Promise<Lut3D | null> {
  let p = parsed.get(id);
  if (!p) {
    p = getFile(lutKey(id)).then(async (b) => {
      if (!b) return null;
      const l = parseCube(await b.text());
      ready.set(id, l);
      lutState.loaded++;
      return l;
    });
    p.catch(() => parsed.delete(id));
    parsed.set(id, p);
  }
  return p;
}

/** The LUT if it's loaded (starting the load otherwise): for the preview's draw loop. */
export function lutNow(id: string): Lut3D | null {
  const l = ready.get(id);
  if (!l) getLut(id).catch(() => {});
  return l ?? null;
}

/** Import .cube files into the project's LUT list. Returns the new ids. */
export async function importLuts(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    try {
      const text = await f.text();
      const l = parseCube(text);
      const id = uid();
      await putFile(lutKey(id), new Blob([text], { type: 'text/plain' }));
      ready.set(id, l);
      parsed.set(id, Promise.resolve(l));
      const name = l.title || f.name.replace(/\.cube$/i, '');
      store.edit((p) => (p.luts = [...(p.luts ?? []), { id, name }]));
      ids.push(id);
    } catch (e) {
      store.toast(`${f.name}: ${(e as Error).message}`, 'error', 6000);
    }
  }
  return ids;
}

/** The .cube files a render needs (each LUT at each amount used), as job inputs. */
export async function lutInputs(p: Project): Promise<Record<string, () => Promise<Uint8Array>>> {
  const out: Record<string, () => Promise<Uint8Array>> = {};
  for (const c of p.clips) {
    const g = c.grade;
    if (!isVideoTrack(c.track) || !g?.lut || (g.lutAmount ?? 1) <= 0) continue;
    const name = lutFile(g.lut, g.lutAmount ?? 1);
    if (out[name]) continue;
    const l = await getLut(g.lut);
    if (!l) throw new Error('A LUT used by a clip is missing. Import it again in the Media panel.');
    const text = cubeText(l, g.lutAmount ?? 1);
    out[name] = async () => new TextEncoder().encode(text);
  }
  return out;
}
