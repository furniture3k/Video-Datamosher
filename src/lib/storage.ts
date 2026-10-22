// IndexedDB persistence for media files, autosaved project and user presets.
import { blobToDisk, saveFromDisk, removeEngineFile } from './ffmpeg-native';
import { isDesktop, isAndroidApp } from './platform';
import { tell } from './ask';

const DB = 'moshpit';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  const p: Promise<IDBDatabase> = (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('files');
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => {
      // the browser can close the connection (storage cleared, another tab upgrading): open again next time
      const forget = () => void (dbp === p && (dbp = null));
      r.result.onclose = forget;
      r.result.onversionchange = () => (r.result.close(), forget());
      res(r.result);
    };
    r.onerror = () => rej(r.error);
  }));
  // a failed open is tried again next time instead of failing forever
  p.catch(() => void (dbp === p && (dbp = null)));
  return p;
}

/**
 * One request in its own transaction. Resolves once the transaction has committed: a write that
 * doesn't fit (QuotaExceededError) succeeds as a request and only fails when the transaction aborts.
 */
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r.result);
    t.onabort = t.onerror = () => rej(t.error ?? r.error ?? new Error('IndexedDB transaction failed'));
  });
}

export const files = new Map<string, Blob>();

// ---------- media on disk (OPFS) ----------
// Where the browser has it, media files are kept in its private file system (OPFS) instead of
// IndexedDB: they come back as Files read straight from disk (no copy into memory, which ffmpeg's
// WORKERFS mounts read in pieces) and big imports write faster. IndexedDB stays the fallback, and
// files kept there by older versions are moved over in the background (moveFilesToDisk).

type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
type Writable = { write(b: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> };
type FileHandle = FileSystemFileHandle & { createWritable?: () => Promise<Writable> };

let opfsDir: Promise<DirHandle | null> | null = null;
/** The folder media is kept in, or null where there's no OPFS that the page can write to. */
export function opfs(): Promise<DirHandle | null> {
  opfsDir ??= (async () => {
    if (isDesktop || !navigator.storage?.getDirectory) return null;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = (await root.getDirectoryHandle('files', { create: true })) as DirHandle;
      // writing from the page (not a worker) needs createWritable: Chromium, Firefox, newer Safari
      const probe = (await dir.getFileHandle('.probe', { create: true })) as FileHandle;
      if (typeof probe.createWritable !== 'function') return null;
      return dir;
    } catch {
      return null;
    }
  })();
  return opfsDir;
}

/** File ids ("proxy:abc", "lut:x"…) as file names. */
const diskName = (id: string) => encodeURIComponent(id);
const diskId = (name: string) => decodeURIComponent(name);

async function writeDisk(dir: DirHandle, id: string, blob: Blob): Promise<boolean> {
  let w: Writable | null = null;
  try {
    const h = (await dir.getFileHandle(diskName(id), { create: true })) as FileHandle;
    w = await h.createWritable!();
    await w.write(blob);
    await w.close();
    return true;
  } catch (e) {
    console.warn('Could not write to the file system (storage full?)', e);
    await w?.abort?.().catch(() => {});
    await dir.removeEntry(diskName(id)).catch(() => {});
    return false;
  }
}

async function readDisk(dir: DirHandle, id: string): Promise<File | undefined> {
  try {
    return await (await dir.getFileHandle(diskName(id))).getFile();
  } catch {
    return undefined;
  }
}

/** Ids of the files on disk. */
async function diskIds(dir: DirHandle): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const [name, h] of dir.entries()) if (h.kind === 'file' && name !== '.probe' && !name.endsWith('.crswap')) out.push(diskId(name));
  } catch {
    /* none */
  }
  return out;
}

/** When each file was last written in this session (a clean-up must not delete what came after its list was made). */
const writtenAt = new Map<string, number>();

export async function putFile(id: string, blob: Blob) {
  writtenAt.set(id, Date.now());
  files.set(id, blob);
  const dir = await opfs();
  if (dir && (await writeDisk(dir, id, blob))) {
    // a copy from before is no longer needed
    tx('files', 'readwrite', (s) => s.delete(id)).catch(() => {});
    // the file on disk stands in for the one in memory (a made proxy or matte would otherwise stay in memory for good)
    const onDisk = await readDisk(dir, id);
    if (onDisk && files.get(id) === blob) files.set(id, onDisk);
    return;
  }
  try {
    await tx('files', 'readwrite', (s) => s.put(blob, id));
  } catch (e) {
    console.warn('Could not persist file (storage full?)', e);
  }
}

