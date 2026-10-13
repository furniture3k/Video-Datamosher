// Frame-type detection for the codecs we mosh with.
import type { FrameType } from './types';

export type MoshCodec = 'mpeg4' | 'mpeg2' | 'mpeg1';

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

export function analyzeFrame(d: Uint8Array, codec: MoshCodec): FrameAnalysis {
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
