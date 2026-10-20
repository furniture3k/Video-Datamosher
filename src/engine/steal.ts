// Steal this edit: measure how a reference edit was made (where it cuts and how that sits on its
// beat, how long its shots are, how many pictures a second it really has, its colours and grade,
// whether the picture sits in a card or has bars, how much text it carries) and turn that into a
// plan for the user's own clips. Pure: small frames and beat times come in, numbers come out.
import type { Gray } from './track';
import type { Lut3D } from './lut';

/** Small colour frames: RGB, three bytes a pixel. */
export interface RGBFrames {
  w: number;
  h: number;
  frames: Uint8Array[];
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Cuts and shots

/** How much each frame differs from the one before it: the mean grey-level change (length n − 1). */
export function frameChanges(g: Gray): number[] {
  const out: number[] = [];
  for (let k = 1; k < g.frames.length; k++) {
    const a = g.frames[k - 1];
    const b = g.frames[k];
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    out.push(s / a.length);
  }
  return out;
}

export interface CutOptions {
  /** the least change that can be a cut (grey levels) */
  min?: number;
  /** the least frames between two cuts */
  gap?: number;
}

/**
 * Where the reference cuts (seconds: the first moment of each new shot). A cut is a jump well above
 * what this footage normally changes by, and well above the frames round it (so fast motion isn't one).
 */
export function detectCuts(g: Gray, fps: number, opts: CutOptions = {}): number[] {
  const d = frameChanges(g);
  if (d.length < 3) return [];
  const med = median(d);
  const mad = median(d.map((x) => Math.abs(x - med)));
  const thr = Math.max(opts.min ?? 14, med + 8 * mad + 6);
  const gap = opts.gap ?? 3;
  const hits: number[] = [];
  for (let i = 0; i < d.length; i++) {
    if (d[i] < thr) continue;
    const around: number[] = [];
    for (let j = Math.max(0, i - 3); j <= Math.min(d.length - 1, i + 3); j++) if (j !== i) around.push(d[j]);
    if (d[i] < 1.8 * Math.max(mean(around), 1)) continue;
    // too close to the last: keep the bigger jump
    const last = hits[hits.length - 1];
    if (last !== undefined && i - last < gap) {
      if (d[i] > d[last]) hits[hits.length - 1] = i;
      continue;
    }
    hits.push(i);
  }
  return hits.map((i) => r3((i + 1) / fps));
}

export interface ShotStats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** the lengths themselves (seconds) */
  lengths: number[];
}

/** How long the shots are, from the cuts and the length of the whole reference. */
export function shotStats(cuts: number[], duration: number): ShotStats {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const lengths = edges.slice(1).map((e, i) => r3(e - edges[i])).filter((l) => l > 0);
  return { count: lengths.length, mean: r3(mean(lengths)), median: r3(median(lengths)), min: lengths.length ? Math.min(...lengths) : 0, max: lengths.length ? Math.max(...lengths) : 0, lengths };
}

export interface BeatFit {
  bpm: number;
  /** share of the cuts that land on a beat, within `tol` seconds */
  onBeat: number;
  /** how many beats a shot usually lasts: ¼, ½, 1, 2 or 4 */
  every: number;
  /** how far the cuts sit after the beat, in seconds (the middle of them) */
  offset: number;
}

/** How the cuts sit on the beat: how many land on one, and how many beats a shot lasts. Null without beats. */
export function cutsAgainstBeats(cuts: number[], beats: number[], tol = 0.06): BeatFit | null {
  if (beats.length < 3 || !cuts.length) return null;
  const period = median(beats.slice(1).map((b, i) => b - beats[i]));
  if (period <= 0) return null;
  const offs = cuts.map((c) => {
    const nearest = beats.reduce((b, p) => (Math.abs(p - c) < Math.abs(b - c) ? p : b), beats[0]);
    return c - nearest;
  });
  const on = offs.filter((o) => Math.abs(o) <= tol).length / cuts.length;
  const shots = shotStats(cuts, Math.max(...cuts) + period);
  const raw = median(shots.lengths) / period;
  const every = [0.25, 0.5, 1, 2, 4].reduce((b, v) => (Math.abs(Math.log(v / raw)) < Math.abs(Math.log(b / raw)) ? v : b), 1);
  return { bpm: r3(60 / period), onBeat: r3(on), every, offset: r3(median(offs)) };
}

// ---------------------------------------------------------------------------------------------
// Frame rate

export interface FpsFit {
  /** pictures a second the reference really has */
  fps: number;
  /** share of frames that repeat the one before */
  repeated: number;
  /** a step-print rate (6, 8, 10, 12 or 15) if it clearly has one */
  stepFps?: number;
}

