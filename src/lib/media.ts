// Importing media into the library, placing it on the timeline, and background preparation
// (preview proxies, decoded audio and waveforms).
import { store } from './store.svelte';
import { placeOnTop } from './edit';
import { ask } from './ask';
import { applyShareCode } from './projectio.svelte';
import { takeSnapshot } from './snapshots.svelte';
import { putFile, getFile, kvGet, kvSet, askPersistOnce } from './storage';
import { probeFile, renderGenerator, makeProxy, extractPcm, proxyKey } from './renderer';
import { mediaState, rt, PEAKS_PER_SEC } from './mediastate.svelte';
import { GENERATORS, even } from '../engine/args';
import { uid, makeClip, insertVideo, nearestCut, freeClips, clipLen, videoEnd, isOverlayTrack, isVideoTrack } from '../engine/timeline';
import { VIDEO_TRACK, type MediaItem, type Project } from '../engine/types';

const blobToDataUrl = (url: string) =>
  url
    ? fetch(url)
        .then((r) => r.blob())
        .then((b) => new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(b);
        }))
        .finally(() => URL.revokeObjectURL(url))
    : Promise.resolve('');

const AUDIO_EXT = /^(mp3|wav|m4a|aac|ogg|oga|opus|flac|aif|aiff|wma)$/;

/** Where dropped media should land. */
export type Place = { track: 'v1'; index: number } | { track: string; start: number } | 'auto' | 'none';

/**
 * Read a file into a media item: probe it, keep the file in storage and make its thumbnail. Not
 * added to any project (addFiles does that; batches make their own projects). Null when it holds
 * neither picture nor sound. `recipe`: a mosh recipe found in the file's metadata.
 */
export async function readMedia(file: File, knownDuration?: number): Promise<{ m: MediaItem; recipe: string | null } | null> {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const isImage = file.type.startsWith('image/') && !/gif$/i.test(file.type) && !/gif$/.test(ext);
  const { info, thumb } = await probeFile(file, ext);
  if (!info.hasVideo && !info.hasAudio) return null;
  const id = uid();
  await putFile(id, file);
  askPersistOnce();
  let duration = isImage ? 3600 : info.duration || knownDuration || 5;
  if (!isFinite(duration) || duration <= 0) duration = knownDuration || 5;
  const m: MediaItem = {
    id,
    source: { kind: 'file', fileId: id, name: file.name, mime: file.type, isImage, ext },
    duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio && !isImage,
    hasVideo: info.hasVideo && !(AUDIO_EXT.test(ext) && !info.width),
    thumb: await blobToDataUrl(thumb),
  };
  return { m, recipe: info.recipe ?? null };
}

/** `recipes: false`: don't offer to apply a recipe found in the files (our own bakes). */
export async function addFiles(list: FileList | File[], place: Place = 'auto', knownDuration?: number, opts: { recipes?: boolean } = {}): Promise<MediaItem[]> {
  const files = [...list];
  const added: MediaItem[] = [];
  const wasEmpty = store.project.clips.length === 0;
  let recipe: { code: string; name: string } | null = null;
  for (const file of files) {
    store.status.engine = `Reading ${file.name}…`;
    try {
      const r = await readMedia(file, knownDuration);
      if (!r) {
        store.toast(`${file.name}: no video or sound found`, 'error');
        continue;
      }
      const m = r.m;
      store.edit((p) => p.media.push(m));
      added.push(m);
      if (r.recipe && !recipe && opts.recipes !== false) recipe = { code: r.recipe, name: file.name };
      prepareMedia(m);
    } catch (e) {
      console.error(e);
      store.toast(`Could not read ${file.name}: ${(e as Error).message}`, 'error', 6000);
    }
  }
  store.status.engine = '';
  // New projects: put everything straight on the timeline so there is something to see.
  if (place === 'auto' && wasEmpty && added.length) {
    for (const m of added) addToTimeline(m);
    // something to see straight away (a recipe found in the file is offered instead)
    if (!recipe) import('./starters.svelte').then((s) => s.firstMosh());
  }
  else if (place !== 'auto' && place !== 'none') {
    let p = place;
    for (const m of added) {
      addToTimeline(m, p);
      // keep several dropped files in order
      if ('index' in p) p = { ...p, index: p.index + 1 };
      else p = { ...p, start: p.start + clipLen(makeClip(m, p.track)) };
    }
  }
  if (recipe) offerRecipe(recipe.code, recipe.name);
  return added;
}

