// A picture per frame from one canvas, encoded a few at a time. toBlob copies the canvas when it is
// called and encodes it off the main thread, so the next frame can be drawn while earlier ones are
// still being encoded (instead of waiting for each in turn).

/** Frames being encoded at once: each holds a copy of the picture until it's done. */
const IN_FLIGHT = 6;

/**
 * `draw(k)` draws frame k on `canvas`; resolves with the encoded frames in order. `draw` may throw
 * (a cancelled render): the frames already on their way are let go.
 */
export async function encodeFrames(canvas: HTMLCanvasElement, count: number, draw: (k: number) => void, type = 'image/png', quality?: number): Promise<Blob[]> {
  const out: Promise<Blob>[] = [];
  for (let k = 0; k < count; k++) {
    draw(k);
    const p = new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('drawing a frame failed'))), type, quality));
    // (a failure is reported by the Promise.all below, or not at all when drawing stopped first)
    p.catch(() => {});
    out.push(p);
    if (k >= IN_FLIGHT) await out[k - IN_FLIGHT];
  }
  return Promise.all(out);
}
