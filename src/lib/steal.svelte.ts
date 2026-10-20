// Steal this edit: read a reference video (a screen recording of a Reel, say), measure how it was
// made (see engine/steal.ts), and put the same rhythm, frame rate, grade and frame round the user's
// own clips.
import { store } from './store.svelte';
import { ffmpeg, MOUNT } from './ffmpeg';
import { grayFrames } from './analysis';
import { colourFrames } from './colourframes';
import { importLuts } from './luts.svelte';
import { takeSnapshot } from './snapshots.svelte';
import { addFiles, addToTimeline } from './media';
import { startProject } from './projects.svelte';
import { analyzeAudio } from '../engine/beats';
import { analyseReference, colourStats, stealPlan, transferLut, type RGBFrames, type StealPlan, type StealResult } from '../engine/steal';
import { cubeText } from '../engine/lut';
import { parseProbe, even } from '../engine/args';
import { mediaOf, uid } from '../engine/timeline';
import { DEFAULT_CANVAS } from '../engine/canvas';
import { newProject, VIDEO_TRACK, type Clip, type MediaItem } from '../engine/types';

/** Where the work has got to, for the dialog. */
export const stealState = $state({ stage: '', running: false });

/** The most seconds of a reference that are read (more is slow and no better). */
const MAX_SECONDS = 90;
/** Pictures a second the cuts and frame rate are measured at. */
const FPS = 24;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Read and measure a reference video. */
export async function measureReference(file: File): Promise<StealResult & { width: number; height: number }> {
  stealState.running = true;
  try {
    const ext = (file.name.split('.').pop() ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const name = `ref.${ext}`;
    const mounts = { [name]: file };
    stealState.stage = 'Opening the video';
    const info = parseProbe((await ffmpeg.run(['-i', MOUNT + name, '-t', '0.1', '-f', 'null', '-'], { mounts })).log);
    if (!info.hasVideo || !info.width) throw new Error('That file has no picture to read.');
    const span = ['-t', String(MAX_SECONDS)];
    const w = 96;
    const h = Math.max(24, even((w * info.height) / info.width));
    stealState.stage = 'Reading the cuts and the frame rate';
    const g = await ffmpeg.run([...span, '-i', MOUNT + name, '-an', '-vf', `fps=${FPS},scale=${w}:${h},format=gray`, '-f', 'rawvideo', 'ref.gray'], { mounts, outputs: ['ref.gray'] });
    const gray = grayFrames(g.out['ref.gray'], w, h);
    if (gray.frames.length < 8) throw new Error('That video is too short to learn anything from.');
    stealState.stage = 'Reading the colours';
    const cw = 64;
    const ch = Math.max(16, even((cw * info.height) / info.width));
    const c = await ffmpeg.run([...span, '-i', MOUNT + name, '-an', '-vf', `fps=4,scale=${cw}:${ch},format=rgb24`, '-f', 'rawvideo', 'ref.rgb'], { mounts, outputs: ['ref.rgb'] });
    const raw = c.out['ref.rgb'];
    const rgb: RGBFrames = { w: cw, h: ch, frames: Array.from({ length: Math.floor(raw.length / (cw * ch * 3)) }, (_, i) => raw.subarray(i * cw * ch * 3, (i + 1) * cw * ch * 3)) };
    let beats: number[] | undefined;
    if (info.hasAudio) {
      stealState.stage = 'Listening for the beat';
      try {
        const a = await ffmpeg.run([...span, '-i', MOUNT + name, '-vn', '-ac', '2', '-ar', '44100', '-f', 's16le', 'ref.pcm'], { mounts, outputs: ['ref.pcm'] });
        const pcm = a.out['ref.pcm'];
        const f = analyzeAudio(new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)), FPS);
        if (f.confidence > 0.2 && f.beatTimes.length > 3) beats = f.beatTimes;
      } catch {
        /* no sound to learn from: the cuts are measured without it */
      }
    }
    const duration = Math.min(MAX_SECONDS, info.duration || gray.frames.length / FPS);
    return { ...analyseReference({ gray, rgb, fps: FPS, duration, beats }), width: info.width, height: info.height };
  } finally {
    stealState.running = false;
    stealState.stage = '';
  }
}

