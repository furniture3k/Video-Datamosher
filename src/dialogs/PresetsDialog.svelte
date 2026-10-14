<script lang="ts">
  import { askText } from '../lib/ask';
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { PRESETS, applyPreset, presetFromProject, type Preset } from '../engine/presets';
  import { EFFECTS } from '../engine/effects';
  import { userPresets } from '../lib/projectio.svelte';
  import Icon from '../components/Icon.svelte';
  import type { Project } from '../engine/types';

  let mine = $state(userPresets.list());
  let mode = $state<'replace' | 'add'>('replace');

  function use(p: Preset) {
    if (!store.project.clips.length) {
      store.toast('Add a clip first.', 'error');
      return;
    }
    store.set(applyPreset($state.snapshot(store.project) as Project, p, store.totalFrames, store.cuts, mode));
    store.ui.dialog = null;
  }
  async function saveCurrent() {
    const name = await askText('Preset name', 'Untitled preset');
    if (!name) return;
    userPresets.save(presetFromProject($state.snapshot(store.project) as Project, store.totalFrames, name));
    mine = userPresets.list();
    store.toast('Preset saved.', 'ok');
  }
</script>

{#snippet row(p: Preset, removable: boolean)}
  <div class="item">
    <button class="main" onclick={() => use(p)}>
      <span class="nm">{p.name}</span>
      <span class="codes">
        {#each p.effects as e}<span class="code" style="--c:{EFFECTS[e.type]?.color}">{EFFECTS[e.type]?.icon}</span>{/each}
      </span>
      <span class="ds">{p.description}</span>
    </button>
    {#if removable}
      <button class="icon ghost del" title="Delete preset" aria-label="Delete preset" onclick={() => (userPresets.remove(p.id), (mine = userPresets.list()))}><Icon name="trash" size={13} /></button>
    {/if}
  </div>
{/snippet}

<Modal title="Presets" wide>
  <div class="row bar">
    <span class="label">On apply</span>
    <div class="seg">
      <button class:on={mode === 'replace'} onclick={() => (mode = 'replace')}>Replace stack</button>
      <button class:on={mode === 'add'} onclick={() => (mode = 'add')}>Add to stack</button>
    </div>
    <span class="grow"></span>
    <button disabled={!store.project.effects.length} onclick={saveCurrent}><Icon name="save" size={14} />Save current stack</button>
  </div>
  {#if mine.length}
    <div class="label gl">Saved</div>
    <div class="grid">
      {#each mine as p (p.id)}{@render row(p, true)}{/each}
    </div>
  {/if}
  <div class="label gl">Built in</div>
  <div class="grid">
    {#each PRESETS as p (p.id)}{@render row(p, false)}{/each}
  </div>
</Modal>

<style>
  .bar {
    margin-bottom: 6px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .gl {
    margin: 14px 0 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
  }
  .item {
    position: relative;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .main {
    width: 100%;
    height: 100%;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 5px;
    padding: 10px 12px;
    background: none;
    border: none;
    border-radius: 0;
    text-align: left;
    white-space: normal;
  }
  .main:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .nm {
    font-weight: 600;
  }
  .codes {
    display: flex;
    gap: 3px;
  }
  .ds {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.45;
  }
  .del {
    position: absolute;
    top: 6px;
    right: 6px;
  }
</style>
