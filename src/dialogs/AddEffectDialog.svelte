<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { ALL_EFFECTS } from '../engine/effects';
  const bit = ALL_EFFECTS.filter((e) => e.kind === 'bitstream');
  const pix = ALL_EFFECTS.filter((e) => e.kind === 'pixel');
  let where = $state<'all' | 'playhead'>('all');
  function add(type: string) {
    const total = store.totalFrames;
    const src = store.render?.frames[store.ui.playhead]?.src ?? 0;
    const range: [number, number] = where === 'all' ? [0, total] : [src, Math.min(total, src + Math.round(store.fps * 2))];
    store.addEffect(type, range);
    store.ui.dialog = null;
  }
</script>

<Modal title="Add effect" wide>
  <div class="row small where">
    <span class="muted">Place it on:</span>
    <button class:on={where === 'all'} onclick={() => (where = 'all')}>The whole video</button>
    <button class:on={where === 'playhead'} onclick={() => (where = 'playhead')}>2 s from the playhead</button>
  </div>
  <h4 class="section-title">Bitstream: edits the compressed video (real datamoshing)</h4>
  <div class="grid">
    {#each bit as d}
      <button class="card" style="--c:{d.color}" onclick={() => add(d.type)}>
        <span class="ic">{d.icon}</span>
        <b>{d.name}</b>
        <span class="small muted">{d.description}</span>
      </button>
    {/each}
  </div>
  <h4 class="section-title">Pixel & flow: works on the decoded image</h4>
  <div class="grid">
    {#each pix as d}
      <button class="card" style="--c:{d.color}" onclick={() => add(d.type)}>
        <span class="ic">{d.icon}</span>
        <b>{d.name}</b>
        <span class="small muted">{d.description}</span>
      </button>
    {/each}
  </div>
</Modal>

<style>
  .where {
    margin-bottom: 12px;
  }
  h4 {
    margin: 12px 0 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 8px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-align: left;
    white-space: normal;
    padding: 10px 12px;
    border-left: 4px solid var(--c);
    line-height: 1.35;
  }
  .card:hover {
    border-color: var(--c);
    background: color-mix(in srgb, var(--c) 12%, var(--panel2));
  }
  .ic {
    font-size: 22px;
    color: var(--c);
  }
</style>