/** Put a media item on the timeline (default: end of the video track, sound-only files on a music track). */
export function addToTimeline(m: MediaItem, place: Place = 'auto') {
  // a compound can't be placed inside itself
  if (store.seqStack.some((s) => s.mediaId === m.id)) {
    store.toast("A compound clip can't go inside itself.", 'error');
    return;
  }
  // adjustment layers only work above the picture
  if (m.source.kind === 'adjust') return placeOnTop(m, typeof place === 'object' && 'start' in place && isOverlayTrack(place.track) ? place : undefined);
  let target = place;
  if (target === 'auto' || target === 'none') target = m.hasVideo ? { track: VIDEO_TRACK, index: Infinity } : { track: firstMusicTrack(), start: endOfTrack(store.project, firstMusicTrack()) };
  if (target.track === VIDEO_TRACK && !m.hasVideo) target = { track: firstMusicTrack(), start: 'index' in target ? videoTimeAtIndex(target.index) : 0 };
  // sound files can't go on a video track above the main one
  if ('start' in target && isOverlayTrack(target.track) && !m.hasVideo) target = { track: firstMusicTrack(), start: target.start };
  const tgt = target;
  const c = makeClip(m, tgt.track);
  if (m.source.kind === 'file' && m.source.isImage) c.out = 3;
  store.editTimeline((p) => {
    if ('index' in tgt) insertVideo(p, c, tgt.index);
    else {
      c.start = Math.max(0, tgt.start);
      if (!p.tracks.some((t) => t.id === c.track)) p.tracks.push({ id: c.track, kind: isVideoTrack(c.track) ? 'video' : 'audio', name: isVideoTrack(c.track) ? 'Video' : 'Audio', muted: false, solo: false, volume: 1, mosh: false });
      p.clips.push(c);
    }
  });
  store.selectClip(c.id);
  return c;
}

function firstMusicTrack(): string {
  return store.project.tracks.find((t) => t.kind === 'audio' && t.id !== 'a0')?.id ?? 'a1';
}

function videoTimeAtIndex(index: number): number {
  const vids = store.project.clips.filter((c) => c.track === VIDEO_TRACK);
  let t = 0;
  for (const c of vids.slice(0, index)) t += clipLen(c);
  return t;
}

export function endOfTrack(p: Project, track: string): number {
  return freeClips(p)
    .filter((c) => c.track === track)
    .reduce((e, c) => Math.max(e, c.start + clipLen(c)), 0);
}

export async function addGenerator(genId: string, seconds = 4, place: Place = 'auto') {
  const g = GENERATORS.find((x) => x.id === genId)!;
  const w = 640;
  const h = even(w / (16 / 9));
  store.status.engine = `Generating ${g.name}…`;
  try {
    const blob = await renderGenerator(g.id, seconds, w, h, 24);
    const file = new File([blob], `${g.name}.mp4`, { type: 'video/mp4' });
    return await addFiles([file], place === 'auto' ? { track: VIDEO_TRACK, index: Infinity } : place, seconds);
  } finally {
    store.status.engine = '';
  }
}

/** Two generated clips with a melt between them: something to look at in one click. */
export async function loadExample() {
  await addGenerator('testsrc2', 3);
  await addGenerator('mandelbrot', 4);
  const vids = store.project.clips.filter((c) => c.track === VIDEO_TRACK);
  if (vids.length >= 2) store.edit(() => (vids[vids.length - 1].transition = { type: 'melt', duration: 1, intensity: 0.5 }));
}

export { nearestCut, videoEnd };

// ---------------------------------------------------------------- background preparation

let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(job: () => Promise<T>): Promise<T> => {
  const p = chain.then(job, job);
  chain = p.catch(() => {});
  return p;
};

const pcm = new Map<string, Promise<Int16Array | null>>();

let h264: boolean | null = null;
/** Can this browser play H.264 video (preview copies fall back to VP8/WebM if not)? */
function canH264() {
  h264 ??= document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') !== '';
  return h264;
}