const STEP_RATES = [6, 8, 10, 12, 15];

/**
 * How many different pictures a second the reference has: frames that repeat the one before (apart
 * from at cuts) show a step print, like 12 fps film played at 24. Needs some motion to say anything.
 */
export function effectiveFps(g: Gray, fps: number, cuts: number[] = [], eps = 0.6): FpsFit {
  const d = frameChanges(g);
  const cutIdx = new Set(cuts.map((c) => Math.round(c * fps) - 1));
  const usable = d.map((v, i) => ({ v, i })).filter((x) => !cutIdx.has(x.i));
  if (usable.length < 6) return { fps, repeated: 0 };
  const changed = usable.filter((x) => x.v > eps);
  const repeated = r3(1 - changed.length / usable.length);
  // with hardly any motion a repeat can't be told from stillness
  if (changed.length < 3 || median(changed.map((x) => x.v)) < 1.5) return { fps, repeated: 0 };
  // the distance (in frames) from one change to the next
  const gaps = changed.slice(1).map((x, k) => x.i - changed[k].i).filter((x) => x < 12);
  const gap = gaps.length ? median(gaps) : 1;
  const real = r3(fps / Math.max(1, gap));
  const step = STEP_RATES.find((c) => Math.abs(real - c) <= 0.12 * c);
  return { fps: real, repeated, ...(step && repeated > 0.2 && real < fps * 0.8 ? { stepFps: step } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Colour

/** sRGB (0..1) to CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE Lab to sRGB (0..1, clamped). */
export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  return [R, G, B].map((v) => Math.max(0, Math.min(1, gam(v)))) as [number, number, number];
}

export interface ColourStats {
  /** mean and spread of L, a and b over the reference's pixels */
  mean: [number, number, number];
  std: [number, number, number];
}

/** The colour of a set of frames: the mean and spread of each Lab channel, from a sample of the pixels. */
export function colourStats(rgb: RGBFrames, sample = 4): ColourStats {
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  let n = 0;
  rgb.frames.forEach((f, k) => {
    if (k % Math.max(1, Math.floor(rgb.frames.length / 24)) !== 0) return;
    for (let i = 0; i < rgb.w * rgb.h; i += sample) {
      const lab = rgbToLab(f[i * 3] / 255, f[i * 3 + 1] / 255, f[i * 3 + 2] / 255);
      for (let c = 0; c < 3; c++) {
        sum[c] += lab[c];
        sq[c] += lab[c] * lab[c];
      }
      n++;
    }
  });
  const m = sum.map((s) => s / Math.max(1, n));
  const sd = sq.map((s, c) => Math.sqrt(Math.max(0, s / Math.max(1, n) - m[c] * m[c])));
  return { mean: m as [number, number, number], std: sd as [number, number, number] };
}

/**
 * A LUT that gives footage with colour `from` the colour of the reference `to` (Reinhard's colour
 * transfer in Lab: each channel moved to the reference's mean and stretched to its spread).
 * `amount` 0..1 mixes it with no change.
 */
export function transferLut(from: ColourStats, to: ColourStats, size = 17, amount = 1): Lut3D {
  const data = new Float32Array(size ** 3 * 3);
  let o = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const rgb: [number, number, number] = [r / (size - 1), g / (size - 1), b / (size - 1)];
        const lab = rgbToLab(...rgb);
        const moved = lab.map((v, c) => {
          // never stretch or squash more than twice, so a flat reference doesn't flatten everything
          const k = Math.max(0.5, Math.min(2, to.std[c] / Math.max(from.std[c], 1e-3)));
          return (v - from.mean[c]) * k + to.mean[c];
        }) as [number, number, number];
        const out = labToRgb(...moved);
        for (let c = 0; c < 3; c++) data[o++] = rgb[c] + (out[c] - rgb[c]) * amount;
      }
  return { title: 'Stolen grade', size, data };
}

export interface PaletteColour {
  hex: string;
  share: number;
}

/** The main colours of the frames: k-means over a sample of the pixels (a fixed start, so the same frames always give the same palette). */
export function palette(rgb: RGBFrames, k = 5, sample = 6): PaletteColour[] {
  const px: number[][] = [];
  rgb.frames.forEach((f, fi) => {
    if (fi % Math.max(1, Math.floor(rgb.frames.length / 16)) !== 0) return;
    for (let i = 0; i < rgb.w * rgb.h; i += sample) px.push([f[i * 3], f[i * 3 + 1], f[i * 3 + 2]]);
  });
  if (!px.length) return [];
  // start from colours spread along brightness
  const byLuma = [...px].sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
  let centres = Array.from({ length: k }, (_, i) => byLuma[Math.floor(((i + 0.5) / k) * byLuma.length)].slice());
  let assign = new Array<number>(px.length).fill(0);
  for (let it = 0; it < 12; it++) {
    assign = px.map((p) => {
      let best = 0;
      let bd = Infinity;
      centres.forEach((c, ci) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) ((bd = d), (best = ci));
      });
      return best;
    });
    centres = centres.map((c, ci) => {
      const mine = px.filter((_, i) => assign[i] === ci);
      return mine.length ? [0, 1, 2].map((ch) => mean(mine.map((p) => p[ch]))) : c;
    });
  }
  const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return centres
    .map((c, ci) => ({ hex: hex(c), share: r3(assign.filter((a) => a === ci).length / px.length) }))
    .filter((p) => p.share > 0)
    .sort((a, b) => b.share - a.share);
}

