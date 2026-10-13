// Global app state (Svelte 5 runes), undo/redo, autosave and auto-render.
import { newProject, type Project, type EffectInstance, type Clip } from '../engine/types';
import { timelineFrames, clipStarts, MAX_OUTPUT_FRAMES } from '../engine/mosh';
import { renderPreview, Cancelled, type RenderResult } from './renderer';
import { kvGet, kvSet, localGet, localSet, pruneFiles } from './storage';
import { makeEffect, uid } from '../engine/presets';
import { EFFECTS } from '../engine/effects';

/** deep copy of plain JSON data (structuredClone needs iOS 15.4+) */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export type CompareMode = 'off' | 'split' | 'side' | 'hold';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

class Store {
  project = $state<Project>(newProject());
  render = $state.raw<RenderResult | null>(null);
  ui = $state({
    advanced: localGet('advanced', false),
    selectedEffect: null as string | null,
    selectedClip: null as string | null,
    tab: 'effects' as 'effects' | 'clip' | 'encoder' | 'audio',
    playhead: 0,
    playing: false,
    loop: null as [number, number] | null,
    loopOn: true,
    speed: 1,
    compare: 'off' as CompareMode,
    split: 0.5,
    zoom: 1,
    autoRender: localGet('autoRender', true),
    dialog: null as null | 'presets' | 'export' | 'variations' | 'help' | 'share' | 'live' | 'addEffect' | 'generate' | 'record',
    theme: localGet<'dark' | 'light'>('theme', 'dark'),
    chaosIntensity: 0.5,
    welcome: !localGet('seenWelcome', false),
  });
  status = $state({ busy: false, pending: false, stage: '', progress: 0, error: '', engine: '' });
  toasts = $state<Toast[]>([]);
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private last = JSON.stringify(newProject());
  private coalesceKey: string | null = null;
  private coalesceTimer = 0;
  historySize = $state({ undo: 0, redo: 0 });
  private renderTimer = 0;
  private renderSignal: { cancelled: boolean } | null = null;
  private renderQueued = false;
  private renderKey = '';

  get fps() {
    return this.project.encoder.fps;
  }
  get totalFrames() {
    return this.render?.prep.frames.length ?? timelineFrames(this.project.clips, this.project.encoder.fps);
  }
  get cuts() {
    return clipStarts(this.project.clips, this.project.encoder.fps).slice(1);
  }
  get selected(): EffectInstance | undefined {
    return this.project.effects.find((e) => e.id === this.ui.selectedEffect);
  }
  get selectedClip(): Clip | undefined {
    return this.project.clips.find((c) => c.id === this.ui.selectedClip);
  }

  toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
    const id = Math.random();
    this.toasts.push({ id, text, kind });
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), ms);
  }

  // ---------- history ----------
  snapshot() {
    return JSON.stringify(this.project);
  }

  /** Record the current state as an undo point. Coalesce rapid edits sharing a key (e.g. slider drags). */
  commit(key: string | null = null) {
    const now = this.snapshot();
    if (now === this.last) return;
    if (!(key && key === this.coalesceKey)) {
      this.undoStack.push(this.last);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.coalesceKey = key;
    clearTimeout(this.coalesceTimer);
    this.coalesceTimer = window.setTimeout(() => (this.coalesceKey = null), 600);
    this.last = now;
    this.historySize = { undo: this.undoStack.length, redo: 0 };
    this.changed();
  }

  /** Apply a mutation then commit. */
  edit(fn: (p: Project) => void, key: string | null = null) {
    fn(this.project);
    this.commit(key);
  }

  set(p: Project, record = true) {
    this.project = p;
    if (record) this.commit();
    else {
      this.last = this.snapshot();
      this.changed();
    }
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.last);
    this.project = JSON.parse(prev);
    this.last = prev;
    this.coalesceKey = null;
    this.historySize = { undo: this.undoStack.length, redo: this.redoStack.length };
    this.changed();
  }

  redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.last);
    this.project = JSON.parse(next);
    this.last = next;
    this.historySize = { undo: this.undoStack.length, redo: this.redoStack.length };
    this.changed();
  }

  // ---------- effects ----------
  addEffect(type: string, range?: [number, number]) {
    const total = this.totalFrames;
    const [s, e] = range ?? [0, total];
    const fx = makeEffect(type, s, Math.max(s + 1, e));
    if (EFFECTS[type].kind === 'bitstream' && type === 'splice') fx.params.from = Math.min(total - 1, Math.round(total / 2));
    this.edit((p) => p.effects.push(fx));
    this.ui.selectedEffect = fx.id;
    this.ui.tab = 'effects';
    return fx;
  }

  duplicateEffect(id: string) {
    const i = this.project.effects.findIndex((e) => e.id === id);
    if (i < 0) return;
    const copy = { ...(clone($state.snapshot(this.project.effects[i])) as EffectInstance), id: uid() };
    this.edit((p) => p.effects.splice(i + 1, 0, copy));
    this.ui.selectedEffect = copy.id;
  }

  removeEffect(id: string) {
    this.edit((p) => (p.effects = p.effects.filter((e) => e.id !== id)));
    if (this.ui.selectedEffect === id) this.ui.selectedEffect = null;
  }

  moveEffect(id: string, dir: number) {
    const i = this.project.effects.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.project.effects.length) return;
    this.edit((p) => {
      const [x] = p.effects.splice(i, 1);
      p.effects.splice(j, 0, x);
    });
  }

  // ---------- rendering ----------
  private changed() {
    this.autosave();
    if (this.ui.autoRender) this.scheduleRender();
  }

  scheduleRender(delay = 350) {
    clearTimeout(this.renderTimer);
    this.status.pending = true;
    this.renderTimer = window.setTimeout(() => this.doRender(), delay);
  }

  private keyOf() {
    return JSON.stringify({ c: this.project.clips, e: this.project.effects, enc: this.project.encoder, d: this.project.decoder, s: this.project.globalSeed });
  }

  async doRender(force = false) {
    this.status.pending = false;
    if (!this.project.clips.length) {
      this.render = null;
      return;
    }
    const key = this.keyOf();
    if (!force && key === this.renderKey && this.render) return;
    if (this.status.busy) {
      // let the running render notice it is stale, then re-run
      if (this.renderSignal) this.renderSignal.cancelled = true;
      this.renderQueued = true;
      return;
    }
    this.status.busy = true;
    this.status.error = '';
    const signal = (this.renderSignal = { cancelled: false });
    const snapshot = $state.snapshot(this.project) as Project;
    try {
      const r = await renderPreview(snapshot, this.project.encoder.previewWidth, (stage, p) => {
        this.status.stage = stage;
        this.status.progress = p;
      }, signal);
      this.render = r;
      this.renderKey = key;
      if (r.frames.length >= MAX_OUTPUT_FRAMES)
        this.toast(`The mosh got very long, so it was cut at ${MAX_OUTPUT_FRAMES} frames. Lower Bloom/Stutter repeats to stay under it.`, 'error', 6000);
      if (this.ui.playhead >= r.frames.length) this.ui.playhead = Math.max(0, r.frames.length - 1);
      if (this.ui.loop && this.ui.loop[1] > r.frames.length) this.ui.loop = null;
    } catch (e) {
      if (!(e instanceof Cancelled)) {
        console.error(e);
        this.status.error = (e as Error).message ?? String(e);
      }
    } finally {
      this.status.busy = false;
      this.status.stage = '';
      this.renderSignal = null;
      if (this.renderQueued) {
        this.renderQueued = false;
        this.scheduleRender(50);
      }
    }
  }

  // ---------- persistence ----------
  private saveTimer = 0;
  autosave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      kvSet('autosave', $state.snapshot(this.project));
    }, 1000);
  }

  async restore() {
    const p = await kvGet<Project>('autosave');
    if (p && p.version === 1) {
      this.project = { ...newProject(), ...p, encoder: { ...newProject().encoder, ...p.encoder }, audio: { ...newProject().audio, ...p.audio }, decoder: { ...newProject().decoder, ...p.decoder } };
      this.last = this.snapshot();
      if (this.project.clips.length) this.scheduleRender(100);
    } else this.last = this.snapshot();
    // Media no longer used by the saved project is removed on startup only, so undo
    // within a session can always bring a deleted clip back.
    pruneFiles(this.project.clips.flatMap((c) => (c.source.kind === 'file' ? [c.source.fileId] : [])));
  }

  setPref<K extends 'advanced' | 'autoRender' | 'theme'>(k: K, v: (typeof this.ui)[K]) {
    this.ui[k] = v;
    localSet(k, v);
    if (k === 'autoRender' && v) this.scheduleRender(50);
  }
}

export const store = new Store();
