<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import Icon from './Icon.svelte';
  let dragFrom = -1;
</script>

<div class="stack">
  <div class="head">
    <span class="label">Stack</span>
    <button class="ghost" onclick={() => (store.ui.dialog = 'addEffect')} title="Add effect  Shift A"><Icon name="plus" size={13} />Add</button>
  </div>
  {#if !store.project.effects.length}
    <div class="empty small muted">
      No effects. Start from a <button class="link" onclick={() => (store.ui.dialog = 'presets')}>preset</button> or
      <button class="link" onclick={() => (store.ui.dialog = 'addEffect')}>add one</button>.
      <span class="faint">Effects run top to bottom.</span>
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
      onclick={() => store.selectEffect(fx.id)}
    >
      <input
        type="checkbox"
        class="switch"
        checked={fx.enabled}
        title={fx.enabled ? 'On (click to bypass)' : 'Bypassed'}
        aria-label="Enabled"
        onclick={(e) => e.stopPropagation()}
        onchange={(e) => store.edit(() => (fx.enabled = (e.target as HTMLInputElement).checked))}
      />
      <span class="code">{def?.icon}</span>
      <span class="nm">{fx.name || (def ? t(def.name) : '')}</span>
      {#if fx.locks.includes('__keep')}<span class="flag" title="Pinned"><Icon name="pin" size={12} /></span>{/if}
      <div class="tools">
        <button
          class="icon ghost solo"
          class:on={fx.solo}
          title="Solo"
          aria-label="Solo"
          onclick={(e) => (e.stopPropagation(), store.edit(() => (fx.solo = !fx.solo)))}>S</button
        >
        <button
          class="icon ghost"
          class:on={fx.locks.includes('__keep')}
          title="Pin: Randomize and Nudge leave this effect alone"
          aria-label="Pin"
          onclick={(e) => {
            e.stopPropagation();
            store.edit(() => (fx.locks = fx.locks.includes('__keep') ? fx.locks.filter((l) => l !== '__keep') : [...fx.locks, '__keep']));
          }}><Icon name="pin" size={13} /></button
        >
        <button class="icon ghost" title="Move up" aria-label="Move up" disabled={i === 0} onclick={(e) => (e.stopPropagation(), store.moveEffect(fx.id, -1))}><Icon name="up" size={13} /></button>
        <button class="icon ghost" title="Move down" aria-label="Move down" disabled={i === store.project.effects.length - 1} onclick={(e) => (e.stopPropagation(), store.moveEffect(fx.id, 1))}><Icon name="down" size={13} /></button>
        <button class="icon ghost" title="Duplicate" aria-label="Duplicate" onclick={(e) => (e.stopPropagation(), store.duplicateEffect(fx.id))}><Icon name="copy" size={13} /></button>
        <button class="icon ghost" title="Delete  Del" aria-label="Delete" onclick={(e) => (e.stopPropagation(), store.removeEffect(fx.id))}><Icon name="trash" size={13} /></button>
      </div>
    </div>
  {/each}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--line);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 6px 6px 12px;
  }
  .empty {
    padding: 0 12px 12px;
    line-height: 1.6;
  }
  .empty .faint {
    display: block;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    height: auto;
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover:not(:disabled) {
    background: none;
    color: var(--accent);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 6px 0 12px;
    border-top: 1px solid var(--line);
    cursor: pointer;
    position: relative;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.sel {
    background: var(--surface-2);
  }
  .item.sel::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
  }
  .item.off .nm,
  .item.off .code {
    opacity: 0.4;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flag {
    color: var(--text-3);
    display: flex;
  }
  .tools {
    display: none;
    align-items: center;
  }
  .item:hover .tools,
  .item.sel .tools {
    display: flex;
  }
  .tools button {
    width: 22px;
    height: 22px;
  }
  .solo {
    font: 600 11px var(--mono);
  }
  @media (hover: none) {
    .tools {
      display: flex;
    }
  }
</style>
