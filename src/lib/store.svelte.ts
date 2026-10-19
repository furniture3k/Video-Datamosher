// Global app state (Svelte 5 runes), undo/redo, autosave and auto-render.
import { newProject, type Project, type EffectInstance, type Clip } from '../engine/types';
import { limits } from '../engine/mosh';
import { timelineFrames, timelineDuration, cutFrames, remapToFootage, layoutVideo, clipLen as timelineClipLen } from '../engine/timeline';
import { migrate } from '../engine/migrate';
import { rootWithInner } from '../engine/compound';
import { renderPreview, renderKey, proxyKey, Cancelled, type RenderResult } from './renderer';
import { outputSize } from '../engine/args';
import { isDesktop } from './platform';
import { kvGet, kvSet, localGet, localSet, pruneFiles } from './storage';
import { makeEffect, uid } from '../engine/presets';
import { EFFECTS } from '../engine/effects';
import { busy } from './recovery';
import { Eta, overallProgress } from '../engine/eta';
import { saveProject, loadProject, migrateAutosave, currentProjectId, setCurrentProjectId, newProjectId, hasContent, loadIndex } from './projectindex';

/** deep copy of plain JSON data (structuredClone needs iOS 15.4+) */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export type CompareMode = 'off' | 'split' | 'side' | 'hold';
export type PreviewRes = 'full' | 'half' | 'quarter';
export const PREVIEW_RES: Record<PreviewRes, number> = { full: 1, half: 0.5, quarter: 0.25 };
/** decoded preview frames are kept in memory as JPEGs: stay around this many bytes */
const PREVIEW_BUDGET = 450e6;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
  /** a button on the toast (Undo, Report…) */
  action?: { label: string; run: () => void };
}

