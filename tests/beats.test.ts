import { describe, expect, it } from 'vitest';
import { analyzeAudio, audioEnvelope } from '../src/engine/beats';
import { makeRng } from '../src/engine/rng';

const SR = 44100;

/** Stereo click track: a short decaying noise burst (with a bass thump on accented beats) every beat. */
function clicks(bpm: number, seconds: number, lead = 0, accentEvery = 4): Int16Array {
  const n = Math.round(seconds * SR);
  const out = new Int16Array(n * 2);
  const rng = makeRng(7);
  const period = 60 / bpm;
  for (let b = 0, t = lead; t < seconds; b++, t = lead + b * period) {
    const s0 = Math.round(t * SR);
    const accent = b % accentEvery === 0;
    for (let i = 0; i < 2000 && s0 + i < n; i++) {
      const env = Math.exp(-i / 300);
      let v = (rng() * 2 - 1) * env * 0.6;
      if (accent) v += Math.sin((2 * Math.PI * 60 * i) / SR) * Math.exp(-i / 1500) * 0.4;
      const q = Math.round(v * 32767);
      out[(s0 + i) * 2] = q;
      out[(s0 + i) * 2 + 1] = q;
    }
  }
  return out;
}

describe('beat analysis', () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM and its beats`, () => {
      const fps = 24;
      const f = analyzeAudio(clicks(bpm, 20), fps);
      expect(Math.abs(f.bpm - bpm)).toBeLessThan(1.5);
      expect(f.confidence).toBeGreaterThan(0.3);
      // every true beat (after the first second) has a detected beat within a frame
      const period = (60 / bpm) * fps;
      for (let k = 2; k * period < 19 * fps; k++) {
        const want = k * period;
        const d = Math.min(...f.beats.map((b) => Math.abs(b - want)));
        expect(d).toBeLessThanOrEqual(1.01);
      }
      // onsets line up with the clicks too
      expect(f.onsets.length).toBeGreaterThan((20 * bpm) / 60 - 3);
    });
  }

  it('finds the downbeats from the accents', () => {
    const fps = 25;
    const bpm = 120;
    const f = analyzeAudio(clicks(bpm, 16, 0.25), fps);
    const period = (60 / bpm) * fps;
    // accented clicks are at 0.25 s + 4k beats
    for (const d of f.downbeats.slice(1, -1)) {
      const k = (d - 0.25 * fps) / period;
      expect(Math.abs(k - Math.round(k / 4) * 4)).toBeLessThan(0.3);
    }
  });

  it('puts no beats in leading silence', () => {
    const f = analyzeAudio(clicks(120, 12, 4), 24);
    expect(f.beats[0]).toBeGreaterThanOrEqual(4 * 24 - 2);
  });

  it('noise has no confident tempo', () => {
    const rng = makeRng(3);
    const pcm = Int16Array.from({ length: 10 * SR * 2 }, () => Math.round((rng() * 2 - 1) * 8000));
    const f = analyzeAudio(pcm, 24);
    expect(f.confidence).toBeLessThan(0.2);
  });

  it('bands are per frame and normalised', () => {
    const f = analyzeAudio(clicks(120, 4), 30, 150);
    expect(f.frames).toBe(150);
    for (const b of Object.values(f.bands)) {
      expect(b.length).toBe(150);
      expect(Math.max(...b)).toBeLessThanOrEqual(1);
      expect(Math.min(...b)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('audio envelopes', () => {
  const f = analyzeAudio(clicks(120, 4), 24);
  it('beats jump up and fall back over the release', () => {
    const env = audioEnvelope(f, { band: 'beat', attack: 0, release: 4, threshold: 0 }, 0, f.frames);
    const b = f.beats[1];
    expect(env[b]).toBeCloseTo(1);
    expect(env[b + 2]).toBeLessThan(env[b + 1]);
    expect(env[b + 2]).toBeGreaterThan(0.2);
  });
  it('threshold silences quiet parts and windows start where asked', () => {
    const full = audioEnvelope(f, { band: 'full', attack: 0, release: 0, threshold: 0 }, 10, 40);
    expect(full.length).toBe(30);
    const gated = audioEnvelope(f, { band: 'full', attack: 0, release: 0, threshold: 0.99 }, 10, 40);
    expect(Math.max(...gated)).toBeLessThanOrEqual(1);
    expect(gated.reduce((a, b) => a + b, 0)).toBeLessThan(full.reduce((a, b) => a + b, 0));
  });
});
