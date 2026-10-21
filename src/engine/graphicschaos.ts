// Randomizing, nudging and breeding the graphics of a project (titles, shapes and the canvas) the
// way the effect stack is: seeded, so a roll can be repeated, and gentle with what is placed on
// purpose (the words stay, and anything that follows or is pinned to something keeps its place).
import { makeRng, type Rng } from './rng';
import { CANVAS_PRESETS, type Canvas } from './canvas';
import type { Layer, ShapeLayer, TextAnim, TextLayer } from './layers';
import type { Project } from './types';

const PALETTES: string[][] = [
  ['#ffffff', '#ff2a6d', '#05d9e8'],
  ['#fff1f6', '#ff5cc8', '#1b1bff'],
  ['#f5f0e6', '#d93a2b', '#1c2a4a'],
  ['#ffffff', '#111111', '#ffe14d'],
  ['#e8ffe8', '#12d96b', '#ff2a2a'],
];
const ANIMS: TextAnim[] = ['none', 'type', 'words', 'glitch', 'slide', 'pop', 'slam', 'stamp', 'drop'];
const FONTS = ['sans', 'serif', 'mono', 'impact'] as const;

export interface Graphics {
  layers: Layer[];
  canvas: Project['canvas'];
}

const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Placed by something else (a tracked path, a surface): its position is not ours to move. */
const placed = (l: Layer) => !!(l.follow?.length || l.surface);

/** The nearest of the points (seconds) to t. */
const nearest = (pts: number[], t: number) => pts.reduce((b, p) => (Math.abs(p - t) < Math.abs(b - t) ? p : b), pts[0] ?? t);

/** Move a hex colour's channels by up to `d` (0..255). */
function jitterColour(hex: string, rng: Rng, d: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => clamp(Math.round(v + rng.range(-d, d)), 0, 255));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * A fresh look for every title and shape: font, size, colour, outline, entrance, a new place (not
 * for things that follow or are pinned), a start moved to a beat (when there are beats), and now
 * and then a new canvas. `intensity` 0..1 is how far it goes.
 */
export function chaosGraphics(project: Pick<Project, 'layers' | 'canvas'>, seed: number, intensity = 0.5, beats: number[] = []): Graphics {
  const rng = makeRng(seed);
  const pal = rng.pick(PALETTES);
  const layers = project.layers.map((src) => {
    const l = clone(src);
    if (l.kind === 'text') restyleText(l, rng, pal, intensity);
    else if (l.shape !== 'subject') restyleShape(l, rng, pal, intensity);
    if (!placed(l) && rng.chance(intensity * 0.7)) {
      l.x = r3(rng.range(0.18, 0.82));
      l.y = r3(rng.range(0.18, 0.82));
    }
    if (beats.length && rng.chance(0.3 + intensity * 0.5)) {
      // on a beat, a few beats off where it was
      const at = nearest(beats, l.start);
      const i = beats.indexOf(at);
      l.start = r3(beats[clamp(i + rng.int(-2, 2), 0, beats.length - 1)] ?? at);
    }
    return l;
  });
  let canvas = project.canvas ? clone(project.canvas) : undefined;
  if (rng.chance(0.1 + intensity * 0.5)) canvas = clone(rng.pick(CANVAS_PRESETS).canvas);
  return { layers, canvas };
}

function restyleText(l: TextLayer, rng: Rng, pal: string[], intensity: number) {
  // an added font is the user's choice: only the built-in ones are swapped
  if (!l.font.startsWith('font:') && rng.chance(0.4 + intensity * 0.4)) l.font = rng.pick(FONTS);
  if (l.fit !== 'width') l.size = r3(clamp(l.size * rng.range(1 - 0.5 * intensity, 1 + 0.6 * intensity), 0.03, 0.6));
  if (rng.chance(0.6)) l.color = rng.pick(pal);
  l.bold = rng.chance(0.7);
  if (rng.chance(0.15 + intensity * 0.3)) {
    l.stroke = r3(rng.range(0.03, 0.1));
    l.strokeColor = rng.pick(pal);
    l.strokeOnly = rng.chance(0.25);
  } else {
    delete l.stroke;
    delete l.strokeOnly;
  }
  l.shadow = rng.chance(0.5);
  l.box = rng.chance(0.15);
  l.anim = rng.pick(ANIMS);
  l.animIn = r3(rng.range(0.15, 0.7));
  if (rng.chance(intensity * 0.3)) l.boil = r3(rng.range(0.3, 1));
  else delete l.boil;
}

