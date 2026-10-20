// What each command in commandlist.ts does, and running commands from the keyboard or the palette.
import { askText } from './ask';
import { store } from './store.svelte';
import * as edit from './edit';
import { startMark, startSurface } from './motion.svelte';
import { startCutout } from './cutout.svelte';
import { chaos, mutate } from '../engine/presets';
import { chaosGraphics } from '../engine/graphicschaos';
import { revealOnBeats, swapCellsOnBeat } from './graphicsops.svelte';
import { beatInfo } from './beatinfo.svelte';
import { randomSeed } from '../engine/rng';
import { takeSnapshot } from './snapshots.svelte';
import { enableMidi, controls } from './controls.svelte';
import { togglePanel, useLayout, saveLayout, BUILT_IN } from './layout.svelte';
import { saveProjectFile, startNewProject, saveRecipeFile, pickRecipeFile } from './projectio.svelte';
import { goHome } from './projects.svelte';
import { reportProblem } from './report';
import { COMMANDS, type CommandInfo } from './commandlist';
import { commandFor, comboOf } from './keymap';
import type { MediaItem } from '../engine/types';

const hasClips = () => store.project.clips.length > 0 || store.project.layers.length > 0;

export function runChaos() {
  if (!store.project.clips.length) return store.toast('Add a clip first.');
  if (store.project.effects.length) takeSnapshot('Before Randomize', true);
  store.set(chaos($state.snapshot(store.project) as never, store.totalFrames, randomSeed(), store.ui.chaosIntensity, store.ui.chaosGraphics ? { beats: beatInfo.beats } : undefined));
}

/** Roll just the titles, shapes and canvas, leaving the effects as they are. */
export function runChaosGraphics() {
  if (!store.project.layers.length && !store.project.canvas) return store.toast('Add a title or a shape first.');
  takeSnapshot('Before Randomize graphics', true);
  const p = $state.snapshot(store.project) as never;
  store.edit((q) => Object.assign(q, chaosGraphics(p, randomSeed(), store.ui.chaosIntensity, beatInfo.beats)));
}

export function runMutate() {
  if (!store.project.effects.length) return store.toast('Nothing to nudge yet. Add an effect first.');
  store.set(mutate($state.snapshot(store.project) as never, store.totalFrames, 0.25));
}

/** J / K / L shuttle: each press of L (or J) doubles the speed in that direction. */
function shuttle(dir: 1 | -1) {
  const s = store.ui.shuttle;
  store.ui.shuttle = store.ui.playing && Math.sign(s) === dir ? Math.max(-16, Math.min(16, s * 2)) : dir;
  store.ui.playing = true;
}

function stepBy(frames: number) {
  const fps = store.project.encoder.fps;
  store.ui.playing = false;
  store.seek(Math.round(store.ui.time * fps + frames) / fps);
}

function sourceEdit(fn: (m: MediaItem) => void) {
  const m = store.project.media.find((x) => x.id === store.ui.selectedMedia);
  if (!m) return store.toast('Pick a clip in the Media panel first (click it).');
  fn(m);
}

function chaosBy(d: number) {
  const v = Math.round(Math.min(2, Math.max(0, (store.project.chaos ?? 1) + d)) * 20) / 20;
  store.edit((p) => (v === 1 ? delete p.chaos : (p.chaos = v)), 'chaos');
  store.toast(`Chaos ${Math.round(v * 100)}%`);
}

const dialog = (d: NonNullable<typeof store.ui.dialog>) => () => (store.ui.dialog = d);

type Run = () => unknown;
interface Action {
  run: Run;
  /** only offered (and run) when this is true */
  when?: () => boolean;
  /** runs even while typing in a field or with a dialog open */
  global?: boolean;
  /** with `global`: not in a text field, which has its own (the text's undo) */
  notInText?: boolean;
}

