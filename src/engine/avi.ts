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

  const s = strh as Uint8Array;
  const h = avih as Uint8Array;
  const info: AviInfo = {
    fourcc: fourcc(s, 4),
    scale: u32(s, 20) || 1,
    rate: u32(s, 24) || 25,
    width: u32(h, 32),
    height: u32(h, 36),
    strh: s,
    strf: strf as Uint8Array,
    avih: h,
  };
  return { info, chunks };
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

/**
 * Build an AVI as a list of byte parts. Frame payloads are referenced, not copied, so a Blob made
 * from the parts never needs one huge contiguous buffer (important for long or high-res exports).
 */
export function writeAviParts(info: AviInfo, frames: WriteFrame[]): Uint8Array[] {
  let maxSize = 0;
  let total = 0;
  for (const f of frames) {
    maxSize = Math.max(maxSize, f.data.length);
    total += f.data.length;
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

  // movi: chunk headers + payloads (+ pad bytes), referenced in place
  const moviParts: Uint8Array[] = [];
  const idx = new Writer();
  let off = 4; // offsets relative to the 'movi' fourcc
  const pad = new Uint8Array(1);
  for (const f of frames) {
    const h = new Uint8Array(8);
    h.set([0x30, 0x30, 0x64, 0x63]); // '00dc'
    new DataView(h.buffer).setUint32(4, f.data.length, true);
    moviParts.push(h, f.data);
    if (f.data.length & 1) moviParts.push(pad);
    idx.str('00dc');
    idx.u32(f.keyframe ? 0x10 : 0);
    idx.u32(off);
    idx.u32(f.data.length);
    off += 8 + f.data.length + (f.data.length & 1);
  }
  const moviBody = off; // 'movi' fourcc + chunks
  const moviHead = new Writer();
  moviHead.str('LIST');
  moviHead.u32(moviBody);
  moviHead.str('movi');
  const idx1 = chunk('idx1', idx.concat());

  const riffBody = 4 + hdrl.length + 8 + moviBody + idx1.length;
  const head = new Writer();
  head.str('RIFF');
  head.u32(riffBody);
  head.str('AVI ');
  head.push(hdrl);
  head.push(moviHead.concat());
  return [head.concat(), ...moviParts, idx1];
}

export function writeAvi(info: AviInfo, frames: WriteFrame[]): Uint8Array {
  const parts = writeAviParts(info, frames);
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