function restyleShape(l: ShapeLayer, rng: Rng, pal: string[], intensity: number) {
  l.color = rng.pick(pal);
  if (l.fill) l.fill = l.color;
  l.width = r3(clamp(l.width * rng.range(0.6, 1.6), 0.002, 0.04));
  if (rng.chance(0.3 + intensity * 0.3)) l.glow = r3(rng.range(0.2, 0.9));
  else delete l.glow;
  if (rng.chance(0.4)) l.drawOn = r3(rng.range(0.2, 0.8));
  else delete l.drawOn;
  if (rng.chance(intensity * 0.4)) l.boil = r3(rng.range(0.3, 1));
  else delete l.boil;
}

/** Small changes to every title and shape and the canvas. `amount` 0..1. */
export function mutateGraphics(project: Pick<Project, 'layers' | 'canvas'>, seed: number, amount = 0.2): Graphics {
  const rng = makeRng(seed);
  const layers = project.layers.map((src) => {
    const l = clone(src);
    if (l.kind === 'text') {
      if (l.fit !== 'width') l.size = r3(clamp(l.size * rng.range(1 - 0.3 * amount, 1 + 0.3 * amount), 0.03, 0.6));
      l.color = jitterColour(l.color, rng, 90 * amount);
      if (rng.chance(amount * 0.3)) l.anim = rng.pick(ANIMS);
      if (l.stroke && rng.chance(amount)) l.strokeColor = jitterColour(l.strokeColor ?? '#000000', rng, 90 * amount);
    } else if (l.shape !== 'subject') {
      l.color = jitterColour(l.color, rng, 90 * amount);
      if (l.fill) l.fill = l.color;
      l.width = r3(clamp(l.width * rng.range(1 - 0.3 * amount, 1 + 0.3 * amount), 0.002, 0.04));
    }
    if (!placed(l)) {
      l.x = r3(clamp(l.x + rng.range(-0.1, 0.1) * amount, 0.02, 0.98));
      l.y = r3(clamp(l.y + rng.range(-0.1, 0.1) * amount, 0.02, 0.98));
    }
    l.start = r3(Math.max(0, l.start + rng.range(-0.3, 0.3) * amount));
    return l;
  });
  let canvas: Canvas | undefined = project.canvas ? clone(project.canvas) : undefined;
  if (canvas && rng.chance(amount * 0.3)) {
    canvas.inset = r3(clamp(canvas.inset + rng.range(-0.03, 0.03), 0, 0.3));
    if (canvas.color) canvas.color = jitterColour(canvas.color, rng, 60 * amount);
  }
  return { layers, canvas };
}

/**
 * Graphics from several parents: the first parent's layers, each taking colour, font, entrance and
 * size from the same-numbered layer of a random parent that has one, and the canvas of a random parent.
 */
export function breedGraphics(parents: Pick<Project, 'layers' | 'canvas'>[], seed: number, mutation = 0.12): Graphics {
  const rng = makeRng(seed);
  const base = parents[0];
  const layers = base.layers.map((src, i) => {
    const l = clone(src);
    const donors = parents.filter((p) => p.layers[i] && p.layers[i].kind === l.kind);
    const d = clone(rng.pick(donors).layers[i]);
    if (l.kind === 'text' && d.kind === 'text') {
      l.color = d.color;
      if (!d.font.startsWith('font:') && !l.font.startsWith('font:')) l.font = d.font;
      l.anim = d.anim;
      l.bold = d.bold;
      if (l.fit !== 'width' && d.fit !== 'width') l.size = r3((l.size + d.size) / 2);
      if (d.stroke) ((l.stroke = d.stroke), (l.strokeColor = d.strokeColor));
      else delete l.stroke;
    } else if (l.kind === 'shape' && d.kind === 'shape' && l.shape !== 'subject') {
      l.color = d.color;
      if (l.fill) l.fill = d.color;
      l.width = d.width;
    }
    return l;
  });
  const canvas = clone(rng.pick(parents).canvas);
  return mutateGraphics({ layers, canvas }, rng.int(0, 1e9), mutation);
}
