// Music analysis for audio-reactive moshing: band envelopes, onsets, tempo, beats and downbeats,
// all mapped onto timeline frames. Pure: PCM in, numbers out.
//
// Onsets come from spectral flux; tempo from the autocorrelation of the onset envelope (weighted
// towards 120 BPM); beats from dynamic programming that trades onset strength against keeping a
// steady tempo (D. Ellis, "Beat tracking by dynamic programming", 2007).

export type Band = 'low' | 'mid' | 'high' | 'full' | 'onset' | 'beat';

export interface AudioFeatures {
  fps: number;
  /** timeline frames analysed */
  frames: number;
  /** per timeline frame, 0..1 (normalised to the loud parts of the track) */
  bands: Record<'low' | 'mid' | 'high' | 'full' | 'onset', Float32Array>;
  /** timeline frames of note / hit onsets, beats and the first beat of each bar */
  onsets: number[];
  beats: number[];
  downbeats: number[];
  /** beat times in seconds (for the ruler) */
  beatTimes: number[];
  bpm: number;
  /** 0..1: how clearly the music has a steady beat */
  confidence: number;
}

const RATE = 22050; // analysis rate (input is 44.1 kHz, halved)
const N = 1024;
const HOP = 256;
const HOP_SEC = HOP / RATE;

// ---------- FFT ----------

function makeFft(n: number) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  /** in-place complex FFT */
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size)
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = -re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
    }
  };
}

const percentile = (xs: ArrayLike<number>, p: number) => {
  const s = Float64Array.from(xs).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0;
};

// ---------- analysis ----------

/** Short-time features at the analysis hop rate. */
function stft(mono: Float32Array) {
  const fft = makeFft(N);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const count = Math.max(0, Math.floor((mono.length - N) / HOP) + 1);
  const low = new Float32Array(count);
  const mid = new Float32Array(count);
  const high = new Float32Array(count);
  const full = new Float32Array(count);
  const flux = new Float32Array(count);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let prev = new Float64Array(N / 2);
  let cur = new Float64Array(N / 2);
  const lowTop = Math.round((200 / RATE) * N);
  const midTop = Math.round((2000 / RATE) * N);
  for (let f = 0; f < count; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = mono[o + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let l = 0;
    let m = 0;
    let h = 0;
    let fl = 0;
    for (let k = 1; k < N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      if (k < lowTop) l += p;
      else if (k < midTop) m += p;
      else h += p;
      const c = Math.log1p(100 * Math.sqrt(p));
      cur[k] = c;
      const d = c - prev[k];
      if (d > 0) fl += d;
    }
    low[f] = Math.sqrt(l / lowTop);
    mid[f] = Math.sqrt(m / (midTop - lowTop));
    high[f] = Math.sqrt(h / (N / 2 - midTop));
    full[f] = Math.sqrt((l + m + h) / (N / 2));
    flux[f] = f === 0 ? 0 : fl;
    [prev, cur] = [cur, prev];
  }
  return { count, low, mid, high, full, flux };
}

/** Onset strength: flux minus its local mean, half-wave rectified, scaled to unit spread. */
function onsetEnvelope(flux: Float32Array): Float32Array {
  const n = flux.length;
  const out = new Float32Array(n);
  const w = Math.round(0.25 / HOP_SEC);
  let sum = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (hi < Math.min(n, i + w + 1)) sum += flux[hi++];
    while (lo < i - w) sum -= flux[lo++];
    out[i] = Math.max(0, flux[i] - sum / (hi - lo));
  }
  let sd = 0;
  for (let i = 0; i < n; i++) sd += out[i] * out[i];
  sd = Math.sqrt(sd / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

function pickOnsets(env: Float32Array): number[] {
  const out: number[] = [];
  const w = 3;
  const minGap = Math.round(0.07 / HOP_SEC);
  const avgW = Math.round(0.2 / HOP_SEC);
  for (let i = 0; i < env.length; i++) {
    const v = env[i];
    if (v < 1) continue;
    let peak = true;
    for (let k = Math.max(0, i - w); k <= Math.min(env.length - 1, i + w); k++) if (env[k] > v || (env[k] === v && k < i)) peak = false;
    if (!peak) continue;
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - avgW); k <= Math.min(env.length - 1, i + avgW); k++) ((s += env[k]), c++);
    if (v < s / c + 0.5) continue;
    if (out.length && i - out[out.length - 1] < minGap) continue;
    out.push(i);
  }
  return out;
}

/** Beat period in hops from the envelope's autocorrelation, and how periodic it is. */
function tempo(env: Float32Array): { period: number; confidence: number } {
  const minLag = Math.floor(60 / 220 / HOP_SEC);
  const maxLag = Math.min(env.length - 1, Math.ceil(60 / 50 / HOP_SEC));
  const n = env.length;
  if (maxLag <= minLag) return { period: 60 / 120 / HOP_SEC, confidence: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= Math.max(1, n);
  const x = Float32Array.from(env, (v) => v - mean);
  let zero = 0;
  for (let i = 0; i < n; i++) zero += x[i] * x[i];
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    ac[lag] = s / (n - lag);
  }
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * HOP_SEC);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = ac[lag] * prior;
    if (score > bestScore) ((bestScore = score), (best = lag));
  }
  // parabolic refinement of the peak
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const den = a - 2 * b + c;
  const period = den < 0 ? best + (0.5 * (a - c)) / den : best;
  return { period, confidence: Math.max(0, Math.min(1, b / (zero / n || 1))) };
}