const ACTIONS: Record<string, Action> = {
  play: { run: () => ((store.ui.shuttle = 1), (store.ui.playing = !store.ui.playing)) },
  'shuttle-back': { run: () => shuttle(-1) },
  stop: { run: () => ((store.ui.playing = false), (store.ui.shuttle = 1)) },
  'shuttle-forward': { run: () => shuttle(1) },
  'frame-next': { run: () => stepBy(1) },
  'frame-prev': { run: () => stepBy(-1) },
  'second-next': { run: () => stepBy(store.project.encoder.fps) },
  'second-prev': { run: () => stepBy(-store.project.encoder.fps) },
  'edit-next': { run: () => ((store.ui.playing = false), edit.jumpEdit(1)) },
  'edit-prev': { run: () => ((store.ui.playing = false), edit.jumpEdit(-1)) },
  'marker-next': { run: () => ((store.ui.playing = false), edit.jumpMarker(1)) },
  'marker-prev': { run: () => ((store.ui.playing = false), edit.jumpMarker(-1)) },
  'go-start': { run: () => ((store.ui.playing = false), store.seek(0)) },
  'go-end': { run: () => ((store.ui.playing = false), store.seek(store.duration)) },
  loop: { run: () => (store.ui.loopOn = !store.ui.loopOn) },
  compare: { run: () => (store.ui.compare = store.ui.compare === 'off' ? 'split' : 'off') },

  'tool-select': { run: () => (store.ui.tool = 'select') },
  'tool-trim': { run: () => (store.ui.tool = 'trim') },
  'tool-blade': { run: () => (store.ui.tool = 'blade') },
  split: { run: () => edit.splitAtPlayhead() },
  delete: { run: () => !edit.deleteSelected(false) && store.ui.selectedEffect && store.removeEffect(store.ui.selectedEffect) },
  'ripple-delete': { run: () => !edit.deleteSelected(true) && store.ui.selectedEffect && store.removeEffect(store.ui.selectedEffect) },
  'toggle-enabled': { run: () => !edit.toggleEnabled() && store.ui.selectedEffect && store.edit(() => (store.selected!.enabled = !store.selected!.enabled)) },
  duplicate: { run: () => edit.duplicateSelected() },
  copy: { run: () => edit.copySelected() },
  paste: { run: () => edit.paste() },
  cut: { run: () => edit.copySelected() && edit.deleteSelected() },
  'select-all': { run: () => (store.ui.selectedClips = [...store.project.clips.filter((c) => !edit.lockedTrack(c.track)).map((c) => c.id), ...store.project.layers.map((t) => t.id)]) },
  'nudge-left': { run: () => edit.nudgeSelected(-1) },
  'nudge-right': { run: () => edit.nudgeSelected(1) },
  'nudge-left-10': { run: () => edit.nudgeSelected(-10) },
  'nudge-right-10': { run: () => edit.nudgeSelected(10) },
  freeze: { run: () => edit.freezeAtPlayhead() },
  'melt-cut': { run: () => edit.transitionAtPlayhead('melt') },
  'dissolve-cut': { run: () => edit.transitionAtPlayhead('dissolve') },
  insert: { run: () => sourceEdit(edit.insertEdit) },
  overwrite: { run: () => sourceEdit(edit.overwriteEdit) },
  'place-on-top': { run: () => sourceEdit(edit.placeOnTop) },
  append: { run: () => sourceEdit(edit.appendEdit) },

  'mark-in': { run: () => edit.markIn() },
  'mark-out': { run: () => edit.markOut() },
  'mark-clip': { run: () => edit.markClip() },
  'clear-in': { run: () => edit.markIn(null) },
  'clear-out': { run: () => edit.markOut(null) },
  'clear-marks': { run: () => (edit.markIn(null), edit.markOut(null)) },
  marker: { run: () => edit.toggleMarker() },

  snap: { run: () => (store.ui.snap = !store.ui.snap) },
  'zoom-in': { run: () => edit.zoom(1.5) },
  'zoom-out': { run: () => edit.zoom(1 / 1.5) },
  'zoom-fit': { run: () => edit.zoomFit() },

  render: { run: () => store.doRender(true), when: hasClips },
  'add-effect': { run: dialog('addEffect') },
  presets: { run: dialog('presets') },
  randomize: { run: runChaos, when: () => store.project.clips.length > 0 },
  'randomize-graphics': { run: runChaosGraphics, when: hasClips },
  'nudge-settings': { run: runMutate, when: () => store.project.effects.length > 0 },
  variations: { run: dialog('variations'), when: () => store.project.clips.length > 0 },
  'chaos-up': { run: () => chaosBy(0.25) },
  'chaos-down': { run: () => chaosBy(-0.25) },
  sequencer: { run: () => store.addEffect('sequence'), when: () => store.project.clips.length > 0 },
  keyframe: {
    run: () => {
      const src = store.playFrame;
      store.edit((p) => {
        const m = p.encoder.keyMarkers;
        const i = m.indexOf(src);
        if (i >= 0) m.splice(i, 1);
        else m.push(src);
      });
    },
  },
  'beat-edit': { run: dialog('beatEdit'), when: () => store.project.clips.length > 0 },
  'add-box': { run: () => void edit.addShape('rect') },
  'add-circle': { run: () => void edit.addShape('circle') },
  'add-arrow': { run: () => void edit.addShape('arrow') },
  'add-callout': { run: () => void edit.addCallout() },
  'add-selection': { run: () => void edit.addSelection() },
  'add-notification': { run: () => void edit.addNotification() },
  'add-ripple': { run: () => void edit.addShape('ripple') },
  'add-polygon': { run: () => void edit.addShape('polygon') },
  'add-leader': { run: () => void edit.addShape('leader') },
  pen: { run: () => void (store.ui.pen = true), when: hasClips },
  mark: { run: () => startMark(), when: hasClips },
  surface: { run: () => startSurface(), when: hasClips },
  cutout: { run: () => startCutout(), when: hasClips },
  'split-side': { run: () => edit.arrangeGrid('side'), when: hasClips },
  'split-stack': { run: () => edit.arrangeGrid('stack'), when: hasClips },
  'split-grid': { run: () => edit.arrangeGrid('g2'), when: hasClips },
  flipbook: { run: dialog('flipbook'), when: () => store.project.media.length > 0 },
  'word-beats': { run: dialog('wordBeats'), when: hasClips },
  script: { run: dialog('script'), when: hasClips },
  steal: { run: dialog('steal') },
  'reveal-beats': { run: () => revealOnBeats(1), when: hasClips },
  'swap-cells': { run: () => swapCellsOnBeat(1), when: hasClips },
  group: { run: () => edit.groupSelected(), when: hasClips },
  ungroup: { run: () => edit.ungroupSelected(), when: hasClips },
  bake: { run: dialog('bake'), when: hasClips },
  captions: { run: dialog('captions'), when: hasClips },
  live: { run: dialog('live') },

  undo: { run: () => store.undo(), global: true, notInText: true },
  redo: { run: () => store.redo(), global: true, notInText: true },
  history: { run: dialog('history') },
  save: { run: () => saveProjectFile(), global: true },
  'save-as': { run: () => saveProjectFile(true) },
  snapshot: { run: () => takeSnapshot().then((s) => store.toast(s ? `Saved ${s.name}.` : 'Nothing to save yet.', s ? 'ok' : 'error')), global: true },
  snapshots: { run: dialog('snapshots') },
  export: { run: dialog('export'), when: hasClips },
  'new-project': { run: () => startNewProject() },
  home: { run: () => goHome() },
  'share-code': { run: dialog('share') },
  'save-recipe': { run: () => saveRecipeFile() },
  'open-recipe': { run: () => pickRecipeFile() },
  batch: { run: dialog('batch') },
  'toggle-media': { run: () => togglePanel('left'), when: () => !store.ui.home },
  'toggle-inspector': { run: () => togglePanel('right'), when: () => !store.ui.home },
  'layout-edit': { run: () => useLayout(BUILT_IN[0].layout) },
  'layout-mosh': { run: () => useLayout(BUILT_IN[1].layout) },
  'layout-player': { run: () => useLayout(BUILT_IN[2].layout) },
  'save-layout': {
    run: async () => {
      const name = await askText('Name this layout', 'My layout');
      if (name?.trim()) (saveLayout(name.trim()), store.toast(`Saved. It's in ⋯ → Layout.`, 'ok'));
    },
  },
  midi: {
    run: () =>
      enableMidi().then((ok) => store.toast(ok ? `MIDI is on${controls.inputs.length ? ': ' + controls.inputs.join(', ') : ''}. Right-click a setting, then move a knob.` : 'No MIDI here (Chrome and Edge have it), or it was not allowed.', ok ? 'ok' : 'error', 6000)),
  },
  record: { run: dialog('record') },
  generate: { run: dialog('generate') },

  palette: { run: dialog('palette'), global: true },
  help: { run: dialog('help') },
  scopes: { run: () => (store.ui.scopes = !store.ui.scopes) },
  advanced: { run: () => store.setPref('advanced', !store.ui.advanced) },
  theme: { run: () => store.setPref('theme', store.ui.theme === 'dark' ? 'light' : 'dark') },
  'auto-render': { run: () => store.setPref('autoRender', !store.ui.autoRender) },
  storage: { run: dialog('storage') },
  'whats-new': { run: dialog('whatsnew') },
  tour: { run: () => ((store.ui.dialog = null), (store.ui.welcome = true)) },
  report: { run: () => reportProblem() },
};

