// Editing commands shared by the timeline, the keyboard and menus.
import { store } from './store.svelte';
import { ask } from './ask';
import { forgetMedia } from './media';
import { splitClip, splitText, clipsAt, deleteClips, detachAudio, insertVideo, layoutVideo, nearestCut, uid, clipLen, isMoshTransition, BLEND_TRANSITIONS, rippleDelete, insertFreeze, makeClip, isOverlayTrack, isVideoTrack, clipEnd, videoClips } from '../engine/timeline';
import { VIDEO_TRACK, CLIP_AUDIO, type Clip, type MediaItem, type Project, type TransitionType } from '../engine/types';
import { FIRST_ROW, nextRow, type TextLayer } from '../engine/layers';
import { addToTimeline } from './media';

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
      p.layers = p.layers.filter((t) => !ids.includes(t.id));
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
  const ids = store.ui.selectedClips;
  if (!ids.length) return false;
  const created: string[] = [];
  store.editTimeline((p) => {
    for (const id of ids) {
      const tx = p.layers.find((x) => x.id === id);
      if (tx) {
        const d = { ...clone(tx), id: uid(), start: tx.start + tx.duration };
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

export function copySelected() {
  clipboard = store.project.clips.filter((c) => store.ui.selectedClips.includes(c.id)).map(clone);
  if (clipboard.length) store.toast(`Copied ${clipboard.length} clip${clipboard.length > 1 ? 's' : ''}.`);
  return clipboard.length > 0;
}

/** Paste at the playhead: video clips go in at the nearest cut, audio keeps its spacing. */
export function paste() {
  if (!clipboard.length) return false;
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
  });
  store.ui.selectedClips = created;
  return true;
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

export function newText(start: number): TextLayer {
  return { id: uid(), kind: 'text', row: FIRST_ROW, text: 'Title', start, duration: 3, size: 0.12, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0.3, moshed: false };
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

/** Add a text title at the playhead. */
export function addText() {
  const tx = newText(store.ui.time);
  store.edit((p) => p.layers.push(tx));
  store.selectClip(tx.id);
}
