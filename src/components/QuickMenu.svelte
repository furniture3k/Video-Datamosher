<script lang="ts">
  // Right-click (or long-press on a phone) on the picture: add things right where you pointed.
  import { store } from '../lib/store.svelte';
  import { addEmoji, addShape, addText, EMOJI } from '../lib/edit';
  import { findFaces, pictureMap, pinHere, trackClip, trackableAt } from '../lib/motion.svelte';
  import { titleBehind, toggleCutout } from '../lib/cutout.svelte';
  import Icon from './Icon.svelte';

  /** x, y: where the menu opens (stage pixels); u, v: the point in the frame (shares of it) */
  let { x, y, u, v, onclose }: { x: number; y: number; u: number; v: number; onclose: () => void } = $props();

  const clip = $derived(trackableAt(store.ui.time));
  /** put the new layer on the point (its middle there) */
  function place(id: string, dx = 0, dy = 0) {
    store.edit((p) => {
      const l = p.layers.find((q) => q.id === id);
      if (l) Object.assign(l, { x: Math.round((u + dx) * 1e4) / 1e4, y: Math.round((v + dy) * 1e4) / 1e4 });
    });
  }
  const run = (fn: () => void) => () => {
    fn();
    onclose();
  };
  const title = run(() => {
    addText();
    place(store.ui.selectedClips[0]);
  });
  const box = run(() => place(addShape('rect').id));
  const arrow = run(() => {
    // pointing down-right at the spot: its tip on the point
    const a = addShape('arrow');
    place(a.id, -a.w / 2, -a.h / 2);
  });
  const sticker = (e: string) => run(() => place(addEmoji(e).id))();
  // follow what's there: a box round the point, tracked, then boxed, arrowed and labelled
  const mark = run(() => {
    if (!clip) return;
    const r = 0.08;
    trackClip(clip.id, [Math.max(0, u - r), Math.max(0, v - r * 1.4), Math.min(1, u + r), Math.min(1, v + r * 1.4)], 'mark').catch((err) => store.toast('Tracking failed: ' + (err as Error).message, 'error'));
  });
  const pin = run(() => pinHere(u, v));
  // cut out what's here: the cut-out starts with a tap on the point
  const cut = run(() => {
    if (!clip) return;
    toggleCutout(clip.id);
    const map = pictureMap(clip.id);
    const [pu, pv] = map ? map.toPicture(u, v) : [u, v];
    if (store.ui.cutout && pu >= 0 && pu <= 1 && pv >= 0 && pv <= 1) store.ui.cutout.points = [[pu, pv, 1]];
  });
  const behind = run(() => clip && titleBehind(clip.id, [u, v]));
  const faces = run(() => {
    if (clip) findFaces(clip.id).catch((err) => store.toast('Finding faces failed: ' + (err as Error).message, 'error'));
  });
</script>

<svelte:window onpointerdown={(e) => !(e.target as HTMLElement).closest?.('.quick') && onclose()} onkeydown={(e) => e.key === 'Escape' && onclose()} />
<!-- (clicks in here aren't taps on the picture) -->
<div class="quick" role="menu" tabindex="-1" style="left:{x}px;top:{y}px" aria-label="Add here" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} oncontextmenu={(e) => (e.preventDefault(), e.stopPropagation())}>
  <button class="ghost mitem" role="menuitem" onclick={title}><Icon name="text" />Title here</button>
  <button class="ghost mitem" role="menuitem" onclick={box}><Icon name="shape" />Box it</button>
  <button class="ghost mitem" role="menuitem" onclick={arrow}><Icon name="pointer" />Arrow to here</button>
  <button class="ghost mitem" role="menuitem" disabled={!clip} onclick={mark} title="Follows what's here: a box, an arrow and a label that move with it"><Icon name="target" />Mark what's here</button>
  <button class="ghost mitem" role="menuitem" disabled={!clip} onclick={cut} title="Cuts what's here out of the clip, following it, so titles can go behind it"><Icon name="target" />Cut out</button>
  <button class="ghost mitem" role="menuitem" disabled={!clip} onclick={behind} title="A big title behind the subject you cut out"><Icon name="text" />Text behind</button>
  <button class="ghost mitem" role="menuitem" disabled={!clip} onclick={pin} title="Pins a title to the flat surface here (a screen, a wall, a sign): it moves, turns and leans with it"><Icon name="screen" />Pin here</button>
  <button class="ghost mitem" role="menuitem" disabled={!clip} onclick={faces}><Icon name="target" />Find faces</button>
  <div class="emoji" role="group" aria-label="Sticker here">
    {#each EMOJI.slice(0, 9) as e (e)}<button class="em" role="menuitem" aria-label={`Sticker ${e} here`} onclick={() => sticker(e)}>{e}</button>{/each}
  </div>
</div>

<style>
  .quick {
    position: absolute;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    min-width: 190px;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  }
  .mitem {
    justify-content: flex-start;
  }
  .emoji {
    display: flex;
    flex-wrap: wrap;
    max-width: 190px;
  }
  .em {
    font-size: 18px;
    width: 30px;
    height: 30px;
    padding: 0;
    background: transparent;
    border-color: transparent;
  }
</style>
