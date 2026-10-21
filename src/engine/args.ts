// FFmpeg argument builders. Pure functions so they can be tested with native ffmpeg.
import { type ChromaKey, clipOn, gradeOf, isIdentityGrade, isIdentityTransform, transformOf, type Clip, type DecoderSettings, type EncoderSettings, type Grade, type MediaItem, type Project } from './types';
import { layerEnd, type Layer } from './layers';
import { blurRadius, canvasZoomKeys, cardRect, hasCanvas, hasChrome, type Canvas } from './canvas';
import { findRecipe } from './recipe';
import { FROM_BROWSER_JPEG, JPEG_FOR_BROWSER, RGBA_FROM_YUV, TAG_709, YUVA_FROM_RGBA, YUV_FROM_RGB, parseColour, passesAsIs, rgbaFrom, type MediaColour } from './colour';
import { hasKeys, keysExpr, rampSetpts, splitRamp, type Keys } from './keys';
import { lutFile } from './lut';
import { reframeFilter, type ReframePath } from './reframe';
import { linearExpr } from './track';
import { screenFilters } from './screen';
import { audioSources, clipLen, sourceTime, cutFrames, segments, transitionKeyTimes, xfadeOf, type Segment } from './timeline';

export const GENERATORS: { id: string; name: string; spec: (w: number, h: number, fps: number) => string }[] = [
  { id: 'mandelbrot', name: 'Mandelbrot zoom', spec: (w, h, r) => `mandelbrot=s=${w}x${h}:r=${r}` },
  { id: 'life', name: 'Game of Life', spec: (w, h, r) => `life=s=${w}x${h}:r=${r}:mold=10:ratio=0.1:death_color=#C83232:life_color=#00ff99,scale=${w}:${h}` },
  { id: 'testsrc2', name: 'Test pattern', spec: (w, h, r) => `testsrc2=s=${w}x${h}:r=${r}` },
  // the test pattern made taller and its top cut off: the same moving bars without the timecode
  { id: 'bars', name: 'Colour bars', spec: (w, h, r) => `testsrc2=s=${w}x${h + 48}:r=${r},crop=${w}:${h}:0:48` },
  { id: 'cellauto', name: 'Cellular automaton', spec: (w, h, r) => `cellauto=s=${w}x${h}:r=${r}:rule=110:scroll=1` },
  { id: 'gradients', name: 'Gradient swirl', spec: (w, h, r) => `gradients=s=${w}x${h}:r=${r}:speed=0.03:n=5` },
  { id: 'rgbtest', name: 'Plasma noise', spec: (w, h, r) => `cellauto=s=${w}x${h}:r=${r}:rule=30,hue=H=t*60:s=4,gblur=sigma=3,scale=${w}:${h}` },
];

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const ASPECTS: Record<string, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16, '4:5': 4 / 5, '21:9': 21 / 9 };

export function outputSize(project: Pick<Project, 'encoder' | 'clips' | 'media'>, width: number): { w: number; h: number } {
  const firstClip = project.clips.find((c) => c.track === 'v1');
  const first = (firstClip && project.media.find((m) => m.id === firstClip.mediaId)) || project.media.find((m) => m.hasVideo);
  const ar = project.encoder.aspect === 'auto' ? (first && first.height ? first.width / first.height : 16 / 9) : ASPECTS[project.encoder.aspect];
  const w = even(width);
  return { w, h: even(w / (ar || 16 / 9)) };
}

export type PathFn = (m: MediaItem) => string;

/**
 * A layer burned into the video before moshing, as transparent full-frame pictures: one PNG for
 * a layer that looks the same throughout (its fades are added here), or, for a layer that moves or
 * changes, one PNG per frame it's on screen (fades drawn in), one after another in a single file,
 * the first one at timeline frame `frames.first`.
 */
/**
 * Pictures for the canvas, drawn by the page (../lib/canvas): the backdrop with the card's shadow
 * (frame size), the card's shape as a white-on-black mask (card size; only with round corners)
 * and the border (frame size, transparent elsewhere).
 */
export interface CanvasPlates {
  bg: string;
  mask?: string;
  border?: string;
}

/** Grey pictures, one per timeline frame, of the subject cut out of the main track while a clip that goes behind it is on (for `alphamerge`). */
export interface ClipMatte {
  clipId: string;
  path: string;
  frames: { first: number; count: number };
}

/** The pictures for a clip's card and mask, mounted for the graph (see lib/clipplates.ts). */
export interface ClipPlates {
  clipId: string;
  /** the paper, shadow and caption (a picture the size of the frame) */
  back?: string;
  /** a grey picture (white where the picture shows), or `maskFrames` of them one after another */
  mask?: string;
  maskFrames?: number;
}

/** Inputs of a clip's plates in the graph (labels like "3:v"), and how many frames of a mask sequence to skip. */
interface PlateInputs {
  back?: string;
  mask?: string;
  skip?: number;
}

export interface LayerOverlay {
  layer: Layer;
  path: string;
  frames?: { first: number; count: number };
}

/** File name of a media item inside the ffmpeg file system. */
export const inputName = (m: Pick<MediaItem, 'id' | 'source'>) => (m.source.kind === 'file' ? `in_${m.id}.${m.source.ext}` : '');

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Input arguments for one clip, already cut to its in/out range (fast seek). */
export function clipInputArgs(c: Clip, m: MediaItem, fps: number, path: PathFn = inputName): string[] {
  const dur = r3(Math.max(0.04, c.out - c.in));
  if (m.source.kind === 'generator') {
    const g = GENERATORS.find((x) => x.id === (m.source as { generator: string }).generator) ?? GENERATORS[0];
    return ['-f', 'lavfi', '-t', String(r3(c.out)), '-i', g.spec(even(m.width), even(m.height), fps)];
  }
  if (m.source.kind === 'adjust') return ['-f', 'lavfi', '-t', String(dur), '-i', `color=c=black@0:s=16x16:r=${fps}`];
  if (m.source.isImage) return ['-loop', '1', '-framerate', String(fps), '-t', String(dur), '-i', path(m)];
  // a freeze frame only needs its first frame
  return ['-ss', String(r3(c.in)), '-t', String(c.freeze ? 0.5 : dur), '-i', path(m)];
}

/** The clip scaled into a w×h frame (letterbox bars are transparent on layers). */
function scaleChain(c: Clip, w: number, h: number, layer: boolean): string {
  if (c.fit === 'stretch') return `scale=${w}:${h}:flags=bicubic`;
  if (c.fit === 'fill') return `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2${layer ? ':color=black@0' : ''}`;
}

/**
 * Colour correction as a 1D curve (gamma, contrast, brightness) and a 3×3 RGB matrix
 * (saturation, hue). The live preview applies exactly the same maths.
 */
export function gradeMatrix(g: Grade): number[] {
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;
  const s = g.saturation;
  const S = [lr * (1 - s) + s, lg * (1 - s), lb * (1 - s), lr * (1 - s), lg * (1 - s) + s, lb * (1 - s), lr * (1 - s), lg * (1 - s), lb * (1 - s) + s];
  const a = (g.hue * Math.PI) / 180;
  const c = Math.cos(a);
  const n = Math.sin(a);
  // the hue rotation used by CSS / SVG filters
  const H = [
    0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
    0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.14, 0.072 - c * 0.072 - n * 0.283,
    0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072,
  ];
  const M: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M.push(H[i * 3] * S[j] + H[i * 3 + 1] * S[3 + j] + H[i * 3 + 2] * S[6 + j]);
  return M;
}

/** Brightness / contrast / gamma curve for an input level 0..1. */
export const gradeCurve = (g: Grade, v: number) => Math.max(0, Math.min(1, (Math.pow(v, 1 / g.gamma) - 0.5) * g.contrast + 0.5 + g.brightness));

