// Faces found frame by frame, linked into one path per face (pure). Each detection is a box in
// the picture (shares of it); a face carries on to the nearest box in the next frames, and a
// face lost for longer than `gap` frames ends.

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceTrack {
  /** [frame, centre x, centre y] */
  pts: [number, number, number][];
  /** the box's average size */
  size: [number, number];
}

/** Link per-frame boxes into tracks; tracks shorter than `minFrames` are dropped (false finds). */
export function linkFaces(frames: FaceBox[][], gap = 6, minFrames = 3): FaceTrack[] {
  interface Open {
    pts: [number, number, number][];
    sizes: [number, number][];
    last: number;
  }
  const open: Open[] = [];
  const done: Open[] = [];
  frames.forEach((boxes, f) => {
    const free = new Set(open.map((_, i) => i));
    // nearest first, so two faces next to each other don't swap
    const pairs: [number, number, number][] = [];
    boxes.forEach((b, bi) =>
      open.forEach((o, oi) => {
        const [, px, py] = o.pts[o.pts.length - 1];
        const d = Math.hypot(b.x + b.w / 2 - px, b.y + b.h / 2 - py);
        // it can move about a face's width a frame, more after being lost a while
        if (d < Math.max(b.w, b.h) * (1 + (f - o.last) * 0.5)) pairs.push([d, bi, oi]);
      }),
    );
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set<number>();
    for (const [, bi, oi] of pairs) {
      if (used.has(bi) || !free.has(oi)) continue;
      used.add(bi);
      free.delete(oi);
      const b = boxes[bi];
      open[oi].pts.push([f, b.x + b.w / 2, b.y + b.h / 2]);
      open[oi].sizes.push([b.w, b.h]);
      open[oi].last = f;
    }
    boxes.forEach((b, bi) => {
      if (!used.has(bi)) open.push({ pts: [[f, b.x + b.w / 2, b.y + b.h / 2]], sizes: [[b.w, b.h]], last: f });
    });
    // faces not seen for too long are finished
    for (let i = open.length - 1; i >= 0; i--) if (f - open[i].last > gap) done.push(...open.splice(i, 1));
  });
  done.push(...open);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return done
    .filter((o) => o.pts.length >= minFrames)
    .sort((a, b) => a.pts[0][0] - b.pts[0][0])
    .map((o) => ({
      pts: o.pts.map(([f, x, y]) => [f, r4(x), r4(y)] as [number, number, number]),
      size: [r4(o.sizes.reduce((s, z) => s + z[0], 0) / o.sizes.length), r4(o.sizes.reduce((s, z) => s + z[1], 0) / o.sizes.length)],
    }));
}
