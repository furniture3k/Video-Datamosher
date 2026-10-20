// Editing commands shared by the timeline, the keyboard and menus.
import { store } from './store.svelte';
import { ask } from './ask';
import { forgetMedia } from './media';
import { splitClip, splitText, clipsAt, deleteClips, detachAudio, insertVideo, layoutVideo, nearestCut, uid, clipLen, isMoshTransition, BLEND_TRANSITIONS, rippleDelete, insertFreeze, makeClip, isOverlayTrack, isVideoTrack, clipEnd, videoClips, layers as timelineLayers } from '../engine/timeline';
import { VIDEO_TRACK, CLIP_AUDIO, type Clip, type MediaItem, type Project, type TransitionType } from '../engine/types';
import { FIRST_ROW, freeRow, nextRow, withGroups, type Layer, type ShapeLayer, type TextLayer } from '../engine/layers';
import { DEFAULT_LOOK, fitPen, newShape, type Pt, type ShapeLook } from '../engine/shapes';
import { calloutLayers, notificationLayers, selectionLayers } from '../engine/annotate';
import { outputSize } from '../engine/args';
import { GRID_LAYOUTS, cellTransform, inset } from '../engine/grid';
import { flipbook, type FlipOrder } from '../engine/flipbook';
import { makeRng } from '../engine/rng';
import { localGet, localSet } from './storage';
import { addToTimeline } from './media';
import { styleForNew } from './styles.svelte';
import { applyStyle } from '../engine/styles';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Split the selected clips and titles under the playhead (or every clip under it when none is selected). */
export function splitAtPlayhead() {
  const t = store.ui.time;
  const selected = store.ui.selectedClips;
  const under = clipsAt(store.project, t).filter((c) => !lockedTrack(c.track));
  const titles = store.project.layers.filter((x) => selected.includes(x.id) && t > x.start + 0.05 && t < x.start + x.duration - 0.05);
  const targets = (selected.length ? under.filter((c) => selected.includes(c.id)) : under).map((c) => c.id);
  if (!targets.length && !titles.length) return store.toast(selected.length ? 'Move the playhead over the selected clip to split it.' : 'Move the playhead over a clip to split it.');
  const created: string[] = [];
  store.editTimeline((p) => {
    for (const id of targets) {
      const b = splitClip(p, id, t);
      if (b) created.push(b.id);
    }
    for (const x of titles) {
      const b = splitText(p, x.id, t);
      if (b) created.push(b.id);
    }
  });
  if (created.length) store.ui.selectedClips = created;
}

/** Clips on locked tracks can't be edited. */
export const lockedTrack = (track: string) => !!store.project.tracks.find((t) => t.id === track)?.locked;
const editable = (ids: string[]) => ids.filter((id) => {
  const c = store.project.clips.find((x) => x.id === id);
  return !c || !lockedTrack(c.track);
});

/** Delete the selection. `ripple`: also close the gaps it leaves on the upper and audio tracks. */
export function deleteSelected(ripple = false) {
  const ids = editable(store.ui.selectedClips);
  if (ids.length) {
    store.editTimeline((p) => {
      if (ripple) rippleDelete(p, ids);
      else deleteClips(p, ids);
      // a layer in a group goes with the rest of it
      const gone = new Set([...ids, ...withGroups(p.layers, ids)]);
      p.layers = p.layers.filter((t) => !gone.has(t.id));
    });
    store.ui.selectedClips = [];
    return true;
  }
  if (store.ui.selectedTransition) {
    setTransition(store.ui.selectedTransition, null);
    store.ui.selectedTransition = null;
    return true;
  }
  return false;
}

/** Turn the selected clips off (they keep their place but aren't seen or heard), or back on. */
export function toggleEnabled() {
  const ids = editable(store.ui.selectedClips);
  const clips = store.project.clips.filter((c) => ids.includes(c.id));
  if (!clips.length) return false;
  const on = clips.some((c) => c.enabled === false);
  store.edit(() => clips.forEach((c) => (c.enabled = on ? undefined : false)));
  return true;
}

