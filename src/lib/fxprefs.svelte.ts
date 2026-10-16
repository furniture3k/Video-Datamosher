// Your favourite effects (shown first when adding one) and settings you saved for an effect
// ("my crunchy glitch"), kept in this browser.
import { store } from './store.svelte';
import { localGet, localSet } from './storage';
import type { EffectInstance, ParamValue } from '../engine/types';

export interface FxPreset {
  name: string;
  params: Record<string, ParamValue>;
}

export const fxPrefs = $state({
  favourites: localGet<string[]>('fxFavourites', []),
  presets: localGet<Record<string, FxPreset[]>>('fxPresets', {}),
});

export function toggleFavourite(type: string) {
  fxPrefs.favourites = fxPrefs.favourites.includes(type) ? fxPrefs.favourites.filter((t) => t !== type) : [...fxPrefs.favourites, type];
  localSet('fxFavourites', fxPrefs.favourites);
}

const savePresets = () => localSet('fxPresets', $state.snapshot(fxPrefs.presets));

/** Keep an effect's current settings under a name (replacing one with the same name). */
export function saveFxPreset(e: EffectInstance, name: string) {
  const list = (fxPrefs.presets[e.type] ?? []).filter((p) => p.name !== name);
  fxPrefs.presets = { ...fxPrefs.presets, [e.type]: [...list, { name, params: JSON.parse(JSON.stringify(e.params)) }] };
  savePresets();
}

export function deleteFxPreset(type: string, name: string) {
  fxPrefs.presets = { ...fxPrefs.presets, [type]: (fxPrefs.presets[type] ?? []).filter((p) => p.name !== name) };
  savePresets();
}

/** Put saved settings on an effect (undoable). Settings the effect no longer has are skipped. */
export function applyFxPreset(e: EffectInstance, p: FxPreset) {
  store.edit(() => {
    for (const [k, v] of Object.entries(p.params)) if (k in e.params) e.params[k] = v;
  });
}
