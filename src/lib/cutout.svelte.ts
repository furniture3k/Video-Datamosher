// Cutting a subject out of a clip: a picture of one frame with the person's taps on it (for the live
// preview), and the job that follows the subject through the whole clip and keeps the matte.
import { store } from './store.svelte';
import { colourFrames } from './colourframes';
import { clipFrames } from './analysis';
import { openFrame, resizeMask, setObjectBackend } from './objectseg';
import { busy, framesBuffer, inWorker } from './motion.svelte';
import { cacheMatte, forgetMattes } from './mattes.svelte';
import { putFile } from './storage';
import { cutOut, type ObjectPrompt } from '../engine/cutout';
import { matteFrames, matteKey, maskBox, packMatte, type MatteRef } from '../engine/matte';
import { trackBox, type TrackPoint } from '../engine/track';
import { clipLen, mediaOf, sourceTime } from '../engine/timeline';
import { even } from '../engine/args';
import { uid } from '../engine/presets';
import { clipStart, trackableAt } from './motion.svelte';
import { FIRST_ROW, freeRow, type ShapeLayer, type SubjectFx, type TextLayer } from '../engine/layers';
import type { Clip, Project } from '../engine/types';

/** The job in progress: for the progress bar and the Cancel button. */
export const cutoutJob = $state({ running: false, progress: 0, cancel: false });

/** Frames a second a matte is made at (it is blended between frames), and the sizes of what the model sees and what is kept. */
export const MATTE_FPS = 12;
const MODEL_W = 384;
const MATTE_W = 256;

/** Source seconds of the picture under the playhead for a clip (null if the playhead isn't on it). */
export function sourceAt(p: Project, c: Clip, t: number): number | null {
  const start = clipStart(p, c);
  const len = clipLen(c);
  if (t < start - 1e-6 || t > start + len + 1e-6) return null;
  return sourceTime(c, Math.max(0, Math.min(len, t - start)));
}

/** One picture of a clip's source at `t` source seconds, for the model to look at (the caller closes it). */
export async function frameAt(c: Clip, p: Project, t: number, w = MODEL_W): Promise<ImageBitmap> {
  const m = mediaOf(p, c.mediaId);
  if (!m) throw new Error('That clip has no footage.');
  return colourFrames(m, t, t + 0.1, 10, w).get(0);
}

/**
 * Follow the subject marked by `points` (shares of the picture; 1 = it, 0 = not it) on the frame at
 * source time `srcT` through the clip, and keep the matte with the footage. Returns the matte's id.
 */
