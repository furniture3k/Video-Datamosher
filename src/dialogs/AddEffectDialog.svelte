<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { ALL_EFFECTS } from '../engine/effects';
  const groups = [
    { title: 'Bitstream', note: 'Edits the compressed frames. This is the actual datamosh.', items: ALL_EFFECTS.filter((e) => e.kind === 'bitstream') },
    { title: 'Picture', note: 'Runs on the decoded image afterwards.', items: ALL_EFFECTS.filter((e) => e.kind === 'pixel') },
  ];
  let where = $state<'all' | 'playhead'>('all');
  function add(type: string) {
    const total = store.totalFrames;
    const src = store.playFrame;
    const range: [number, number] = where === 'all' ? [0, total] : [src, Math.min(total, src + Math.round(store.fps * 2))];
    store.addEffect(type, range);
    store.ui.dialog = null;
  }
</script>

<Modal title="Add effect" wide>
  <div class="row place">
    <span class="label">Place on</span>
    <div class="seg">
      <button class:on={where === 'all'} onclick={() => (where = 'all')}>Whole timeline</button>
      <button class:on={where === 'playhead'} onclick={() => (where = 'playhead')}>2 s from playhead</button>
    </div>
  </div>
  <div class="cols">
    {#each groups as g}
      <div>
        <div class="gh"><span class="label">{g.title}</span><span class="faint small">{g.note}</span></div>
        {#each g.items as d}
          <button class="item" style="--c:{d.color}" onclick={() => add(d.type)}>
            <span class="code">{d.icon}</span>
            <span class="txt">
              <span class="nm">{d.name}</span>
              <span class="ds">{d.description}</span>
            </span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
</Modal>

<style>
  .place {
    margin-bottom: 14px;
    gap: 10px;
  }
  .cols {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 24px;
  }
  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .gh {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .item {
    width: 100%;
    height: auto;
    justify-content: flex-start;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 4px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    text-align: left;
    white-space: normal;
  }
  .item:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .item .code {
    margin-top: 2px;
  }
  .txt {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nm {
    font-weight: 600;
  }
  .ds {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.45;
  }
</style>
