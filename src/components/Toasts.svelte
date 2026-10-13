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
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 200;
    pointer-events: none;
    max-width: calc(100vw - 32px);
  }
  .toast {
    background: var(--panel2);
    border: 1px solid var(--line);
    border-left: 4px solid var(--accent2);
    padding: 8px 14px;
    border-radius: 8px;
    box-shadow: var(--shadow);
    animation: pop 0.2s ease;
  }
  .toast.error {
    border-left-color: var(--danger);
  }
  .toast.ok {
    border-left-color: var(--ok);
  }
  @keyframes pop {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
