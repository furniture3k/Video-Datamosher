<script lang="ts">
  import { store } from '../lib/store.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each store.toasts as t (t.id)}
    <div class="toast {t.kind}">{t.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 200;
    pointer-events: none;
    max-width: min(420px, calc(100vw - 24px));
  }
  .toast {
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-left: 2px solid var(--text-3);
    padding: 7px 12px;
    font-size: 12.5px;
    box-shadow: var(--shadow);
  }
  .toast.error {
    border-left-color: var(--danger);
  }
  .toast.ok {
    border-left-color: var(--ok);
  }
</style>