function gradeFilters(g: Grade): string[] {
  if (isIdentityGrade(g)) return [];
  const f: string[] = [];
  if (g.brightness || g.contrast !== 1 || g.gamma !== 1) {
    const e = `clip(255*((pow(val/255\\,${r3(1 / g.gamma)})-0.5)*${r3(g.contrast)}+0.5+${r3(g.brightness)})\\,0\\,255)`;
    f.push(`lutrgb=r=${e}:g=${e}:b=${e}`);
  }
  if (g.saturation !== 1 || g.hue) {
    const m = gradeMatrix(g).map((x) => Math.round(x * 10000) / 10000);
    const k = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
    f.push('colorchannelmixer=' + k.map((n, i) => `${n}=${m[i]}`).join(':'));
  }
  // the LUT file is written next to the job with the amount baked in (see lutFile)
  if (g.lut && (g.lutAmount ?? 1) > 0) f.push(`lut3d=file=${lutFile(g.lut, g.lutAmount ?? 1)}:interp=tetrahedral`);
  return f;
}

/**
 * Stabilization: zoom in a little, then rotate and shift each frame by its correction (source
 * time `t + inPoint`), cropping back to the original size.
 */
function stabFilters(s: NonNullable<Clip['stab']>, inPoint: number): string[] {
  const t = `(t+${r3(inPoint)})`;
  const z = Math.max(1, Math.min(1.5, s.zoom));
  return [
    `scale=trunc(iw*${r3(z)}/2)*2:trunc(ih*${r3(z)}/2)*2`,
    `rotate=a='(${linearExpr(s.r, t)})*PI/180':c=black`,
    `crop=w='trunc(iw/${r3(z)}/2)*2':h='trunc(ih/${r3(z)}/2)*2':x='(iw-ow)/2-(${linearExpr(s.x, t)})*iw':y='(ih-oh)/2-(${linearExpr(s.y, t)})*ih'`,
  ];
}

/** Chroma key on an RGBA picture: the colour goes transparent, its spill is pulled from the edges. */
function keyFilters(k: ChromaKey): string[] {
  // luma key: brightness near black (or white) goes transparent
  if (k.luma) return ['format=yuva444p', `lumakey=threshold=${k.luma === 'light' ? 1 : 0}:tolerance=${r3(Math.max(0.01, k.similarity))}:softness=${r3(k.blend)}`, 'format=rgba'];
  const hex = k.color.replace('#', '').padEnd(6, '0').slice(0, 6);
  const f = [`colorkey=0x${hex}:${r3(Math.max(0.01, k.similarity))}:${r3(k.blend)}`];
  if (k.spill) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (g >= b && g >= r) f.push('despill=type=green');
    else if (b >= g && b >= r) f.push('despill=type=blue');
  }
  return f;
}

/**
 * Animated position / zoom / rotation on a w×h picture: FFmpeg's perspective filter, fed for
 * every frame the source point that lands on each corner. A 2px border of the background is
 * added first so whatever comes into view from outside the picture is background.
 */
function keyedTransform(keys: Keys, T: { zoom: number; x: number; y: number; rotate: number }, w: number, h: number, fps: number, offset: number, bg: string, sub = 1): string[] {
  const W = w + 4;
  const H = h + 4;
  // with `sub` pictures a frame (motion blur), picture k of frame i is at i - (sub-1-k)/(2 sub) frames: half a frame, ending on the frame
  const t = sub > 1 ? `((floor(in/${sub})+(mod(in,${sub})-${sub - 1})/${2 * sub})/${fps}+${r3(offset)})` : `(in/${fps}+${r3(offset)})`;
  const val = (k: 'zoom' | 'x' | 'y' | 'rotate', fallback: number) => (keys[k]?.length ? `(${keysExpr(keys[k]!, t)})` : `(${r3(fallback)})`);
  const z = `max(0.01,${val('zoom', T.zoom)})`;
  const dx = `${val('x', T.x)}*${w}`;
  const dy = `${val('y', T.y)}*${h}`;
  const a = `${val('rotate', T.rotate)}*PI/180`;
  const corner = (qx: number, qy: number): [string, string] => {
    const ux = `((${qx}-${W / 2}-${dx})/${z})`;
    const uy = `((${qy}-${H / 2}-${dy})/${z})`;
    return [`${W / 2}+cos(${a})*${ux}+sin(${a})*${uy}`, `${H / 2}-sin(${a})*${ux}+cos(${a})*${uy}`];
  };
  const c = [corner(0, 0), corner(W, 0), corner(0, H), corner(W, H)];
  // quoted, so the commas inside the expressions don't split the filter graph
  const opts = c.flatMap(([x, y], i) => [`x${i}='${x}'`, `y${i}='${y}'`]);
  return [`pad=${W}:${H}:2:2:color=${bg}`, `perspective=${opts.join(':')}:interpolation=linear:sense=source:eval=frame`, `crop=${w}:${h}:2:2`];
}

/** Transitions that are a fast pan: blurred sideways through the middle. */
const WHIPS = new Set(['whip', 'whipleft', 'whipright']);

/** Pictures a frame is averaged from for motion blur. */
const MB_SUB = 4;

/** A clip cut down to part of itself: local seconds a..b of it. */
export function windowClip(c: Clip, a: number, b: number): Clip {
  if (c.freeze) return { ...c, out: c.in + (b - a) };
  if (c.ramp?.length) {
    // the piece of the source under [a, b], with the matching piece of the ramp
    const len = clipLen(c);
    const x0 = Math.max(0, Math.min(1, a / len));
    const x1 = Math.max(x0 + 1e-6, Math.min(1, b / len));
    let ramp = c.ramp;
    if (x1 < 1) ramp = splitRamp(ramp, x1)[0];
    if (x0 > 0) ramp = splitRamp(ramp, x0 / x1)[1];
    const [s0, s1] = [sourceTime(c, a), sourceTime(c, b)];
    return { ...c, in: Math.min(s0, s1), out: Math.max(s0, s1), ramp };
  }
  if (c.reverse) return { ...c, in: c.out - b * c.speed, out: c.out - a * c.speed };
  return { ...c, in: c.in + a * c.speed, out: c.in + b * c.speed };
}

/**
 * Filter statements for one clip's picture: reads input `src` (null for a disabled clip) and
 * writes a w×h stream `out` exactly as long as the clip. Layers (upper tracks) are RGBA with
 * transparent surroundings; main-track clips are opaque. `offset`: the clip's own local time at
 * the start of this piece (layers are cut where main-track segments meet), for its fades.
 */