/** Colour label for the selected clips (null clears it). */
export function setLabel(color: string | null) {
  const ids = store.ui.selectedClips;
  store.edit((p) => p.clips.filter((c) => ids.includes(c.id)).forEach((c) => (c.label = color ?? undefined)));
}

/** Insert a freeze frame (hold) at the playhead into the selected clip, or the video clip under it. */
export function freezeAtPlayhead(dur = 2) {
  const t = store.ui.time;
  const under = clipsAt(store.project, t).filter((c) => isVideoTrack(c.track) && !lockedTrack(c.track));
  const c = under.find((x) => store.ui.selectedClips.includes(x.id)) ?? under.find((x) => x.track === VIDEO_TRACK) ?? under[0];
  if (!c) return store.toast('Move the playhead over a video clip to freeze a frame.');
  let id = '';
  store.editTimeline((p) => (id = insertFreeze(p, c.id, t, dur)?.id ?? ''));
  if (id) store.ui.selectedClips = [id];
}

/** Move the selected clips by `frames` frames (upper and audio tracks; texts). */
export function nudgeSelected(frames: number) {
  const ids = editable(store.ui.selectedClips);
  const d = frames / store.fps;
  const free = store.project.clips.filter((c) => ids.includes(c.id) && c.track !== VIDEO_TRACK);
  const texts = store.project.layers.filter((t) => ids.includes(t.id));
  if (!free.length && !texts.length) return false;
  store.editTimeline(() => {
    for (const c of free) c.start = Math.max(0, c.start + d);
    for (const t of texts) t.start = Math.max(0, t.start + d);
  }, 'nudge');
  return true;
}

// ---------------------------------------------------------------- source edits (media panel → timeline)

/** Insert (F9): the clip goes in at the playhead; the main track splits there and moves along. */
export function insertEdit(m: MediaItem) {
  if (m.source.kind === 'adjust') return void placeOnTop(m);
  if (!m.hasVideo) return void addToTimeline(m, { track: musicTrack(), start: store.ui.time });
  const t = store.ui.time;
  const c = makeClip(m, VIDEO_TRACK);
  if (m.source.kind === 'file' && m.source.isImage) c.out = 3;
  store.editTimeline((p) => {
    const under = layoutVideo(p).find((pl) => t > pl.start + 0.05 && t < pl.end - 0.05);
    if (under) splitClip(p, under.clip.id, t);
    insertVideo(p, c, nearestCut(p, t));
  });
  store.selectClip(c.id);
}

/** Overwrite (F10): the clip replaces whatever is on the main track from the playhead on. */
export function overwriteEdit(m: MediaItem) {
  if (m.source.kind === 'adjust') return void placeOnTop(m);
  if (!m.hasVideo) return void addToTimeline(m, { track: musicTrack(), start: store.ui.time });
  const t = store.ui.time;
  const c = makeClip(m, VIDEO_TRACK);
  if (m.source.kind === 'file' && m.source.isImage) c.out = 3;
  const len = clipLen(c);
  store.editTimeline((p) => {
    for (const at of [t, t + len]) {
      const under = layoutVideo(p).find((pl) => at > pl.start + 0.05 && at < pl.end - 0.05);
      if (under) splitClip(p, under.clip.id, at);
    }
    const gone = layoutVideo(p)
      .filter((pl) => pl.start >= t - 0.05 && pl.end <= t + len + 0.05)
      .map((pl) => pl.clip.id);
    deleteClips(p, gone);
    insertVideo(p, c, nearestCut(p, t));
  });
  store.selectClip(c.id);
}

/** Place on top (F12): on the lowest upper video track that is free at the playhead (a new one if needed). */
/** Put media on the first free video track above the main one, at `at` (default the playhead). */
export function placeOnTop(m: MediaItem, at?: { track: string; start: number }) {
  if (!m.hasVideo) return void addToTimeline(m, { track: musicTrack(), start: store.ui.time });
  const t = at?.start ?? store.ui.time;
  const c = makeClip(m, 'v2');
  if (m.source.kind === 'file' && m.source.isImage) c.out = 3;
  const len = clipLen(c);
  const free = (p: Project, id: string) => !p.clips.some((x) => x.track === id && x.start < t + len - 1e-3 && clipEnd(x) > t + 1e-3);
  store.editTimeline((p) => {
    let track = at && free(p, at.track) ? at.track : videoTracks(p).find((id) => free(p, id));
    if (!track) track = addVideoTrackTo(p);
    c.track = track;
    c.start = t;
    p.clips.push(c);
  });
  store.selectClip(c.id);
}

