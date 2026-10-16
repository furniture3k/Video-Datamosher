import { bitstreamEffects } from './bitstream';
import { pixelEffects } from './pixel';
import { moreBitstreamEffects } from './bend';
import { script } from './script';
import type { EffectDef } from './types';

export const ALL_EFFECTS: EffectDef[] = [...bitstreamEffects, ...moreBitstreamEffects, script, ...pixelEffects];
export const EFFECTS: Record<string, EffectDef> = Object.fromEntries(ALL_EFFECTS.map((d) => [d.type, d]));
export * from './types';