export function clipGraph(c: Clip, m: MediaItem, fps: number, w: number, h: number, src: string | null, out: string, tag: string, layer = false, offset = 0, fullLen = clipLen(c), plates?: PlateInputs): string[] {
  const len = r3(clipLen(c));
  if (!src) return [`color=c=black${layer ? '@0' : ''}:s=${w}x${h}:r=${fps}:d=${r3(len + 0.5)},format=${layer ? 'rgba' : 'yuv420p'},setsar=1,trim=duration=${len}[${out}]`];
  const T = transformOf(c);
  const G = gradeOf(c);
  const op = Math.max(0, Math.min(1, c.opacity ?? 1));
  // a picture put on a tracked surface is placed by the surface, not by its own position, zoom and turn
  const screen = layer && c.screen ? c.screen : null;
  // zoom / rotation keys need the full perspective transform; position alone moves with overlay
  // (motion blur needs the moves worked out between frames: position keys go that way too)
  const blur = !screen && !!c.motionBlur && hasKeys(c.keys, ['zoom', 'rotate', 'x', 'y']);
  const moving = !screen && (hasKeys(c.keys, ['zoom', 'rotate']) || blur);
  const sliding = !screen && !moving && hasKeys(c.keys, ['x', 'y']);
  const fading = hasKeys(c.keys, ['opacity']);
  const ramp = !c.freeze && c.ramp?.length ? c.ramp : null;
  // (footage in other colours than the pipeline's goes through RGB to be converted)
  const rgba = layer || (!screen && !isIdentityTransform(T)) || !isIdentityGrade(G) || moving || sliding || fading || !passesAsIs(m);
  const bg = layer ? 'black@0' : 'black';
  const f: string[] = [];
  if (m.source.kind === 'generator') f.push(`trim=start=${r3(c.in)}:end=${r3(Math.max(c.in + 0.04, c.out))}`);
  f.push('setpts=PTS-STARTPTS');
  // stabilization works in source time, so it comes before any speed change
  if (c.stab && !c.freeze) f.push(...stabFilters(c.stab, c.in));
  if (c.freeze) f.push('trim=end_frame=1', 'loop=loop=-1:size=1', `setpts=N/${fps}/TB`);
  else if (ramp) f.push(`setpts='${rampSetpts(ramp, c.out - c.in)}'`);
  else if (c.speed !== 1) f.push(`setpts=PTS/${r3(c.speed)}`);
  // step print: drop to a few pictures a second, each held until the next
  if (c.stepFps && c.stepFps < fps && !c.freeze) f.push(`fps=${c.stepFps}`);
  f.push(`fps=${fps}`);
  if (rgba) f.push(rgbaFrom(m));
  if (layer && c.key) f.push(...keyFilters(c.key));
  // grade the picture itself (not the letterbox bars added next)
  f.push(...gradeFilters(G));
  // (a picture for a surface fills the frame, whatever its shape: the surface's corners place it)
  f.push(scaleChain(screen ? { ...c, fit: 'stretch' } : c, w, h, layer), 'setsar=1');
  if (!rgba) f.push('format=yuv420p');
  // reverse buffers the whole clip in memory, so do it after scaling down
  if (c.reverse && !c.freeze) f.push('reverse', 'setpts=PTS-STARTPTS');
  f.push(`tpad=stop_mode=clone:stop_duration=${len}`, `trim=duration=${len}`);
  if (!screen && (T.cropL || T.cropR || T.cropT || T.cropB)) {
    const cx = Math.round(w * Math.min(0.99, T.cropL));
    const cy = Math.round(h * Math.min(0.99, T.cropT));
    const cw = Math.max(2, w - cx - Math.round(w * T.cropR));
    const ch = Math.max(2, h - cy - Math.round(h * T.cropB));
    f.push(`crop=${cw}:${ch}:${cx}:${cy}`, `pad=${w}:${h}:${cx}:${cy}:color=${bg}`);
  }
  const stmts: string[] = [];
  // a card and a mask: the picture is cut by the mask's grey picture and the paper put behind it, in
  // the picture's own space, so they zoom, move and turn with it
  if (plates && layer && src && (plates.back || plates.mask)) {
    stmts.push(`[${src}]${f.join(',')}[${tag}pic]`);
    f.length = 0;
    src = `${tag}pic`;
    if (plates.mask) {
      const skip = plates.skip ? `trim=start_frame=${plates.skip},setpts=PTS-STARTPTS,` : '';
      stmts.push(`[${plates.mask}]${skip}format=gray,scale=${w}:${h}[${tag}mk]`);
      stmts.push(`[${src}]format=rgba[${tag}pa]`);
      stmts.push(`[${tag}pa][${tag}mk]alphamerge[${tag}pm]`);
      src = `${tag}pm`;
    }
    if (plates.back) {
      stmts.push(`[${plates.back}]format=rgba,scale=${w}:${h}[${tag}bk]`);
      stmts.push(`[${tag}bk][${src}]overlay=0:0:format=auto:shortest=1[${tag}pc]`);
      src = `${tag}pc`;
    }
  }
  /** the filters so far, as a chain (`null` when there are none: a stream passed on as it is) */
  const chain = () => (f.length ? f.join(',') : 'null');
  if (T.flipH && !screen) f.push('hflip');
  if (T.flipV && !screen) f.push('vflip');
  let cur = `${tag}p`;
  if (screen) {
    f.push(...screenFilters(screen, w, h, fps, offset, bg));
    stmts.push(`[${src}]${chain()}[${cur}]`);
  } else if (moving && blur) {
    // the move at MB_SUB moments across half a frame, averaged (a 180° shutter)
    f.push(`fps=${fps * MB_SUB}`, ...keyedTransform(c.keys!, T, w, h, fps, offset, bg, MB_SUB), `format=${layer ? 'gbrap' : 'gbrp'}`, `tmix=frames=${MB_SUB}`, `select='eq(mod(n,${MB_SUB}),${MB_SUB - 1})'`, `setpts=N/${fps}/TB`, `fps=${fps}`, 'format=rgba');
    stmts.push(`[${src}]${chain()}[${cur}]`);
  } else if (moving) {
    f.push(...keyedTransform(c.keys!, T, w, h, fps, offset, bg));
    stmts.push(`[${src}]${chain()}[${cur}]`);
  } else if (T.zoom !== 1 || T.x || T.y || T.rotate || sliding) {
    f.push(`scale=${even(w * T.zoom)}:${even(h * T.zoom)}:flags=bicubic`);
    if (T.rotate) {
      const a = r3((T.rotate * Math.PI) / 180);
      f.push(`rotate=${a}:ow=rotw(${a}):oh=roth(${a}):c=${bg}`);
    }
    stmts.push(`[${src}]${chain()}[${tag}fg]`);
    stmts.push(`color=c=${bg}:s=${w}x${h}:r=${fps},format=rgba[${tag}bg]`);
    const tt = `(t+${r3(offset)})`;
    const ox = c.keys?.x?.length ? `(${keysExpr(c.keys.x, tt)})*${w}` : `${r3(T.x * w)}`;
    const oy = c.keys?.y?.length ? `(${keysExpr(c.keys.y, tt)})*${h}` : `${r3(T.y * h)}`;
    stmts.push(`[${tag}bg][${tag}fg]overlay=x='(W-w)/2+${ox}':y='(H-h)/2+${oy}':shortest=1:format=auto,setsar=1[${cur}]`);
  } else stmts.push(`[${src}]${chain()}[${cur}]`);
  const g: string[] = [];
  if (fading) {
    const e = `clip(${keysExpr(c.keys!.opacity!, `(T+${r3(offset)})`)},0,1)`;
    g.push(layer ? `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${e}'` : `geq=r='r(X,Y)*${e}':g='g(X,Y)*${e}':b='b(X,Y)*${e}':a='alpha(X,Y)'`);
  } else if (op < 1) g.push(layer ? `colorchannelmixer=aa=${r3(op)}` : `colorchannelmixer=rr=${r3(op)}:gg=${r3(op)}:bb=${r3(op)}`);
  const alpha = layer ? ':alpha=1' : '';
  const fi = Math.min(c.vfadeIn ?? 0, fullLen / 2);
  const fo = Math.min(c.vfadeOut ?? 0, fullLen / 2);
  if (fi > 0.01 && offset < fi) g.push(`fade=t=in:st=0:d=${r3(fi - offset)}${alpha}`);
  const foSt = fullLen - fo - offset;
  if (fo > 0.01 && foSt < len) g.push(`fade=t=out:st=${r3(Math.max(0, foSt))}:d=${r3(Math.min(fo, len - Math.max(0, foSt)))}${alpha}`);
  if (rgba && !layer) g.push(YUV_FROM_RGB);
  stmts.push(`[${cur}]${g.length ? g.join(',') : 'null'}[${out}]`);
  return stmts;
}

/** Blend modes for upper-track clips: ffmpeg blend mode and the colour that leaves the picture below unchanged. */
const BLEND: Record<string, { mode: string; neutral: string }> = {
  screen: { mode: 'screen', neutral: 'black' },
  add: { mode: 'addition', neutral: 'black' },
  multiply: { mode: 'multiply', neutral: 'white' },
  difference: { mode: 'difference', neutral: 'black' },
  // (where the clip isn't, the colour that leaves the picture below as it is)
  overlay: { mode: 'overlay', neutral: 'gray' },
  softlight: { mode: 'softlight', neutral: 'gray' },
  hardlight: { mode: 'hardlight', neutral: 'gray' },
  lighten: { mode: 'lighten', neutral: 'black' },
  darken: { mode: 'darken', neutral: 'white' },
  dodge: { mode: 'dodge', neutral: 'black' },
  burn: { mode: 'burn', neutral: 'white' },
  exclusion: { mode: 'exclusion', neutral: 'black' },
};

/**
 * Filter graph for one segment. Clips inside a segment are joined by blend transitions (xfade)
 * or plain concatenation, then clips on upper video tracks are composited on top. Returns the
 * inputs it needs and its output label.
 */
