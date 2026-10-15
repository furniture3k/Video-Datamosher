import type { EffectInstance, Frame, ParamValue } from '../types';
import type { Rng } from '../rng';

export type ParamDef = (
  | {
      key: string;
      label: string;
      type: 'number' | 'int';
      min: number;
      max: number;
      step?: number;
      default: number;
      help: string;
      advanced?: boolean;
      unit?: string;
      /** values used when randomising (defaults to min..max) */
      chaos?: [number, number];
      /** UI hint: logarithmic slider */
      log?: boolean;
      /** which way is "more destroyed" (the Chaos dial pushes values that way) */
      intensity?: 'up' | 'down';
    }
  | { key: string; label: string; type: 'bool'; default: boolean; help: string; advanced?: boolean }
  | {
      key: string;
      label: string;
      type: 'select';
      /** `hint` explains what picking this option does (shown under the control) */
      options: { value: string; label: string; hint?: string }[];
      default: string;
      help: string;
      advanced?: boolean;
    }
  | { key: string; label: string; type: 'frame'; default: number; help: string; advanced?: boolean }
) & {
  /** only show this setting when it applies to the current mode */
  show?: (params: Record<string, ParamValue>) => boolean;
};

export interface EffectContext {
  totalFrames: number;
  fps: number;
  /** first frame of every clip after the first */
  cuts: number[];
  rng: Rng;
  /** original prepared frames, indexed by src */
  source: Frame[];
}

export interface BitstreamEffect {
  kind: 'bitstream';
  type: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  params: ParamDef[];
  apply(frames: Frame[], e: EffectInstance, ctx: EffectContext): Frame[];
  /**
   * The effect can add or remove frames. With its Timing set to "Keep length" (the default), the
   * engine fits the result back into the effect's range so the timeline stays in sync.
   */
  retimes?: boolean;
  /** seconds a new instance covers when added at the playhead (omit: the whole timeline) */
  span?: number;
}

export interface PixelEffectDef {
  kind: 'pixel';
  span?: number;
  type: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  params: ParamDef[];
}

export type EffectDef = BitstreamEffect | PixelEffectDef;

export const defaultParams = (defs: ParamDef[]): Record<string, ParamValue> =>
  Object.fromEntries(defs.map((d) => [d.key, d.default]));
