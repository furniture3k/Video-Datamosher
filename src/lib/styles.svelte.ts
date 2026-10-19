// Title styles saved on this device (the built-in ones are in the engine), putting them on
// titles, and the style new titles get: the one put on a title last.
import { store } from './store.svelte';
import { askText } from './ask';
import { localGet, localSet } from './storage';
import { uid } from '../engine/presets';
import { BUILTIN_STYLES, applyStyle, styleOf, type TitleStyle } from '../engine/styles';
import type { TextLayer } from '../engine/layers';

export const titleStyles = $state({
  saved: localGet<TitleStyle[]>('titleStyles', []),
  /** id of the style put on a title last */
  last: localGet<string | null>('titleStyle', null),
});

export const allStyles = (): TitleStyle[] => [...BUILTIN_STYLES, ...titleStyles.saved];

function remember(id: string | null) {
  titleStyles.last = id;
  localSet('titleStyle', id);
}

/** The style for new titles, if one has been used. */
export const styleForNew = () => (titleStyles.last ? allStyles().find((s) => s.id === titleStyles.last) : undefined);

/** Put a style on these titles (one undo step); new titles get it too from now on. */
export function styleTitles(ids: string[], s: TitleStyle) {
  store.edit((p) => {
    for (const l of p.layers) if (l.kind === 'text' && ids.includes(l.id)) applyStyle(l, s);
  });
  remember(s.id);
}

/** Save a title's look as a style of your own. */
export async function saveStyle(l: TextLayer) {
  const name = (await askText('Name this style', 'My style'))?.trim();
  if (!name) return;
  const s = styleOf(l, uid(), name);
  titleStyles.saved = [...titleStyles.saved, s];
  localSet('titleStyles', titleStyles.saved);
  remember(s.id);
  store.toast(`Saved the style “${name}”. New titles get it, and it's in the list for every project.`, 'ok');
}

export function deleteStyle(id: string) {
  titleStyles.saved = titleStyles.saved.filter((s) => s.id !== id);
  localSet('titleStyles', titleStyles.saved);
  if (titleStyles.last === id) remember(null);
}