/** The colour of the user's own footage, from a few pictures of it. */
async function ownColour(pool: { clip: Clip; media: MediaItem }[]) {
  const frames: Uint8Array[] = [];
  const w = 48;
  let h = 27;
  for (const { clip, media } of pool.slice(0, 4)) {
    try {
      const cf = colourFrames(media, clip.in, Math.max(clip.in + 0.2, clip.out), 1, w);
      h = cf.h;
      for (const i of [0, Math.floor(cf.n / 2)]) {
        const bmp = await cf.get(Math.min(i, cf.n - 1));
        const cv = new OffscreenCanvas(w, cf.h);
        cv.getContext('2d')!.drawImage(bmp, 0, 0, w, cf.h);
        bmp.close();
        const d = cv.getContext('2d')!.getImageData(0, 0, w, cf.h).data;
        const f = new Uint8Array(w * cf.h * 3);
        for (let p = 0; p < w * cf.h; p++) f.set([d[p * 4], d[p * 4 + 1], d[p * 4 + 2]], p * 3);
        frames.push(f);
      }
    } catch {
      /* a picture that can't be read is left out */
    }
  }
  return frames.length ? colourStats({ w, h, frames }) : null;
}

/** The main-track video clips, with their media. */
const poolOf = () =>
  store.project.clips
    .filter((c) => c.track === VIDEO_TRACK)
    .map((c) => ({ clip: c, media: mediaOf(store.project, c.mediaId)! }))
    .filter((x) => x.media && x.media.hasVideo);

/** How many seconds of footage the user has on the main track. */
export const footageSeconds = () => poolOf().reduce((s, x) => s + Math.max(0.1, x.clip.out - x.clip.in), 0);

/**
 * Cut the user's footage the way the reference was cut: the same shot lengths in turn, the same
 * frame rate, the reference's grade as a LUT made from the two colours, and a card round the picture
 * if it had bars. `files`: footage to start a new project from (the home screen), else the main
 * track's clips are re-cut. One snapshot first, so it can be undone.
 */
export async function applySteal(result: StealResult, plan: StealPlan, files?: File[]) {
  if (files?.length) {
    await startProject({ ...newProject(), name: 'Stolen edit' });
    const media = await addFiles(files, 'none', undefined, { recipes: false });
    for (const m of media.filter((x) => x.hasVideo)) addToTimeline(m);
  }
  const pool = poolOf();
  if (!pool.length) return store.toast('Put some clips on the timeline first: the edit is cut from them.', 'error');
  if (!files?.length) await takeSnapshot('Before Steal this edit', true);
  // the reference's grade, as a LUT from the colour of these clips to the colour of the reference
  let lutId: string | undefined;
  if (plan.grade > 0) {
    const own = await ownColour(pool);
    if (own) {
      const text = cubeText(transferLut(own, result.colour, 17, 1));
      [lutId] = await importLuts([new File([text], 'Stolen grade.cube', { type: 'text/plain' })]);
    }
  }
  // the shots in turn, each taken from the next stretch of its clip (round to the start when it runs out)
  const cursor = pool.map((x) => x.clip.in);
  const made: Clip[] = plan.shots.map((len, i) => {
    const k = i % pool.length;
    const base = pool[k].clip;
    const room = Math.max(0.1, base.out - base.in);
    const l = Math.min(len, room);
    let from = cursor[k];
    if (from + l > base.out + 1e-6) from = base.in;
    cursor[k] = from + l;
    const c: Clip = { ...clone(base), id: uid(), in: Math.round(from * 1000) / 1000, out: Math.round((from + l) * 1000) / 1000, speed: 1, reverse: false, transition: undefined, ramp: undefined, freeze: undefined, keys: undefined };
    delete c.ramp;
    delete c.freeze;
    delete c.keys;
    if (plan.stepFps) c.stepFps = plan.stepFps;
    else delete c.stepFps;
    if (lutId) c.grade = { ...(c.grade ?? {}), lut: lutId, lutAmount: plan.grade };
    return c;
  });
  store.edit((p) => {
    p.clips = [...p.clips.filter((c) => c.track !== VIDEO_TRACK), ...made];
    if (plan.card) p.canvas = { ...DEFAULT_CANVAS, bg: 'color', color: plan.card.colour, inset: plan.card.inset, shadow: 0.25 };
  });
  store.ui.selectedClips = [];
  store.seek(0);
  store.commit();
  store.toast(`Cut ${made.length} shots like the reference${plan.stepFps ? `, at ${plan.stepFps} pictures a second` : ''}${lutId ? ', with its colours' : ''}${plan.card ? ' and a card round the picture' : ''}. Undo takes it back.`, 'ok', 7000);
}

/** The plan for the user's footage from a measurement (their length and beat feed it). */
export function planFor(result: StealResult, seconds: number, opts: { grade?: number; beatPeriod?: number } = {}) {
  return stealPlan(result, seconds, opts);
}
