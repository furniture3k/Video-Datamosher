// Small vibrations on phones that support them (Android; iPhones ignore navigator.vibrate),
// so picking up, trimming and cutting clips can be felt. Off with the "Vibration" setting.
import { store } from './store.svelte';

function buzz(pattern: number | number[]) {
  if (!store.ui.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed (no user gesture yet): ignore */
  }
}

/** a light tick: snapping to a new place */
export const tick = () => buzz(6);
/** picking something up, grabbing a handle */
export const grab = () => buzz(15);
/** a cut or a delete */
export const thud = () => buzz([10, 30, 18]);