/** Append (Shift+F12): at the end of the main track. */
export function appendEdit(m: MediaItem) {
  if (m.source.kind === 'adjust') return void placeOnTop(m);
  addToTimeline(m, m.hasVideo ? { track: VIDEO_TRACK, index: Infinity } : 'auto');
}

const musicTrack = () => store.project.tracks.find((t) => t.kind === 'audio' && t.id !== CLIP_AUDIO)?.id ?? 'a1';

/** Upper video track ids, bottom first. */
export const videoTracks = (p: Project = store.project) =>
  p.tracks
    .filter((t) => isOverlayTrack(t.id))
    .map((t) => t.id)
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

function addVideoTrackTo(p: Project): string {
  let n = 2;
  while (p.tracks.some((t) => t.id === 'v' + n)) n++;
  const id = 'v' + n;
  p.tracks.push({ id, kind: 'video', name: `Video ${n}`, muted: false, solo: false, volume: 1, mosh: true });
  return id;
}

export function addVideoTrack(): string {
  let id = '';
  store.edit((p) => (id = addVideoTrackTo(p)));
  return id;
}

/**
 * Flipbook: the chosen media swapped on each of `times` (to `t1`) on a new track above, in
 * order, shuffled or back and forth, filling the frame. One undo step. Returns how many clips.
 */
export function addFlipbook(mediaIds: string[], times: number[], t1: number, order: FlipOrder, fit: Clip['fit'] = 'fill'): number {
  const p = store.project;
  const items = mediaIds.map((id) => p.media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m?.hasVideo);
  if (!items.length || !times.length) return 0;
  const lengths = Object.fromEntries(items.map((m) => [m.id, m.source.kind === 'file' && m.source.isImage ? 0 : m.duration]));
  const flips = flipbook(items.map((m) => m.id), lengths, times, t1, order, makeRng(p.globalSeed + times.length));
  store.edit((q) => {
    const track = addVideoTrackTo(q);
    for (const f of flips) {
      const m = items.find((x) => x.id === f.media)!;
      q.clips.push(makeClip(m, track, { start: f.start, in: f.from, out: f.from + f.duration, fit, muted: true }));
    }
  });
  return flips.length;
}

// ---------------------------------------------------------------- markers and in / out

const MARKER_COLORS = ['#4fa3e0', '#5cc46b', '#d95b8f', '#e0c341', '#9b7be0', '#3fc1c9'];

/** Add a marker at the playhead (or remove the one that is already there). */
export function toggleMarker() {
  const t = store.ui.time;
  const ms = store.project.markers ?? [];
  const near = ms.find((m) => Math.abs(m.t - t) < 0.5 / store.fps);
  store.edit((p) => {
    p.markers ??= [];
    if (near) p.markers = p.markers.filter((m) => m.id !== near.id);
    else p.markers.push({ id: uid(), t, color: MARKER_COLORS[p.markers.length % MARKER_COLORS.length], name: '' });
  });
}

export function jumpMarker(dir: 1 | -1) {
  const t = store.ui.time;
  const ts = (store.project.markers ?? []).map((m) => m.t).sort((a, b) => a - b);
  const to = dir > 0 ? ts.find((x) => x > t + 1e-3) : ts.reverse().find((x) => x < t - 1e-3);
  if (to !== undefined) store.seek(to);
}

/** Every edit point (clip starts and ends on all tracks), for Up / Down. */
export function editPoints(p: Project = store.project): number[] {
  const t = new Set<number>([0]);
  for (const pl of layoutVideo(p)) (t.add(pl.start), t.add(pl.end));
  for (const c of p.clips) if (c.track !== VIDEO_TRACK) (t.add(c.start), t.add(clipEnd(c)));
  for (const x of p.layers) (t.add(x.start), t.add(x.start + x.duration));
  return [...t].map((x) => Math.round(x * 1000) / 1000).sort((a, b) => a - b);
}