class Store {
  project = $state<Project>(newProject());
  /** which saved project is open (null: a new one, saved once there's something in it) */
  projectId = $state<string | null>(null);
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
    /** clicking the player picks a chroma-key colour for the selected clip */
    eyedropper: false,
    /** Flow Paint effect being painted on the player, and the brush */
    paintEffect: null as string | null,
    brush: { tool: 'push' as import('../engine/flowfield').FlowTool, radius: 0.12, strength: 0.012 },
    /** painting a Mosh Map: erase (moshes again) instead of paint (stays clean) */
    maskErase: false,
    /** id of the clip to track: the next box drawn on the player is followed through it */
    trackPick: null as string | null,
    /** scopes panel under the player */
    scopes: false,
    /** safe-zone guides drawn over the player (social export presets) */
    guides: null as null | 'vertical' | 'feed',
    split: 0.5,
    zoom: 1,
    autoRender: localGet('autoRender', true),
    /** playback resolution of the mosh preview, as a share of the mosh resolution (like an NLE's Full / ½ / ¼) */
    // full in the desktop app (native FFmpeg is fast); half in the browser, where the engine is wasm
    previewRes: localGet<PreviewRes>('previewRes', isDesktop ? 'full' : 'half'),
    dialog: null as null | 'snapshots' | 'beatEdit' | 'bake' | 'compound' | 'captions' | 'wordBeats' | 'fonts' | 'presets' | 'export' | 'variations' | 'help' | 'share' | 'live' | 'addEffect' | 'generate' | 'record' | 'whatsnew' | 'storage' | 'palette' | 'history' | 'batch',
    theme: localGet<'dark' | 'light'>('theme', 'dark'),
    chaosIntensity: 0.5,
    welcome: false,
    /** the home screen (projects, templates, examples) instead of the editor */
    home: false,
    /** imported clips on an empty timeline get a melt (or a bloom) straight away */
    autoMosh: localGet('autoMosh', true),
    /** start on the home screen (else straight into the last project) */
    startHome: localGet('startHome', true),
    /** vibrate on phones when clips are picked up, trimmed and cut */
    haptics: localGet('haptics', true),
  });
  /** `overall`: how far through the whole render (stages combined); `eta`: seconds it still needs (null when unknown) */
  status = $state({ busy: false, pending: false, stage: '', progress: 0, error: '', engine: '', overall: 0, eta: null as number | null });
  private eta = new Eta();
  toasts = $state<Toast[]>([]);
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private last = JSON.stringify(newProject());
  private coalesceKey: string | null = null;
  private coalesceTimer = 0;
  historySize = $state({ undo: 0, redo: 0 });
  /** compound clips opened for editing, outermost first (the parent timelines wait here) */
  seqStack = $state.raw<{ parent: Project; mediaId: string; name: string }[]>([]);
  private renderTimer = 0;
  private renderSignal: { cancelled: boolean } | null = null;
  private renderQueued = false;
  private renderKey = '';
  // worked out once per change of the project (not on every read: some are read every frame)
  private keyNow = $derived(renderKey(this.project));
  private durationNow = $derived(timelineDuration(this.project));
  private framesNow = $derived(timelineFrames(this.project, this.project.encoder.fps));
  private cutsNow = $derived(cutFrames(this.project, this.project.encoder.fps));

  get fps() {
    return this.project.encoder.fps;
  }
  /**
   * Width the mosh preview is rendered at: the mosh resolution itself (so the preview looks exactly
   * like the export, block size and all) or a half / quarter of it, stepped down on very long
   * timelines so the decoded frames fit in memory.
   */
  get previewWidth() {
    const enc = this.project.encoder;
    let w = enc.width * PREVIEW_RES[this.ui.previewRes];
    const frames = this.framesNow;
    const { w: ow, h: oh } = outputSize(this.project, enc.width);
    // a JPEG at the preview's quality is roughly 0.15 bytes a pixel
    const fit = Math.sqrt(PREVIEW_BUDGET / Math.max(1, frames * 0.15 * (oh / ow)));
    w = Math.min(w, fit);
    return Math.max(240, Math.round(w / 16) * 16);
  }
  get totalFrames() {
    return this.render && this.renderFresh ? this.render.prep.frames.length : this.framesNow;
  }
  /** timeline frame under the playhead (works in both the edit and mosh views) */
  get playFrame() {
    return Math.round(this.ui.time * this.project.encoder.fps);
  }
  get duration() {
    return this.durationNow;
  }
  get cuts() {
    return this.cutsNow;
  }
  /** the rendered mosh matches the current project */
  get renderFresh() {
    return !!this.render && this.render.key === this.keyNow;
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

  toast(text: string, kind: Toast['kind'] = 'info', ms = 3500, action?: Toast['action']) {
    const id = Math.random();
    this.toasts.push({ id, text, kind, action });
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

  /** Forget undo / redo (entering or leaving a compound: its history doesn't mix with the parent's). */
  resetHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.last = this.snapshot();
    this.historySize = { undo: 0, redo: 0 };
  }

  /** Edit inside a compound: the current timeline waits on the stack while `inner` is shown. */
  enterSequence(mediaId: string, name: string, inner: Project) {
    this.seqStack = [...this.seqStack, { parent: JSON.parse(this.snapshot()), mediaId, name }];
    this.project = inner;
    this.ui.selectedClips = [];
    this.ui.selectedEffect = null;
    this.render = null;
    this.resetHistory();
    this.changed();
  }

  /** Back out of the innermost compound to its (updated) parent. */
  leaveSequence(parent: Project) {
    this.seqStack = this.seqStack.slice(0, -1);
    this.project = parent;
    this.ui.selectedClips = [];
    this.render = null;
    this.resetHistory();
    this.changed();
  }

  /** Drop selections that point at things that no longer exist (after undo, redo, loading). */
  private pruneSelection() {
    const p = this.project;
    const ok = (id: string) => p.clips.some((c) => c.id === id) || p.layers.some((t) => t.id === id);
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

  /** The versions undo and redo go through (as saved JSON), oldest first; for the History panel. */
  historyStates(): { past: string[]; current: string; future: string[] } {
    return { past: [...this.undoStack], current: this.last, future: [...this.redoStack].reverse() };
  }

  /** Undo (negative) or redo (positive) several steps at once. */
  jumpHistory(steps: number) {
    for (let i = 0; i < -steps; i++) this.undo();
    for (let i = 0; i < steps; i++) this.redo();
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
    if (!this.project.clips.length && !this.project.layers.length) {
      this.render = null;
      return;
    }
    // a different preview resolution renders again, though the result counts as the same mosh
    const key = renderKey(this.project) + '@' + this.previewWidth;
    if (!force && key === this.renderKey && this.render) return;
    if (this.status.busy) {
      // let the running render notice it is stale, then re-run
      if (this.renderSignal) this.renderSignal.cancelled = true;
      this.renderQueued = true;
      return;
    }
    this.status.busy = true;
    this.status.error = '';
    const done = busy('render');
    const signal = (this.renderSignal = { cancelled: false });
    const snapshot = $state.snapshot(this.project) as Project;
    try {
      this.eta.reset();
      Object.assign(this.status, { stage: '', progress: 0, overall: 0, eta: null });
      const r = await renderPreview(snapshot, this.previewWidth, (stage, p) => {
        this.status.stage = stage;
        this.status.progress = p;
        // only forwards (a stage can report again after a later one)
        this.status.overall = Math.max(this.status.overall, overallProgress(stage, p));
        this.status.eta = this.eta.update('render', this.status.overall);
      }, signal);
      // a newer project was opened (or the render went stale) while it finished: don't show it
      if (signal.cancelled) return;
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
      done();
      this.status.busy = false;
      this.status.stage = '';
      this.status.eta = null;
      this.renderSignal = null;
      if (this.renderQueued) {
        this.renderQueued = false;
        this.scheduleRender(50);
      }
    }
  }

  // ---------- persistence ----------
  private saveTimer = 0;
  /** saving failed (storage full): said once, until a save works again */
  private saveFailed = false;
  autosave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 1000);
  }

  /** The whole project as saved: inside a compound, with the open edits folded back in. */
  rootProject(): Project {
    const p = $state.snapshot(this.project) as Project;
    return this.seqStack.length ? rootWithInner(this.seqStack, p) : p;
  }

  /** Save the open project now (before switching to another one or going home). */
  async flush() {
    clearTimeout(this.saveTimer);
    const p = this.rootProject();
    if (!this.projectId) {
      // a new project joins the list once there's something in it
      if (!hasContent(p)) return;
      this.projectId = newProjectId();
      setCurrentProjectId(this.projectId);
    }
    const ok = await saveProject(this.projectId, p);
    if (!ok && !this.saveFailed) this.toast("Could not save the project: the browser's storage is full or unavailable. Free some space in Storage, or save a project file.", 'error', 10000, { label: 'Storage', run: () => (this.ui.dialog = 'storage') });
    this.saveFailed = !ok;
  }

  /** Show another project in the editor (null id: a new one). The open one is saved first. */
  async openProject(id: string | null, p: Project) {
    await this.flush();
    clearTimeout(this.renderTimer);
    if (this.renderSignal) this.renderSignal.cancelled = true;
    this.renderQueued = false;
    this.seqStack = [];
    this.project = migrate(p);
    this.projectId = id;
    setCurrentProjectId(id);
    this.render = null;
    this.renderKey = '';
    this.status.error = '';
    Object.assign(this.ui, { selectedClips: [], selectedEffect: null, selectedTransition: null, selectedMedia: null, inPoint: null, outPoint: null, playhead: 0, time: 0, playing: false, compareSnap: null, compare: 'off' });
    this.resetHistory();
    if (this.ui.autoRender && (this.project.clips.length || this.project.layers.length)) this.scheduleRender(100);
    const { prepareAll } = await import('./media');
    prepareAll(this.project.media);
  }

  /** Load the autosaved project; `render` false skips the start-up render (after a crash). */
  async restore(render = true) {
    // the project open last time (the single autosave of older versions becomes the first one)
    const id = (await migrateAutosave()) ?? currentProjectId();
    const p = id ? await loadProject(id) : undefined;
    let ok = false;
    if (p)
      try {
        this.project = migrate(p);
        this.projectId = id;
        ok = true;
      } catch (e) {
        console.warn('autosave not restored', e);
      }
    this.last = this.snapshot();
    if (render && ok && (this.project.clips.length || this.project.layers.length)) this.scheduleRender(100);
    // Media no longer in the saved project is removed on startup only, so undo
    // within a session can always bring a deleted clip back.
    // (media used by snapshots is kept so they can still be restored)
    pruneFiles(await this.keepFiles());
    const { prepareAll } = await import('./media');
    prepareAll(this.project.media);
    // compounds edited when the app last closed are rendered again
    const { ensureCompounds } = await import('./compound.svelte');
    if (render) ensureCompounds().catch((e: unknown) => console.warn('compound render failed', e));
  }

  /** Stored files still needed: this project's media, preview copies and LUTs, and what snapshots use. */
  async keepFiles(): Promise<string[]> {
    const { snapshotFileIds, snapshots } = await import('./snapshots.svelte');
    const snapFiles = await snapshotFileIds().catch(() => [] as string[]);
    // preview copies are kept under the media item's id, not its file's
    const snapProxies = snapshots.list.flatMap((s) => s.project.media.filter((m) => m.source.kind === 'file').map((m) => proxyKey(m.id)));
    const lutFiles = [...(this.project.luts ?? []).map((l) => 'lut:' + l.id), ...(this.project.fonts ?? []).map((f) => 'font:' + f.id)];
    // every saved project's media too, not just the open one's
    const others = (await loadIndex().catch(() => [])).flatMap((m) => m.files);
    return [...others, ...lutFiles, ...this.project.media.flatMap((m) => (m.source.kind === 'file' ? [m.source.fileId, proxyKey(m.id)] : [])), ...snapFiles, ...snapProxies];
  }

  setPref<K extends 'advanced' | 'autoRender' | 'theme' | 'view' | 'timelineHeight' | 'tips' | 'previewRes' | 'haptics' | 'startHome' | 'autoMosh'>(k: K, v: (typeof this.ui)[K]) {
    this.ui[k] = v;
    localSet(k, v);
    if (k === 'autoRender' && v) this.scheduleRender(50);
    if (k === 'previewRes' && this.ui.autoRender) this.scheduleRender(50);
  }
}

export const store = new Store();
