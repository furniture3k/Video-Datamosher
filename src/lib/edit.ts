// Editing commands shared by the timeline, the keyboard and menus.
import { store } from './store.svelte';
import { forgetMedia } from './media';
import { splitClip, clipsAt, deleteClips, detachAudio, insertVideo, layoutVideo, nearestCut, uid, clipLen, isMoshTransition, BLEND_TRANSITIONS } from '../engine/timeline';
import { VIDEO_TRACK, CLIP_AUDIO, type Clip, type TextClip, type TransitionType } from '../engine/types';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Split the selected clips under the playhead (or every clip under it when none is selected). */
export function splitAtPlayhead() {
  const t = store.ui.time;
  const under = clipsAt(store.project, t);
  const sel = under.filter((c) => store.ui.selectedClips.includes(c.id));
  const targets = (sel.length ? sel : under).map((c) => c.id);
  if (!targets.length) return store.toast('Move the playhead over a clip to split it.');
  const created: string[] = [];
  store.editTimeline((p) => {
    for (const id of targets) {
      const b = splitClip(p, id, t);
      if (b) created.push(b.id);
    }
  });
  if (created.length) store.ui.selectedClips = created;
}

export function deleteSelected() {
  const ids = store.ui.selectedClips;
  if (ids.length) {
    store.editTimeline((p) => {
      deleteClips(p, ids);
      p.texts = p.texts.filter((t) => !ids.includes(t.id));
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

export function duplicateSelected() {
  const ids = store.ui.selectedClips;
  if (!ids.length) return false;
  const created: string[] = [];
  store.editTimeline((p) => {
    for (const id of ids) {
      const tx = p.texts.find((x) => x.id === id);
      if (tx) {
        const d = { ...clone(tx), id: uid(), start: tx.start + tx.duration };
        p.texts.push(d);
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

export function removeTrack(id: string) {
  if (id === VIDEO_TRACK || id === CLIP_AUDIO) return;
  const n = store.project.clips.filter((c) => c.track === id).length;
  if (n && !confirm(`Remove this track and its ${n} clip${n > 1 ? 's' : ''}?`)) return;
  store.editTimeline((p) => {
    p.clips = p.clips.filter((c) => c.track !== id);
    p.tracks = p.tracks.filter((t) => t.id !== id);
  });
}

export const DEFAULT_DURATION: Record<string, number> = { melt: 1, bloom: 1.5, glitch: 1, stutter: 1, liquid: 1.5 };

/** Set (or clear with null) the transition into a video clip. */
export function setTransition(clipId: string, type: TransitionType | null, patch: { duration?: number; intensity?: number } = {}) {
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
export function removeMedia(id: string) {
  const n = store.project.clips.filter((c) => c.mediaId === id).length;
  if (n && !confirm(`This media is used by ${n} clip${n > 1 ? 's' : ''} on the timeline. Remove it and those clips?`)) return;
  store.editTimeline((p) => {
    deleteClips(p, p.clips.filter((c) => c.mediaId === id).map((c) => c.id));
    p.media = p.media.filter((m) => m.id !== id);
  });
  forgetMedia(id);
  store.ui.selectedClips = store.ui.selectedClips.filter((x) => store.project.clips.some((c) => c.id === x));
}

export function zoom(f: number) {
  const viewW = store.ui.timelineViewW || 800;
  const cur = store.ui.pxPerSec || Math.max(2, (viewW - 40) / Math.max(5, store.duration));
  store.ui.pxPerSec = Math.max(2, Math.min(800, cur * f));
}

export function zoomFit() {
  store.ui.pxPerSec = 0;
}

export function newText(start: number): TextClip {
  return { id: uid(), text: 'Title', start, duration: 3, size: 0.12, color: '#ffffff', font: 'sans', bold: true, x: 0.5, y: 0.5, align: 'center', shadow: true, box: false, fade: 0.3, moshed: false };
}

/** Add a text title at the playhead. */
export function addText() {
  const tx = newText(store.ui.time);
  store.edit((p) => p.texts.push(tx));
  store.selectClip(tx.id);
}
