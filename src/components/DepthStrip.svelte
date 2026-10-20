<script lang="ts">
  // What is behind and in front of the subject at the playhead, as a slim strip above the player:
  // click a chip to pick it, drag one onto another (or use the arrows) to change which is drawn
  // over which, and the side button puts it behind or in front of the subject.
  import { store } from '../lib/store.svelte';
  import { depthStack, swapDrawOrder, type Layer } from '../engine/layers';
  import { layerName } from '../engine/shapes';
  import Icon from './Icon.svelte';

  const stack = $derived(depthStack(store.project.layers, store.ui.time));
  const subject = $derived(store.project.media.flatMap((m) => m.mattes ?? [])[0]?.name ?? 'Subject');
  let dragging = $state<string | null>(null);

  const label = (l: Layer) => layerName(l);
  function swap(a: string, b: string) {
    store.edit((p) => swapDrawOrder(p.layers, a, b), 'depthorder');
  }
  /** one place towards the front (+1) or the back (−1), among those on this side */
  function nudge(side: Layer[], i: number, dir: 1 | -1) {
    const other = side[i + dir];
    if (other) swap(side[i].id, other.id);
  }
  function flip(l: Layer) {
    store.edit((p) => {
      const x = p.layers.find((y) => y.id === l.id);
      if (!x) return;
      if (x.depth === 'behind' || x.depth === 'inside') delete x.depth;
      else x.depth = 'behind';
    });
  }
  function drop(e: DragEvent, onto: Layer) {
    e.preventDefault();
    const from = dragging;
    dragging = null;
    if (from && from !== onto.id) swap(from, onto.id);
  }
</script>

{#snippet chips(side: Layer[], where: string)}
  {#each side as l, i (l.id)}
    <span
      class="chip"
      class:on={store.ui.selectedClips.includes(l.id)}
      class:drag={dragging === l.id}
      role="group"
      aria-label="{label(l)}, {where}"
      draggable="true"
      ondragstart={(e) => ((dragging = l.id), e.dataTransfer?.setData('text/plain', l.id))}
      ondragover={(e) => dragging && e.preventDefault()}
      ondrop={(e) => drop(e, l)}
      ondragend={() => (dragging = null)}
    >
      <button class="name" onclick={() => store.selectClip(l.id)} title={label(l)}>{label(l)}</button>
      <button class="mini" aria-label="Draw {label(l)} further back" title="Further back" disabled={i === 0} onclick={() => nudge(side, i, -1)}>‹</button>
      <button class="mini" aria-label="Draw {label(l)} further forward" title="Further forward" disabled={i === side.length - 1} onclick={() => nudge(side, i, 1)}>›</button>
      <button class="mini" aria-label={where === 'behind the subject' ? `Put ${label(l)} in front of the subject` : `Put ${label(l)} behind the subject`} title={where === 'behind the subject' ? 'Bring in front of the subject' : 'Send behind the subject'} onclick={() => flip(l)}><Icon name="reverse" size={11} /></button>
    </span>
  {/each}
{/snippet}

<div class="strip" role="group" aria-label="What is behind and in front of the subject">
  <span class="side">Behind</span>
  <span class="row">{#if stack.behind.length}{@render chips(stack.behind, 'behind the subject')}{:else}<span class="none">nothing</span>{/if}</span>
  <span class="subj" title="The subject cut out of the footage">{subject}</span>
  <span class="side">In front</span>
  <span class="row">{#if stack.front.length}{@render chips(stack.front, 'in front of the subject')}{:else}<span class="none">nothing</span>{/if}</span>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: 11px;
    min-height: 26px;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    white-space: nowrap;
  }
  .side {
    color: var(--text-3, var(--text-2));
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 10px;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  .none {
    color: var(--text-3, var(--text-2));
    font-style: italic;
  }
  .subj {
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    background: var(--surface-2);
  }
  .chip.on {
    border-color: var(--accent);
  }
  .chip.drag {
    opacity: 0.45;
  }
  .chip button {
    border: 0;
    background: transparent;
    color: var(--text);
    padding: 1px 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .chip .name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip .mini {
    color: var(--text-2);
    padding: 1px 3px;
  }
  .chip .mini:disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
