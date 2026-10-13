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
    }
  | { key: string; label: string; type: 'bool'; default: boolean; help: string; advanced?: boolean }
  | {
      key: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
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
}

export interface PixelEffectDef {
  kind: 'pixel';
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
