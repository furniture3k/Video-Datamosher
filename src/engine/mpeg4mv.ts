// SPIKE: editing the motion vectors inside MPEG-4 Part 2 (Xvid) P-frames.
//
// Parses a P-VOP down to the macroblock layer (for the stream moshpit's encoder makes: rectangular,
// progressive, no data partitioning, no quarter-pel, one vector per macroblock; video packets with
// resync markers, which FFmpeg's slice-threaded encoder writes, are handled),
// rebuilds the motion-vector field with the codec's median prediction, lets you change it, and
// writes the frame back with every other bit untouched.
//
// VLC tables are from FFmpeg's libavcodec (h263data.c, mpeg4data.h; LGPL-2.1-or-later).

// ---------- bits ----------

class BitReader {
  pos = 0;
  constructor(public d: Uint8Array) {}
  get left() {
    return this.d.length * 8 - this.pos;
  }
  bit(): number {
    const b = (this.d[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return b;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
  peek(n: number): number {
    const p = this.pos;
    const v = this.bits(n);
    this.pos = p;
    return v;
  }
}

class BitWriter {
  private out: number[] = [];
  private cur = 0;
  private n = 0;
  put(v: number, bits: number) {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((v >> i) & 1);
      if (++this.n === 8) {
        this.out.push(this.cur);
        this.cur = 0;
        this.n = 0;
      }
    }
  }
  /** copy bits [a, b) of `src` */
  copy(src: Uint8Array, a: number, b: number) {
    for (let p = a; p < b; p++) this.put((src[p >> 3] >> (7 - (p & 7))) & 1, 1);
  }
  get length() {
    return this.out.length * 8 + this.n;
  }
  /** MPEG-4 stuffing: a 0, then 1s up to the byte boundary */
  stuff() {
    this.put(0, 1);
    const k = (8 - this.n) & 7;
    if (k) this.put((1 << k) - 1, k);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

// ---------- VLC tables (FFmpeg) ----------

type Vlc = [code: number, bits: number];

/** Decoder for a list of codes: returns the index of the code read. */
function vlc(table: Vlc[]) {
  const map = new Map<string, number>();
  table.forEach(([c, b], i) => b && map.set(`${b}:${c}`, i));
  const maxBits = Math.max(...table.map(([, b]) => b));
  return (r: BitReader): number => {
    let v = 0;
    for (let b = 1; b <= maxBits; b++) {
      v = (v << 1) | r.bit();
      const i = map.get(`${b}:${v}`);
      if (i !== undefined) return i;
    }
    throw new Error('bad VLC at bit ' + r.pos);
  };
}

const MCBPC_CODE = [1, 3, 2, 5, 3, 4, 3, 3, 3, 7, 6, 5, 4, 4, 3, 2, 2, 5, 4, 5, 1, 0, 0, 0, 2, 12, 14, 15];
const MCBPC_BITS = [1, 4, 4, 6, 5, 8, 8, 7, 3, 7, 7, 9, 6, 9, 9, 9, 3, 7, 7, 8, 9, 0, 0, 0, 11, 13, 13, 13];
const readMcbpc = vlc(MCBPC_CODE.map((c, i) => [c, MCBPC_BITS[i]]));

const CBPY: Vlc[] = [[3, 4], [5, 5], [4, 5], [9, 4], [3, 5], [7, 4], [2, 6], [11, 4], [2, 5], [3, 6], [5, 4], [10, 4], [4, 4], [8, 4], [6, 4], [3, 2]];
const readCbpy = vlc(CBPY);

const MVTAB: Vlc[] = [[1, 1], [1, 2], [1, 3], [1, 4], [3, 6], [5, 7], [4, 7], [3, 7], [11, 9], [10, 9], [9, 9], [17, 10], [16, 10], [15, 10], [14, 10], [13, 10], [12, 10], [11, 10], [10, 10], [9, 10], [8, 10], [7, 10], [6, 10], [5, 10], [4, 10], [7, 11], [6, 11], [5, 11], [4, 11], [3, 11], [2, 11], [3, 12], [2, 12]];
const readMv = vlc(MVTAB);

// inter / intra coefficient tables: 102 codes + escape (index 102)
const INTER_VLC: Vlc[] = [[0x2, 2], [0xf, 4], [0x15, 6], [0x17, 7], [0x1f, 8], [0x25, 9], [0x24, 9], [0x21, 10], [0x20, 10], [0x7, 11], [0x6, 11], [0x20, 11], [0x6, 3], [0x14, 6], [0x1e, 8], [0xf, 10], [0x21, 11], [0x50, 12], [0xe, 4], [0x1d, 8], [0xe, 10], [0x51, 12], [0xd, 5], [0x23, 9], [0xd, 10], [0xc, 5], [0x22, 9], [0x52, 12], [0xb, 5], [0xc, 10], [0x53, 12], [0x13, 6], [0xb, 10], [0x54, 12], [0x12, 6], [0xa, 10], [0x11, 6], [0x9, 10], [0x10, 6], [0x8, 10], [0x16, 7], [0x55, 12], [0x15, 7], [0x14, 7], [0x1c, 8], [0x1b, 8], [0x21, 9], [0x20, 9], [0x1f, 9], [0x1e, 9], [0x1d, 9], [0x1c, 9], [0x1b, 9], [0x1a, 9], [0x22, 11], [0x23, 11], [0x56, 12], [0x57, 12], [0x7, 4], [0x19, 9], [0x5, 11], [0xf, 6], [0x4, 11], [0xe, 6], [0xd, 6], [0xc, 6], [0x13, 7], [0x12, 7], [0x11, 7], [0x10, 7], [0x1a, 8], [0x19, 8], [0x18, 8], [0x17, 8], [0x16, 8], [0x15, 8], [0x14, 8], [0x13, 8], [0x18, 9], [0x17, 9], [0x16, 9], [0x15, 9], [0x14, 9], [0x13, 9], [0x12, 9], [0x11, 9], [0x7, 10], [0x6, 10], [0x5, 10], [0x4, 10], [0x24, 11], [0x25, 11], [0x26, 11], [0x27, 11], [0x58, 12], [0x59, 12], [0x5a, 12], [0x5b, 12], [0x5c, 12], [0x5d, 12], [0x5e, 12], [0x5f, 12], [0x3, 7]];
const INTRA_VLC: Vlc[] = [[0x2, 2], [0x6, 3], [0xf, 4], [0xd, 5], [0xc, 5], [0x15, 6], [0x13, 6], [0x12, 6], [0x17, 7], [0x1f, 8], [0x1e, 8], [0x1d, 8], [0x25, 9], [0x24, 9], [0x23, 9], [0x21, 9], [0x21, 10], [0x20, 10], [0xf, 10], [0xe, 10], [0x7, 11], [0x6, 11], [0x20, 11], [0x21, 11], [0x50, 12], [0x51, 12], [0x52, 12], [0xe, 4], [0x14, 6], [0x16, 7], [0x1c, 8], [0x20, 9], [0x1f, 9], [0xd, 10], [0x22, 11], [0x53, 12], [0x55, 12], [0xb, 5], [0x15, 7], [0x1e, 9], [0xc, 10], [0x56, 12], [0x11, 6], [0x1b, 8], [0x1d, 9], [0xb, 10], [0x10, 6], [0x22, 9], [0xa, 10], [0xd, 6], [0x1c, 9], [0x8, 10], [0x12, 7], [0x1b, 9], [0x54, 12], [0x14, 7], [0x1a, 9], [0x57, 12], [0x19, 8], [0x9, 10], [0x18, 8], [0x23, 11], [0x17, 8], [0x19, 9], [0x18, 9], [0x7, 10], [0x58, 12], [0x7, 4], [0xc, 6], [0x16, 8], [0x17, 9], [0x6, 10], [0x5, 11], [0x4, 11], [0x59, 12], [0xf, 6], [0x16, 9], [0x5, 10], [0xe, 6], [0x4, 10], [0x11, 7], [0x24, 11], [0x10, 7], [0x25, 11], [0x13, 7], [0x5a, 12], [0x15, 8], [0x5b, 12], [0x14, 8], [0x13, 8], [0x1a, 8], [0x15, 9], [0x14, 9], [0x13, 9], [0x12, 9], [0x11, 9], [0x26, 11], [0x27, 11], [0x5c, 12], [0x5d, 12], [0x5e, 12], [0x5f, 12], [0x3, 7]];
const readInter = vlc(INTER_VLC);
const readIntra = vlc(INTRA_VLC);
const ESC = 102;

const DC_LUM: Vlc[] = [[3, 3], [3, 2], [2, 2], [2, 3], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11]];
const DC_CHROM: Vlc[] = [[3, 2], [2, 2], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], [1, 12]];
const readDcLum = vlc(DC_LUM);
const readDcChrom = vlc(DC_CHROM);

/** Skip one block's coefficients (bits only; values aren't needed). `lastFrom`: first index with last = 1. */
function skipCoefficients(r: BitReader, read: (r: BitReader) => number, lastFrom: number) {
  for (;;) {
    const i = read(r);
    let last: number;
    if (i === ESC) {
      if (r.bit() === 0) {
        // escape 1: another code, level offset
        const j = read(r);
        last = j >= lastFrom ? 1 : 0;
        r.bit();
      } else if (r.bit() === 0) {
        // escape 2: another code, run offset
        const j = read(r);
        last = j >= lastFrom ? 1 : 0;
        r.bit();
      } else {
        // escape 3: last, run (6), marker, level (12), marker
        last = r.bit();
        r.bits(6 + 1 + 12 + 1);
      }
    } else {
      last = i >= lastFrom ? 1 : 0;
      r.bit(); // sign
    }
    if (last) return;
  }
}

// ---------- headers ----------

export interface Vol {
  width: number;
  height: number;
  timeIncBits: number;
  quarterSample: boolean;
  resyncMarkerDisable: boolean;
  dataPartitioned: boolean;
  interlaced: boolean;
  quantPrecision: number;
}

const findCode = (d: Uint8Array, from: number, test: (c: number) => boolean): number => {
  for (let i = from; i + 3 < d.length; i++) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1 && test(d[i + 3])) return i;
  return -1;
};

/** Read the video object layer header (in the first keyframe's chunk). */
export function parseVol(d: Uint8Array): Vol {
  const at = findCode(d, 0, (c) => c >= 0x20 && c <= 0x2f);
  if (at < 0) throw new Error('no VOL header');
  const r = new BitReader(d.subarray(at + 4));
  r.bit(); // random_accessible_vol
  r.bits(8); // video_object_type_indication
  let verid = 1;
  if (r.bit()) {
    verid = r.bits(4);
    r.bits(3);
  }
  if (r.bits(4) === 15) r.bits(16); // aspect ratio
  if (r.bit()) {
    // vol_control_parameters
    r.bits(2);
    r.bit();
    if (r.bit()) r.bits(15 + 1 + 15 + 1 + 15 + 1 + 3 + 11 + 1 + 15 + 1);
  }
  const shape = r.bits(2);
  if (shape !== 0) throw new Error('only rectangular video is supported');
  r.bit();
  const res = r.bits(16);
  r.bit();
  const timeIncBits = Math.max(1, Math.ceil(Math.log2(res)));
  if (r.bit()) r.bits(timeIncBits); // fixed_vop_rate
  r.bit();
  const width = r.bits(13);
  r.bit();
  const height = r.bits(13);
  r.bit();
  const interlaced = !!r.bit();
  r.bit(); // obmc_disable
  if ((verid === 1 ? r.bit() : r.bits(2)) !== 0) throw new Error('sprites are not supported');
  let quantPrecision = 5;
  if (r.bit()) {
    quantPrecision = r.bits(4);
    r.bits(4);
  }
  if (r.bit()) throw new Error('MPEG quantisation matrices are not supported');
  const quarterSample = verid !== 1 ? !!r.bit() : false;
  if (!r.bit()) throw new Error('complexity estimation is not supported');
  const resyncMarkerDisable = !!r.bit();
  const dataPartitioned = !!r.bit();
  return { width, height, timeIncBits, quarterSample, resyncMarkerDisable, dataPartitioned, interlaced, quantPrecision };
}

// ---------- P-VOPs ----------

export interface MotionField {
  mbw: number;
  mbh: number;
  fcode: number;
  /** per macroblock: [x, y] in half pixels, or null for intra macroblocks */
  mv: ([number, number] | null)[];
}

interface MvdField {
  /** bit range of the two codes in the frame */
  start: number;
  end: number;
  mb: number;
}

/** A video packet boundary: stuffing from `stuff`, the resync marker from `marker` (byte aligned). */
interface Packet {
  mb: number;
  stuff: number;
  marker: number;
}

interface ParsedVop {
  field: MotionField;
  fields: MvdField[];
  packets: Packet[];
  /** first bit after the macroblocks */
  end: number;
}

/** FFmpeg's prediction context: where the current video packet started. */
interface Slice {
  resyncX: number;
  resyncY: number;
  /** the top neighbours are outside the packet */
  firstLine: boolean;
}

const decodeMvd = (r: BitReader, fcode: number): number => {
  const code = readMv(r);
  if (code === 0) return 0;
  const sign = r.bit();
  let v = code;
  const shift = fcode - 1;
  if (shift) v = (((v - 1) << shift) | r.bits(shift)) + 1;
  return sign ? -v : v;
};

function encodeMvd(w: BitWriter, val: number, fcode: number) {
  const bitSize = fcode - 1;
  const range = 1 << bitSize;
  // wrap into the coded range
  const lim = 32 << bitSize;
  val = ((((val + lim) % (2 * lim)) + 2 * lim) % (2 * lim)) - lim;
  if (val === 0) return w.put(MVTAB[0][0], MVTAB[0][1]);
  const sign = val < 0 ? 1 : 0;
  const a = Math.abs(val) - 1;
  const code = (a >> bitSize) + 1;
  const bits = a & (range - 1);
  w.put((MVTAB[code][0] << 1) | sign, MVTAB[code][1] + 1);
  if (bitSize > 0) w.put(bits, bitSize);
}

const median = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
const wrap = (v: number, fcode: number) => {
  const lim = 32 << (fcode - 1);
  return v < -lim ? v + 2 * lim : v >= lim ? v - 2 * lim : v;
};

/**
 * The codec's prediction for macroblock (x, y) from its decoded neighbours (one vector each),
 * following FFmpeg's ff_h263_pred_motion, including its rules at video packet starts.
 */
function predict(f: MotionField, x: number, y: number, s: Slice): [number, number] {
  const at = (i: number, j: number): [number, number] => (i < 0 || i >= f.mbw || j < 0 ? [0, 0] : (f.mv[j * f.mbw + i] ?? [0, 0]));
  const A = at(x - 1, y);
  if (s.firstLine) {
    if (x === s.resyncX) return [0, 0];
    if (x + 1 === s.resyncX) {
      const C = at(x + 1, y - 1);
      return x === 0 ? C : [median(A[0], 0, C[0]), median(A[1], 0, C[1])];
    }
    return A;
  }
  const B = at(x, y - 1);
  const C = at(x + 1, y - 1);
  return [median(A[0], B[0], C[0]), median(A[1], B[1], C[1])];
}

/** The packet context at macroblock (x, y): the first line ends where the packet's next row passes its start. */
function advance(s: Slice, x: number, y: number) {
  if (s.firstLine && x === s.resyncX && y === s.resyncY + 1) s.firstLine = false;
}

/** Is a video packet (stuffing to the byte boundary, then a resync marker) next? Returns the aligned bit position. */
function resyncAt(r: BitReader, fcode: number): number {
  const p = r.pos;
  const k = 8 - (p & 7);
  if (r.left < k + 17) return -1;
  // stuffing: a 0 then 1s up to the boundary
  if (r.peek(k) !== (1 << (k - 1)) - 1) return -1;
  r.pos = p + k;
  const zeros = 16 + fcode - 1;
  const ok = r.peek(zeros + 1) === 1;
  r.pos = p;
  return ok ? p + k : -1;
}

/** Parse a P-VOP chunk: its vector field and where the vector codes are. */
export function parsePVop(chunk: Uint8Array, vol: Vol): ParsedVop {
  if (vol.dataPartitioned) throw new Error('data partitioning is not supported');
  if (vol.interlaced || vol.quarterSample) throw new Error('interlaced / quarter-pel streams are not supported');
  const at = findCode(chunk, 0, (c) => c === 0xb6);
  if (at < 0) throw new Error('no VOP');
  const r = new BitReader(chunk);
  r.pos = (at + 4) * 8;
  const type = r.bits(2);
  if (type !== 1) throw new Error('not a P-VOP');
  while (r.bit()); // modulo_time_base
  r.bit();
  r.bits(vol.timeIncBits);
  r.bit();
  if (!r.bit()) throw new Error('VOP not coded');
  r.bit(); // rounding type
  r.bits(3); // intra_dc_vlc_thr (moshpit's encoder: 0 = DC always VLC coded)
  r.bits(vol.quantPrecision);
  const fcode = r.bits(3);
  if (fcode === 0) throw new Error('bad f_code');
  const mbw = Math.ceil(vol.width / 16);
  const mbh = Math.ceil(vol.height / 16);
  const field: MotionField = { mbw, mbh, fcode, mv: new Array(mbw * mbh).fill([0, 0]) };
  const fields: MvdField[] = [];
  const packets: Packet[] = [];
  const mbBits = Math.ceil(Math.log2(mbw * mbh));
  const slice: Slice = { resyncX: 0, resyncY: 0, firstLine: true };
  for (let mb = 0; mb < mbw * mbh; mb++) {
    if (!vol.resyncMarkerDisable && mb > 0) {
      const aligned = resyncAt(r, fcode);
      if (aligned >= 0) {
        packets.push({ mb, stuff: r.pos, marker: aligned });
        r.pos = aligned + 16 + fcode;
        const n = r.bits(mbBits);
        if (n !== mb) throw new Error(`video packet starts at macroblock ${n}, expected ${mb}`);
        r.bits(vol.quantPrecision);
        if (r.bit()) throw new Error('header extension in video packets is not supported');
        Object.assign(slice, { resyncX: mb % mbw, resyncY: Math.floor(mb / mbw), firstLine: true });
      }
    }
    advance(slice, mb % mbw, Math.floor(mb / mbw));
    // like FFmpeg: after MCBPC stuffing, the not-coded flag comes again
    let i = 20;
    let skipped = false;
    while (i === 20) {
      if (r.bit()) {
        skipped = true;
        break;
      }
      i = readMcbpc(r);
    }
    if (skipped) {
      field.mv[mb] = [0, 0]; // not coded: skipped, zero motion
      continue;
    }
    const type = i >> 2;
    const cbpc = i & 3;
    const intra = type === 1 || type === 3;
    if (type === 4 || type === 6) throw new Error('four vectors per macroblock (4MV) is not supported');
    if (intra) r.bit(); // ac_pred_flag
    const cbpy = readCbpy(r);
    const cbp = ((intra ? cbpy : 15 - cbpy) << 2) | cbpc;
    if (type === 2 || type === 3) r.bits(2); // dquant
    if (!intra) {
      const start = r.pos;
      const dx = decodeMvd(r, fcode);
      const dy = decodeMvd(r, fcode);
      fields.push({ start, end: r.pos, mb });
      const p = predict(field, mb % mbw, Math.floor(mb / mbw), slice);
      field.mv[mb] = [wrap(p[0] + dx, fcode), wrap(p[1] + dy, fcode)];
    } else field.mv[mb] = null;
    for (let b = 0; b < 6; b++) {
      if (intra) {
        const size = b < 4 ? readDcLum(r) : readDcChrom(r);
        if (size) {
          r.bits(size);
          if (size > 8) r.bit();
        }
      }
      if (cbp & (32 >> b)) skipCoefficients(r, intra ? readIntra : readInter, intra ? 67 : 58);
    }
  }
  return { field, fields, packets, end: r.pos };
}

/** Write a P-VOP back with a new vector field (`mv`, same layout); everything else is copied. */
export function writePVop(chunk: Uint8Array, parsed: ParsedVop, mv: MotionField['mv']): Uint8Array {
  const { field, fields, packets } = parsed;
  const out: MotionField = { ...field, mv: new Array(field.mv.length).fill([0, 0]) };
  const w = new BitWriter();
  let p = 0;
  let k = 0;
  let q = 0;
  const slice: Slice = { resyncX: 0, resyncY: 0, firstLine: true };
  for (let mb = 0; mb < field.mv.length; mb++) {
    const pk = packets[q];
    if (pk && pk.mb === mb) {
      // a new video packet: its resync marker must stay byte aligned, so the stuffing is redone
      w.copy(chunk, p, pk.stuff);
      w.stuff();
      p = pk.marker;
      q++;
      Object.assign(slice, { resyncX: mb % field.mbw, resyncY: Math.floor(mb / field.mbw), firstLine: true });
    }
    advance(slice, mb % field.mbw, Math.floor(mb / field.mbw));
    const f = fields[k];
    if (f && f.mb === mb) {
      w.copy(chunk, p, f.start);
      const want = mv[mb] ?? [0, 0];
      const pred = predict(out, mb % field.mbw, Math.floor(mb / field.mbw), slice);
      encodeMvd(w, want[0] - pred[0], field.fcode);
      encodeMvd(w, want[1] - pred[1], field.fcode);
      out.mv[mb] = [wrap(want[0], field.fcode), wrap(want[1], field.fcode)];
      p = f.end;
      k++;
    } else out.mv[mb] = field.mv[mb] === null ? null : [0, 0];
  }
  w.copy(chunk, p, parsed.end);
  w.stuff();
  return w.bytes();
}

/** Clamp a vector field to what the frame's f_code can express. */
export function clampField(mv: MotionField['mv'], fcode: number): MotionField['mv'] {
  const lim = (32 << (fcode - 1)) - 1;
  return mv.map((v) => (v ? [Math.max(-lim, Math.min(lim, Math.round(v[0]))), Math.max(-lim, Math.min(lim, Math.round(v[1])))] : null));
}
