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

/** Every stored file and its size in bytes. */
export async function fileSizes(): Promise<Map<string, number>> {
  const d = await db();
  return new Promise((res, rej) => {
    const out = new Map<string, number>();
    const r = d.transaction('files', 'readonly').objectStore('files').openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return res(out);
      const v = c.value as Blob | { size?: number };
      out.set(String(c.key), v?.size ?? 0);
      c.continue();
    };
    r.onerror = () => rej(r.error);
  });
}

/** How much the browser lets this site keep, and whether it may clear it under pressure. */
export async function storageInfo(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  const s = navigator.storage;
  const e = s?.estimate ? await s.estimate().catch(() => ({}) as StorageEstimate) : ({} as StorageEstimate);
  const persisted = s?.persisted ? await s.persisted().catch(() => false) : false;
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}

/** Ask the browser not to clear moshpit's files when the disk gets full (asked once, quietly). */
export async function askPersist(): Promise<boolean> {
  if (isDesktop || !navigator.storage?.persist) return false;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/** askPersist() the first time media is imported, never again (Firefox shows a prompt for it). */
export function askPersistOnce() {
  if (localGet('askedPersist', false)) return;
  localSet('askedPersist', true);
  void askPersist();
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

// ---------- save dialog and share sheet (browser) ----------

type SaveHandle = { createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>; name: string };
type PickerWindow = { showSaveFilePicker?: (o: object) => Promise<SaveHandle> };

/** The browser has a real Save dialog (Chromium on desktop). Needs a click to call it. */
export const hasSavePicker = () => !isDesktop && typeof (window as unknown as PickerWindow).showSaveFilePicker === 'function';

/**
 * Save with the browser's Save dialog where there is one (from a click), else download.
 * Resolves with the chosen file (to write to again later), null when cancelled or downloaded.
 */
export async function saveAs(blob: Blob, name: string, handle?: SaveHandle | null): Promise<SaveHandle | null> {
  if (!hasSavePicker()) {
    download(blob, name, blob.type);
    return null;
  }
  try {
    const ext = name.includes('.') ? name.slice(name.indexOf('.')) : '';
    handle ??= await (window as unknown as PickerWindow).showSaveFilePicker!({
      suggestedName: name,
      types: ext ? [{ description: name.slice(name.indexOf('.') + 1).toUpperCase() + ' file', accept: { [blob.type || 'application/octet-stream']: [ext.slice(ext.lastIndexOf('.'))] } }] : undefined,
    });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return handle;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null;
    // permission lost or no user gesture: fall back to a download
    download(blob, name, blob.type);
    return null;
  }
}

/** The share sheet can take this file (phones, Safari, Edge…). */
export function canShareFile(file: File): boolean {
  try {
    return !isDesktop && typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/** Open the system share sheet with a file. Resolves false when it was cancelled or failed. */
export async function shareFile(file: File, text?: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: file.name, text });
    return true;
  } catch {
    return false;
  }
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
