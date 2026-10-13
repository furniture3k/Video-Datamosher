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

<div class="insp panel">
  <nav>
    {#each tabs as [id, label]}
      <button class="ghost" class:active={store.ui.tab === id} onclick={() => (store.ui.tab = id)}>
        {label}{#if id === 'effects' && store.project.effects.length}<span class="badge">{store.project.effects.length}</span>{/if}
      </button>
    {/each}
  </nav>
  <div class="body">
    {#if store.ui.tab === 'effects'}
      <EffectStack />
      {#if store.selected}
        <EffectEditor effect={store.selected} />
      {/if}
    {:else if store.ui.tab === 'clip'}
      <ClipEditor />
    {:else if store.ui.tab === 'encoder'}
      <EncoderPanel />
    {:else}
      <AudioPanel />
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
  nav {
    display: flex;
    border-bottom: 1px solid var(--line);
    padding: 4px;
    gap: 2px;
  }
  nav button {
    flex: 1;
    border-radius: 6px;
    color: var(--muted);
  }
  nav button.active {
    color: var(--text);
    background: var(--panel2);
    border-color: var(--line);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .badge {
    background: var(--accent);
    color: #fff;
    border-radius: 8px;
    padding: 0 5px;
    font-size: 10px;
    margin-left: 4px;
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
