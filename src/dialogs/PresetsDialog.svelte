<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { PRESETS, applyPreset, presetFromProject, type Preset } from '../engine/presets';
  import { userPresets } from '../lib/projectio.svelte';
  import type { Project } from '../engine/types';

  let mine = $state(userPresets.list());
  let mode = $state<'replace' | 'add'>('replace');

  function use(p: Preset) {
    if (!store.project.clips.length) {
      store.toast('Add a clip first, then choose a preset.', 'error');
      return;
    }
    store.set(applyPreset($state.snapshot(store.project) as Project, p, store.totalFrames, store.cuts, mode));
    store.ui.dialog = null;
    store.toast(`${p.emoji} ${p.name} applied. Tweak anything in the Effects panel.`);
  }
  function saveCurrent() {
    const name = prompt('Name your preset', 'My mosh');
    if (!name) return;
    userPresets.save(presetFromProject($state.snapshot(store.project) as Project, store.totalFrames, name));
    mine = userPresets.list();
    store.toast('Preset saved', 'ok');
  }
</script>

<Modal title="Presets" wide>
  <div class="row bar small">
    <span class="muted">When applying:</span>
    <button class:on={mode === 'replace'} onclick={() => (mode = 'replace')}>Replace my effects</button>
    <button class:on={mode === 'add'} onclick={() => (mode = 'add')}>Add on top</button>
    <span class="grow"></span>
    <button disabled={!store.project.effects.length} onclick={saveCurrent}>⭐ Save current as preset</button>
  </div>
  {#if mine.length}
    <h4 class="section-title">Your presets</h4>
    <div class="grid">
      {#each mine as p (p.id)}
        <div class="card-wrap">
          <button class="card" onclick={() => use(p)}>
            <span class="em">{p.emoji}</span><b>{p.name}</b>
            <span class="small muted">{p.effects.length} effect(s)</span>
          </button>
          <button class="del icon ghost" title="Delete preset" onclick={() => (userPresets.remove(p.id), (mine = userPresets.list()))}>✕</button>
        </div>
      {/each}
    </div>
  {/if}
  <h4 class="section-title">Built in</h4>
  <div class="grid">
    {#each PRESETS as p (p.id)}
      <button class="card" onclick={() => use(p)}>
        <span class="em">{p.emoji}</span><b>{p.name}</b>
        <span class="small muted">{p.description}</span>
      </button>
    {/each}
  </div>
</Modal>

<style>
  .bar {
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  h4 {
    margin: 12px 0 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-align: left;
    white-space: normal;
    padding: 12px;
    width: 100%;
    height: 100%;
    line-height: 1.35;
  }
  .em {
    font-size: 26px;
  }
  .card-wrap {
    position: relative;
  }
  .del {
    position: absolute;
    top: 4px;
    right: 4px;
  }
</style>
