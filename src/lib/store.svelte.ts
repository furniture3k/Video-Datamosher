// Global app state (Svelte 5 runes), undo/redo, autosave and auto-render.
import { newProject, type Project, type EffectInstance, type Clip } from '../engine/types';
import { limits } from '../engine/mosh';
import { timelineFrames, timelineDuration, cutFrames, remapToFootage, layoutVideo, clipLen as timelineClipLen } from '../engine/timeline';
import { migrate } from '../engine/migrate';
import { renderPreview, renderKey, proxyKey, Cancelled, type RenderResult } from './renderer';
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
    /** show the description under every setting */
    tips: localGet('tips', true),
    selectedEffect: null as string | null,
    /** selected timeline clips */
    selectedClips: [] as string[],
    /** selected transition (id of the clip it leads into) */
    selectedTransition: null as string | null,
    tab: 'effects' as 'effects' | 'clip' | 'encoder' | 'audio',
    /** output frame shown by the mosh preview */
    playhead: 0,
    /** timeline position (s) shown by the edit preview */
    time: 0,
    /** what the player shows: live edit, rendered mosh, or whichever is up to date */
    view: localGet<'auto' | 'edit' | 'mosh'>('view', 'auto'),
    /** timeline zoom in pixels per second (0 = fit) */
    pxPerSec: 0,
    snap: true,
    /** phones show one panel at a time under the player */
    mobilePanel: 'timeline' as 'timeline' | 'media' | 'inspector',
    timelineViewW: 800,
    timelineHeight: localGet('timelineHeight', 300),
    playing: false,
    /** shuttle rate (J / K / L): negative plays backwards */
    shuttle: 1,
    /** In / Out marks on the timeline (seconds): the loop range and the export range */
    inPoint: null as number | null,
    outPoint: null as number | null,
    loopOn: true,
    /** timeline tool: select (A), trim (T: roll edges, slip clips) or blade (B) */
    tool: 'select' as 'select' | 'trim' | 'blade',
    /** media item picked in the media panel (source for insert / overwrite edits) */
    selectedMedia: null as string | null,
    speed: 1,
    compare: 'off' as CompareMode,
    /** A/B against this snapshot instead of the clean source */
    compareSnap: null as string | null,
    /** safe-zone guides drawn over the player (social export presets) */
    guides: null as null | 'vertical' | 'feed',
    split: 0.5,
    zoom: 1,
    autoRender: localGet('autoRender', true),
    dialog: null as null | 'snapshots' | 'beatEdit' | 'presets' | 'export' | 'variations' | 'help' | 'share' | 'live' | 'addEffect' | 'generate' | 'record',
    theme: localGet<'dark' | 'light'>('theme', 'dark'),
    chaosIntensity: 0.5,
    welcome: false,
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
    return this.render && this.renderFresh ? this.render.prep.frames.length : timelineFrames(this.project, this.project.encoder.fps);
  }
  /** timeline frame under the playhead (works in both the edit and mosh views) */
  get playFrame() {
    return Math.round(this.ui.time * this.project.encoder.fps);
  }
  get duration() {
    return timelineDuration(this.project);
  }
  get cuts() {
    return cutFrames(this.project, this.project.encoder.fps);
  }
  /** the rendered mosh matches the current project */
  get renderFresh() {
    return !!this.render && this.render.key === renderKey(this.project);
  }
  /** the player is showing the rendered mosh (otherwise the live edit preview) */
  get showingMosh() {
    const v = this.ui.view;
    return !!this.render && (v === 'mosh' || (v === 'auto' && this.renderFresh && !this.status.busy && !this.status.pending));
  }
  get selectedClipId(): string | null {
    return this.ui.selectedClips[0] ?? null;
  }
  get selected(): EffectInstance | undefined {
    return this.project.effects.find((e) => e.id === this.ui.selectedEffect);
  }
  get selectedClip(): Clip | undefined {
    const id = this.ui.selectedClips[0];
    return id ? this.project.clips.find((c) => c.id === id) : undefined;
  }

  /** Output frame showing timeline time t (the first one at or after it). */
  frameAtTime(t: number): number {
    const fr = this.render?.frames;
    if (!fr?.length) return 0;
    const s = t * this.render!.fps;
    const pos = (i: number) => fr[i].at ?? fr[i].src;
    // usually output frame N is timeline frame N (effects keep their length)
    const g = Math.max(0, Math.min(fr.length - 1, Math.round(s)));
    if (Math.abs(pos(g) - s) <= 0.5 && (g === 0 || pos(g - 1) < s - 0.5)) return g;
    // frames are mostly in timeline order; a linear scan handles inserted and reordered ones
    for (let i = 0; i < fr.length; i++) if (pos(i) >= s - 0.5) return i;
    return fr.length - 1;
  }

  /** Move the playhead to timeline time t (both previews follow). */
  seek(t: number) {
    const d = this.duration;
    this.ui.time = Math.max(0, Math.min(d, t));
    // also when the render is out of date (the Mosh view still shows it, near enough)
    if (this.render) this.ui.playhead = Math.min(this.render.frames.length - 1, this.frameAtTime(this.ui.time));
  }

  /** Move the mosh preview to output frame i (the timeline playhead follows). */
  seekFrame(i: number) {
    const r = this.render;
    if (!r) return;
    this.ui.playhead = Math.max(0, Math.min(r.frames.length - 1, i));
    const f = r.frames[this.ui.playhead];
    this.ui.time = Math.min(this.duration, (f ? (f.at ?? f.src) : 0) / r.fps);
  }

  /** Select an effect (clip selection is cleared so Delete/Duplicate act on the effect). */
  selectEffect(id: string | null) {
    this.ui.selectedEffect = id;
    if (id) {
      this.ui.selectedClips = [];
      this.ui.selectedTransition = null;
      this.ui.tab = 'effects';
    }
  }

  selectClip(id: string | null, add = false) {
    if (!id) this.ui.selectedClips = [];
    else if (add) this.ui.selectedClips = this.ui.selectedClips.includes(id) ? this.ui.selectedClips.filter((x) => x !== id) : [...this.ui.selectedClips, id];
    else this.ui.selectedClips = [id];
    this.ui.selectedTransition = null;
    if (id) {
      this.ui.selectedEffect = null;
      this.ui.tab = 'clip';
    }
  }

  selectTransition(clipId: string) {
    this.ui.selectedTransition = clipId;
    this.ui.selectedClips = [];
    this.ui.selectedEffect = null;
    this.ui.tab = 'clip';
  }

  /** Edit the timeline; effects, markers and Motion Transfer sources stay on their footage. */
  editTimeline(fn: (p: Project) => void, key: string | null = null) {
    const before = clone($state.snapshot(this.project)) as Project;
    fn(this.project);
    remapToFootage(before, this.project);
    this.commit(key);
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

  /** Drop selections that point at things that no longer exist (after undo, redo, loading). */
  private pruneSelection() {
    const p = this.project;
    const ok = (id: string) => p.clips.some((c) => c.id === id) || p.texts.some((t) => t.id === id);
    if (this.ui.selectedClips.some((id) => !ok(id))) this.ui.selectedClips = this.ui.selectedClips.filter(ok);
    const tr = this.ui.selectedTransition;
    if (tr) {
      const vids = p.clips.filter((c) => c.track === 'v1');
      const c = vids.find((x) => x.id === tr);
      if (!c || vids[0] === c) this.ui.selectedTransition = null;
    }
    if (this.ui.selectedEffect && !p.effects.some((e) => e.id === this.ui.selectedEffect)) this.ui.selectedEffect = null;
    if (this.ui.time > this.duration) this.ui.time = this.duration;
    if (this.ui.selectedMedia && !p.media.some((m) => m.id === this.ui.selectedMedia)) this.ui.selectedMedia = null;
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
  /**
   * Where a new effect goes: over the marked In–Out range, else over the selected clip, else (for
   * local effects like Bloom) a short stretch from the playhead, else the whole timeline.
   */
  defaultRange(type: string): [number, number] {
    const total = this.totalFrames;
    const fps = this.fps;
    const a = this.ui.inPoint;
    const b = this.ui.outPoint;
    if (a !== null || b !== null) return [Math.round((a ?? 0) * fps), Math.max(Math.round((a ?? 0) * fps) + 1, Math.round((b ?? this.duration) * fps))];
    const c = this.selectedClip;
    if (c && c.track !== 'v1' && 'mediaId' in c) return [Math.round(c.start * fps), Math.round((c.start + timelineClipLen(c)) * fps)];
    if (c) {
      const pl = layoutVideo(this.project).find((x) => x.clip.id === c.id);
      if (pl) return [Math.round(pl.start * fps), Math.round(pl.end * fps)];
    }
    const span = EFFECTS[type]?.span;
    if (!span) return [0, total];
    const len = Math.min(total, Math.round(span * fps));
    const s = Math.max(0, Math.min(total - len, this.playFrame));
    return [s, s + len];
  }

  addEffect(type: string, range?: [number, number]) {
    const total = this.totalFrames;
    const [s, e] = range ?? this.defaultRange(type);
    const fx = makeEffect(type, s, Math.max(s + 1, e));
    // borrow motion from somewhere else: the other half of the timeline
    if (type === 'splice') fx.params.from = Math.max(0, Math.min(total - 1, s < total / 2 ? Math.round(total / 2) : 0));
    this.edit((p) => p.effects.push(fx));
    this.selectEffect(fx.id);
    return fx;
  }

  duplicateEffect(id: string) {
    const i = this.project.effects.findIndex((e) => e.id === id);
    if (i < 0) return;
    const copy = { ...(clone($state.snapshot(this.project.effects[i])) as EffectInstance), id: uid() };
    this.edit((p) => p.effects.splice(i + 1, 0, copy));
    this.selectEffect(copy.id);
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
    this.pruneSelection();
    this.autosave();
    if (this.ui.autoRender) this.scheduleRender();
  }

  scheduleRender(delay = 350) {
    clearTimeout(this.renderTimer);
    this.status.pending = true;
    this.renderTimer = window.setTimeout(() => this.doRender(), delay);
  }

  async doRender(force = false) {
    this.status.pending = false;
    if (!this.project.clips.length && !this.project.texts.length) {
      this.render = null;
      return;
    }
    const key = renderKey(this.project);
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
      if (r.frames.length >= limits.maxOutputFrames)
        this.toast(`Output capped at ${limits.maxOutputFrames} frames. Lower the Bloom or Stutter repeats.`, 'error', 6000);
      if (this.renderFresh) this.ui.playhead = Math.min(r.frames.length - 1, this.frameAtTime(this.ui.time));
      if (this.ui.playhead >= r.frames.length) this.ui.playhead = Math.max(0, r.frames.length - 1);
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
    let ok = false;
    if (p)
      try {
        this.project = migrate(p);
        ok = true;
      } catch (e) {
        console.warn('autosave not restored', e);
      }
    this.last = this.snapshot();
    if (ok && (this.project.clips.length || this.project.texts.length)) this.scheduleRender(100);
    // Media no longer in the saved project is removed on startup only, so undo
    // within a session can always bring a deleted clip back.
    // (media used by snapshots is kept so they can still be restored)
    const { snapshotFileIds } = await import('./snapshots.svelte');
    const snapFiles = await snapshotFileIds().catch(() => [] as string[]);
    pruneFiles([...this.project.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.fileId, proxyKey(m.id)] : [])), ...snapFiles, ...snapFiles.map(proxyKey)]);
    const { prepareAll } = await import('./media');
    prepareAll(this.project.media);
  }

  setPref<K extends 'advanced' | 'autoRender' | 'theme' | 'view' | 'timelineHeight' | 'tips'>(k: K, v: (typeof this.ui)[K]) {
    this.ui[k] = v;
    localSet(k, v);
    if (k === 'autoRender' && v) this.scheduleRender(50);
  }
}

export const store = new Store();
