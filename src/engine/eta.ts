// "About 12 s left": an estimate of the time a render stage still needs, from how fast its progress
// has moved over the last few seconds. Starts over when the stage changes.

export class Eta {
  private stage = '';
  private samples: [number, number][] = [];

  /** Record progress (0..1) of a stage at time `now` (ms); returns seconds left, or null when unknown. */
  update(stage: string, progress: number, now = performance.now()): number | null {
    if (stage !== this.stage) {
      this.stage = stage;
      this.samples = [];
    }
    this.samples.push([now, progress]);
    // the last ~6 s
    while (this.samples.length > 2 && now - this.samples[0][0] > 6000) this.samples.shift();
    const [t0, p0] = this.samples[0];
    const dt = now - t0;
    const dp = progress - p0;
    // too early, or not moving: no guess (a wrong number is worse than none)
    if (dt < 1500 || dp <= 0.01) return null;
    return Math.max(0, ((1 - progress) * dt) / dp / 1000);
  }

  reset() {
    this.stage = '';
    this.samples = [];
  }
}

/** 12 → "12 s", 95 → "1 min 35 s", 4000 → "1 h 7 min". */
export function formatSeconds(s: number): string {
  if (s < 1) return 'a moment';
  if (s < 60) return `${Math.ceil(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 >= 5 ? ` ${Math.round(s % 60)} s` : ''}`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/**
 * The preview render goes through these stages in order, each with a rough share of the time.
 * Combining them gives one bar that only moves forward (stage percentages each start at 0).
 */
const STAGES: [RegExp, number][] = [
  [/^Preparing/, 0.55],
  [/^Moshing|^Generation/, 0.05],
  [/^Decoding/, 0.32],
  [/^Pixel effects/, 0.08],
];

/** How far through the whole render, 0..1, from the stage and its own progress. */
export function overallProgress(stage: string, p: number): number {
  let before = 0;
  for (const [re, share] of STAGES) {
    if (re.test(stage)) return Math.min(1, before + share * Math.max(0, Math.min(1, p)));
    before += share;
  }
  return Math.max(0, Math.min(1, p));
}