function segmentGraph(seg: Segment, fps: number, w: number, h: number, first: number, tag: string, path: PathFn, overlays: LayerOverlay[] = [], canvas?: { c: Canvas; plates: CanvasPlates }, clipMattes: ClipMatte[] = [], clipPlates: ClipPlates[] = []): { inputs: string[]; filter: string[]; label: string; count: number } {
  const n = seg.f1 - seg.f0;
  const label = `seg${tag}`;
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const dur = r3(n / fps);
  const shown = overlays.filter((o) => o.layer.start < t1 && layerEnd(o.layer) > t0);
  const inputs: string[] = [];
  const filter: string[] = [];
  let count = 0;
  const input = (args: string[]) => {
    inputs.push(...args);
    return `${first + count++}:v`;
  };
  // ---- the main track
  let acc = `${tag}base`;
  const vis = seg.hideBase ? [] : seg.clips;
  if (!vis.length) {
    filter.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${r3(n / fps + 1)},format=yuv420p,setsar=1,trim=end_frame=${n},setpts=PTS-STARTPTS[${acc}]`);
  } else {
    vis.forEach((pl, k) => {
      const on = clipOn(pl.clip);
      const src = on ? input(clipInputArgs(pl.clip, pl.media, fps, path)) : null;
      filter.push(...clipGraph(pl.clip, pl.media, fps, w, h, src, `${tag}c${k}`, `${tag}m${k}`));
    });
    let cur = `${tag}c0`;
    vis.slice(1).forEach((pl, i) => {
      const k = i + 1;
      const o = `${tag}x${k}`;
      if (pl.overlap > 0) {
        const type = pl.clip.transition!.type;
        const tr = xfadeOf(type, vis[k - 1].clip, pl.clip);
        const at = pl.start - seg.start;
        if (WHIPS.has(type)) {
          // a whip pan smears sideways through its middle (blurred only for those frames)
          const a = r3(at + pl.overlap * 0.15);
          const b = r3(at + pl.overlap * 0.85);
          filter.push(`[${cur}][${tag}c${k}]xfade=transition=${tr}:duration=${r3(pl.overlap)}:offset=${r3(at)},split[${o}a][${o}b]`);
          filter.push(`[${o}b]trim=start=${a}:end=${b},gblur=sigma=${r3(Math.max(2, w * 0.02))}:sigmaV=0.01[${o}c]`);
          filter.push(`[${o}a][${o}c]overlay=0:0:eof_action=pass:format=auto[${o}]`);
        } else filter.push(`[${cur}][${tag}c${k}]xfade=transition=${tr}:duration=${r3(pl.overlap)}:offset=${r3(at)}[${o}]`);
      } else filter.push(`[${cur}][${tag}c${k}]concat=n=2:v=1:a=0[${o}]`);
      cur = o;
    });
    filter.push(`[${cur}]tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${n},setpts=PTS-STARTPTS[${acc}]`);
  }
  // ---- upper video tracks
  // a clip that goes behind the subject: the subject is cut out of a copy of the main track and put back over the clip
  const behindClips = seg.hideBase ? [] : seg.layers.filter((l) => l.clip.depth === 'behind' && l.media.source.kind !== 'adjust' && clipMattes.some((m) => m.clipId === l.clip.id) && Math.min(l.end, t1) - Math.max(l.start, t0) >= 0.5 / fps);
  const baseCopies = new Map<string, string>();
  if (behindClips.length) {
    const main = `${tag}basem`;
    behindClips.forEach((l, j) => baseCopies.set(l.clip.id, `${tag}bc${j}`));
    filter.push(`[${acc}]split=${behindClips.length + 1}[${main}]${behindClips.map((_, j) => `[${tag}bc${j}]`).join('')}`);
    acc = main;
  }
  seg.layers.forEach((l, k) => {
    const a = Math.max(l.start, t0);
    const b = Math.min(l.end, t1);
    if (b - a < 0.5 / fps) return;
    const lay = `${tag}l${k}`;
    if (l.media.source.kind === 'adjust') {
      // an adjustment layer re-grades everything below it while it's on screen
      const next = `${tag}y${k}`;
      const G = gradeOf(l.clip);
      const ga = r3(a - t0);
      const gb = r3(b - t0);
      const op = Math.max(0, Math.min(1, l.clip.opacity ?? 1));
      const fx = [RGBA_FROM_YUV, ...gradeFilters(G)];
      if (op < 1) fx.push(`colorchannelmixer=aa=${r3(op)}`);
      const len = clipLen(l.clip);
      const fi = Math.min(l.clip.vfadeIn ?? 0, len / 2);
      const fo = Math.min(l.clip.vfadeOut ?? 0, len / 2);
      if (fi > 0.01) fx.push(`fade=t=in:st=${r3(l.start - t0)}:d=${r3(fi)}:alpha=1`);
      if (fo > 0.01) fx.push(`fade=t=out:st=${r3(l.start + len - fo - t0)}:d=${r3(fo)}:alpha=1`);
      fx.push(YUVA_FROM_RGBA);
      filter.push(`[${acc}]split[${lay}a][${lay}b]`);
      filter.push(`[${lay}b]${fx.join(',')}[${lay}c]`);
      filter.push(`[${lay}a][${lay}c]overlay=0:0:enable='between(t,${ga},${gb})':format=auto,format=yuv420p[${next}]`);
      acc = next;
      return;
    }
    const sub = windowClip(l.clip, a - l.start, b - l.start);
    const src = input(clipInputArgs(sub, l.media, fps, path));
    // the clip's card and mask pictures, if it has them
    const cp = clipPlates.find((p) => p.clipId === l.clip.id);
    let pin: PlateInputs | undefined;
    if (cp) {
      const len = r3(b - a + 1);
      pin = {};
      if (cp.back) pin.back = input(['-loop', '1', '-framerate', String(fps), '-t', String(len), '-i', cp.back]);
      if (cp.mask && cp.maskFrames) {
        pin.mask = input(['-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', cp.mask]);
        // a piece of the clip that starts part-way in starts part-way through the mask's pictures
        pin.skip = Math.round((a - l.start) * fps);
      } else if (cp.mask) pin.mask = input(['-loop', '1', '-framerate', String(fps), '-t', String(len), '-i', cp.mask]);
    }
    filter.push(...clipGraph(sub, l.media, fps, w, h, src, `${lay}r`, `${tag}L${k}`, true, a - l.start, clipLen(l.clip), pin));
    const at = r3(a - t0);
    filter.push(`[${lay}r]setpts=PTS+${at}/TB[${lay}]`);
    const next = `${tag}y${k}`;
    const bm = BLEND[l.clip.blend ?? 'normal'];
    if (!bm) {
      filter.push(`[${lay}]${YUVA_FROM_RGBA}[${lay}v]`);
      filter.push(`[${acc}][${lay}v]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[${next}]`);
    }
    else {
      filter.push(`color=c=${bm.neutral}:s=${w}x${h}:r=${fps}:d=${dur},format=rgba[${lay}n]`);
      filter.push(`[${lay}n][${lay}]overlay=0:0:eof_action=pass:format=auto,format=gbrp[${lay}f]`);
      filter.push(`[${acc}]${RGBA_FROM_YUV.replace('rgba', 'gbrp')}[${lay}b]`);
      filter.push(`[${lay}b][${lay}f]blend=all_mode=${bm.mode}:shortest=1,${YUV_FROM_RGB}[${next}]`);
    }
    acc = next;
    // behind the subject: the main track's subject (a copy cut by the matte pictures) goes back on top
    const copy = baseCopies.get(l.clip.id);
    const cm = clipMattes.find((m) => m.clipId === l.clip.id);
    if (copy && cm) {
      const idx = first + count++;
      const skip = Math.max(0, seg.f0 - cm.frames.first);
      const delay = r3(Math.max(0, cm.frames.first - seg.f0) / fps);
      inputs.push('-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', cm.path);
      const pad = delay > 0 ? `,tpad=start_duration=${delay}:color=black` : '';
      filter.push(`[${idx}:v]trim=start_frame=${skip},setpts=PTS-STARTPTS,format=gray,scale=${w}:${h}${pad}[${lay}mt]`);
      filter.push(`[${copy}]format=yuva420p[${lay}by]`);
      filter.push(`[${lay}by][${lay}mt]alphamerge[${lay}sj]`);
      const over = `${tag}z${k}`;
      filter.push(`[${acc}][${lay}sj]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[${over}]`);
      acc = over;
    }
  });
  // ---- the canvas: the picture as a card on a backdrop
  if (canvas && hasCanvas(canvas.c)) {
    const { c, plates } = canvas;
    const R = cardRect(c, w, h);
    const still = (file: string) => {
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(r3(dur + 1)), '-i', file);
      return `${first + count++}:v`;
    };
    let pic = acc;
    let back = `${tag}cvk`;
    if (c.bg === 'blur') {
      filter.push(`[${acc}]split[${tag}cva][${tag}cvb]`);
      pic = `${tag}cva`;
      filter.push(`[${tag}cvb]boxblur=${Math.min(blurRadius(c, h), Math.floor(Math.min(w, h) / 2) - 1)}:2[${back}]`);
    } else filter.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${r3(dur + 1)},format=yuv420p[${back}]`);
    filter.push(`[${still(plates.bg)}]format=rgba,${YUVA_FROM_RGBA}[${tag}cvp]`);
    filter.push(`[${back}][${tag}cvp]overlay=0:0:shortest=1:format=auto[${tag}cvg]`);
    filter.push(`[${pic}]crop=${R.crop.w}:${R.crop.h}:${R.crop.x}:${R.crop.y},scale=${R.w}:${R.h},setsar=1[${tag}cvi]`);
    let card = `${tag}cvi`;
    if (R.r > 0 && plates.mask) {
      filter.push(`[${still(plates.mask)}]format=gray,scale=${R.w}:${R.h}[${tag}cvm]`);
      filter.push(`[${card}]format=yuva420p[${tag}cvj]`);
      filter.push(`[${tag}cvj][${tag}cvm]alphamerge[${tag}cvr]`);
      card = `${tag}cvr`;
    }
    filter.push(`[${tag}cvg][${card}]overlay=${R.x}:${R.y}:format=auto,format=yuv420p[${tag}cvc]`);
    acc = `${tag}cvc`;
    if (hasChrome(c) && plates.border) {
      filter.push(`[${still(plates.border)}]format=rgba,${YUVA_FROM_RGBA}[${tag}cvo]`);
      filter.push(`[${acc}][${tag}cvo]overlay=0:0:shortest=1:format=auto,format=yuv420p[${tag}cvd]`);
      acc = `${tag}cvd`;
    }
  }
  // ---- a camera move into the card (zooming towards the screen)
  if (canvas && hasCanvas(canvas.c) && canvas.c.zoomIn) {
    const keys = canvasZoomKeys(canvas.c, w, h, fps, t0, t1);
    if (keys) {
      const next = `${tag}cz`;
      filter.push(`[${acc}]${keyedTransform(keys, { zoom: 1, x: 0, y: 0, rotate: 0 }, w, h, fps, 0, 'black').join(',')},format=yuv420p[${next}]`);
      acc = next;
    }
  }
  // ---- layers that melt, in drawing order
  shown.forEach((o, k) => {
    const idx = first + count++;
    const l = o.layer;
    const a = r3(Math.max(0, l.start - t0));
    const b = r3(Math.min(t1, layerEnd(l)) - t0);
    const next = `${tag}o${k}`;
    if (o.frames) {
      // the pictures from this segment's first frame on, placed where they start in it
      const skip = Math.max(0, seg.f0 - o.frames.first);
      const delay = r3(Math.max(0, o.frames.first - seg.f0) / fps);
      inputs.push('-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', o.path);
      const pad = delay > 0 ? `,tpad=start_duration=${delay}:color=black@0` : '';
      filter.push(`[${idx}:v]trim=start_frame=${skip},setpts=PTS-STARTPTS,format=rgba,scale=${w}:${h}${pad},${YUVA_FROM_RGBA}[${tag}t${k}]`);
      filter.push(`[${acc}][${tag}t${k}]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[${next}]`);
    } else {
      const f = Math.min(l.fade, l.duration / 2);
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(r3(t1 - t0 + 1)), '-i', o.path);
      // fades that started in an earlier segment can't be expressed (negative start): skip them
      const fi = r3(l.start - t0);
      const fo = r3(layerEnd(l) - f - t0);
      const fades = f > 0.01 ? (fi >= 0 ? `,fade=t=in:st=${fi}:d=${r3(f)}:alpha=1` : '') + (fo >= 0 ? `,fade=t=out:st=${fo}:d=${r3(f)}:alpha=1` : '') : '';
      filter.push(`[${idx}:v]format=rgba,scale=${w}:${h}${fades},${YUVA_FROM_RGBA}[${tag}t${k}]`);
      filter.push(`[${acc}][${tag}t${k}]overlay=0:0:enable='between(t,${a},${b})':format=auto:shortest=1,format=yuv420p[${next}]`);
    }
    acc = next;
  });
  filter.push(`[${acc}]trim=end_frame=${n},setpts=PTS-STARTPTS[${label}]`);
  return { inputs, filter, label, count };
}

