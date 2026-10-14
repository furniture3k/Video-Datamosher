// Audio that follows the mosh: each output frame plays the audio slice of its source frame,
// so blooms stutter, drops skip and shuffles scramble the sound in sync with the picture.
import type { AudioSettings, Frame } from './types';
import { makeRng } from './rng';

export const SAMPLE_RATE = 44100;

/** pcm: interleaved stereo Int16 */
export function buildAudio(pcm: Int16Array, frames: Pick<Frame, 'src' | 'tag' | 'at'>[], fps: number, s: AudioSettings, seed = 1): Int16Array {
  const spf = SAMPLE_RATE / fps;
  const outLen = Math.round(frames.length * spf);
  const out = new Int16Array(outLen * 2);
  const srcLen = pcm.length / 2;
  if (s.mode === 'original') {
    out.set(pcm.subarray(0, Math.min(pcm.length, out.length)));
  } else {
    const fade = s.crossfade ? Math.min(64, Math.floor(spf / 4)) : 0;
    const rng = makeRng(seed);
    frames.forEach((f, i) => {
      const o0 = Math.round(i * spf);
      const o1 = Math.round((i + 1) * spf);
      // borrowed motion (Motion Transfer) keeps the sound of the place it is shown at
      const s0 = Math.round((f.tag === 'spliced' ? (f.at ?? f.src) : f.src) * spf);
      const rev = s.reverseChunks > 0 && f.tag !== 'orig' && rng.chance(s.reverseChunks);
      const n = o1 - o0;
      for (let k = 0; k < n; k++) {
        const si = s0 + (rev ? n - 1 - k : k);
        if (si < 0 || si >= srcLen) continue;
        let g = 1;
        if (fade) g = Math.min(1, (k + 1) / fade, (n - k) / fade);
        out[(o0 + k) * 2] = pcm[si * 2] * g;
        out[(o0 + k) * 2 + 1] = pcm[si * 2 + 1] * g;
      }
    });
  }
  return processAudio(out, s, seed);
}

export function processAudio(buf: Int16Array, s: AudioSettings, seed = 1): Int16Array {
  const rng = makeRng(seed ^ 0xa5a5);
  const bits = Math.max(1, Math.min(16, Math.round(s.bitcrush)));
  const step = 1 << (16 - bits);
  const ds = Math.max(1, Math.round(s.downsample));
  let holdL = 0;
  let holdR = 0;
  for (let i = 0; i < buf.length / 2; i++) {
    let l = buf[i * 2] * s.volume;
    let r = buf[i * 2 + 1] * s.volume;
    if (ds > 1) {
      if (i % ds === 0) {
        holdL = l;
        holdR = r;
      } else {
        l = holdL;
        r = holdR;
      }
    }
    if (bits < 16) {
      l = Math.round(l / step) * step;
      r = Math.round(r / step) * step;
    }
    if (s.glitch > 0 && rng() < s.glitch * 0.002) {
      // byte-level damage: flip a high bit, like corrupting raw PCM
      const bit = 1 << rng.int(8, 14);
      l = l ^ bit;
      r = r ^ bit;
    }
    buf[i * 2] = Math.max(-32768, Math.min(32767, l));
    buf[i * 2 + 1] = Math.max(-32768, Math.min(32767, r));
  }
  return buf;
}

export function wav(pcm: Int16Array, rate = SAMPLE_RATE, channels = 2): Uint8Array {
  const [head, data] = wavParts(pcm, rate, channels);
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  return out;
}

/** A WAV file as [44-byte header, the samples' bytes (not copied)]. */
export function wavParts(pcm: Int16Array, rate = SAMPLE_RATE, channels = 2): [Uint8Array, Uint8Array] {
  const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const out = new Uint8Array(44);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + data.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, data.length, true);
  return [out, data];
}
