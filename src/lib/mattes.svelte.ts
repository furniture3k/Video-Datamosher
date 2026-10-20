// Mattes in use: the frames of a matte loaded from storage once and kept, and the picture a layer
// is cut by (alpha = the subject) for the footage that is on screen at a moment.
import { getFile } from './storage';
import { layers, layoutVideo, sourceTime } from '../engine/timeline';
import { matteAt, matteKey, unpackMatte, type MatteRef } from '../engine/matte';
import type { MatteSource } from './layers';
import type { Project } from '../engine/types';

/** Bumped when a matte finishes loading, so a picture drawn without it is drawn again. */
export const matteState = $state({ version: 0 });

const frames = new Map<string, Uint8Array[]>();
const loading = new Map<string, Promise<void>>();
/** mattes whose file isn't in storage (not asked for again on every frame) */
const missing = new Set<string>();
const keyOf = (m: Pick<MatteRef, 'id' | 'version'>) => `${m.id}@${m.version}`;

/** Load a matte's frames (once) into memory. */
export function loadMatte(m: MatteRef): Promise<void> {
  const k = keyOf(m);
  if (frames.has(k)) return Promise.resolve();
  let p = loading.get(k);
  if (!p) {
    p = (async () => {
      const blob = await getFile(m.fileId || matteKey(m.id));
      if (!blob) return void missing.add(k);
      const f = await unpackMatte(new Uint8Array(await blob.arrayBuffer()), m.w, m.h);
      frames.set(k, f);
      // frames of older versions of it are no use now
      for (const key of frames.keys()) if (key.startsWith(m.id + '@') && key !== k) frames.delete(key);
      matteState.version++;
    })().finally(() => loading.delete(k));
    loading.set(k, p);
  }
  return p;
}

/** Put frames straight into memory (what a cut-out has just made, so it shows before it is read back). */
export function cacheMatte(m: MatteRef, f: Uint8Array[]) {
  for (const key of frames.keys()) if (key.startsWith(m.id + '@')) frames.delete(key);
  missing.delete(keyOf(m));
  frames.set(keyOf(m), f);
  matteState.version++;
}

/** The frames of a matte if they are in memory; otherwise they are loaded in the background. */
export function matteFramesNow(m: MatteRef): Uint8Array[] | null {
  const f = frames.get(keyOf(m));
  if (!f && !missing.has(keyOf(m))) void loadMatte(m).catch(() => {});
  return f ?? null;
}

/** Every matte of a project in memory (before a render draws with them). */
export async function ensureMattes(p: Pick<Project, 'media'>) {
  await Promise.all(p.media.flatMap((m) => (m.mattes ?? []).map((x) => loadMatte(x).catch(() => {}))));
}

/** Forget what is in memory (a matte was deleted, or the project changed). */
export function forgetMattes() {
  frames.clear();
  missing.clear();
  alpha = null;
}

/** the last matte picture made, and the matte frame it was made from (the same frame isn't made again) */
let alpha: { c: HTMLCanvasElement; w: number; h: number; from: Uint8Array | null } | null = null;
let small: HTMLCanvasElement | null = null;

/** A matte frame as a picture the size of the output frame whose opacity is the matte (so it can cut a layer out). */
export function matteAlpha(f: Uint8Array, mw: number, mh: number, W: number, H: number): HTMLCanvasElement {
  if (alpha && alpha.from === f && alpha.w === W && alpha.h === H) return alpha.c;
  small ??= document.createElement('canvas');
  if (small.width !== mw || small.height !== mh) {
    small.width = mw;
    small.height = mh;
  }
  const sg = small.getContext('2d')!;
  const id = sg.createImageData(mw, mh);
  for (let i = 0; i < f.length; i++) id.data[i * 4 + 3] = f[i];
  sg.putImageData(id, 0, 0);
  if (!alpha || alpha.w !== W || alpha.h !== H) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    alpha = { c, w: W, h: H, from: null };
  }
  alpha.from = f;
  const g = alpha.c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // a little soft, so the edge of a layer cut by it is not blocky
  g.filter = `blur(${Math.max(0.6, (W / mw) * 0.35)}px)`;
  g.drawImage(small, 0, 0, W, H);
  g.filter = 'none';
  return alpha.c;
}

/**
 * The matte of the footage on screen at timeline time t: the top clip that has one covering that
 * moment (`only: 'main'`: just the main track's, the footage a clip can go behind). Null when there
 * is none, or its frames are still loading (they are asked for).
 */
export function matteSourceFor(p: Pick<Project, 'clips' | 'media' | 'tracks'>, only: 'all' | 'main' = 'all'): MatteSource {
  return (t, W, H) => {
    void matteState.version;
    // top first: clips on tracks above, then the main track
    const on: { clip: (typeof p.clips)[number]; media: Project['media'][number]; start: number }[] = [];
    if (only === 'all') for (const l of [...layers(p)].reverse()) if (t >= l.start - 1e-6 && t < l.end) on.push({ clip: l.clip, media: l.media, start: l.start });
    for (const pl of layoutVideo(p)) if (t >= pl.start - 1e-6 && t < pl.end) on.push({ clip: pl.clip, media: pl.media, start: pl.start });
    for (const { clip, media, start } of on) {
      for (const m of media.mattes ?? []) {
        const f = matteFramesNow(m);
        if (!f) continue;
        const a = matteAt(m, f, sourceTime(clip, Math.max(0, t - start)));
        if (a) return matteAlpha(a, m.w, m.h, W, H);
      }
    }
    return null;
  };
}

/** Does any footage in the project have a matte (so a layer can go behind a subject)? */
export const hasMattes = (p: Pick<Project, 'media'>) => p.media.some((m) => (m.mattes ?? []).length > 0);

let greyC: HTMLCanvasElement | null = null;
let whiteC: HTMLCanvasElement | null = null;

/**
 * The matte at timeline time t as a grey picture the size of the frame (white = the subject, black
 * = not), for things that read maps. Null when there is no matte. The picture is reused: use it at once.
 */
export function matteGrey(source: MatteSource, t: number, w: number, h: number): HTMLCanvasElement | null {
  const m = source(t, w, h);
  if (!m) return null;
  greyC ??= document.createElement('canvas');
  whiteC ??= document.createElement('canvas');
  for (const c of [greyC, whiteC]) if (c.width !== w || c.height !== h) ((c.width = w), (c.height = h));
  const wg = whiteC.getContext('2d')!;
  wg.globalCompositeOperation = 'source-over';
  wg.fillStyle = '#fff';
  wg.fillRect(0, 0, w, h);
  wg.globalCompositeOperation = 'destination-in';
  wg.drawImage(m, 0, 0, w, h);
  const g = greyC.getContext('2d')!;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.drawImage(whiteC, 0, 0);
  return greyC;
}