export function encoderArgs(enc: EncoderSettings, keyTimes: number[]): string[] {
  const a: string[] = [];
  if (enc.codec === 'h264') {
    // H.264 for moshing: Baseline (CAVLC, so damaged bytes don't derail a whole slice), one
    // reference frame and no B-frames (motion only ever points back at the frame before), the same
    // quantiser throughout, and parameter sets before every keyframe (dropping one leaves the
    // stream readable)
    const qp = Math.round(10 + ((enc.quality - 1) * 41) / 30);
    a.push('-c:v', 'libx264', '-vtag', 'H264', '-profile:v', 'baseline', '-preset', 'veryfast', '-refs', '1', '-bf', '0', '-qp', String(qp));
    // one slice per frame, so each frame has one header (see renumberH264)
    a.push('-x264-params', `keyint=${Math.max(1, enc.gop)}:min-keyint=1:scenecut=${enc.sceneCut ? 40 : 0}:repeat-headers=1:sliced-threads=0:slices=1`);
    a.push('-pix_fmt', 'yuv420p');
    const kt = keyTimes.filter((t) => t > 0.001);
    if (kt.length) a.push('-force_key_frames', kt.map((t) => r3(Math.max(0.001, t - 0.5 / enc.fps))).join(','));
    return a;
  }
  if (enc.codec === 'mpeg4') {
    a.push('-c:v', 'mpeg4', '-vtag', 'XVID');
    a.push('-motion_est', enc.motionEst);
    const flags = [enc.mv4 ? '+mv4' : '', enc.qpel ? '+qpel' : ''].join('');
    if (flags) a.push('-flags', flags);
  } else {
    a.push('-c:v', enc.codec === 'mpeg2' ? 'mpeg2video' : 'mpeg1video');
    a.push('-motion_est', enc.motionEst);
    // allow non-standard frame rates (8/12/15 fps) for MPEG-1/2
    a.push('-strict', '-1');
  }
  a.push('-q:v', String(enc.quality), '-qmin', String(enc.quality), '-qmax', String(enc.quality));
  a.push('-g', String(Math.max(1, enc.gop)), '-bf', String(enc.bframes));
  if (enc.meRange > 0) a.push('-me_range', String(enc.meRange));
  a.push('-mbd', enc.mbd, '-cmp', enc.cmp, '-subcmp', enc.cmp);
  if (enc.trellis) a.push('-trellis', '1');
  a.push('-sc_threshold', enc.sceneCut ? '0' : '1000000000');
  const kt = keyTimes.filter((t) => t > 0.001);
  // half a frame early: ffmpeg keys the first frame at or after each time, and rounding to
  // milliseconds could otherwise push the key to the next frame
  if (kt.length) a.push('-force_key_frames', kt.map((t) => r3(Math.max(0.001, t - 0.5 / enc.fps))).join(','));
  return a;
}

