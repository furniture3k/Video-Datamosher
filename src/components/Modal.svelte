<script lang="ts">
  import type { Snippet } from 'svelte';
  import { store } from '../lib/store.svelte';
  import Icon from './Icon.svelte';
  let { title, wide = false, onclose, children, footer }: { title: string; wide?: boolean; onclose?: () => void; children: Snippet; footer?: Snippet } = $props();
  const close = () => (onclose ? onclose() : (store.ui.dialog = null));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="modal" class:wide role="dialog" aria-modal="true" aria-label={title}>
    <div class="head">
      <h3>{title}</h3>
      <button class="icon ghost" onclick={close} aria-label="Close" title="Close  Esc"><Icon name="x" /></button>
    </div>
    <div class="content">{@render children()}</div>
    {#if footer}<div class="foot">{@render footer()}</div>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 100;
    padding: 16px;
  }
  .modal {
    width: min(520px, 100%);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    box-shadow: var(--shadow);
  }
  .modal.wide {
    width: min(980px, 100%);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding: 0 6px 0 14px;
    border-bottom: 1px solid var(--line);
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
  }
  .content {
    padding: 14px;
    overflow: auto;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 14px;
    border-top: 1px solid var(--line);
  }
</style>