export function jumpEdit(dir: 1 | -1) {
  const t = store.ui.time;
  const pts = editPoints();
  const to = dir > 0 ? pts.find((x) => x > t + 1e-3) : pts.reverse().find((x) => x < t - 1e-3);
  if (to !== undefined) store.seek(to);
}

export function markIn(t: number | null = store.ui.time) {
  store.ui.inPoint = t;
  if (t !== null && store.ui.outPoint !== null && store.ui.outPoint <= t) store.ui.outPoint = null;
}
export function markOut(t: number | null = store.ui.time) {
  store.ui.outPoint = t;
  if (t !== null && store.ui.inPoint !== null && store.ui.inPoint >= t) store.ui.inPoint = null;
}
/** Mark the clip under the playhead (X). */
export function markClip() {
  const t = store.ui.time;
  const sel = store.selectedClip;
  const pl = layoutVideo(store.project).find((x) => t >= x.start && t < x.end);
  const [a, b] = sel && sel.track !== VIDEO_TRACK ? [sel.start, clipEnd(sel)] : pl ? [pl.start, pl.end] : [null, null];
  if (a === null || b === null) return;
  store.ui.inPoint = a;
  store.ui.outPoint = b;
}
/** The marked range (in / out, either may be open), or null when nothing is marked. */
export function markedRange(): [number, number] | null {
  const { inPoint: a, outPoint: b } = store.ui;
  if (a === null && b === null) return null;
  return [a ?? 0, b ?? store.duration];
}

export { videoClips };

export function duplicateSelected() {
  if (!store.ui.selectedClips.length) return false;
  // a group is copied whole
  const ids = [...new Set([...store.ui.selectedClips, ...withGroups(store.project.layers, store.ui.selectedClips)])];
  const created: string[] = [];
  store.editTimeline((p) => {
    // the copy of a group is a group of its own
    const groups = new Map<string, string>();
    for (const id of ids) {
      const tx = p.layers.find((x) => x.id === id);
      if (tx) {
        const d: Layer = { ...clone(tx), id: uid(), start: tx.start + tx.duration };
        if (tx.group) {
          if (!groups.has(tx.group)) groups.set(tx.group, uid());
          d.group = groups.get(tx.group);
        }
        p.layers.push(d);
        created.push(d.id);
        continue;
      }
      const c = p.clips.find((x) => x.id === id);
      if (!c) continue;
      const d: Clip = { ...clone(c), id: uid(), transition: undefined };
      if (c.track === VIDEO_TRACK) p.clips.splice(p.clips.indexOf(c) + 1, 0, d);
      else {
        d.start = c.start + clipLen(c);
        p.clips.push(d);
      }
      created.push(d.id);
    }
  });
  store.ui.selectedClips = created;
  return true;
}

let clipboard: Clip[] = [];
let clipboardLayers: Layer[] = [];

export function copySelected() {
  clipboard = store.project.clips.filter((c) => store.ui.selectedClips.includes(c.id)).map(clone);
  // titles and shapes too, and whole groups of them
  const lids = withGroups(store.project.layers, store.ui.selectedClips);
  clipboardLayers = store.project.layers.filter((l) => lids.includes(l.id)).map(clone);
  const n = clipboard.length + clipboardLayers.length;
  if (n) store.toast(`Copied ${n} ${clipboardLayers.length && !clipboard.length ? 'layer' : 'clip'}${n > 1 ? 's' : ''}.`);
  return n > 0;
}