/** Keyframe times (s) on the whole timeline: clip cuts (optional), mosh transitions and user markers. */
export function keyTimes(project: Project): number[] {
  const fps = project.encoder.fps;
  const t: number[] = [...transitionKeyTimes(project)];
  if (project.encoder.keyAtCuts) for (const s of segments(project, fps)) t.push(s.f0 / fps);
  if (project.encoder.keyAtCuts) t.push(...cutFrames(project, fps).map((f) => f / fps));
  for (const m of project.encoder.keyMarkers) t.push(m / fps);
  return [...new Set(t.map(r3))].filter((x) => x > 0).sort((a, b) => a - b);
}

/** Prepare the whole timeline in a single pass (used when cuts must not get keyframes). */
export function prepArgs(project: Project, width: number, out = 'prep.avi', path: PathFn = inputName, overlays: LayerOverlay[] = [], plates?: CanvasPlates, clipMattes: ClipMatte[] = [], clipPlates: ClipPlates[] = []): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  const segs = segments(project, fps);
  const inputs: string[] = [];
  const filter: string[] = [];
  const labels: string[] = [];
  let next = 0;
  segs.forEach((s, i) => {
    const g = segmentGraph(s, fps, w, h, next, `s${i}`, path, overlays, canvasOf(project, plates), clipMattes, clipPlates);
    next += g.count;
    inputs.push(...g.inputs);
    filter.push(...g.filter);
    labels.push(g.label);
  });
  filter.push(labels.length > 1 ? `${labels.map((l) => `[${l}]`).join('')}concat=n=${labels.length}:v=1:a=0[vout]` : `[${labels[0]}]null[vout]`);
  return [...inputs, '-filter_complex', filter.join(';'), '-map', '[vout]', '-an', ...encoderArgs(project.encoder, keyTimes(project)), '-f', 'avi', out];
}

const canvasOf = (p: Project, plates?: CanvasPlates) => (plates && hasCanvas(p.canvas) ? { c: p.canvas, plates } : undefined);

/** Prepare one segment on its own (starts with a keyframe). Keyframe times are relative to it. */
export function segmentArgs(project: Project, seg: Segment, width: number, out: string, path: PathFn = inputName, overlays: LayerOverlay[] = [], plates?: CanvasPlates, clipMattes: ClipMatte[] = [], clipPlates: ClipPlates[] = []): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  const g = segmentGraph(seg, fps, w, h, 0, 'a', path, overlays, canvasOf(project, plates), clipMattes, clipPlates);
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const keys = keyTimes(project)
    .filter((t) => t > t0 + 0.001 && t < t1 - 0.001)
    .map((t) => t - t0);
  return [...g.inputs, '-filter_complex', g.filter.join(';'), '-map', `[${g.label}]`, '-an', '-frames:v', String(seg.f1 - seg.f0), ...encoderArgs(project.encoder, keys), '-f', 'avi', out];
}

/** Stable identity of a segment's prepared output (for caching). */
export function segmentKey(project: Project, seg: Segment, width: number, path: PathFn = inputName): string {
  const fps = project.encoder.fps;
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const { previewWidth: _p, width: _w, keyMarkers: _k, ...enc } = project.encoder;
  return JSON.stringify({
    // (pieces prepared before colours were kept BT.709 throughout are made again)
    cm: 709,
    enc,
    size: outputSize(project, width),
    n: seg.f1 - seg.f0,
    keys: keyTimes(project).filter((t) => t > t0 + 0.001 && t < t1 - 0.001).map((t) => r3(t - t0)),
    texts: (project.layers ?? []).filter((t) => t.moshed && t.start < t1 && t.start + t.duration > t0),
    clips: seg.clips.map((pl) => ({ m: path(pl.media) || JSON.stringify(pl.media.source), w: pl.media.width, h: pl.media.height, co: pl.media.color, i: pl.clip.in, o: pl.clip.out, s: pl.clip.speed, r: pl.clip.reverse, f: pl.clip.fit, ov: r3(pl.overlap), st: r3(pl.start - seg.start), t: pl.overlap > 0 ? pl.clip.transition?.type : '', ...clipLook(pl.clip) })),
    layers: seg.layers.map((l) => ({ m: path(l.media) || JSON.stringify(l.media.source), w: l.media.width, h: l.media.height, co: l.media.color, i: l.clip.in, o: l.clip.out, s: l.clip.speed, r: l.clip.reverse, f: l.clip.fit, st: r3(l.start - t0), tr: l.track, ...clipLook(l.clip) })),
    hb: seg.hideBase,
    // (layers behind the subject are cut by the mattes: a new matte draws them again)
    mt: project.layers.some((l) => l.moshed && l.depth && l.depth !== 'front') || project.clips.some((c) => c.depth === 'behind') ? project.media.flatMap((m) => (m.mattes ?? []).map((x) => `${x.id}@${x.version}`)) : undefined,
    cv: hasCanvas(project.canvas) ? project.canvas : undefined,
  });
}

/** Everything about a clip's picture besides its timing. */
function clipLook(c: Clip) {
  // everything clipGraph draws from, so a change re-prepares the segment
  return { e: clipOn(c), fz: !!c.freeze, op: c.opacity ?? 1, bl: c.blend ?? 'normal', tf: transformOf(c), gr: gradeOf(c), vi: c.vfadeIn ?? 0, vo: c.vfadeOut ?? 0, k: c.keys, ra: c.ramp, ck: c.key, sb: c.stab, sp: c.stepFps, sc: c.screen, dp: c.depth, cd: c.card, mk: c.mask, mb: c.motionBlur };
}

/**
 * Decoding a moshed stream makes the decoder report an error for nearly every macroblock.
 * Keep the log quiet (only fatal errors) and report progress via -progress instead.
 */
export const QUIET = ['-loglevel', 'fatal', '-progress', 'pipe:1', '-stats_period', '0.5'];

export function decoderInputArgs(d: DecoderSettings): string[] {
  const a: string[] = [...QUIET];
  const ec = [d.guessMvs && 'guess_mvs', d.deblock && 'deblock', d.favorInter && 'favor_inter'].filter(Boolean).join('+');
  a.push('-ec', ec || '0');
  if (d.ignoreErrors) a.push('-err_detect', 'ignore_err');
  if (d.showAll) a.push('-flags2', '+showall');
  return a;
}

/** Decode a (moshed) AVI to a stream of JPEGs for frame-accurate preview. */
export function decodeToMjpegArgs(d: DecoderSettings, input: string, out: string, quality = 5, scaleW?: number): string[] {
  return [
    ...decoderInputArgs(d),
    '-i', input,
    '-fps_mode', 'passthrough',
    '-vf', scaleW ? `scale=${even(scaleW)}:-2:${JPEG_FOR_BROWSER}` : `scale=${JPEG_FOR_BROWSER}`,
    '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-q:v', String(quality),
    '-f', 'image2pipe', out,
  ];
}

function tempo(speed: number): string[] {
  const f: string[] = [];
  // a speed of 0 (or less, or NaN) would never reach the 0.5..2 range atempo takes
  if (!(speed > 0) || !isFinite(speed)) return f;
  let s = speed;
  while (s > 2) (f.push('atempo=2'), (s /= 2));
  while (s < 0.5) (f.push('atempo=0.5'), (s /= 0.5));
  if (Math.abs(s - 1) > 1e-4) f.push(`atempo=${r3(s)}`);
  return f;
}

export interface AudioMix {
  args: string[];
  /** output files that were produced, by bus */
  outputs: { mosh?: string; clean?: string };
}

/**
 * Mix every audible clip into two raw s16le stereo 44.1 kHz buses: sound that follows the mosh
 * and sound that stays clean. Both are exactly `total` seconds long.
 */
