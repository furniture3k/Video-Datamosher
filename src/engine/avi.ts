// Minimal RIFF/AVI reader + writer for single-video-stream files.
// The reader pulls every video frame chunk ("00dc"/"00db") out of the movi list(s);
// the writer builds a fresh, valid AVI around an edited list of frames.

export interface AviInfo {
  width: number;
  height: number;
  /** frame rate = rate / scale */
  rate: number;
  scale: number;
  fourcc: string;
  /** raw strh / strf payloads, reused verbatim when writing */
  strh: Uint8Array;
  strf: Uint8Array;
  avih: Uint8Array;
}

export interface AviChunk {
  data: Uint8Array;
  /** AVIIF_KEYFRAME flag from the index, if present */
  keyframe: boolean;
}

const fourcc = (b: Uint8Array, o: number) =>
  String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function parseAvi(buf: Uint8Array): { info: AviInfo; chunks: AviChunk[] } {
  let avih: Uint8Array | null = null;
  let strh: Uint8Array | null = null;
  let strf: Uint8Array | null = null;
  let videoStream = -1;
  let streamIdx = -1;
  const chunks: AviChunk[] = [];
  const chunkOffsets: number[] = [];
  let firstMovi = -1;
  let idx1: Uint8Array | null = null;

  const walk = (start: number, end: number, inMovi: boolean) => {
    let p = start;
    while (p + 8 <= end) {
      const id = fourcc(buf, p);
      let size = u32(buf, p + 4);
      const body = p + 8;
      if (body + size > buf.length) size = Math.max(0, buf.length - body); // truncated file
      if (id === 'RIFF' || id === 'LIST') {
        const type = fourcc(buf, body);
        if (type === 'movi' && firstMovi < 0) firstMovi = body;
        if (type === 'strl') streamIdx++;
        walk(body + 4, body + size, inMovi || type === 'movi');
      } else if (id === 'avih') {
        avih = buf.slice(body, body + size);
      } else if (id === 'strh') {
        if (fourcc(buf, body) === 'vids' && videoStream < 0) {
          videoStream = streamIdx;
          strh = buf.slice(body, body + size);
        }
      } else if (id === 'strf') {
        if (streamIdx === videoStream && !strf) strf = buf.slice(body, body + size);
      } else if (id === 'idx1') {
        idx1 = buf.subarray(body, body + size);
      } else if (inMovi && /^\d\d(dc|db)$/.test(id) && parseInt(id.slice(0, 2), 10) === videoStream) {
        if (size > 0) {
          chunks.push({ data: buf.slice(body, body + size), keyframe: false });
          chunkOffsets.push(p);
        }
      }
      p = body + size + (size & 1);
    }
  };
  walk(0, buf.length, false);

  if (!avih || !strh || !strf) throw new Error('Not a usable AVI (missing video stream headers)');

  // Pull keyframe flags from idx1 (offsets are relative to 'movi' or absolute)
  if (idx1 && firstMovi >= 0) {
    const ix = idx1 as Uint8Array;
    const byOffset = new Map<number, number>();
    chunkOffsets.forEach((o, i) => byOffset.set(o, i));
    for (let i = 0; i + 16 <= ix.length; i += 16) {
      const flags = u32(ix, i + 4);
      const off = u32(ix, i + 8);
      const ci = byOffset.get(off + firstMovi) ?? byOffset.get(off);
      if (ci !== undefined) chunks[ci].keyframe = (flags & 0x10) !== 0;
    }
  }

  return { info: aviInfo(avih, strh, strf), chunks };
}

/** Stream info from the raw avih / strh / strf payloads. */
export function aviInfo(avih: Uint8Array, strh: Uint8Array, strf: Uint8Array): AviInfo {
  return {
    fourcc: fourcc(strh, 4),
    scale: u32(strh, 20) || 1,
    rate: u32(strh, 24) || 25,
    width: u32(avih, 32),
    height: u32(avih, 36),
    strh,
    strf,
    avih,
  };
}