/** Paste at the playhead: video clips go in at the nearest cut, audio keeps its spacing. */
export function paste() {
  if (!clipboard.length && !clipboardLayers.length) return false;
  const t = store.ui.time;
  const audio = clipboard.filter((c) => c.track !== VIDEO_TRACK);
  const t0 = Math.min(...audio.map((c) => c.start), Infinity);
  const created: string[] = [];
  store.editTimeline((p) => {
    let at = nearestCut(p, t);
    for (const c of clipboard) {
      const d: Clip = { ...clone(c), id: uid() };
      if (!p.media.some((m) => m.id === d.mediaId)) continue;
      if (c.track === VIDEO_TRACK) {
        d.transition = undefined;
        insertVideo(p, d, at++);
      } else {
        d.start = t + (c.start - t0);
        p.clips.push(d);
      }
      created.push(d.id);
    }
    // titles and shapes come in at the playhead, keeping their spacing, each group a new group
    const l0 = Math.min(...clipboardLayers.map((l) => l.start), Infinity);
    const groups = new Map<string, string>();
    for (const l of clipboardLayers) {
      const d: Layer = { ...clone(l), id: uid(), start: t + (l.start - l0) };
      if (l.group) {
        if (!groups.has(l.group)) groups.set(l.group, uid());
        d.group = groups.get(l.group);
      }
      d.row = freeRow(p.layers, d.start, d.start + d.duration);
      p.layers.push(d);
      created.push(d.id);
    }
  });
  store.ui.selectedClips = created;
  return true;
}

/** Group the selected titles and shapes: they move, copy and delete together. */
export function groupSelected() {
  const ids = store.ui.selectedClips.filter((id) => store.project.layers.some((l) => l.id === id));
  if (ids.length < 2) return store.toast('Select two or more titles or shapes to group.', 'info');
  const g = uid();
  store.edit((p) => {
    for (const l of p.layers) if (ids.includes(l.id)) l.group = g;
  });
  store.toast(`Grouped ${ids.length}: they move, copy and delete together.`, 'ok');
}

/** Take the selected layers (and everything grouped with them) out of their group. */
export function ungroupSelected() {
  const ids = withGroups(store.project.layers, store.ui.selectedClips);
  if (!store.project.layers.some((l) => ids.includes(l.id) && l.group)) return store.toast('That is not in a group.', 'info');
  store.edit((p) => {
    for (const l of p.layers) if (ids.includes(l.id)) delete l.group;
  });
}

export function detach(id: string) {
  let track = store.project.tracks.find((t) => t.kind === 'audio' && t.id !== CLIP_AUDIO && !store.project.clips.some((c) => c.track === t.id))?.id;
  store.editTimeline((p) => {
    if (!track) track = addTrackTo(p);
    detachAudio(p, id, track);
  });
}

function addTrackTo(p: typeof store.project): string {
  let n = 1;
  while (p.tracks.some((t) => t.id === 'a' + n)) n++;
  const id = 'a' + n;
  p.tracks.push({ id, kind: 'audio', name: `Audio ${n}`, muted: false, solo: false, volume: 1, mosh: false });
  return id;
}

export function addAudioTrack(): string {
  let id = '';
  store.edit((p) => (id = addTrackTo(p)));
  return id;
}

export async function removeTrack(id: string) {
  if (id === VIDEO_TRACK || id === CLIP_AUDIO) return;
  const n = store.project.clips.filter((c) => c.track === id).length;
  if (n && !(await ask(`Remove this track and its ${n} clip${n > 1 ? 's' : ''}?`))) return;
  store.editTimeline((p) => {
    p.clips = p.clips.filter((c) => c.track !== id);
    p.tracks = p.tracks.filter((t) => t.id !== id);
  });
}

export const DEFAULT_DURATION: Record<string, number> = { melt: 1.5, bloom: 1.5, glitch: 1, stutter: 1.5, liquid: 1.5, ghost: 1.5, rewind: 1.5 };

/** Set (or clear with null) the transition into a video clip. */
export function setTransition(clipId: string, type: TransitionType | null, patch: { duration?: number; intensity?: number; resolve?: boolean } = {}) {
  store.editTimeline((p) => {
    const vids = p.clips.filter((c) => c.track === VIDEO_TRACK);
    const c = vids.find((x) => x.id === clipId);
    if (!c || vids[0] === c) return;
    if (!type) c.transition = undefined;
    else {
      const prev = c.transition;
      const keepDur = prev && isMoshTransition(prev) === !(type in BLEND_TRANSITIONS);
      c.transition = {
        type,
        duration: patch.duration ?? (keepDur ? prev!.duration : (DEFAULT_DURATION[type] ?? 0.75)),
        intensity: patch.intensity ?? prev?.intensity ?? 0.5,
        ...((patch.resolve ?? prev?.resolve) === false ? { resolve: false } : {}),
      };
    }
  }, 'tr' + clipId);
}