export function audioMixArgs(project: Project, total: number, path: PathFn = inputName, names = { mosh: 'mosh.raw', clean: 'clean.raw' }): AudioMix | null {
  const fps = project.encoder.fps;
  const srcs = audioSources(project).filter((s) => s.start < total);
  if (!srcs.length || total <= 0) return null;
  const inputs: string[] = [];
  const filter: string[] = [];
  const buses: Record<'mosh' | 'clean', string[]> = { mosh: [], clean: [] };
  srcs.forEach((s, i) => {
    inputs.push(...clipInputArgs(s.clip, s.media, fps, path));
    const len = r3(Math.min(s.len, total - s.start));
    const f: string[] = ['asetpts=PTS-STARTPTS'];
    if (s.clip.reverse) f.push('areverse');
    // a ramped clip's sound is stretched in time with the picture (samples dropped or repeated)
    if (!s.clip.freeze && s.clip.ramp?.length) f.push(`asetpts='${rampSetpts(s.clip.ramp, s.clip.out - s.clip.in)}'`, 'aresample=async=1000:first_pts=0');
    else f.push(...tempo(s.clip.speed));
    f.push('aresample=44100', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'apad', `atrim=end=${len}`);
    if (Math.abs(s.gain - 1) > 1e-4) f.push(`volume=${r3(s.gain)}`);
    const fi = Math.min(s.fadeIn, len / 2);
    const fo = Math.min(s.fadeOut, len / 2);
    if (fi > 0.005) f.push(`afade=t=in:st=0:d=${r3(fi)}`);
    if (fo > 0.005) f.push(`afade=t=out:st=${r3(len - fo)}:d=${r3(fo)}`);
    const ms = Math.round(s.start * 1000);
    if (ms > 0) f.push(`adelay=delays=${ms}:all=1`);
    filter.push(`[${i}:a]${f.join(',')}[s${i}]`);
    buses[s.bus].push(`[s${i}]`);
  });
  const maps: string[] = [];
  const outputs: AudioMix['outputs'] = {};
  for (const bus of ['mosh', 'clean'] as const) {
    const ins = buses[bus];
    if (!ins.length) continue;
    const mix = ins.length > 1 ? `${ins.join('')}amix=inputs=${ins.length}:duration=longest:dropout_transition=0:normalize=0,` : `${ins[0]}`;
    filter.push(`${mix}${ins.length > 1 ? '' : 'anull,'}apad,atrim=end=${r3(total)},aformat=sample_fmts=s16:channel_layouts=stereo[${bus}]`);
    maps.push('-map', `[${bus}]`, '-f', 's16le', '-ar', '44100', '-ac', '2', names[bus]);
    outputs[bus] = names[bus];
  }
  return { args: [...inputs, '-filter_complex', filter.join(';'), ...maps], outputs };
}

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'avi' | 'png';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  /** scale algorithm when resizing the output */
  scaler: 'bicubic' | 'neighbor' | 'lanczos';
  crf: number;
  preset: 'ultrafast' | 'veryfast' | 'medium' | 'slow';
  gifColors: number;
  gifDither: 'bayer' | 'floyd_steinberg' | 'sierra2_4a' | 'none';
  gifFps: number;
  loop: boolean;
  audio: boolean;
  /** only this part of the timeline (seconds), e.g. the In–Out range */
  range?: [number, number] | null;
  /** written into the file's metadata (the mosh recipe, so the video can be remixed) */
  comment?: string;
  /** keep the file under this size (MB): the encoder targets a bitrate instead of a quality */
  maxMB?: number;
  /** worked out from maxMB and the length when exporting (kbit/s) */
  videoKbps?: number;
  /** export in another shape than the project: the crop follows the action */
  reframeTo?: string;
  /** worked out when exporting: the crop path, and where this piece starts (s) */
  reframe?: ReframePath;
  timeOffset?: number;
  /** seamless loop: the end crossfades or melts into the start */
  loopMode?: 'off' | 'crossfade' | 'melt';
  /** how long the loop seam lasts (s) */
  loopSeconds?: number;
  /** worked out when exporting: frames in the video and frames overlapped */
  crossfade?: { frames: number; overlap: number };
  /** MP4 / WebM: encode with the browser's own (hardware) encoder where it can, see webcodecs.ts */
  hardware?: boolean;
  /** mosh at the output size instead of scaling the mosh up to it (sharpest, slower) */
  moshAtSize?: boolean;
  /** MP4 / WebM frame rate when it isn't the project's: higher ones are made by blending neighbouring frames */
  fps?: number;
}

/** The filter that changes a video's frame rate from `from` to `to`: in-between frames blended, or frames dropped. */
export function rateFilter(from: number, to?: number): string {
  if (!to || to === from) return '';
  return to > from ? `framerate=fps=${to}` : `fps=${to}`;
}

/**
 * The mosh resolution (width) that makes a video `outW` wide without scaling: the output width
 * itself, or more when a reframe to `dstAr` crops the sides off a `srcAr` frame.
 */
export function moshWidthFor(outW: number, srcAr: number, dstAr?: number): number {
  return even(dstAr && dstAr < srcAr - 0.01 ? (outW * srcAr) / dstAr : outW);
}

/**
 * ffmpeg's log cuts long metadata short, so a recipe seen in the log is read in full by
 * writing the file's metadata out with these arguments.
 */
export const metadataArgs = (input: string, out: string) => ['-i', input, '-f', 'ffmetadata', out];

/** ffmpeg arguments that store `comment` in the output's metadata. */
export const commentArgs = (comment?: string) => (comment ? ['-metadata', `comment=${comment}`] : []);

export const defaultExport = (): ExportOptions => ({
  format: 'mp4',
  width: 0,
  scaler: 'bicubic',
  crf: 18,
  preset: 'veryfast',
  gifColors: 128,
  gifDither: 'bayer',
  gifFps: 15,
  loop: true,
  audio: true,
  hardware: true,
});

/**
 * Final encode. `videoIn` is either the moshed AVI (decoder args applied) or an MJPEG
 * stream of post-processed frames.
 */
export function exportArgs(o: ExportOptions, d: DecoderSettings, fps: number, videoIn: { file: string; mjpeg: boolean }, audioWav: string | null, out: string): string[] {
  const a: string[] = [];
  if (videoIn.mjpeg) a.push('-framerate', String(fps), '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', videoIn.file);
  else a.push(...decoderInputArgs(d), '-i', videoIn.file);
  const withAudio = !!audioWav && o.audio && o.format !== 'gif';
  if (withAudio) a.push('-i', audioWav!);
  const scale = o.width > 0 ? `scale=${even(o.width)}:-2:flags=${o.scaler}` : '';
  // the browser's JPEGs (picture effects) are BT.601, full range: back to the pipeline's colours
  const colour = videoIn.mjpeg ? (scale ? `${scale}:${FROM_BROWSER_JPEG}` : `scale=${FROM_BROWSER_JPEG}`) : scale;
  // auto-reframe crop (its clock continues across chunks), then the output size
  const crop = o.reframe ? reframeFilter(o.reframe, o.timeOffset ?? 0) : '';
  const xf = o.crossfade && o.crossfade.overlap > 0 && o.crossfade.frames > o.crossfade.overlap * 2 ? o.crossfade : null;
  if (o.format === 'gif') {
    const pre = [crop, `fps=${o.gifFps}`, scale].filter(Boolean).join(',');
    const dither = o.gifDither === 'bayer' ? 'dither=bayer:bayer_scale=3' : `dither=${o.gifDither}`;
    const src = xf ? `${loopFilter('[0:v]', xf.frames, xf.overlap, fps, '[lv]')};[lv]` : '[0:v]';
    a.push('-filter_complex', `${src}${pre},split[a][b];[a]palettegen=max_colors=${o.gifColors}:stats_mode=diff[p];[b][p]paletteuse=${dither}`);
    a.push('-loop', o.loop ? '0' : '-1', out);
    return a;
  }
  if (o.format === 'png') {
    const vf = [crop, scale].filter(Boolean).join(',');
    if (vf) a.push('-vf', vf);
    a.push('-fps_mode', 'passthrough', '-f', 'image2', out);
    return a;
  }
  const rate = o.format === 'mp4' || o.format === 'webm' ? rateFilter(fps, o.fps) : '';
  const chain = [crop, colour, 'format=yuv420p', rate].filter(Boolean).join(',');
  if (xf) {
    // the end crossfades into the start, so the file loops without a jump
    const g = [`${loopFilter('[0:v]', xf.frames, xf.overlap, fps, '[lv]')}`, `[lv]${chain}[v]`];
    if (withAudio) g.push(loopAudioFilter('[1:a]', xf.frames / fps, xf.overlap / fps, '[aout]'));
    a.push('-filter_complex', g.join(';'), '-map', '[v]');
    if (withAudio) a.push('-map', '[aout]');
  } else {
    a.push('-map', '0:v');
    if (withAudio) a.push('-map', '1:a');
    a.push('-vf', chain);
  }
  a.push('-r', String(rate ? o.fps : fps));
  a.push(...encodeArgs(o, withAudio));
  if (withAudio) a.push('-shortest');
  a.push(...commentArgs(o.comment), out);
  return a;
}

