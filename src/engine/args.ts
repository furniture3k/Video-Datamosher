// FFmpeg argument builders. Pure functions so they can be tested with native ffmpeg.
import { type ChromaKey, clipOn, gradeOf, isIdentityGrade, isIdentityTransform, transformOf, type Clip, type DecoderSettings, type EncoderSettings, type Grade, type MediaItem, type Project, type TextClip } from './types';
import { findRecipe } from './recipe';
import { hasKeys, keysExpr, rampSetpts, type Keys } from './keys';
import { lutFile } from './lut';
import { BLEND_TRANSITIONS, audioSources, clipLen, cutFrames, segments, transitionKeyTimes, type Segment } from './timeline';

export const GENERATORS: { id: string; name: string; spec: (w: number, h: number, fps: number) => string }[] = [
  { id: 'mandelbrot', name: 'Mandelbrot zoom', spec: (w, h, r) => `mandelbrot=s=${w}x${h}:r=${r}` },
  { id: 'life', name: 'Game of Life', spec: (w, h, r) => `life=s=${w}x${h}:r=${r}:mold=10:ratio=0.1:death_color=#C83232:life_color=#00ff99,scale=${w}:${h}` },
  { id: 'testsrc2', name: 'Test pattern', spec: (w, h, r) => `testsrc2=s=${w}x${h}:r=${r}` },
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

/** A title burned into the video before moshing: a transparent PNG of the text, full frame. */
export interface TextOverlay {
  tx: TextClip;
  path: string;
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

/** Chroma key on an RGBA picture: the colour goes transparent, its spill is pulled from the edges. */
function keyFilters(k: ChromaKey): string[] {
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
function keyedTransform(keys: Keys, T: { zoom: number; x: number; y: number; rotate: number }, w: number, h: number, fps: number, offset: number, bg: string): string[] {
  const W = w + 4;
  const H = h + 4;
  const t = `(in/${fps}+${r3(offset)})`;
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

/** A clip cut down to part of itself: local seconds a..b of it. */
export function windowClip(c: Clip, a: number, b: number): Clip {
  if (c.freeze) return { ...c, out: c.in + (b - a) };
  if (c.reverse) return { ...c, in: c.out - b * c.speed, out: c.out - a * c.speed };
  return { ...c, in: c.in + a * c.speed, out: c.in + b * c.speed };
}

/**
 * Filter statements for one clip's picture: reads input `src` (null for a disabled clip) and
 * writes a w×h stream `out` exactly as long as the clip. Layers (upper tracks) are RGBA with
 * transparent surroundings; main-track clips are opaque. `offset`: the clip's own local time at
 * the start of this piece (layers are cut where main-track segments meet), for its fades.
 */
export function clipGraph(c: Clip, m: MediaItem, fps: number, w: number, h: number, src: string | null, out: string, tag: string, layer = false, offset = 0, fullLen = clipLen(c)): string[] {
  const len = r3(clipLen(c));
  if (!src) return [`color=c=black${layer ? '@0' : ''}:s=${w}x${h}:r=${fps}:d=${r3(len + 0.5)},format=${layer ? 'rgba' : 'yuv420p'},setsar=1,trim=duration=${len}[${out}]`];
  const T = transformOf(c);
  const G = gradeOf(c);
  const op = Math.max(0, Math.min(1, c.opacity ?? 1));
  const moving = hasKeys(c.keys, ['x', 'y', 'zoom', 'rotate']);
  const fading = hasKeys(c.keys, ['opacity']);
  const ramp = !c.freeze && c.ramp?.length ? c.ramp : null;
  const rgba = layer || !isIdentityTransform(T) || !isIdentityGrade(G) || moving || fading;
  const bg = layer ? 'black@0' : 'black';
  const f: string[] = [];
  if (m.source.kind === 'generator') f.push(`trim=start=${r3(c.in)}:end=${r3(Math.max(c.in + 0.04, c.out))}`);
  f.push('setpts=PTS-STARTPTS');
  if (c.freeze) f.push('trim=end_frame=1', 'loop=loop=-1:size=1', `setpts=N/${fps}/TB`);
  else if (ramp) f.push(`setpts='${rampSetpts(ramp, c.out - c.in)}'`);
  else if (c.speed !== 1) f.push(`setpts=PTS/${r3(c.speed)}`);
  f.push(`fps=${fps}`);
  if (rgba) f.push('format=rgba');
  if (layer && c.key) f.push(...keyFilters(c.key));
  // grade the picture itself (not the letterbox bars added next)
  f.push(...gradeFilters(G));
  f.push(scaleChain(c, w, h, layer), 'setsar=1');
  if (!rgba) f.push('format=yuv420p');
  // reverse buffers the whole clip in memory, so do it after scaling down
  if (c.reverse && !c.freeze) f.push('reverse', 'setpts=PTS-STARTPTS');
  f.push(`tpad=stop_mode=clone:stop_duration=${len}`, `trim=duration=${len}`);
  if (T.cropL || T.cropR || T.cropT || T.cropB) {
    const cx = Math.round(w * Math.min(0.99, T.cropL));
    const cy = Math.round(h * Math.min(0.99, T.cropT));
    const cw = Math.max(2, w - cx - Math.round(w * T.cropR));
    const ch = Math.max(2, h - cy - Math.round(h * T.cropB));
    f.push(`crop=${cw}:${ch}:${cx}:${cy}`, `pad=${w}:${h}:${cx}:${cy}:color=${bg}`);
  }
  if (T.flipH) f.push('hflip');
  if (T.flipV) f.push('vflip');
  const stmts: string[] = [];
  let cur = `${tag}p`;
  if (moving) {
    f.push(...keyedTransform(c.keys!, T, w, h, fps, offset, bg));
    stmts.push(`[${src}]${f.join(',')}[${cur}]`);
  } else if (T.zoom !== 1 || T.x || T.y || T.rotate) {
    f.push(`scale=${even(w * T.zoom)}:${even(h * T.zoom)}:flags=bicubic`);
    if (T.rotate) {
      const a = r3((T.rotate * Math.PI) / 180);
      f.push(`rotate=${a}:ow=rotw(${a}):oh=roth(${a}):c=${bg}`);
    }
    stmts.push(`[${src}]${f.join(',')}[${tag}fg]`);
    stmts.push(`color=c=${bg}:s=${w}x${h}:r=${fps},format=rgba[${tag}bg]`);
    stmts.push(`[${tag}bg][${tag}fg]overlay=x=(W-w)/2+${r3(T.x * w)}:y=(H-h)/2+${r3(T.y * h)}:shortest=1:format=auto,setsar=1[${cur}]`);
  } else stmts.push(`[${src}]${f.join(',')}[${cur}]`);
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
  if (rgba && !layer) g.push('format=yuv420p');
  stmts.push(`[${cur}]${g.length ? g.join(',') : 'null'}[${out}]`);
  return stmts;
}

/** Blend modes for upper-track clips: ffmpeg blend mode and the colour that leaves the picture below unchanged. */
const BLEND: Record<string, { mode: string; neutral: string }> = {
  screen: { mode: 'screen', neutral: 'black' },
  add: { mode: 'addition', neutral: 'black' },
  multiply: { mode: 'multiply', neutral: 'white' },
  difference: { mode: 'difference', neutral: 'black' },
};

/**
 * Filter graph for one segment. Clips inside a segment are joined by blend transitions (xfade)
 * or plain concatenation, then clips on upper video tracks are composited on top. Returns the
 * inputs it needs and its output label.
 */
function segmentGraph(seg: Segment, fps: number, w: number, h: number, first: number, tag: string, path: PathFn, overlays: TextOverlay[] = []): { inputs: string[]; filter: string[]; label: string; count: number } {
  const n = seg.f1 - seg.f0;
  const label = `seg${tag}`;
  const t0 = seg.f0 / fps;
  const t1 = seg.f1 / fps;
  const dur = r3(n / fps);
  const texts = overlays.filter((o) => o.tx.start < t1 && o.tx.start + o.tx.duration > t0);
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
        const tr = BLEND_TRANSITIONS[pl.clip.transition!.type]?.xfade ?? 'fade';
        filter.push(`[${cur}][${tag}c${k}]xfade=transition=${tr}:duration=${r3(pl.overlap)}:offset=${r3(pl.start - seg.start)}[${o}]`);
      } else filter.push(`[${cur}][${tag}c${k}]concat=n=2:v=1:a=0[${o}]`);
      cur = o;
    });
    filter.push(`[${cur}]tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${n},setpts=PTS-STARTPTS[${acc}]`);
  }
  // ---- upper video tracks
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
      const fx = ['format=rgba', ...gradeFilters(G)];
      if (op < 1) fx.push(`colorchannelmixer=aa=${r3(op)}`);
      const len = clipLen(l.clip);
      const fi = Math.min(l.clip.vfadeIn ?? 0, len / 2);
      const fo = Math.min(l.clip.vfadeOut ?? 0, len / 2);
      if (fi > 0.01) fx.push(`fade=t=in:st=${r3(l.start - t0)}:d=${r3(fi)}:alpha=1`);
      if (fo > 0.01) fx.push(`fade=t=out:st=${r3(l.start + len - fo - t0)}:d=${r3(fo)}:alpha=1`);
      filter.push(`[${acc}]split[${lay}a][${lay}b]`);
      filter.push(`[${lay}b]${fx.join(',')}[${lay}c]`);
      filter.push(`[${lay}a][${lay}c]overlay=0:0:enable='between(t,${ga},${gb})':format=auto,format=yuv420p[${next}]`);
      acc = next;
      return;
    }
    const sub = windowClip(l.clip, a - l.start, b - l.start);
    const src = input(clipInputArgs(sub, l.media, fps, path));
    filter.push(...clipGraph(sub, l.media, fps, w, h, src, `${lay}r`, `${tag}L${k}`, true, a - l.start, clipLen(l.clip)));
    const at = r3(a - t0);
    filter.push(`[${lay}r]setpts=PTS+${at}/TB[${lay}]`);
    const next = `${tag}y${k}`;
    const bm = BLEND[l.clip.blend ?? 'normal'];
    if (!bm) filter.push(`[${acc}][${lay}]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[${next}]`);
    else {
      filter.push(`color=c=${bm.neutral}:s=${w}x${h}:r=${fps}:d=${dur},format=rgba[${lay}n]`);
      filter.push(`[${lay}n][${lay}]overlay=0:0:eof_action=pass:format=auto,format=gbrp[${lay}f]`);
      filter.push(`[${acc}]format=gbrp[${lay}b]`);
      filter.push(`[${lay}b][${lay}f]blend=all_mode=${bm.mode}:shortest=1,format=yuv420p[${next}]`);
    }
    acc = next;
  });
  // ---- titles that melt
  texts.forEach((o, k) => {
    const idx = first + count++;
    const a = r3(Math.max(0, o.tx.start - t0));
    const b = r3(Math.min(t1, o.tx.start + o.tx.duration) - t0);
    const f = Math.min(o.tx.fade, o.tx.duration / 2);
    inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(r3(t1 - t0 + 1)), '-i', o.path);
    // fades that started in an earlier segment can't be expressed (negative start): skip them
    const fi = r3(o.tx.start - t0);
    const fo = r3(o.tx.start + o.tx.duration - f - t0);
    const fades = f > 0.01 ? (fi >= 0 ? `,fade=t=in:st=${fi}:d=${r3(f)}:alpha=1` : '') + (fo >= 0 ? `,fade=t=out:st=${fo}:d=${r3(f)}:alpha=1` : '') : '';
    filter.push(`[${idx}:v]format=rgba,scale=${w}:${h}${fades}[${tag}t${k}]`);
    const next = `${tag}o${k}`;
    filter.push(`[${acc}][${tag}t${k}]overlay=0:0:enable='between(t,${a},${b})':format=auto:shortest=1,format=yuv420p[${next}]`);
    acc = next;
  });
  filter.push(`[${acc}]trim=end_frame=${n},setpts=PTS-STARTPTS[${label}]`);
  return { inputs, filter, label, count };
}

