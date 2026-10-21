// Colour: which matrix turns a source's YUV into RGB, and the conversions the filter graphs use so
// colours come out as they went in. Inside the pipeline the picture is BT.709, video range (what
// HD footage and players use). The browser reads JPEGs as BT.601, full range, so the frames it is
// given (preview, picture effects) are converted to that and back. Every conversion names its
// matrix: FFmpeg's own choice depends on its version and on how the file is tagged.
import type { MediaItem } from './types';

export interface MediaColour {
  /** pixel format, e.g. yuv420p, yuv420p10le, rgb24 */
  pix?: string;
  range?: 'tv' | 'pc';
  /** FFmpeg's names: bt709, bt470bg, smpte170m, bt2020nc… */
  matrix?: string;
  primaries?: string;
  /** bt709, arib-std-b67 (HLG), smpte2084 (PQ)… */
  transfer?: string;
}

/** The colour properties FFmpeg prints for the first video stream, e.g. `yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive)`. */
export function parseColour(log: string): MediaColour | undefined {
  const m = /Stream #[^\n]*Video: [^\n]*?\b((?:yuvj?|rgb|bgr|gbr|nv|p0|gray|argb|abgr|rgba|bgra|pal)[\w]*)(?:\(([^)]*)\))?/.exec(log);
  if (!m) return undefined;
  const c: MediaColour = { pix: m[1] };
  for (const part of (m[2] ?? '').split(',').map((s) => s.trim())) {
    if (part === 'tv' || part === 'pc') c.range = part;
    else if (/^(bt|smpte|gbr|fcc|ycgco|unknown|chroma|ictcp|reserved)/.test(part)) {
      const [matrix, primaries, transfer] = part.split('/');
      // one name stands for all three
      c.matrix = matrix;
      c.primaries = primaries ?? matrix;
      c.transfer = transfer ?? matrix;
    }
  }
  return c;
}

/** HDR footage (HLG or PQ): its picture needs tone-mapping down to normal range. */
export const hdrOf = (m: Pick<MediaItem, 'color'>): 'hlg' | 'pq' | null => (m.color?.transfer === 'arib-std-b67' ? 'hlg' : m.color?.transfer === 'smpte2084' ? 'pq' : null);

/**
 * The matrix a source's YUV is in, as the scale filter names it: its tag, or for untagged video
 * what players assume (BT.709 from 720 lines up, BT.601 below). 'auto' for pictures (a JPEG says
 * BT.601 itself; PNGs are RGB) and generated footage.
 */
export function sourceMatrix(m: Pick<MediaItem, 'color' | 'height' | 'source'> & { width?: number }): 'bt709' | 'bt601' | 'bt2020' | 'auto' {
  if (m.source.kind === 'generator' || (m.source.kind === 'file' && m.source.isImage)) return 'auto';
  const pix = m.color?.pix ?? '';
  if (/^(rgb|bgr|gbr|argb|abgr|rgba|bgra|pal|gray)/.test(pix)) return 'auto';
  const t = m.color?.matrix;
  if (t === 'bt709') return 'bt709';
  if (t === 'bt470bg' || t === 'smpte170m' || t === 'fcc') return 'bt601';
  if (t === 'bt2020nc' || t === 'bt2020c') return 'bt2020';
  return (m.width ?? 0) >= 1280 || m.height >= 720 ? 'bt709' : 'bt601';
}

/** Whether a source's YUV can join the pipeline as it is (BT.709, video range, normal range of light). */
export const passesAsIs = (m: Pick<MediaItem, 'color' | 'height' | 'source' | 'width'>) => sourceMatrix(m) === 'bt709' && m.color?.range !== 'pc' && !hdrOf(m) && !/^yuvj/.test(m.color?.pix ?? '');

/** A source's picture to RGBA, read with its own matrix. */
export function rgbaFrom(m: Pick<MediaItem, 'color' | 'height' | 'source' | 'width'>): string {
  const hdr = hdrRgba(m);
  if (hdr) return hdr;
  const mat = sourceMatrix(m);
  const range = m.color?.range ? `:in_range=${m.color.range}` : '';
  return mat === 'auto' ? `scale=in_color_matrix=auto${range},format=rgba` : `scale=in_color_matrix=${mat}${range},format=rgba`;
}