/** Ellis' dynamic-programming beat tracker. Returns beat positions in hops. */
function trackBeats(env: Float32Array, period: number, tightness = 100): number[] {
  const n = env.length;
  if (!n) return [];
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity;
    let arg = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const pen = Math.log((t - tau) / period);
      const s = score[tau] - tightness * pen * pen;
      if (s > best) ((best = s), (arg = tau));
    }
    score[t] = env[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // end on the best-scoring beat in the last period
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

/** Mean of a hop-rate signal over each timeline frame. */
function toFrames(x: Float32Array, frames: number, fps: number): Float32Array {
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = Math.floor(f / fps / HOP_SEC);
    const b = Math.max(a + 1, Math.floor((f + 1) / fps / HOP_SEC));
    let s = 0;
    let c = 0;
    for (let k = a; k < b && k < x.length; k++) ((s += x[k]), c++);
    out[f] = c ? s / c : 0;
  }
  return out;
}

/** Scale to 0..1 against the loud parts (98th percentile), ignoring silence. */
function normalise(x: Float32Array): Float32Array {
  const ref = percentile(x, 0.98) || 1;
  return x.map((v) => Math.min(1, v / ref));
}

const uniq = (xs: number[]) => xs.filter((v, i) => i === 0 || v !== xs[i - 1]);

/**
 * Analyse interleaved stereo 16-bit PCM at 44.1 kHz for a timeline at `fps`.
 * `frames`: length of the timeline (defaults to the length of the sound).
 */
export function analyzeAudio(pcm: Int16Array, fps: number, frames?: number): AudioFeatures {
  const n2 = Math.floor(pcm.length / 4);
  const mono = new Float32Array(n2);
  for (let i = 0; i < n2; i++) mono[i] = (pcm[i * 4] + pcm[i * 4 + 1] + pcm[i * 4 + 2] + pcm[i * 4 + 3]) / (4 * 32768);
  const total = frames ?? Math.max(1, Math.round((pcm.length / 2 / 44100) * fps));
  const s = stft(mono);
  const env = onsetEnvelope(s.flux);
  const onsetHops = pickOnsets(env);
  const { period, confidence } = tempo(env);
  let beatHops = trackBeats(env, period);
  // no beats in silence (before the music starts, after it ends)
  const quiet = percentile(s.full, 0.9) * 0.05;
  beatHops = beatHops.filter((h) => {
    let m = 0;
    for (let k = Math.max(0, h - 4); k <= Math.min(s.count - 1, h + 4); k++) m = Math.max(m, s.full[k]);
    return m > quiet;
  });
  // downbeats: the phase (of 4) whose beats carry the most bass and onset strength
  let phase = 0;
  let bestAcc = -Infinity;
  for (let ph = 0; ph < 4; ph++) {
    let acc = 0;
    for (let i = ph; i < beatHops.length; i += 4) acc += env[beatHops[i]] + 2 * s.low[beatHops[i]] / (percentile(s.low, 0.98) || 1);
    acc /= Math.max(1, Math.ceil((beatHops.length - ph) / 4));
    if (acc > bestAcc) ((bestAcc = acc), (phase = ph));
  }
  const frameOf = (h: number) => Math.round((h * HOP + N / 2) / RATE * fps);
  const inside = (f: number) => f >= 0 && f < total;
  const beats = uniq(beatHops.map(frameOf)).filter(inside);
  const downbeats = uniq(beatHops.filter((_, i) => i % 4 === phase).map(frameOf)).filter(inside);
  return {
    fps,
    frames: total,
    bands: {
      low: normalise(toFrames(s.low, total, fps)),
      mid: normalise(toFrames(s.mid, total, fps)),
      high: normalise(toFrames(s.high, total, fps)),
      full: normalise(toFrames(s.full, total, fps)),
      onset: normalise(toFrames(env, total, fps)),
    },
    onsets: uniq(onsetHops.map(frameOf)).filter(inside),
    beats,
    downbeats,
    beatTimes: beatHops.map((h) => (h * HOP + N / 2) / RATE),
    bpm: 60 / (period * HOP_SEC),
    confidence,
  };
}

// ---------- envelopes for automation ----------

export interface AudioAuto {
  band: Band;
  /** response time in frames */
  attack: number;
  release: number;
  /** 0..1: quieter than this counts as nothing */
  threshold: number;
}

/**
 * The 0..1 control signal an audio automation follows over timeline frames [start, end).
 * `beat` and `onset` hits jump to 1 and fall away over the release time.
 */
export function audioEnvelope(f: AudioFeatures, a: AudioAuto, start: number, end: number): Float32Array {
  const len = Math.max(1, end - start);
  const raw = new Float32Array(len);
  if (a.band === 'beat' || a.band === 'onset') {
    const hits = a.band === 'beat' ? f.beats : f.onsets;
    for (const h of hits) if (h >= start && h < end) raw[h - start] = 1;
  } else {
    const b = f.bands[a.band];
    for (let i = 0; i < len; i++) raw[i] = b[start + i] ?? 0;
  }
  const thr = Math.min(0.99, Math.max(0, a.threshold));
  const up = a.attack > 0 ? 1 / (a.attack + 1) : 1;
  const down = 1 / (Math.max(0, a.release) + 1);
  const out = new Float32Array(len);
  let y = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.max(0, (raw[i] - thr) / (1 - thr));
    y += (x - y) * (x > y ? up : down);
    out[i] = y;
  }
  return out;
}
