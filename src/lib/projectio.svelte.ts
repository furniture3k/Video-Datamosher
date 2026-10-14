import { store } from './store.svelte';
import { download, localGet, localSet } from './storage';
import { type MediaItem, type Project } from '../engine/types';
import { migrate } from '../engine/migrate';
import { uid, type Preset } from '../engine/presets';

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
      if (m.source.kind === 'generator') {
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
async function deflate(s: string): Promise<string> {
  const cs = new Blob([s]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = '';
  buf.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function inflate(code: string): Promise<string> {
  const b64 = code.trim().replace(/^MOSH:/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(ds).text();
}

export async function shareCode(): Promise<string> {
  const p = $state.snapshot(store.project) as Project;
  const total = Math.max(1, store.totalFrames);
  const payload = {
    v: 1,
    t: total,
    enc: { ...p.encoder, keyMarkers: p.encoder.keyMarkers.map((m) => m / total) },
    dec: p.decoder,
    au: p.audio,
    seed: p.globalSeed,
    fx: p.effects.map((e) => ({ ...e, start: e.start / total, end: e.end / total, params: e.type === 'splice' ? { ...e.params, from: Number(e.params.from) / total } : e.params })),
  };
  return 'MOSH:' + (await deflate(JSON.stringify(payload)));
}

export async function applyShareCode(code: string) {
  const data = JSON.parse(await inflate(code));
  const total = Math.max(1, store.totalFrames);
  const R = (x: number) => Math.round(x * total);
  type Fx = Project['effects'][number];
  store.set({
    ...store.project,
    encoder: { ...store.project.encoder, ...data.enc, keyMarkers: (data.enc.keyMarkers ?? []).map(R) },
    decoder: { ...store.project.decoder, ...data.dec },
    audio: (({ source: _s, clipId: _c, ...a }) => ({ ...store.project.audio, ...a }))(data.au ?? {}),
    globalSeed: data.seed ?? store.project.globalSeed,
    effects: (data.fx as Fx[]).map((e) => ({ ...e, start: R(e.start), end: Math.max(R(e.start) + 1, R(e.end)), params: e.type === 'splice' ? { ...e.params, from: R(Number(e.params.from)) } : e.params })),
  });
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
