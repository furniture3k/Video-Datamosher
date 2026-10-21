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
