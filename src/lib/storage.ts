// IndexedDB persistence for media files, autosaved project and user presets.
import { blobToDisk, saveFromDisk, removeEngineFile } from './ffmpeg-native';
import { isDesktop } from './platform';
import { tell } from './ask';

const DB = 'moshpit';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('files');
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const files = new Map<string, Blob>();

export async function putFile(id: string, blob: Blob) {
  files.set(id, blob);
  try {
    await tx('files', 'readwrite', (s) => s.put(blob, id));
  } catch (e) {
    console.warn('Could not persist file (storage full?)', e);
  }
}

export async function getFile(id: string): Promise<Blob | undefined> {
  if (files.has(id)) return files.get(id);
  try {
    const b = await tx<Blob | undefined>('files', 'readonly', (s) => s.get(id));
    if (b) files.set(id, b);
    return b;
  } catch {
    return undefined;
  }
}

export async function pruneFiles(keep: string[]) {
  try {
    const keys = await tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys());
    for (const k of keys) if (!keep.includes(String(k))) await tx('files', 'readwrite', (s) => s.delete(k));
  } catch {
    /* ignore */
  }
  for (const k of [...files.keys()]) if (!keep.includes(k)) files.delete(k);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return await tx<T | undefined>('kv', 'readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown) {
  try {
    await tx('kv', 'readwrite', (s) => s.put(value, key));
  } catch (e) {
    console.warn('kv save failed', e);
  }
}

export function localGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('moshpit:' + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function localSet(key: string, value: unknown) {
  try {
    localStorage.setItem('moshpit:' + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function download(data: Blob | Uint8Array, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  if (isDesktop) return void saveNative(blob, name);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Desktop app: the webview can't download, so copy the file to disk in chunks and use the native Save dialog. */
async function saveNative(blob: Blob, name: string) {
  try {
    const path = await blobToDisk(blob, name);
    if (!(await saveFromDisk(path, name))) removeEngineFile(path); // cancelled
  } catch (e) {
    tell('Could not save ' + name + ': ' + ((e as Error)?.message ?? e));
  }
}
