// The editor's layout: how wide the media and inspector panels are (or whether they're folded
// away) and how tall the timeline is, plus layouts to switch between: three that come with the app
// and any you save. Kept in this browser.
import { store } from './store.svelte';
import { localGet, localSet } from './storage';

export interface Layout {
  left: number;
  right: number;
  leftOpen: boolean;
  rightOpen: boolean;
  timeline: number;
}

export const PANEL = { min: 180, max: 560 };

export const BUILT_IN: { id: string; name: string; hint: string; layout: Layout }[] = [
  { id: 'edit', name: 'Edit', hint: 'Room for the media and a tall timeline, for cutting.', layout: { left: 280, right: 300, leftOpen: true, rightOpen: true, timeline: 340 } },
  { id: 'mosh', name: 'Mosh', hint: 'A wide inspector for effect settings; the media is folded away.', layout: { left: 260, right: 420, leftOpen: false, rightOpen: true, timeline: 240 } },
  { id: 'player', name: 'Big player', hint: 'Both panels folded away and a short timeline: to watch the mosh.', layout: { left: 260, right: 330, leftOpen: false, rightOpen: false, timeline: 170 } },
];

const saved = localGet<Partial<Layout>>('layout', {});
export const layout = $state<Layout>({ left: 260, right: 330, leftOpen: true, rightOpen: true, timeline: store.ui.timelineHeight, ...saved });
export const custom = $state<{ list: { name: string; layout: Layout }[] }>({ list: localGet('layouts', []) });

/**
 * The tallest the timeline can be in this window: the player keeps 220px at the very least, and on a
 * short window (a laptop, the desktop app's smallest) about half the window, so the picture stays big
 * enough to work with. (App.svelte's footer height says the same in CSS.)
 */
export const timelineMax = (h = window.innerHeight) => Math.min(h - 220, Math.max(h * 0.45, h - 400));

const clampPanel = (w: number) => Math.round(Math.max(PANEL.min, Math.min(PANEL.max, w)));

/** Keep the current layout (call after a change). */
export function keep() {
  layout.left = clampPanel(layout.left);
  layout.right = clampPanel(layout.right);
  store.ui.timelineHeight = layout.timeline;
  store.setPref('timelineHeight', layout.timeline);
  localSet('layout', $state.snapshot(layout));
}

export function useLayout(l: Layout) {
  Object.assign(layout, l, { timeline: Math.max(150, Math.min(timelineMax(), l.timeline)) });
  keep();
}

export function togglePanel(side: 'left' | 'right') {
  if (side === 'left') layout.leftOpen = !layout.leftOpen;
  else layout.rightOpen = !layout.rightOpen;
  keep();
}

/** Save the current layout under a name (replacing one with the same name). */
export function saveLayout(name: string) {
  layout.timeline = store.ui.timelineHeight;
  custom.list = [...custom.list.filter((x) => x.name !== name), { name, layout: $state.snapshot(layout) }];
  localSet('layouts', $state.snapshot(custom.list));
}

export function deleteLayout(name: string) {
  custom.list = custom.list.filter((x) => x.name !== name);
  localSet('layouts', $state.snapshot(custom.list));
}
