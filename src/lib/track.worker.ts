// Tracking and stabilization off the main thread: the page stays responsive on long clips.
import { trackBox, stabilize, type Gray } from '../engine/track';

export type TrackJob =
  | { kind: 'track'; w: number; h: number; buf: ArrayBuffer; start: number; cx: number; cy: number; bw: number; bh: number; dir: 1 | -1 }
  | { kind: 'stabilize'; w: number; h: number; buf: ArrayBuffer; radius: number };

export function runJob(j: TrackJob) {
  const n = Math.floor(j.buf.byteLength / (j.w * j.h));
  const g: Gray = { w: j.w, h: j.h, frames: Array.from({ length: n }, (_, i) => new Uint8Array(j.buf, i * j.w * j.h, j.w * j.h)) };
  return j.kind === 'track' ? trackBox(g, j.start, j.cx, j.cy, j.bw, j.bh, j.dir) : stabilize(g, j.radius);
}

self.onmessage = (e: MessageEvent<TrackJob>) => {
  try {
    self.postMessage({ ok: runJob(e.data) });
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