export async function cutOutThroughClip(clipId: string, points: [number, number, 0 | 1][], srcT: number): Promise<string | void> {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m || !points.some((q) => q[2] === 1)) return;
  if (cutoutJob.running) return;
  store.ui.playing = false;
  cutoutJob.running = true;
  cutoutJob.cancel = false;
  cutoutJob.progress = 0;
  try {
    const result = await busy('Cutting out', async () => {
      const from = c.in;
      const to = Math.max(c.in + 0.1, c.out);
      const cf = colourFrames(m, from, to, MATTE_FPS, MODEL_W);
      const n = cf.n;
      const k0 = Math.max(0, Math.min(n - 1, Math.round((srcT - from) * MATTE_FPS)));
      const mw = even(MATTE_W);
      const mh = even((MATTE_W * (m.height || 9)) / (m.width || 16));
      const segment = async (i: number, prompt: ObjectPrompt) => {
        const bmp = await cf.get(i);
        try {
          const s = await openFrame(bmp);
          try {
            const r = await s.mask(prompt);
            return r ? resizeMask(r, mw, mh) : null;
          } finally {
            s.close();
          }
        } finally {
          bmp.close();
        }
      };
      // the box tracker follows the subject too (on small grey frames), to point the model at it when the mask is lost
      let recover: ((i: number) => [number, number, number, number] | null) | undefined;
      const first = await segment(k0, { points });
      if (!first) throw new Error('The model could not find anything there: tap on the thing to cut out.');
      const box = maskBox(first, mw, mh);
      if (box) {
        const g = await clipFrames(c, m, MATTE_FPS, 256);
        const [cx, cy, bw, bh] = [((box[0] + box[2]) / 2) * g.w, ((box[1] + box[3]) / 2) * g.h, (box[2] - box[0]) * g.w, (box[3] - box[1]) * g.h];
        const start = Math.min(k0, g.frames.length - 1);
        const [fwd, back] = await Promise.all([
          inWorker<TrackPoint[]>({ kind: 'track', w: g.w, h: g.h, buf: framesBuffer(g, start, g.frames.length), start: 0, cx, cy, bw, bh, dir: 1 }, () => trackBox({ ...g, frames: g.frames.slice(start) }, 0, cx, cy, bw, bh, 1)).then((t) => t.map(([f, x, y]) => [f + start, x, y] as const)),
          inWorker<TrackPoint[]>({ kind: 'track', w: g.w, h: g.h, buf: framesBuffer(g, 0, start + 1), start, cx, cy, bw, bh, dir: -1 }, () => trackBox({ ...g, frames: g.frames.slice(0, start + 1) }, start, cx, cy, bw, bh, -1)).then((t) => t.map(([f, x, y]) => [f, x, y] as const)),
        ]);
        const path = new Map<number, readonly [number, number, number]>();
        for (const q of [...back, ...fwd]) path.set(q[0], q);
        recover = (i) => {
          const q = path.get(i);
          return q ? [(q[1] - bw / 2) / g.w, (q[2] - bh / 2) / g.h, (q[1] + bw / 2) / g.w, (q[2] + bh / 2) / g.h] : null;
        };
      }
      const masks = await cutOut({
        n,
        start: k0,
        prompt: { points },
        w: mw,
        h: mh,
        segment,
        recover,
        onFrame: (done, total) => {
          cutoutJob.progress = done / total;
          store.status.engine = `Cutting out… ${Math.round((done / total) * 100)}%`;
        },
        cancelled: () => cutoutJob.cancel,
      });
      return { masks, mw, mh, from, to };
    });
    if (cutoutJob.cancel) {
      store.toast('Cut-out cancelled.', 'info');
      return;
    }
    const id = uid();
    const packed = await packMatte(result.masks);
    await putFile(matteKey(id), new Blob([packed as BlobPart], { type: 'application/octet-stream' }));
    const n = (m.mattes?.length ?? 0) + 1;
    const ref: MatteRef = { id, name: `Cut-out ${n}`, fileId: matteKey(id), w: result.mw, h: result.mh, fps: MATTE_FPS, from: result.from, to: result.to, prompts: [{ t: srcT, points }], version: 1 };
    cacheMatte(ref, result.masks);
    store.edit((q) => {
      const x = q.media.find((y) => y.id === m.id);
      if (x) x.mattes = [...(x.mattes ?? []), ref];
    });
    const seen = result.masks.filter((f) => f.some((v) => v >= 128)).length;
    store.toast(`${ref.name}: the subject was found in ${seen} of ${matteFrames(ref)} frames. Put a title behind it from the title's settings (Depth).`, 'ok', 6000);
    return id;
  } finally {
    cutoutJob.running = false;
    cutoutJob.progress = 0;
  }
}

/** Throw a matte away (its stored frames are cleaned up with other unused files). */
export function deleteMatte(mediaId: string, matteId: string) {
  store.edit((q) => {
    const m = q.media.find((x) => x.id === mediaId);
    if (m) m.mattes = m.mattes?.filter((x) => x.id !== matteId);
    // layers that were behind it go back to the front: there is nothing to hide them now
    if (!q.media.some((x) => (x.mattes ?? []).length)) for (const l of q.layers) delete l.depth;
  });
  forgetMattes();
}

/** Start (or stop) cutting a subject out of a clip: tap it on the player, with the playhead on the clip. */
export function toggleCutout(id: string) {
  if (store.ui.cutout?.clipId === id) return void (store.ui.cutout = null);
  const c = store.project.clips.find((x) => x.id === id);
  if (!c) return;
  store.ui.playing = false;
  store.ui.trackPick = null;
  store.ui.trackThen = null;
  store.ui.surfacePick = null;
  const start = clipStart(store.project, c);
  const len = clipLen(c);
  if (store.ui.time < start || store.ui.time >= start + len - 1e-3) store.seek(start + Math.min(len / 2, 0.5));
  setObjectBackend(store.ui.cutModel);
  store.ui.cutout = { clipId: id, points: [] };
}