/** The pipeline's own YUV (BT.709, video range) to RGBA. */
export const RGBA_FROM_YUV = 'scale=in_color_matrix=bt709:in_range=tv,format=rgba';
/** RGB(A) to the pipeline's YUV. */
export const YUV_FROM_RGB = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
/** RGBA to the pipeline's YUV with its alpha, ready to lay over it. */
export const YUVA_FROM_RGBA = 'scale=out_color_matrix=bt709:out_range=tv,format=yuva420p';
/** The scale options that turn the pipeline's YUV into what a browser expects of a JPEG. */
export const JPEG_FOR_BROWSER = 'in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc';
/** The scale options that read a JPEG the browser made back into the pipeline's YUV. */
export const FROM_BROWSER_JPEG = 'in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv';
/** What MP4 and WebM exports say about their colours. */
export const TAG_709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

// ---------- HDR to SDR ----------

/** The .cube file name the render reads a tone-map from. */
export const hdrLutFile = (kind: 'hlg' | 'pq') => `hdr_${kind}.cube`;

/** HLG signal to scene light (0..1), BT.2100. */
function hlgToScene(v: number): number {
  const a = 0.17883277;
  const b = 1 - 4 * a;
  const c = 0.5 - a * Math.log(4 * a);
  return v <= 0.5 ? (v * v) / 3 : (Math.exp((v - c) / a) + b) / 12;
}

/** PQ signal to light in nits, SMPTE ST 2084. */
function pqToNits(v: number): number {
  const m1 = 0.1593017578125;
  const m2 = 78.84375;
  const c1 = 0.8359375;
  const c2 = 18.8515625;
  const c3 = 18.6875;
  const p = Math.pow(Math.max(0, v), 1 / m2);
  return 10000 * Math.pow(Math.max(p - c1, 0) / (c2 - c3 * p), 1 / m1);
}

/** HDR reference white (BT.2408): the light SDR's 100 % stands for. */
const REF_WHITE = 203;
/** where the highlights start to roll off, as a share of SDR white */
const KNEE = 0.75;

/**
 * The tone-map from HDR (BT.2020 primaries, HLG or PQ, as RGB 0..1 read with the BT.2020 matrix)
 * to SDR BT.709 RGB, as a function: light relative to reference white, BT.2020 to BT.709
 * primaries, highlights above the knee rolled off towards white (keeping their hue), then
 * encoded for a BT.1886 display.
 */
export function hdrToSdr(kind: 'hlg' | 'pq', rgb: [number, number, number]): [number, number, number] {
  let lin: number[];
  if (kind === 'hlg') {
    // scene light, then the display light of a 1000-nit HLG display (system gamma 1.2)
    const e = rgb.map(hlgToScene);
    const ys = 0.2627 * e[0] + 0.678 * e[1] + 0.0593 * e[2];
    const k = 1000 * Math.pow(Math.max(ys, 1e-6), 0.2);
    lin = e.map((x) => (k * x) / REF_WHITE);
  } else lin = rgb.map((x) => pqToNits(x) / REF_WHITE);
  // BT.2020 primaries to BT.709 (out-of-gamut colours clipped)
  const [r, g, b] = lin;
  let out = [1.6605 * r - 0.5876 * g - 0.0728 * b, -0.1246 * r + 1.1329 * g - 0.0083 * b, -0.0182 * r - 0.1006 * g + 1.1187 * b].map((x) => Math.max(0, x));
  const m = Math.max(...out);
  if (m > KNEE) {
    const to = KNEE + (1 - KNEE) * (1 - Math.exp(-(m - KNEE) / (1 - KNEE)));
    out = out.map((x) => (x * to) / m);
  }
  return out.map((x) => Math.pow(Math.min(1, x), 1 / 2.4)) as [number, number, number];
}

/** The tone-map as a .cube 3D LUT (red fastest). */
export function hdrCube(kind: 'hlg' | 'pq', n = 33): string {
  const lines = [`TITLE "${kind.toUpperCase()} to SDR"`, `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) lines.push(hdrToSdr(kind, [r / (n - 1), g / (n - 1), b / (n - 1)]).map((v) => v.toFixed(5)).join(' '));
  return lines.join('\n') + '\n';
}

/** HDR footage's picture to (SDR) RGBA: read with its matrix at 16 bits, tone-mapped by its LUT. */
export function hdrRgba(m: Pick<MediaItem, 'color'>): string | null {
  const kind = hdrOf(m);
  if (!kind) return null;
  const mat = m.color?.matrix === 'bt709' ? 'bt709' : 'bt2020';
  return `scale=in_color_matrix=${mat}:in_range=${m.color?.range ?? 'tv'},format=rgb48le,lut3d=file=${hdrLutFile(kind)}:interp=tetrahedral,format=rgba`;
}