/** Put a transition on the cut nearest the playhead. */
export function transitionAtPlayhead(type: TransitionType = 'melt') {
  const placed = layoutVideo(store.project);
  if (placed.length < 2) return store.toast('Transitions go between two video clips.');
  let best = placed[1];
  for (const pl of placed.slice(1)) if (Math.abs(pl.start - store.ui.time) < Math.abs(best.start - store.ui.time)) best = pl;
  setTransition(best.clip.id, type);
  store.selectTransition(best.clip.id);
}

/** Remove a media item from the library (and its clips from the timeline). */
export async function removeMedia(id: string) {
  const n = store.project.clips.filter((c) => c.mediaId === id).length;
  if (n && !(await ask(`This media is used by ${n} clip${n > 1 ? 's' : ''} on the timeline. Remove it and those clips?`))) return;
  store.editTimeline((p) => {
    deleteClips(p, p.clips.filter((c) => c.mediaId === id).map((c) => c.id));
    p.media = p.media.filter((m) => m.id !== id);
  });
  forgetMedia(id);
}

export function zoom(f: number) {
  const viewW = store.ui.timelineViewW || 800;
  const cur = store.ui.pxPerSec || Math.max(2, (viewW - 40) / Math.max(5, store.duration));
  store.ui.pxPerSec = Math.max(2, Math.min(800, cur * f));
}

export function zoomFit() {
  store.ui.pxPerSec = 0;
}

/** A new title at `start`, in the style used last (if any). */
export function newText(start: number): TextLayer {
  const l: TextLayer = { id: uid(), kind: 'text', row: FIRST_ROW, text: 'Title', start, duration: 3, size: 0.12, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0.3, moshed: false };
  const s = styleForNew();
  if (s) applyStyle(l, s);
  return l;
}

/**
 * The graphics row under the pointer while dragging layer `id` on a timeline: the row whose lane
 * it's over, a new row on top when it's above the topmost lane, or null (stay where it is).
 */
export function graphicsRowAt(clientX: number, clientY: number, id: string): string | null {
  const over = (document.elementFromPoint(clientX, clientY)?.closest('[data-row]') as HTMLElement | null)?.dataset.row;
  if (over) return over;
  const top = document.querySelector('[data-row]');
  if (!top || clientY >= top.getBoundingClientRect().top) return null;
  // the row above all the others (a layer already alone on top stays there)
  return nextRow(store.project.layers.filter((l) => l.id !== id));
}

/** The look new shapes get: the last one changed (colour, line, glow…), else annotation red. */
export const shapeLook = (): ShapeLook => ({ ...DEFAULT_LOOK, ...localGet<Partial<ShapeLook>>('shapeLook', {}) });

/** Remember a shape's look for the next one. */
export function rememberShapeLook(s: ShapeLayer) {
  const { color, width, fill, glow, drawOn, boil } = s;
  if (s.shape !== 'highlight') localSet('shapeLook', { color, width, fill, glow, drawOn, boil });
}

const aspect = () => {
  const { w, h } = outputSize(store.project, 640);
  return w / h;
};

/** Add a shape at the playhead, on a free graphics row. */
export function addShape(kind: ShapeLayer['shape']) {
  const t = store.ui.time;
  const s = newShape(kind, uid(), freeRow(store.project.layers, t, t + 3), t, aspect(), shapeLook());
  store.edit((p) => p.layers.push(s));
  store.selectClip(s.id);
  return s;
}

/**
 * A callout: a box round the point, a leader line to a title, and small print, as one group. `at`
 * is where it points (shares of the frame); the middle of the picture if not given.
 */
export function addCallout(at: [number, number] = [0.5, 0.5]) {
  const t = store.ui.time;
  const look = shapeLook();
  const made = calloutLayers(at, aspect(), look, store.project.layers, uid, t, 3);
  store.edit((p) => p.layers.push(...made));
  // the title is what to type over first
  store.selectClip(made[2].id);
  return made;
}

