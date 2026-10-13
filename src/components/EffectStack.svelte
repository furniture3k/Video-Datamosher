<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  let dragFrom = -1;
</script>

<div class="stack">
  <div class="row head">
    <span class="section-title grow">Effect stack</span>
    <button class="small" onclick={() => (store.ui.dialog = 'addEffect')}>＋ Add</button>
  </div>
  {#if !store.project.effects.length}
    <div class="empty small muted">
      No effects yet. Pick a <button class="link" onclick={() => (store.ui.dialog = 'presets')}>preset</button>, roll
      <b>🎲 Chaos</b>, or <button class="link" onclick={() => (store.ui.dialog = 'addEffect')}>add an effect</button>.
      <br /><br />Effects run top to bottom. Bitstream effects ✂✿ edit the compressed video; pixel effects ➶◐ work on the decoded image afterwards.
    </div>
  {/if}
  {#each store.project.effects as fx, i (fx.id)}
    {@const def = EFFECTS[fx.type]}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="item"
      class:sel={store.ui.selectedEffect === fx.id}
      class:off={!fx.enabled}
      style="--c:{def?.color}"
      draggable="true"
      ondragstart={() => (dragFrom = i)}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => {
        e.preventDefault();
        if (dragFrom >= 0 && dragFrom !== i) store.moveEffect(store.project.effects[dragFrom].id, i - dragFrom);
        dragFrom = -1;
      }}
      onclick={() => (store.ui.selectedEffect = fx.id)}
    >
      <input
        type="checkbox"
        checked={fx.enabled}
        title="Enable / bypass"
        onclick={(e) => e.stopPropagation()}
        onchange={(e) => store.edit(() => (fx.enabled = (e.target as HTMLInputElement).checked))}
      />
      <span class="ic">{def?.icon}</span>
      <span class="nm grow">{fx.name || def?.name}</span>
      <span class="kind small mono">{def?.kind === 'pixel' ? 'PIX' : 'BIT'}</span>
      <button
        class="icon ghost tiny"
        class:on={fx.solo}
        title="Solo: hear/see only soloed effects"
        onclick={(e) => (e.stopPropagation(), store.edit(() => (fx.solo = !fx.solo)))}>S</button
      >
      <button
        class="icon ghost tiny"
        class:on={fx.locks.includes('__keep')}
        title="Pin: keep this effect (unchanged) when rolling Chaos or Mutate"
        onclick={(e) => {
          e.stopPropagation();
          store.edit(() => (fx.locks = fx.locks.includes('__keep') ? fx.locks.filter((l) => l !== '__keep') : [...fx.locks, '__keep']));
        }}>📌</button
      >
      <button class="icon ghost tiny" title="Move up" disabled={i === 0} onclick={(e) => (e.stopPropagation(), store.moveEffect(fx.id, -1))}>↑</button>
      <button class="icon ghost tiny" title="Move down" disabled={i === store.project.effects.length - 1} onclick={(e) => (e.stopPropagation(), store.moveEffect(fx.id, 1))}>↓</button>
      <button class="icon ghost tiny" title="Duplicate (D)" onclick={(e) => (e.stopPropagation(), store.duplicateEffect(fx.id))}>⧉</button>
      <button class="icon ghost tiny" title="Delete (Del)" onclick={(e) => (e.stopPropagation(), store.removeEffect(fx.id))}>✕</button>
    </div>
  {/each}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .head {
    margin-bottom: 4px;
  }
  .empty {
    padding: 10px;
    border: 1px dashed var(--line);
    border-radius: 8px;
    line-height: 1.5;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px 3px 6px;
    border-radius: 7px;
    background: var(--bg2);
    border: 1px solid transparent;
    border-left: 3px solid var(--c);
    cursor: pointer;
  }
  .item.sel {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 12%, var(--bg2));
  }
  .item.off .nm,
  .item.off .ic {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .ic {
    color: var(--c);
    width: 16px;
    text-align: center;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    color: var(--faint);
    font-size: 9px;
  }
  .tiny {
    padding: 1px 4px;
    min-width: 0;
    font-size: 11px;
  }
</style>