/** Cut a subject out of the video clip under the playhead (for the palette and menus). */
export function startCutout() {
  if (store.ui.cutout) return void (store.ui.cutout = null);
  const c = trackableAt(store.ui.time);
  if (!c) return store.toast('Put the playhead on a video clip first: the subject is cut out of it.', 'error');
  toggleCutout(c.id);
}

/**
 * A big title behind the subject: across the frame for as long as the clip is on, hidden wherever the
 * subject is (so it shows between the subject and the background). `at`: where to put it (shares of the frame).
 */
export function titleBehind(clipId: string, at: [number, number] = [0.5, 0.5], text = 'BEHIND') {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  if (!(m.mattes ?? []).length) return store.toast('Cut a subject out of the clip first: the title goes behind it.', 'error');
  const t0 = clipStart(p, c);
  const t1 = t0 + clipLen(c);
  const tx: TextLayer = { id: uid(), kind: 'text', row: p.layers.length ? freeRow(p.layers, t0, t1) : FIRST_ROW, text, start: t0, duration: Math.max(0.5, t1 - t0), size: 0.3, color: '#ffffff', font: 'impact', bold: true, x: at[0], y: at[1], align: 'center', shadow: false, box: false, fade: 0, moshed: false, fit: 'width', depth: 'behind' };
  store.edit((q) => q.layers.push(tx));
  store.ui.selectedClips = [tx.id];
  store.toast('Added a title behind the subject: change its words in the inspector.', 'ok');
}

/** What each subject effect starts as. */
export const SUBJECT_EFFECTS: { value: SubjectFx['effect']; label: string; hint: string; colour: string; fx: Partial<SubjectFx> }[] = [
  { value: 'fill', label: 'Recolour', hint: 'The subject as a flat colour: a red car, a white cut-out.', colour: '#ff2a2a', fx: { amount: 0.5 } },
  { value: 'outline', label: 'Outline', hint: 'A line round the subject.', colour: '#ffffff', fx: { amount: 0.3 } },
  { value: 'glow', label: 'Glow', hint: 'A soft light round the subject.', colour: '#ff5cc8', fx: { amount: 0.5 } },
  { value: 'echo', label: 'Echo', hint: 'Copies of the subject stepping away behind it.', colour: '#22d3ee', fx: { amount: 0.5, copies: 4, dx: 0.04, dy: 0 } },
  { value: 'blur', label: 'Blur the background', hint: 'Everything but the subject out of focus.', colour: '#ffffff', fx: { amount: 0.5, part: 'background' } },
  { value: 'grade', label: 'Darken the background', hint: 'Everything but the subject dimmer and greyer (or change it to taste).', colour: '#ffffff', fx: { amount: 0.5, part: 'background', brightness: 0.45, saturation: 0.3, contrast: 1 } },
];

/** A subject effect over the whole length of a clip that has a cut-out. */
export function addSubjectEffect(clipId: string, effect: SubjectFx['effect']) {
  const p = $state.snapshot(store.project) as Project;
  const c = p.clips.find((x) => x.id === clipId);
  const m = c && mediaOf(p, c.mediaId);
  if (!c || !m) return;
  if (!(m.mattes ?? []).length) return store.toast('Cut a subject out of the clip first: the effect is made of it.', 'error');
  const def = SUBJECT_EFFECTS.find((x) => x.value === effect)!;
  const t0 = clipStart(p, c);
  const t1 = t0 + clipLen(c);
  const fx: SubjectFx = { effect, amount: 0.5, ...def.fx };
  const l: ShapeLayer = { id: uid(), kind: 'shape', row: p.layers.length ? freeRow(p.layers, t0, t1) : FIRST_ROW, shape: 'subject', start: t0, duration: Math.max(0.5, t1 - t0), x: 0.5, y: 0.5, w: 1, h: 1, color: def.colour, width: 0.004, fade: 0, moshed: false, subject: fx };
  store.edit((q) => q.layers.push(l));
  store.ui.selectedClips = [l.id];
  store.toast(`${def.label}: change it in the settings.`, 'ok');
  return l.id;
}
