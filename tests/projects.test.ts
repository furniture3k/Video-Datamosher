import { describe, expect, it, vi, beforeEach } from 'vitest';
import { newProject, type Project, type MediaItem } from '../src/engine/types';

// IndexedDB and localStorage stand-ins
const kv = new Map<string, unknown>();
const local = new Map<string, unknown>();
/** the database fails to read (a locked or broken IndexedDB) */
let unreadable = false;
vi.mock('../src/lib/storage', () => ({
  kvGet: async (k: string) => (unreadable ? undefined : structuredClone(kv.get(k))),
  kvRead: async (k: string) => {
    if (unreadable) throw new Error('IndexedDB transaction failed');
    return structuredClone(kv.get(k));
  },
  kvSet: async (k: string, v: unknown) => void kv.set(k, structuredClone(v)),
  kvDelete: async (k: string) => void kv.delete(k),
  localGet: (k: string, d: unknown) => (local.has(k) ? local.get(k) : d),
  localSet: (k: string, v: unknown) => void local.set(k, v),
}));
vi.mock('../src/lib/renderer', () => ({ proxyKey: (id: string) => 'proxy:' + id }));

const idx = await import('../src/lib/projectindex');

function project(name: string, withMedia = true): Project {
  const p = { ...newProject(), name };
  if (withMedia) {
    const m = { id: 'm1', source: { kind: 'file', fileId: 'f1', name: 'clip.mp4', mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration: 4, width: 640, height: 360, fps: 24, hasAudio: false, hasVideo: true } as MediaItem;
    p.media = [m];
    p.clips = [{ id: 'c1', mediaId: 'm1', track: 'v1', in: 0, out: 4, start: 0, speed: 1 } as Project['clips'][number]];
  }
  return p;
}

beforeEach(() => {
  kv.clear();
  local.clear();
  unreadable = false;
});

describe('saved projects', () => {
  it("a list that can't be read is never written over with just one project", async () => {
    await idx.saveProject('a', project('A'));
    await idx.saveProject('b', project('B'));
    unreadable = true;
    expect(await idx.saveProject('c', project('C'))).toBe(false);
    await expect(idx.loadIndexStrict()).rejects.toThrow();
    unreadable = false;
    expect((await idx.loadIndex()).map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('moves the old single autosave into the list once, with its snapshots', async () => {
    kv.set('autosave', project('Old one'));
    kv.set('snapshots', [{ id: 's1', name: 'Snap' }]);
    const id = await idx.migrateAutosave();
    expect(id).toBeTruthy();
    expect(idx.currentProjectId()).toBe(id);
    const list = await idx.loadIndex();
    expect(list.map((m) => m.name)).toEqual(['Old one']);
    expect(list[0].files).toEqual(['f1', 'proxy:m1']);
    expect((await idx.loadProject(id!))?.name).toBe('Old one');
    expect((kv.get('snapshots') as { projectId: string }[])[0].projectId).toBe(id);
    // a second start doesn't migrate again
    expect(await idx.migrateAutosave()).toBeNull();
    expect((await idx.loadIndex()).length).toBe(1);
  });

  it('an empty old autosave leaves an empty list', async () => {
    kv.set('autosave', newProject());
    expect(await idx.migrateAutosave()).toBeNull();
    expect(await idx.loadIndex()).toEqual([]);
  });

  it('saves, lists newest first, and removes', async () => {
    await idx.saveProject('a', project('A'));
    await new Promise((r) => setTimeout(r, 5));
    await idx.saveProject('b', project('B'));
    expect((await idx.loadIndex()).map((m) => m.id)).toEqual(['b', 'a']);
    // saving again keeps when it was made and its picture
    await idx.updateIndex((l) => void (l.find((m) => m.id === 'a')!.thumb = 'data:x'));
    const created = (await idx.loadIndex()).find((m) => m.id === 'a')!.created;
    await new Promise((r) => setTimeout(r, 5));
    await idx.saveProject('a', project('A renamed'));
    const a = (await idx.loadIndex())[0];
    expect([a.id, a.name, a.thumb, a.created]).toEqual(['a', 'A renamed', 'data:x', created]);
    await idx.removeProject('a');
    expect((await idx.loadIndex()).map((m) => m.id)).toEqual(['b']);
    expect(kv.has(idx.projectKey('a'))).toBe(false);
  });

  it('queues index changes so quick saves never lose an entry', async () => {
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => idx.saveProject(id, project(id))));
    expect((await idx.loadIndex()).map((m) => m.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('knows which projects are worth keeping', () => {
    expect(idx.hasContent(newProject())).toBe(false);
    expect(idx.hasContent(project('x'))).toBe(true);
  });
});
