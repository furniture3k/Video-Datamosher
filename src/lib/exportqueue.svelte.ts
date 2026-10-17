// Exports that run in the background while you carry on editing. They use the second video engine
// (ffmpegBg), so the preview keeps rendering on the first, and run one after another. Each keeps a
// copy of the project as it was when it was added. Nothing here survives a reload.
import { exportVideo, Cancelled, type Exported, type Signal } from './renderer';
import { ffmpegBg } from './ffmpeg';
import { busy } from './recovery';
import { store } from './store.svelte';
import { saveAs, download } from './storage';
import { isDesktop } from './platform';
import { saveFromDisk, revealFile, removeEngineFile } from './ffmpeg-native';
import { Eta, formatSeconds } from '../engine/eta';
import type { ExportOptions } from '../engine/args';
import type { Project } from '../engine/types';

export interface QueueJob {
  id: number;
  name: string;
  format: string;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  eta: string;
  error?: string;
  result?: Exported;
  /** browser: the finished file, to download or play */
  url?: string;
  /** desktop: where it was saved */
  savedTo?: string;
}

export const exportQueue = $state<{ jobs: QueueJob[]; open: boolean }>({ jobs: [], open: true });

const work = new Map<number, { project: Project; o: ExportOptions; signal: Signal }>();
let nextId = 1;
let running = false;

const job = (id: number) => exportQueue.jobs.find((j) => j.id === id);

/** Add an export to the queue (it starts when the ones before it are done). */
export function enqueue(project: Project, o: ExportOptions) {
  const id = nextId++;
  const name = `${project.name || 'Untitled'} · ${o.format.toUpperCase()}`;
  work.set(id, { project, o, signal: { cancelled: false } });
  exportQueue.jobs.push({ id, name, format: o.format, status: 'waiting', stage: 'Waiting', progress: 0, eta: '' });
  exportQueue.open = true;
  askToNotify();
  void pump();
}

async function pump() {
  if (running) return;
  const next = exportQueue.jobs.find((j) => j.status === 'waiting');
  if (!next) return;
  running = true;
  const w = work.get(next.id)!;
  const done = busy('export');
  const eta = new Eta();
  const j = job(next.id)!;
  j.status = 'running';
  try {
    const r = await exportVideo(
      w.project,
      w.o,
      (s, p) => {
        j.stage = s;
        j.progress = p;
        const left = eta.update(s.replace(/ \d.*$/, ''), p);
        j.eta = left === null ? '' : formatSeconds(left);
      },
      w.signal,
      ffmpegBg,
    );
    j.result = r;
    j.status = 'done';
    j.stage = 'Done';
    j.progress = 1;
    if (r.blob) j.url = URL.createObjectURL(r.blob);
    notifyDone(j);
  } catch (e) {
    if (e instanceof Cancelled || w.signal.cancelled) j.status = 'cancelled';
    else {
      j.status = 'failed';
      j.error = (e as Error)?.message ?? String(e);
      store.toast(`Export of ${j.name} failed: ${j.error.split('\n')[0]}`, 'error', 8000);
    }
  } finally {
    done();
    work.delete(next.id);
    j.eta = '';
    running = false;
    void pump();
  }
}

/** Stop a running export, or take a waiting one off the queue. */
export function cancelJob(id: number) {
  const j = job(id);
  const w = work.get(id);
  if (!j || !w) return;
  w.signal.cancelled = true;
  if (j.status === 'running') ffmpegBg.cancel();
  else {
    j.status = 'cancelled';
    work.delete(id);
  }
}

/** Take a finished (or failed) export off the list. */
export function removeJob(id: number) {
  const j = job(id);
  if (!j || j.status === 'running' || j.status === 'waiting') return;
  if (j.url) URL.revokeObjectURL(j.url);
  // desktop: an export never saved is still in the engine's folder (saving moves it out)
  if (j.result?.file && !j.savedTo) removeEngineFile(j.result.file);
  exportQueue.jobs = exportQueue.jobs.filter((x) => x.id !== id);
}

/** Save a finished export: the Save dialog (desktop, Chromium) or a download. */
export async function saveJob(id: number) {
  const j = job(id);
  const r = j?.result;
  if (!j || !r) return;
  if (isDesktop) {
    if (j.savedTo) return void revealFile(j.savedTo);
    const file = r.file;
    if (!file) return void (r.blob && download(r.blob, r.name));
    const to = await saveFromDisk(file, r.name).catch((e) => void store.toast('Could not save: ' + ((e as Error)?.message ?? e), 'error'));
    if (to) j.savedTo = to;
    return;
  }
  if (r.blob) await saveAs(r.blob, r.name);
}

// ---------- telling you when it's done

function askToNotify() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  // asked from the click that queued the export
  // (older Safari answers through a callback and returns nothing)
  try {
    Promise.resolve(Notification.requestPermission()).catch(() => {});
  } catch {
    /* not allowed here */
  }
}

function notifyDone(j: QueueJob) {
  store.toast(`${j.name} is ready.`, 'ok', 6000, { label: isDesktop ? 'Save…' : 'Save', run: () => void saveJob(j.id) });
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification('Export finished', { body: `${j.name} is ready to save.`, icon: 'icon-192.png', tag: 'moshpit-export-' + j.id });
    n.onclick = () => {
      window.focus();
      exportQueue.open = true;
      n.close();
    };
  } catch {
    /* some browsers only notify from a service worker */
  }
}