export function encoderArgs(enc: EncoderSettings, keyTimes: number[]): string[] {
  const a: string[] = [];
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
export function prepArgs(project: Project, width: number, out = 'prep.avi', path: PathFn = inputName, overlays: TextOverlay[] = []): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  const segs = segments(project, fps);
  const inputs: string[] = [];
  const filter: string[] = [];
  const labels: string[] = [];
  let next = 0;
  segs.forEach((s, i) => {
    const g = segmentGraph(s, fps, w, h, next, `s${i}`, path, overlays);
    next += g.count;
    inputs.push(...g.inputs);
    filter.push(...g.filter);
    labels.push(g.label);
  });
  filter.push(labels.length > 1 ? `${labels.map((l) => `[${l}]`).join('')}concat=n=${labels.length}:v=1:a=0[vout]` : `[${labels[0]}]null[vout]`);
  return [...inputs, '-filter_complex', filter.join(';'), '-map', '[vout]', '-an', ...encoderArgs(project.encoder, keyTimes(project)), '-f', 'avi', out];
}

/** Prepare one segment on its own (starts with a keyframe). Keyframe times are relative to it. */
export function segmentArgs(project: Project, seg: Segment, width: number, out: string, path: PathFn = inputName, overlays: TextOverlay[] = []): string[] {
  const { w, h } = outputSize(project, width);
  const fps = project.encoder.fps;
  const g = segmentGraph(seg, fps, w, h, 0, 'a', path, overlays);
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
    enc,
    size: outputSize(project, width),
    n: seg.f1 - seg.f0,
    keys: keyTimes(project).filter((t) => t > t0 + 0.001 && t < t1 - 0.001).map((t) => r3(t - t0)),
    texts: (project.texts ?? []).filter((t) => t.moshed && t.start < t1 && t.start + t.duration > t0),
    clips: seg.clips.map((pl) => ({ m: path(pl.media) || JSON.stringify(pl.media.source), w: pl.media.width, h: pl.media.height, i: pl.clip.in, o: pl.clip.out, s: pl.clip.speed, r: pl.clip.reverse, f: pl.clip.fit, ov: r3(pl.overlap), st: r3(pl.start - seg.start), t: pl.overlap > 0 ? pl.clip.transition?.type : '', ...clipLook(pl.clip) })),
    layers: seg.layers.map((l) => ({ m: path(l.media) || JSON.stringify(l.media.source), w: l.media.width, h: l.media.height, i: l.clip.in, o: l.clip.out, s: l.clip.speed, r: l.clip.reverse, f: l.clip.fit, st: r3(l.start - t0), tr: l.track, ...clipLook(l.clip) })),
    hb: seg.hideBase,
  });
}