// ---------------------------------------------------------------------------------------------
// The picture's frame: bars or a card

export interface Borders {
  /** each side's width as a share of the picture's height (top, bottom) or width (left, right) */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** the colour of the bars, as hex */
  colour: string;
}

/**
 * Bars or a card round the picture: strips along the edges that are one flat colour and stay that
 * colour in every frame. Null if there are none (less than 2% of a side).
 */
export function detectBorders(rgb: RGBFrames, minShare = 0.02): Borders | null {
  const { w, h } = rgb;
  const n = Math.min(rgb.frames.length, 24);
  const frames = Array.from({ length: n }, (_, i) => rgb.frames[Math.floor((i * rgb.frames.length) / n)]);
  const px = (f: Uint8Array, x: number, y: number) => [f[(y * w + x) * 3], f[(y * w + x) * 3 + 1], f[(y * w + x) * 3 + 2]];
  /** is the line one flat colour (the same as `ref`) in every frame? returns its colour or null */
  const flat = (cells: [number, number][], ref: number[] | null): number[] | null => {
    let colour: number[] | null = ref;
    for (const f of frames) {
      const first = px(f, cells[0][0], cells[0][1]);
      colour ??= first;
      for (const [x, y] of cells) {
        const p = px(f, x, y);
        if (Math.abs(p[0] - colour[0]) > 10 || Math.abs(p[1] - colour[1]) > 10 || Math.abs(p[2] - colour[2]) > 10) return null;
      }
    }
    return colour;
  };
  const row = (y: number): [number, number][] => Array.from({ length: w }, (_, x) => [x, y]);
  const col = (x: number): [number, number][] => Array.from({ length: h }, (_, y) => [x, y]);
  let ref: number[] | null = null;
  const count = (lines: ((i: number) => [number, number][]), max: number) => {
    let k = 0;
    while (k < max) {
      const c = flat(lines(k), ref);
      if (!c) break;
      ref ??= c;
      k++;
    }
    return k;
  };
  const top = count((i) => row(i), h >> 1);
  const bottom = count((i) => row(h - 1 - i), h >> 1);
  const left = count((i) => col(i), w >> 1);
  const right = count((i) => col(w - 1 - i), w >> 1);
  const out = { top: r3(top / h), bottom: r3(bottom / h), left: r3(left / w), right: r3(right / w) };
  if (Math.max(out.top, out.bottom, out.left, out.right) < minShare || !ref) return null;
  // a picture that is one flat colour all through has no frame round it
  if (top >= h >> 1 || bottom >= h >> 1 || left >= w >> 1 || right >= w >> 1) return null;
  const c = ref as number[];
  return { ...out, colour: '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') };
}

// ---------------------------------------------------------------------------------------------
// Text

export interface TextFit {
  /** share of the picture, over the frames, that looks like lines of small letters (0..1) */
  density: number;
  /** where most of it is */
  where: 'top' | 'middle' | 'bottom' | null;
}

/**
 * How much of the picture is text: cells of about 8 × 8 pixels where hard edges come every few
 * pixels (letters) without being everywhere (texture) or nowhere (flat). A rough measure, good
 * enough to say "this edit carries a lot of words".
 */