function canPlay(blob: Blob, audio: boolean): Promise<boolean> {
  return new Promise((res) => {
    const el = document.createElement(audio ? 'audio' : 'video');
    el.muted = true;
    el.preload = 'auto';
    const url = URL.createObjectURL(blob);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      res(ok);
    };
    const timer = setTimeout(() => done(false), 5000);
    el.onloadeddata = () => done(audio || (el as HTMLVideoElement).videoWidth > 0);
    el.onerror = () => done(false);
    el.src = url;
  });
}

/** Check playability, make a proxy if needed and decode the sound for waveforms. */
export async function prepareMedia(m: MediaItem) {
  if (m.source.kind !== 'file') return;
  const r = rt(m.id);
  const blob = await getFile(m.source.fileId);
  if (!blob) return;
  if (!r.peaks) {
    const saved = await kvGet<Uint8Array>('peaks:' + m.id);
    if (saved) r.peaks = saved;
  }
  if (m.source.isImage) {
    r.playable = true;
    return;
  }
  r.playable = await canPlay(blob, !m.hasVideo);
  if (m.hasVideo && r.proxy !== 'ready') {
    if (await getFile(proxyKey(m.id))) r.proxy = 'ready';
    else if (!r.playable || m.width > 960) {
      r.proxy = 'pending';
      queue(async () => {
        if (!store.project.media.some((x) => x.id === m.id)) return;
        r.proxy = 'working';
        try {
          const px = await makeProxy(m, blob, (p) => (r.progress = p), !canH264());
          await putFile(proxyKey(m.id), px.blob);
          r.proxyHw = px.hardware;
          r.proxy = 'ready';
        } catch (e) {
          console.warn('proxy failed', e);
          r.proxy = 'failed';
        }
      });
    }
  }
  if (m.hasAudio && !r.peaks) getPcm(m);
}

/** Decoded sound of a media item (for the edit preview), computing its waveform on the way. */
export function getPcm(m: MediaItem): Promise<Int16Array | null> {
  let p = pcm.get(m.id);
  if (p) return p;
  p = queue(async () => {
    if (m.source.kind !== 'file' || !m.hasAudio) return null;
    const blob = await getFile(m.source.fileId);
    if (!blob) return null;
    try {
      const data = await extractPcm(m, blob);
      const r = rt(m.id);
      if (!r.peaks) {
        r.peaks = peaksOf(data);
        kvSet('peaks:' + m.id, r.peaks);
      }
      return data;
    } catch (e) {
      console.warn('audio decode failed', e);
      return null;
    }
  });
  pcm.set(m.id, p);
  return p;
}

function peaksOf(data: Int16Array): Uint8Array {
  const per = Math.round(44100 / PEAKS_PER_SEC) * 2;
  const n = Math.ceil(data.length / per);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let mx = 0;
    const end = Math.min(data.length, (i + 1) * per);
    for (let k = i * per; k < end; k += 2) {
      const v = Math.abs(data[k]) + Math.abs(data[k + 1]);
      if (v > mx) mx = v;
    }
    out[i] = Math.min(255, Math.round(Math.sqrt(mx / 65536) * 255));
  }
  return out;
}

/** After loading a project: restore waveforms / proxies and redo any missing preparation. */
export function prepareAll(media: MediaItem[]) {
  for (const m of media) prepareMedia(m);
}

export function forgetMedia(id: string) {
  pcm.delete(id);
  delete mediaState[id];
}

/** A video exported from moshpit carries its recipe: offer to put that mosh on this timeline. */
async function offerRecipe(code: string, name: string) {
  if (!(await ask(`${name} was made in moshpit and carries its mosh recipe. Apply that recipe to your timeline? (Your current effects are kept in a snapshot.)`))) return;
  try {
    await takeSnapshot('Before recipe from ' + name, true);
    await applyShareCode(code);
    store.toast('Recipe applied.', 'ok');
  } catch {
    store.toast('The recipe in that file could not be read.', 'error');
  }
}

/** An adjustment layer (made once per project) placed on a track above, at the playhead. */
export function addAdjustmentLayer() {
  let m = store.project.media.find((x) => x.source.kind === 'adjust');
  if (!m) {
    m = { id: uid(), source: { kind: 'adjust', name: 'Adjustment layer' }, duration: 3600, width: 0, height: 0, fps: store.project.encoder.fps, hasAudio: false, hasVideo: true };
    const item = m;
    store.edit((p) => p.media.push(item));
  }
  return placeOnTop(m);
}