/** Everything about a clip's picture besides its timing. */
function clipLook(c: Clip) {
  return { e: clipOn(c), fz: !!c.freeze, op: c.opacity ?? 1, bl: c.blend ?? 'normal', tf: transformOf(c), gr: gradeOf(c), vi: c.vfadeIn ?? 0, vo: c.vfadeOut ?? 0 };
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
    ...(scaleW ? ['-vf', `scale=${even(scaleW)}:-2`] : []),
    '-c:v', 'mjpeg', '-huffman', '0', '-pix_fmt', 'yuvj420p', '-q:v', String(quality),
    '-f', 'image2pipe', out,
  ];
}

function tempo(speed: number): string[] {
  const f: string[] = [];
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
  if (o.format === 'gif') {
    const pre = [`fps=${o.gifFps}`, scale].filter(Boolean).join(',');
    const dither = o.gifDither === 'bayer' ? 'dither=bayer:bayer_scale=3' : `dither=${o.gifDither}`;
    a.push('-filter_complex', `[0:v]${pre},split[a][b];[a]palettegen=max_colors=${o.gifColors}:stats_mode=diff[p];[b][p]paletteuse=${dither}`);
    a.push('-loop', o.loop ? '0' : '-1', out);
    return a;
  }
  if (o.format === 'png') {
    if (scale) a.push('-vf', scale);
    a.push('-fps_mode', 'passthrough', '-f', 'image2', out);
    return a;
  }
  a.push('-map', '0:v');
  if (withAudio) a.push('-map', '1:a');
  if (scale) a.push('-vf', `${scale},format=yuv420p`);
  else a.push('-pix_fmt', 'yuv420p');
  a.push('-r', String(fps));
  const sized = o.videoKbps && o.videoKbps > 0 ? ['-b:v', `${o.videoKbps}k`, '-maxrate', `${Math.round(o.videoKbps * 1.1)}k`, '-bufsize', `${o.videoKbps * 2}k`] : null;
  const abr = sized ? '128k' : '192k';
  if (o.format === 'mp4') {
    a.push('-c:v', 'libx264', '-preset', o.preset, ...(sized ?? ['-crf', String(o.crf)]), '-movflags', '+faststart');
    if (withAudio) a.push('-c:a', 'aac', '-b:a', abr);
  } else if (sized) {
    a.push('-c:v', 'libvpx', ...sized, '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0');
    if (withAudio) a.push('-c:a', 'libvorbis', '-b:a', abr);
  } else {
    // VP8: the VP9 encoder in ffmpeg.wasm crashes, VP8 is solid
    a.push('-c:v', 'libvpx', '-crf', String(Math.min(63, Math.max(4, o.crf - 4))), '-b:v', '12M', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0');
    if (withAudio) a.push('-c:a', 'libvorbis', '-q:a', '6');
  }
  if (withAudio) a.push('-shortest');
  a.push(...commentArgs(o.comment), out);
  return a;
}

/** Parse "ffmpeg -i" log output into basic media info. */
export function parseProbe(log: string): { duration: number; width: number; height: number; fps: number; hasAudio: boolean; hasVideo: boolean; recipe: string | null } {
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
  };
}

/** Generation loss: decode a moshed AVI and encode it again (settings `enc`) for another pass. */
export function regenArgs(project: Pick<Project, 'decoder' | 'encoder' | 'clips' | 'media' | 'texts'>, enc: EncoderSettings, input: string, out: string): string[] {
  return [...decoderInputArgs(project.decoder), '-i', input, '-an', '-pix_fmt', 'yuv420p', ...encoderArgs(enc, keyTimes(project as Project)), '-f', 'avi', out];
}

/** Settings for generation g (2, 3…): quality crushed a little more each time. */
export const generationEncoder = (enc: EncoderSettings, g: number): EncoderSettings => ({ ...enc, quality: Math.min(31, enc.quality + (g - 1) * (enc.genCrush ?? 2)) });