/** Selected text with its handles and menu, as phones show it (a group), at `at` (shares of the frame). */
export function addSelection(at: [number, number] = [0.5, 0.55]) {
  const t = store.ui.time;
  const made = selectionLayers(at, aspect(), store.project.layers, uid, t, 3);
  store.edit((p) => p.layers.push(...made));
  store.selectClip(made[0].id);
  return made;
}

/** A notification banner sliding down from the top (a group). */
export function addNotification() {
  const t = store.ui.time;
  const made = notificationLayers(aspect(), store.project.layers, uid, t, 3);
  store.edit((p) => p.layers.push(...made));
  store.selectClip(made[2].id);
  return made;
}

/** Emoji to stick on (reactions, as in the references). */
export const EMOJI = ['😂', '😍', '🔥', '💀', '😭', '✨', '💯', '👀', '🙏', '❤️', '👍', '😎', '🤯', '🥹', '⭐', '🌸', '🎉', '💥'];

/** Add an emoji sticker at the playhead (a title of one emoji: it has every title's settings). */
export function addEmoji(e: string) {
  const t = store.ui.time;
  const l: TextLayer = { id: uid(), kind: 'text', row: freeRow(store.project.layers, t, t + 3), text: e, start: t, duration: 3, size: 0.14, color: '#ffffff', font: 'sans', bold: false, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, anim: 'pop', animIn: 0.25 };
  store.edit((p) => p.layers.push(l));
  store.selectClip(l.id);
  return l;
}

/** Add a freehand stroke drawn on the player (points as shares of the frame). */
export function addPen(raw: Pt[]) {
  const fit = fitPen(raw);
  if (!fit) return null;
  const t = store.ui.time;
  const s: ShapeLayer = { ...newShape('pen', uid(), freeRow(store.project.layers, t, t + 3), t, aspect(), shapeLook()), ...fit };
  delete s.fill;
  store.edit((p) => p.layers.push(s));
  store.selectClip(s.id);
  return s;
}

/**
 * Split screen: put the clips under the playhead (or the selected ones) into the cells of a
 * layout, the main track's first. Each is zoomed, moved and cropped to cover its cell.
 */
export function arrangeGrid(layoutId: string, gap = 0) {
  const L = GRID_LAYOUTS.find((g) => g.id === layoutId);
  if (!L) return;
  const p = store.project;
  const t = store.ui.time;
  const picture = (m: MediaItem | undefined) => !!m?.hasVideo && m.source.kind !== 'adjust';
  const sel = store.ui.selectedClips.map((id) => p.clips.find((c) => c.id === id)).filter((c): c is Clip => !!c && picture(p.media.find((m) => m.id === c.mediaId)));
  const under = [
    ...layoutVideo(p).filter((pl) => t >= pl.start && t < pl.end).map((pl) => pl.clip),
    ...timelineLayers(p).filter((l) => t >= l.start && t < l.end).map((l) => l.clip),
  ].filter((c) => picture(p.media.find((m) => m.id === c.mediaId)));
  const clips = sel.length >= 2 ? sel : under;
  if (clips.length < 2) return store.toast('Put two or more clips under the playhead (on tracks above each other), or select them.', 'error', 5000);
  const { w: W, h: H } = outputSize(p, 640);
  const ids = clips.slice(0, L.cells.length).map((c) => c.id);
  store.edit((q) => {
    ids.forEach((id, i) => {
      const c = q.clips.find((x) => x.id === id)!;
      const m = q.media.find((x) => x.id === c.mediaId)!;
      c.transform = cellTransform(inset(L.cells[i], gap, W, H), c.fit, m.width, m.height, W, H);
      if (c.keys) for (const k of ['x', 'y', 'zoom', 'rotate'] as const) delete c.keys[k];
    });
  });
  const left = clips.length - ids.length;
  store.toast(`${L.name}: ${ids.length} clips arranged${left > 0 ? ` (${left} more than there are cells)` : ''}.`, 'ok');
}

/** Add a text title at the playhead. */
export function addText() {
  const tx = newText(store.ui.time);
  store.edit((p) => p.layers.push(tx));
  store.selectClip(tx.id);
}
