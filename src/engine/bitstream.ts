// Frame-type detection for the codecs we mosh with.
import type { FrameType } from './types';

export type MoshCodec = 'mpeg4' | 'mpeg2' | 'mpeg1' | 'h264';

/** Find "00 00 01 <code>" start code; returns index of the 00 or -1. */
export function findStartCode(d: Uint8Array, code: number, from = 0): number {
  for (let i = from; i + 3 < d.length; i++) {
    if (d[i + 2] > 1) {
      i += 2;
      continue;
    }
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1 && d[i + 3] === code) return i;
  }
  return -1;
}

export interface FrameAnalysis {
  type: FrameType;
  /** byte offset where the picture (VOP) payload starts — bytes before it are headers */
  payloadStart: number;
  /** true when the chunk carries sequence/VOL headers */
  hasHeaders: boolean;
}

/**
 * Reads unsigned Exp-Golomb numbers (H.264's ue(v)) from the start of a NAL unit's payload,
 * skipping emulation-prevention bytes (00 00 03).
 */
class BitReader {
  private bit = 0;
  private bytes: number[] = [];
  constructor(d: Uint8Array, from: number, len = 16) {
    let zeros = 0;
    for (let i = from; i < d.length && this.bytes.length < len; i++) {
      if (zeros >= 2 && d[i] === 3) {
        zeros = 0;
        continue;
      }
      zeros = d[i] === 0 ? zeros + 1 : 0;
      this.bytes.push(d[i]);
    }
  }
  private one(): number {
    const b = this.bytes[this.bit >> 3];
    if (b === undefined) throw new Error('out of bits');
    return (b >> (7 - (this.bit++ & 7))) & 1;
  }
  ue(): number {
    let z = 0;
    while (this.one() === 0) if (++z > 31) throw new Error('bad exp-golomb');
    let v = 1;
    for (let i = 0; i < z; i++) v = (v << 1) | this.one();
    return v - 1;
  }
}

/**
 * H.264 (Annex B, as ffmpeg writes it into AVI): an access unit is a run of NAL units, each after
 * a 00 00 01 start code. Parameter sets (7, 8) and SEI (6) are headers; an IDR slice (5) is a
 * keyframe; any other slice (1) says its type in slice_type (P, B, I, SP, SI).
 */
function analyzeH264(d: Uint8Array): FrameAnalysis {
  let i = findStartCode24(d, 0);
  let hasHeaders = false;
  while (i >= 0) {
    const nal = i + 3;
    const t = d[nal] & 0x1f;
    if (t === 7 || t === 8 || t === 6) hasHeaders = true;
    if (t === 5) return { type: 'I', payloadStart: nal + 5, hasHeaders };
    if (t === 1) {
      try {
        const r = new BitReader(d, nal + 1);
        r.ue(); // first_mb_in_slice
        const st = r.ue() % 5;
        const type: FrameType = st === 0 || st === 3 ? 'P' : st === 1 ? 'B' : 'I';
        return { type, payloadStart: nal + 5, hasHeaders };
      } catch {
        return { type: '?', payloadStart: nal + 5, hasHeaders };
      }
    }
    i = findStartCode24(d, nal);
  }
  return { type: '?', payloadStart: 0, hasHeaders };
}

/** Next 00 00 01 at or after `from`: the index of its first 00, or -1. */
function findStartCode24(d: Uint8Array, from: number): number {
  for (let i = from; i + 2 < d.length; i++) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) return i;
  return -1;
}

export function analyzeFrame(d: Uint8Array, codec: MoshCodec): FrameAnalysis {
  if (codec === 'h264') return analyzeH264(d);
  if (codec === 'mpeg4') {
    const vop = findStartCode(d, 0xb6);
    if (vop < 0 || vop + 4 >= d.length) return { type: '?', payloadStart: 0, hasHeaders: false };
    const t = d[vop + 4] >> 6;
    // VOP header is roughly: start code(4) + type/time bits (~2-4 bytes) + quant
    return {
      type: (['I', 'P', 'B', 'S'] as FrameType[])[t],
      payloadStart: vop + 8,
      hasHeaders: vop > 0,
    };
  }
  // MPEG-1/2: picture start code 00 00 01 00, then 10 bits temporal ref, 3 bits coding type
  const pic = findStartCode(d, 0x00);
  if (pic < 0 || pic + 6 >= d.length) return { type: '?', payloadStart: 0, hasHeaders: false };
  const ct = (d[pic + 5] >> 3) & 7;
  const type: FrameType = ct === 1 ? 'I' : ct === 2 ? 'P' : ct === 3 ? 'B' : '?';
  // first slice start code (01..AF) marks payload
  let payloadStart = pic + 8;
  for (let i = pic + 4; i + 3 < d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1 && d[i + 3] >= 1 && d[i + 3] <= 0xaf) {
      payloadStart = i + 6;
      break;
    }
  }
  return { type, payloadStart, hasHeaders: pic > 0 };
}

// ---------------------------------------------------------------- H.264 frame numbers