export function textDensity(g: Gray): TextFit {
  const { w, h } = g;
  const cell = 8;
  const cx = Math.floor(w / cell);
  const cy = Math.floor(h / cell);
  if (!cx || !cy || !g.frames.length) return { density: 0, where: null };
  const rows = new Array<number>(cy).fill(0);
  let total = 0;
  const step = Math.max(1, Math.floor(g.frames.length / 16));
  let used = 0;
  for (let k = 0; k < g.frames.length; k += step) {
    const f = g.frames[k];
    used++;
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let edges = 0;
        let flips = 0;
        for (let y = j * cell; y < (j + 1) * cell; y++) {
          let prev = false;
          for (let x = i * cell + 1; x < (i + 1) * cell; x++) {
            const e = Math.abs(f[y * w + x] - f[y * w + x - 1]) > 60;
            if (e) edges++;
            if (e && !prev) flips++;
            prev = e;
          }
        }
        const share = edges / (cell * (cell - 1));
        // letters: some hard edges, but in separate strokes, not a wall of them
        if (share >= 0.08 && share <= 0.4 && flips >= cell * 0.5) {
          rows[j]++;
          total++;
        }
      }
  }
  const density = r3(total / (used * cx * cy));
  if (density < 0.01) return { density, where: null };
  const third = (a: number, b: number) => rows.slice(a, b).reduce((s, v) => s + v, 0);
  const t = third(0, Math.floor(cy / 3));
  const m = third(Math.floor(cy / 3), Math.floor((2 * cy) / 3));
  const b = third(Math.floor((2 * cy) / 3), cy);
  return { density, where: t >= m && t >= b ? 'top' : b >= m ? 'bottom' : 'middle' };
}

// ---------------------------------------------------------------------------------------------
// Putting it together

export interface StealResult {
  duration: number;
  fps: number;
  cuts: number[];
  shots: ShotStats;
  beat: BeatFit | null;
  effective: FpsFit;
  colour: ColourStats;
  palette: PaletteColour[];
  borders: Borders | null;
  text: TextFit;
}

export interface StealInput {
  gray: Gray;
  rgb: RGBFrames;
  fps: number;
  duration: number;
  /** beat times of the reference's music, in seconds (if it has any) */
  beats?: number[];
}

/** Measure a reference edit. */
export function analyseReference(input: StealInput): StealResult {
  const cuts = detectCuts(input.gray, input.fps);
  return {
    duration: input.duration,
    fps: input.fps,
    cuts,
    shots: shotStats(cuts, input.duration),
    beat: input.beats ? cutsAgainstBeats(cuts, input.beats) : null,
    effective: effectiveFps(input.gray, input.fps, cuts),
    colour: colourStats(input.rgb),
    palette: palette(input.rgb),
    borders: detectBorders(input.rgb),
    text: textDensity(input.gray),
  };
}

/** What the user can tweak before it is applied to their clips. */
export interface StealPlan {
  /** the length of each shot to cut the user's clips into (seconds) */
  shots: number[];
  /** a step-print rate for the clips, if the reference had one */
  stepFps?: number;
  /** how strongly to put the reference's grade on (0 = not at all) */
  grade: number;
  /** a card round the picture (bars or a backdrop), as a share of the frame's shorter side, and its colour */
  card?: { inset: number; colour: string };
  /** an estimate of how many titles it needs per second of footage (0 = none) */
  titlesPerSecond: number;
}

/**
 * A plan for `seconds` of the user's footage from what was measured: the shot lengths repeated
 * until they fill it (on the beat the reference's cuts were, if its music had a steady beat), its
 * frame rate and grade, a card if it had bars, and how wordy it was.
 */
export function stealPlan(r: StealResult, seconds: number, opts: { grade?: number; beatPeriod?: number } = {}): StealPlan {
  const lengths = r.shots.lengths.length ? r.shots.lengths : [Math.max(0.5, seconds / 4)];
  const shots: number[] = [];
  let t = 0;
  for (let i = 0; t < seconds - 1e-6; i++) {
    let len = lengths[i % lengths.length];
    // the user's own beat: cut on whole numbers of beats if the reference cut on its beat
    if (opts.beatPeriod && r.beat && r.beat.onBeat > 0.5) len = Math.max(0.25, Math.round(len / opts.beatPeriod) * opts.beatPeriod);
    len = Math.min(len, seconds - t);
    if (len < 0.1) break;
    shots.push(r3(len));
    t += len;
  }
  const b = r.borders;
  const side = b ? Math.max(b.top, b.bottom, b.left, b.right) : 0;
  return {
    shots,
    ...(r.effective.stepFps ? { stepFps: r.effective.stepFps } : {}),
    grade: opts.grade ?? 1,
    ...(b && side >= 0.02 ? { card: { inset: r3(Math.min(0.3, side)), colour: b.colour } } : {}),
    titlesPerSecond: r3(Math.min(2, r.text.density * 8)),
  };
}
