// Particles: many copies of a title or shape (an emoji, a heart, a star…) rising, falling or
// bursting out from where it is. Pure: where each copy is at a moment; ../lib/layers draws them.
import { noise } from './textlayout';

export interface Particles {
  /** rise like bubbles, fall like snow or confetti, or burst out once */
  kind: 'rise' | 'fall' | 'burst';
  /** how many at once */
  count: number;
  /** frame heights a second */
  speed: number;
  /** how wide they spread across (a share of the frame width) */
  spread: number;
}

export interface Particle {
  /** offset from the layer's position (shares of the frame) */
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  /** degrees */
  turn: number;
}

/** How long each one lives (s). */
export const LIFE = 1.6;

/** Where every particle is `local` seconds after the layer starts. */
export function particlesAt(p: Particles, local: number): Particle[] {
  const out: Particle[] = [];
  const n = Math.max(1, Math.min(200, Math.round(p.count)));
  for (let i = 0; i < n; i++) {
    const a = noise(i, 1.7);
    const b = noise(i, 4.3);
    const c = noise(i, 7.9);
    let age: number;
    if (p.kind === 'burst') age = local;
    else {
      // they start one after another, then each comes round again
      const born = (i / n) * LIFE;
      if (local < born) continue;
      age = (local - born) % LIFE;
    }
    if (p.kind === 'burst' && age > LIFE) continue;
    const life = age / LIFE;
    // in quickly, out slowly
    const alpha = Math.min(1, life * 8) * (1 - Math.max(0, (life - 0.6) / 0.4));
    const scale = 0.55 + a * 0.7;
    if (p.kind === 'burst') {
      const ang = a * Math.PI * 2;
      const dist = p.speed * age * (0.5 + b * 0.8) * (1 - life * 0.35);
      out.push({ dx: Math.cos(ang) * dist * p.spread * 2, dy: Math.sin(ang) * dist + 0.25 * age * age, scale, alpha, turn: (c - 0.5) * 360 * life });
    } else {
      const dir = p.kind === 'rise' ? -1 : 1;
      const sway = Math.sin(age * (2 + b * 3) + c * 6.28) * 0.02;
      out.push({ dx: (a - 0.5) * p.spread + sway, dy: dir * p.speed * age * (0.7 + c * 0.6), scale, alpha, turn: (b - 0.5) * 40 + (p.kind === 'fall' ? age * 120 * (c - 0.5) : 0) });
    }
  }
  return out;
}