/**
 * Raw bytes of a NAL unit with its emulation-prevention bytes (00 00 03) taken out, and for each
 * of those bytes where it is in the original.
 */
function rbsp(d: Uint8Array, from: number, len: number): { bytes: number[]; at: number[] } {
  const bytes: number[] = [];
  const at: number[] = [];
  let zeros = 0;
  for (let i = from; i < d.length && bytes.length < len; i++) {
    if (zeros >= 2 && d[i] === 3) {
      zeros = 0;
      continue;
    }
    zeros = d[i] === 0 ? zeros + 1 : 0;
    bytes.push(d[i]);
    at.push(i);
  }
  return { bytes, at };
}

class Bits {
  pos = 0;
  constructor(private b: number[]) {}
  one(): number {
    const v = this.b[this.pos >> 3];
    if (v === undefined) throw new Error('out of bits');
    return (v >> (7 - (this.pos++ & 7))) & 1;
  }
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.one();
    return v;
  }
  ue(): number {
    let z = 0;
    while (this.one() === 0) if (++z > 31) throw new Error('bad exp-golomb');
    return ((1 << z) | this.u(z)) - 1;
  }
}

/** log2(MaxFrameNum) from a sequence parameter set (Baseline / Main; High's extra fields too). */
export function spsFrameNumBits(d: Uint8Array, nal: number): number | null {
  try {
    const r = new Bits(rbsp(d, nal + 1, 32).bytes);
    const profile = r.u(8);
    r.u(16); // constraint flags, level
    r.ue(); // sps id
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      if (r.ue() === 3) r.u(1);
      r.ue();
      r.ue();
      r.u(1);
      if (r.u(1)) return null; // scaling lists: not what our encoder writes
    }
    return r.ue() + 4;
  } catch {
    return null;
  }
}

const renumbered = new WeakMap<Uint8Array, Map<number, Uint8Array>>();

/** The frame with its slice's frame_num set to `num` (the same array when it already is). */
function withFrameNum(d: Uint8Array, bits: number, num: number): Uint8Array {
  let hit = renumbered.get(d)?.get(num);
  if (hit) return hit;
  let i = findStartCode24(d, 0);
  while (i >= 0 && (d[i + 3] & 0x1f) !== 1) i = findStartCode24(d, i + 3);
  if (i < 0) return d;
  const { bytes, at } = rbsp(d, i + 4, 16);
  let out = d;
  try {
    const r = new Bits(bytes);
    r.ue(); // first_mb_in_slice
    r.ue(); // slice_type
    r.ue(); // pic_parameter_set_id
    const start = r.pos;
    if (r.u(bits) === num) return d;
    const nb = bytes.slice();
    for (let k = 0; k < bits; k++) {
      const p = start + k;
      const bit = (num >> (bits - 1 - k)) & 1;
      nb[p >> 3] = (nb[p >> 3] & ~(1 << (7 - (p & 7)))) | (bit << (7 - (p & 7)));
    }
    // only the bytes that changed are written back; a change that would make or break a
    // 00 00 0x pattern next to them would need re-escaping, so such a frame is left as it was
    const last = (start + bits - 1) >> 3;
    out = d.slice();
    for (let k = start >> 3; k <= last; k++) out[at[k]] = nb[k];
    const lo = Math.max(i + 4, at[start >> 3] - 2);
    const hi = Math.min(out.length - 1, at[last] + 3);
    for (let k = lo; k + 2 <= hi; k++) if (out[k] === 0 && out[k + 1] === 0 && out[k + 2] <= 3) out = d;
    for (let k = lo; k + 2 <= hi; k++) if (d[k] === 0 && d[k + 1] === 0 && d[k + 2] === 3 && (out[k] !== 0 || out[k + 1] !== 0)) out = d;
  } catch {
    out = d;
  }
  if (!renumbered.has(d)) renumbered.set(d, new Map());
  renumbered.get(d)!.set(num, out);
  hit = out;
  return hit;
}

/**
 * H.264 numbers its frames (frame_num), and without B-frames the order frames are shown in comes
 * from those numbers. A removed keyframe (they reset the count) or a repeated frame makes the
 * numbers jump back, and the decoder drops what looks late. So after moshing, the frames are
 * numbered again in the order they now play: each keyframe that's left starts at 0, as it must.
 */
export function renumberH264<F extends { data: Uint8Array; type: FrameType }>(frames: F[]): F[] {
  let bits: number | null = null;
  let n = 0;
  return frames.map((f) => {
    const d = f.data;
    let i = findStartCode24(d, 0);
    let idr = false;
    while (i >= 0) {
      const t = d[i + 3] & 0x1f;
      if (t === 7) bits = spsFrameNumBits(d, i + 3) ?? bits;
      if (t === 5) idr = true;
      if (t === 1 || t === 5) break;
      i = findStartCode24(d, i + 3);
    }
    if (idr || bits === null) {
      n = 1;
      return f;
    }
    const num = n++ % (1 << bits);
    const data = withFrameNum(d, bits, num);
    return data === d ? f : { ...f, data };
  });
}
