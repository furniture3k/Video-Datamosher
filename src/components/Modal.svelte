<script lang="ts">
  import type { Snippet } from 'svelte';
  import { store } from '../lib/store.svelte';
  let { title, wide = false, onclose, children, footer }: { title: string; wide?: boolean; onclose?: () => void; children: Snippet; footer?: Snippet } = $props();
  const close = () => (onclose ? onclose() : (store.ui.dialog = null));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="modal panel" class:wide role="dialog" aria-modal="true" aria-label={title}>
    <div class="head row">
      <h3 class="grow">{title}</h3>
      <button class="icon ghost" onclick={close} aria-label="Close">✕</button>
    </div>
    <div class="content">{@render children()}</div>
    {#if footer}<div class="foot row">{@render footer()}</div>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 10, 0.6);
    backdrop-filter: blur(3px);
    display: grid;
    place-items: center;
    z-index: 100;
    padding: 16px;
  }
  .modal {
    width: min(560px, 100%);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow);
  }
  .modal.wide {
    width: min(1080px, 100%);
  }
  .head {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
  }
  .content {
    padding: 14px;
    overflow: auto;
  }
  .foot {
    padding: 10px 14px;
    border-top: 1px solid var(--line);
    justify-content: flex-end;
  }
</style>
