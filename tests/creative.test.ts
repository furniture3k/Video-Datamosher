import { describe, expect, it } from 'vitest';
import { recipeFile, parseRecipeFile, applyRecipe, batchProject, recipePayload } from '../src/engine/recipe';
import { TEXT_ANIMS } from '../src/lib/text';
import { EFFECTS } from '../src/engine/effects';
import { guideOf } from '../src/lib/effectguide';
import { makeEffect } from '../src/engine/presets';
import { newProject, type MediaItem, type Project } from '../src/engine/types';
import { animProgress, type TextLayer } from '../src/engine/layers';
import { makeClip, timelineDuration } from '../src/engine/timeline';

const media = (id: string, duration: number, w = 1280, h = 720): MediaItem => ({ id, source: { kind: 'file', fileId: id, name: `${id}.mp4`, mime: 'video/mp4', isImage: false, ext: 'mp4' }, duration, width: w, height: h, fps: 24, hasAudio: false, hasVideo: true });

describe('recipe files', () => {
  const p: Project = { ...newProject(), name: 'Crunchy', media: [media('a', 10)] };
  p.clips = [makeClip(p.media[0], 'v1')];
  p.effects = [makeEffect('bloom', 24, 120), makeEffect('vhs', 0, 240)];

  it('round-trip through the readable file and land at the same places on footage of another length', () => {
    const text = JSON.stringify(recipeFile(p, 240));
    const { name, recipe } = parseRecipeFile(text);
    expect(name).toBe('Crunchy');
    const other: Project = { ...newProject(), media: [media('b', 20)] };
    other.clips = [makeClip(other.media[0], 'v1')];
    const out = applyRecipe(other, recipe, 480);
    expect(out.effects.map((e) => e.type)).toEqual(['bloom', 'vhs']);
    expect([out.effects[0].start, out.effects[0].end]).toEqual([48, 240]);
    // a bare payload is accepted too; anything else is refused
    expect(parseRecipeFile(JSON.stringify(recipePayload(p, 240))).recipe.fx).toHaveLength(2);
    expect(() => parseRecipeFile('{"hello": 1}')).toThrow(/not a moshpit recipe/);
  });

  it('a batch gives each video its own project with the recipe fitted to it, in its own shape', () => {
    const recipe = recipePayload({ ...p, encoder: { ...p.encoder, aspect: '9:16' } }, 240);
    const b = batchProject(media('c', 5, 640, 480), recipe);
    expect(b.name).toBe('c');
    expect(b.clips).toHaveLength(1);
    expect(timelineDuration(b)).toBeCloseTo(5, 5);
    // bloom covered 10 %–50 % of the recipe's timeline, so of these 120 frames too
    expect([b.effects[0].start, b.effects[0].end]).toEqual([12, 60]);
    expect(b.encoder.aspect).toBe('auto');
    expect(batchProject(media('d', 5), recipe, false).encoder.aspect).toBe('9:16');
  });
});

describe('text animations', () => {
  const tx = (o: Partial<TextLayer> = {}): TextLayer => ({ id: 't', kind: 'text', row: 'g1', text: 'Hi', start: 2, duration: 3, size: 0.1, color: '#fff', font: 'sans', bold: false, x: 0.5, y: 0.5, align: 'center', shadow: false, box: false, fade: 0, moshed: false, ...o });
  it('comes in over animIn seconds (titles that melt too); titles without one are always in', () => {
    expect(animProgress(tx({ anim: 'type', animIn: 1 }), 2.5)).toBeCloseTo(0.5, 5);
    expect(animProgress(tx({ anim: 'type', animIn: 1 }), 1)).toBe(0);
    expect(animProgress(tx({ anim: 'pop' }), 4)).toBe(1);
    expect(animProgress(tx({ anim: 'glitch', moshed: true, animIn: 1 }), 2.1)).toBeCloseTo(0.1, 5);
    expect(animProgress(tx(), 2)).toBe(1);
    expect(TEXT_ANIMS.map((a) => a.value)).toEqual(['none', 'type', 'glitch', 'slide', 'pop']);
  });
});

describe('new effects', () => {
  it('the retro looks and the map sources are listed, with a family and words for the picker', () => {
    for (const t of ['vhs', 'crt', 'grain', 'posterize']) {
      expect(EFFECTS[t]?.kind).toBe('pixel');
      expect(guideOf(t).family).toBe('retro');
      // the Chaos dial has something to push
      expect(EFFECTS[t].params.some((p) => 'intensity' in p && p.intensity)).toBe(true);
    }
    const src = EFFECTS.mask.params.find((p) => p.key === 'source')!;
    expect(src.type === 'select' && src.options.map((o) => o.value)).toEqual(expect.arrayContaining(['gradient', 'paint', 'media', 'depth']));
    // the gradient's settings show only for the gradient
    const gx = EFFECTS.mask.params.find((p) => p.key === 'gx')!;
    expect(gx.show?.({ source: 'gradient' })).toBe(true);
    expect(gx.show?.({ source: 'person' })).toBe(false);
  });
});
