<script lang="ts">
  import { store } from '../lib/store.svelte';
  import EffectStack from './EffectStack.svelte';
  import EffectEditor from './EffectEditor.svelte';
  import ClipEditor from './ClipEditor.svelte';
  import EncoderPanel from './EncoderPanel.svelte';
  import AudioPanel from './AudioPanel.svelte';
  const tabs = [
    ['effects', 'Effects'],
    ['clip', 'Clip'],
    ['encoder', 'Encode'],
    ['audio', 'Audio'],
  ] as const;
</script>

<div class="insp">
  <div class="tabs" role="tablist">
    {#each tabs as [id, label]}
      <button role="tab" aria-selected={store.ui.tab === id} class:active={store.ui.tab === id} onclick={() => (store.ui.tab = id)}>
        {label}{#if id === 'effects' && store.project.effects.length}<span class="count mono">{store.project.effects.length}</span>{/if}
      </button>
    {/each}
    <button class="tipbtn" class:on={store.ui.tips} title={store.ui.tips ? 'Hide the description under each setting' : 'Show a description under each setting'} aria-label="Show descriptions" aria-pressed={store.ui.tips} onclick={() => store.setPref('tips', !store.ui.tips)}>?</button>
  </div>
  <div class="body">
    {#if store.ui.tab === 'effects'}
      <EffectStack />
      {#if store.selected}
        <EffectEditor effect={store.selected} />
      {/if}
    {:else if store.ui.tab === 'clip'}
      <div class="pad"><ClipEditor /></div>
    {:else if store.ui.tab === 'encoder'}
      <div class="pad"><EncoderPanel /></div>
    {:else}
      <div class="pad"><AudioPanel /></div>
    {/if}
  </div>
</div>

<style>
  .insp {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tabs {
    display: flex;
    height: 32px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .tabs .tipbtn {
    flex: none;
    width: 32px;
    font: 600 12px var(--mono);
  }
  .tabs .tipbtn.on {
    color: var(--accent);
  }
  .tabs button {
    flex: 1;
    height: 100%;
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text-3);
    font-size: 12px;
  }
  .tabs button:hover:not(:disabled) {
    background: none;
    color: var(--text-2);
  }
  .tabs button.active {
    color: var(--text);
    box-shadow: inset 0 -1px 0 var(--text);
  }
  .count {
    font-size: 10px;
    color: var(--text-3);
    margin-left: 2px;
  }
  .body {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .pad {
    padding: 10px 12px 24px;
  }
</style>
