// Pure mosh core: prepared AVI -> frames -> effect stack -> moshed AVI.
import { parseAvi, writeAvi, type AviInfo } from './avi';
import { analyzeFrame, type MoshCodec } from './bitstream';
import { EFFECTS } from './effects';
import { hashSeed, makeRng } from './rng';
import type { Clip, EffectInstance, Frame, Project } from './types';

export interface Prepared {
  info: AviInfo;
  frames: Frame[];
}

export function framesFromAvi(buf: Uint8Array, codec: MoshCodec): Prepared {
  const { info, chunks } = parseAvi(buf);
  const frames = chunks.map((c, i): Frame => {
    const a = analyzeFrame(c.data, codec);
    return { data: c.data, type: a.type === '?' && c.keyframe ? 'I' : a.type, src: i, tag: 'orig', payloadStart: a.payloadStart };
  });
  return { info, frames };
}

export const clipDuration = (c: Clip) => Math.max(0.04, (c.out - c.in) / Math.max(0.01, c.speed));

/** Start frame of every clip on the prepared timeline (approximate: fps filter rounding). */
export function clipStarts(clips: Clip[], fps: number): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of clips) {
    starts.push(Math.round(t * fps));
    t += clipDuration(c);
  }
  return starts;
}

export const timelineFrames = (clips: Clip[], fps: number) =>
  Math.max(1, Math.round(clips.reduce((s, c) => s + clipDuration(c), 0) * fps));

/** Hard cap on output length (about 6 minutes at 24 fps). */
export const MAX_OUTPUT_FRAMES = 9000;

export function activeEffects(effects: EffectInstance[]): EffectInstance[] {
  const solo = effects.some((e) => e.solo && e.enabled);
  return effects.filter((e) => e.enabled && (!solo || e.solo) && EFFECTS[e.type]);
}

export function applyBitstream(prep: Prepared, project: Project, cuts: number[]): Frame[] {
  let frames = prep.frames.slice();
  for (const e of activeEffects(project.effects)) {
    const def = EFFECTS[e.type];
    if (def.kind !== 'bitstream') continue;
    const rng = makeRng(hashSeed(project.globalSeed, e.seed, e.id));
    frames = def.apply(frames, e, { totalFrames: prep.frames.length, fps: project.encoder.fps, cuts, rng, source: prep.frames });
  }
  // The decoder needs a real keyframe (with headers) first.
  if (frames.length === 0 || frames[0].type !== 'I') frames.unshift(prep.frames[0]);
  // Safety net against runaway stacks (e.g. bloom on every frame x 200) eating all memory.
  if (frames.length > MAX_OUTPUT_FRAMES) frames.length = MAX_OUTPUT_FRAMES;
  return frames;
}

export function writeMoshed(prep: Prepared, frames: Frame[]): Uint8Array {
  return writeAvi(
    prep.info,
    frames.map((f) => ({ data: f.data, keyframe: f.type === 'I' })),
  );
}