/** Codec arguments of an MP4 / WebM export. */
export function encodeArgs(o: ExportOptions, withAudio: boolean): string[] {
  const a: string[] = [];
  const sized = o.videoKbps && o.videoKbps > 0 ? ['-b:v', `${o.videoKbps}k`, '-maxrate', `${Math.round(o.videoKbps * 1.1)}k`, '-bufsize', `${o.videoKbps * 2}k`] : null;
  const abr = sized ? '128k' : '192k';
  if (o.format === 'mp4') {
    a.push('-c:v', 'libx264', '-preset', o.preset, ...(sized ?? ['-crf', String(o.crf)]), ...TAG_709, '-movflags', '+faststart');
    if (withAudio) a.push('-c:a', 'aac', '-b:a', abr);
  } else if (sized) {
    a.push('-c:v', 'libvpx', ...sized, ...TAG_709, '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0');
    if (withAudio) a.push('-c:a', 'libvorbis', '-b:a', abr);
  } else {
    // VP8: the VP9 encoder in ffmpeg.wasm crashes, VP8 is solid
    a.push('-c:v', 'libvpx', '-crf', String(Math.min(63, Math.max(4, o.crf - 4))), '-b:v', '12M', ...TAG_709, '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0');
    if (withAudio) a.push('-c:a', 'libvorbis', '-q:a', '6');
  }
  return a;
}

/**
 * Crossfade loop: the first `overlap` frames are taken off the start and faded in over the last
 * `overlap` frames, so the video ends on exactly the picture it starts after.
 */
export function loopFilter(input: string, frames: number, overlap: number, fps: number, out: string): string {
  const d = r3(overlap / fps);
  const off = r3((frames - 2 * overlap) / fps);
  return `${input}split[lpa][lpb];[lpa]trim=start_frame=${overlap},setpts=PTS-STARTPTS[lpbody];[lpb]trim=end_frame=${overlap},setpts=PTS-STARTPTS[lphead];[lpbody][lphead]xfade=transition=fade:duration=${d}:offset=${off}${out}`;
}

/**
 * The sound of a crossfade loop (`total` seconds long, `seconds` of overlap). Built from afade +
 * adelay + amix rather than acrossfade: acrossfade fed from asplit outputs nothing in FFmpeg 6.1
 * and older (ffmpeg.wasm included).
 */
export function loopAudioFilter(input: string, total: number, seconds: number, out: string): string {
  const d = r3(seconds);
  const st = r3(Math.max(0, total - 2 * seconds));
  return `${input}asplit[lqa][lqb];[lqa]atrim=start=${d},asetpts=PTS-STARTPTS,afade=t=out:st=${st}:d=${d}[lqbody];[lqb]atrim=end=${d},asetpts=PTS-STARTPTS,afade=t=in:d=${d},adelay=${Math.round(st * 1000)}:all=1[lqhead];[lqbody][lqhead]amix=inputs=2:normalize=0:duration=first${out}`;
}

/** A finished (joined) MP4 / WebM made into a crossfade loop: one more encode. */
export function loopPassArgs(o: ExportOptions, input: string, frames: number, overlap: number, fps: number, withAudio: boolean, out: string): string[] {
  const g = [loopFilter('[0:v]', frames, overlap, fps, '[v]')];
  if (withAudio) g.push(loopAudioFilter('[0:a]', frames / fps, overlap / fps, '[aout]'));
  return ['-i', input, '-filter_complex', g.join(';'), '-map', '[v]', ...(withAudio ? ['-map', '[aout]'] : []), '-r', String(fps), '-pix_fmt', 'yuv420p', ...encodeArgs(o, withAudio), ...commentArgs(o.comment), out];
}

/** Parse "ffmpeg -i" log output into basic media info. */
export function parseProbe(log: string): { duration: number; width: number; height: number; fps: number; hasAudio: boolean; hasVideo: boolean; recipe: string | null; color?: MediaColour } {
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const duration = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const vid = /Stream #.*Video: .*?(\d{2,5})x(\d{2,5})/.exec(log);
  const fpsM = /Stream #.*Video: .*?([\d.]+) (?:fps|tbr)/.exec(log);
  // phones store upright video as landscape + a rotation flag; ffmpeg rotates it when decoding
  const rot = /displaymatrix: rotation of (-?[\d.]+)/.exec(log) ?? /\brotate\s*:\s*(-?\d+)/.exec(log);
  const quarter = rot ? Math.round(Math.abs(+rot[1]) / 90) % 2 === 1 : false;
  const w = vid ? +vid[1] : 0;
  const h = vid ? +vid[2] : 0;
  return {
    duration,
    width: quarter ? h : w,
    height: quarter ? w : h,
    fps: fpsM ? +fpsM[1] : 30,
    hasAudio: /Stream #.*Audio:/.test(log),
    hasVideo: !!vid,
    recipe: findRecipe(log),
    color: vid ? parseColour(log) : undefined,
  };
}

/** Generation loss: decode a moshed AVI and encode it again (settings `enc`) for another pass. */
export function regenArgs(project: Pick<Project, 'decoder' | 'encoder' | 'clips' | 'media' | 'layers'>, enc: EncoderSettings, input: string, out: string): string[] {
  return [...decoderInputArgs(project.decoder), '-i', input, '-an', '-pix_fmt', 'yuv420p', ...encoderArgs(enc, keyTimes(project as Project)), '-f', 'avi', out];
}

/** Settings for generation g (2, 3…): quality crushed a little more each time. */
export const generationEncoder = (enc: EncoderSettings, g: number): EncoderSettings => ({ ...enc, quality: Math.min(31, enc.quality + (g - 1) * (enc.genCrush ?? 2)) });

/** Filter options whose graph can come from a file instead: [option, its FFmpeg 6 script form]. */
const GRAPH_OPTIONS: Record<string, string> = { '-filter_complex': '-filter_complex_script', '-lavfi': '-filter_complex_script', '-vf': '-filter_script:v', '-filter:v': '-filter_script:v', '-af': '-filter_script:a', '-filter:a': '-filter_script:a' };

/**
 * The arguments with every filter graph longer than `limit` characters moved into a file (named in
 * `files`, to be written next to the job). A native FFmpeg is started with its arguments on a
 * command line, which Windows caps at 32 767 characters and Linux at 128 KB per argument; keyframed
 * clips make graphs bigger than that. FFmpeg 7 and later read any option from a file with `-/option`;
 * older ones have the `-filter_script` options.
 */
export function graphsToFiles(args: string[], ffmpegMajor: number, limit = 4000): { args: string[]; files: [string, string][] } {
  const out: string[] = [];
  const files: [string, string][] = [];
  for (let i = 0; i < args.length; i++) {
    const opt = args[i];
    const val = args[i + 1];
    if (GRAPH_OPTIONS[opt] && val !== undefined && val.length > limit) {
      const name = `graph${files.length}.txt`;
      files.push([name, val]);
      out.push(ffmpegMajor >= 7 ? '-/' + opt.slice(1) : GRAPH_OPTIONS[opt], name);
      i++;
    } else out.push(opt);
  }
  return { args: out, files };
}

/** The major version in FFmpeg's first `-version` line ("ffmpeg version 8.0 …", "n7.1", "6.1.1-3ubuntu5"); 0 when unknown (a git build). */
export function ffmpegMajor(versionLine: string): number {
  const m = /version\s+n?(\d+)\./.exec(versionLine);
  return m ? +m[1] : 0;
}