export async function getFile(id: string): Promise<Blob | undefined> {
  if (files.has(id)) return files.get(id);
  const dir = await opfs();
  const f = dir ? await readDisk(dir, id) : undefined;
  if (f) {
    files.set(id, f);
    return f;
  }
  try {
    const b = await tx<Blob | undefined>('files', 'readonly', (s) => s.get(id));
    if (b) files.set(id, b);
    return b;
  } catch {
    return undefined;
  }
}

/**
 * Delete stored files that aren't in `keep`. `since`: when `keep` was worked out; files written
 * after that (media imported while the list was made or this runs) are new, not unused, and stay.
 */
export async function pruneFiles(keep: string[], since = Date.now()) {
  const k = new Set(keep);
  const unused = (id: string) => !k.has(id) && (writtenAt.get(id) ?? 0) < since;
  try {
    const keys = await tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys());
    for (const key of keys) if (unused(String(key))) await tx('files', 'readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
  const dir = await opfs();
  if (dir) for (const id of await diskIds(dir)) if (unused(id)) await dir.removeEntry(diskName(id)).catch(() => {});
  for (const key of [...files.keys()]) if (unused(key)) files.delete(key);
}

/** Every stored file and its size in bytes. */
export async function fileSizes(): Promise<Map<string, number>> {
  const d = await db();
  const out = await new Promise<Map<string, number>>((res, rej) => {
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
  const dir = await opfs();
  if (dir) for (const id of await diskIds(dir)) out.set(id, (await readDisk(dir, id))?.size ?? 0);
  return out;
}

/**
 * Move files kept in IndexedDB (by older versions, or when OPFS failed) to OPFS, one at a time in
 * the background. Each is checked on disk before its IndexedDB copy is deleted.
 */
export async function moveFilesToDisk(): Promise<number> {
  const dir = await opfs();
  if (!dir) return 0;
  let moved = 0;
  let keys: IDBValidKey[] = [];
  try {
    keys = await tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys());
  } catch {
    return 0;
  }
  for (const key of keys) {
    const id = String(key);
    const blob = await tx<Blob | undefined>('files', 'readonly', (s) => s.get(key)).catch(() => undefined);
    if (!blob) continue;
    if (!(await writeDisk(dir, id, blob))) break; // disk full: leave the rest where they are
    if ((await readDisk(dir, id))?.size !== blob.size) {
      await dir.removeEntry(diskName(id)).catch(() => {});
      break;
    }
    await tx('files', 'readwrite', (s) => s.delete(key)).catch(() => {});
    // the File on disk replaces the in-memory copy
    if (files.has(id)) files.set(id, (await readDisk(dir, id)) ?? blob);
    moved++;
    await new Promise((r) => setTimeout(r, 30));
  }
  return moved;
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

/** Like kvGet, but a database that can't be read throws (undefined only means there's nothing saved under the key). */
export function kvRead<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>('kv', 'readonly', (s) => s.get(key));
}

/** Resolves false when it could not be saved (storage full, or no IndexedDB). */
export async function kvSet(key: string, value: unknown): Promise<boolean> {
  try {
    await tx('kv', 'readwrite', (s) => s.put(value, key));
    return true;
  } catch (e) {
    console.warn('kv save failed', e);
    return false;
  }
}

export async function kvDelete(key: string) {
  try {
    await tx('kv', 'readwrite', (s) => s.delete(key));
  } catch (e) {
    console.warn('kv delete failed', e);
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
  if (isAndroidApp) return void saveAndroid(blob, name);
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
    // "my.mosh.json" is a JSON file (named by its last extension)
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    handle ??= await (window as unknown as PickerWindow).showSaveFilePicker!({
      suggestedName: name,
      types: ext ? [{ description: ext.slice(1).toUpperCase() + ' file', accept: { [blob.type || 'application/octet-stream']: [ext] } }] : undefined,
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
  let path = '';
  try {
    path = await blobToDisk(blob, name);
    if (!(await saveFromDisk(path, name))) removeEngineFile(path); // cancelled
  } catch (e) {
    if (path) removeEngineFile(path);
    tell('Could not save ' + name + ': ' + ((e as Error)?.message ?? e));
  }
}

/** Android app: the webview can't download, so the file goes to Downloads through the app. */
async function saveAndroid(blob: Blob, name: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('save_download', new Uint8Array(await blob.arrayBuffer()), { headers: { name: encodeURIComponent(name) } });
    const { store } = await import('./store.svelte');
    store.toast(`Saved to ${path.split('/').slice(-2).join('/')}.`, 'ok', 6000);
  } catch (e) {
    tell('Could not save ' + name + ': ' + ((e as Error)?.message ?? e));
  }
}