export interface Command extends CommandInfo {
  enabled: boolean;
}

/** Every command, with whether it can run right now. */
export function commands(): Command[] {
  return COMMANDS.filter((c) => ACTIONS[c.id]).map((c) => ({ ...c, enabled: ACTIONS[c.id].when?.() ?? true }));
}

/** Run a command by id (from the palette, a menu, or a key). Returns false when it can't run now. */
export function runCommand(id: string): boolean {
  const a = ACTIONS[id];
  if (!a || (a.when && !a.when())) return false;
  a.run();
  return true;
}

/** A field you type text into (sliders, colour pickers and menus have no text to undo). */
function hasText(t: EventTarget | null): boolean {
  const el = t as HTMLInputElement | null;
  if (!el?.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(el.type);
}

/**
 * A key press in the editor: run the command it's bound to. Returns true when it ran (the caller
 * then stops the browser's own handling). `typing` is true in text fields; `blocked` when a dialog
 * or the tour is open: then only global commands (undo, save, the palette…) run.
 */
export function runKey(e: KeyboardEvent, typing: boolean, blocked: boolean): boolean {
  const id = commandFor(comboOf(e));
  if (!id) return false;
  const a = ACTIONS[id];
  if (!a) return false;
  if ((typing || blocked) && !a.global) return false;
  if (typing && a.notInText && hasText(e.target)) return false;
  if (a.when && !a.when()) return false;
  a.run();
  return true;
}

// every command in the list has something to do (caught in development)
if (import.meta.env?.DEV) for (const c of COMMANDS) if (!ACTIONS[c.id]) console.warn('command without an action:', c.id);