class Writer {
  parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
  }
  str(s: string) {
    this.push(new TextEncoder().encode(s));
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function chunk(id: string, data: Uint8Array): Uint8Array {
  const w = new Writer();
  w.str(id);
  w.u32(data.length);
  w.push(data);
  if (data.length & 1) w.push(new Uint8Array(1));
  return w.concat();
}

function list(type: string, children: Uint8Array[], id = 'LIST'): Uint8Array {
  const w = new Writer();
  w.str(type);
  children.forEach((c) => w.push(c));
  return chunk(id, w.concat());
}

export interface WriteFrame {
  data: Uint8Array;
  keyframe: boolean;
}

/** Headers and index of an AVI holding frames of these sizes; the movi payloads go in between. */
function aviSkeleton(info: AviInfo, frames: { size: number; keyframe: boolean }[]): { head: Uint8Array; idx1: Uint8Array } {
  let maxSize = 0;
  let total = 0;
  for (const f of frames) {
    maxSize = Math.max(maxSize, f.size);
    total += f.size;
  }
  const fps = info.rate / info.scale;

  const avih = info.avih.slice();
  const av = new DataView(avih.buffer);
  av.setUint32(0, Math.round(1e6 / fps), true);
  av.setUint32(4, Math.round((total / Math.max(1, frames.length)) * fps), true);
  av.setUint32(12, 0x10, true); // AVIF_HASINDEX
  av.setUint32(16, frames.length, true);
  av.setUint32(20, 0, true);
  av.setUint32(24, 1, true);
  av.setUint32(28, maxSize + 8, true);

  const strh = info.strh.slice();
  const sv = new DataView(strh.buffer);
  sv.setUint32(32, frames.length, true);
  if (strh.length >= 40) sv.setUint32(36, maxSize + 8, true);

  const hdrl = list('hdrl', [chunk('avih', avih), list('strl', [chunk('strh', strh), chunk('strf', info.strf)])]);

  const idx = new Writer();
  let off = 4; // offsets relative to the 'movi' fourcc
  for (const f of frames) {
    idx.str('00dc');
    idx.u32(f.keyframe ? 0x10 : 0);
    idx.u32(off);
    idx.u32(f.size);
    off += 8 + f.size + (f.size & 1);
  }
  const moviBody = off; // 'movi' fourcc + chunks
  const idx1 = chunk('idx1', idx.concat());
  const head = new Writer();
  head.str('RIFF');
  head.u32(4 + hdrl.length + 8 + moviBody + idx1.length);
  head.str('AVI ');
  head.push(hdrl);
  head.str('LIST');
  head.u32(moviBody);
  head.str('movi');
  return { head: head.concat(), idx1 };
}

/** The 8-byte header of a movi frame chunk. */
function frameHeader(size: number): Uint8Array {
  const h = new Uint8Array(8);
  h.set([0x30, 0x30, 0x64, 0x63]); // '00dc'
  new DataView(h.buffer).setUint32(4, size, true);
  return h;
}

/**
 * Build an AVI as a list of byte parts. Frame payloads are referenced, not copied, so a Blob made
 * from the parts never needs one huge contiguous buffer (important for long or high-res exports).
 */
export function writeAviParts(info: AviInfo, frames: WriteFrame[]): Uint8Array[] {
  const { head, idx1 } = aviSkeleton(info, frames.map((f) => ({ size: f.data.length, keyframe: f.keyframe })));
  const parts: Uint8Array[] = [head];
  const pad = new Uint8Array(1);
  for (const f of frames) {
    parts.push(frameHeader(f.data.length), f.data);
    if (f.data.length & 1) parts.push(pad);
  }
  parts.push(idx1);
  return parts;
}

export interface PlanFrame extends WriteFrame {
  /** payload on disk: `size` bytes at `off` in `file` (then `data` is only its first bytes) */
  size?: number;
  off?: number;
  file?: string;
}

/**
 * How to assemble an AVI from inline bytes and ranges of files on disk (for the desktop engine's
 * engine_assemble). pieces: [0, offset in inline, length] or [1, file index, offset, length].
 */
export interface AviPlan {
  files: string[];
  pieces: number[][];
  inline: Uint8Array;
}

export function aviPlan(info: AviInfo, frames: PlanFrame[]): AviPlan {
  const sizeOf = (f: PlanFrame) => (f.file !== undefined ? f.size! : f.data.length);
  const { head, idx1 } = aviSkeleton(info, frames.map((f) => ({ size: sizeOf(f), keyframe: f.keyframe })));
  const inline = new Writer();
  const pieces: number[][] = [];
  const files: string[] = [];
  const fileIdx = new Map<string, number>();
  const addInline = (b: Uint8Array) => {
    if (!b.length) return;
    const last = pieces[pieces.length - 1];
    if (last && last[0] === 0 && last[1] + last[2] === inline.length) last[2] += b.length;
    else pieces.push([0, inline.length, b.length]);
    inline.push(b);
  };
  addInline(head);
  const pad = new Uint8Array(1);
  for (const f of frames) {
    const size = sizeOf(f);
    addInline(frameHeader(size));
    if (f.file !== undefined) {
      let k = fileIdx.get(f.file);
      if (k === undefined) fileIdx.set(f.file, (k = files.push(f.file) - 1));
      pieces.push([1, k, f.off!, size]);
    } else addInline(f.data);
    if (size & 1) addInline(pad);
  }
  addInline(idx1);
  return { files, pieces, inline: inline.concat() };
}

export function writeAvi(info: AviInfo, frames: WriteFrame[]): Uint8Array {
  const parts = writeAviParts(info, frames);
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
