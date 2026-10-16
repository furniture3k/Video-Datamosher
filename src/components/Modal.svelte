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
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
    z-index: 100;
    padding: 16px;
    animation: fade 0.14s ease-out;
  }
  .modal {
    width: min(540px, 100%);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: rise 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .modal.wide {
    width: min(1000px, 100%);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    flex: none;
    padding: 0 8px 0 18px;
    border-bottom: 1px solid var(--line);
  }
  h3 {
    font-size: 14px;
    font-weight: 650;
  }
  .content {
    padding: 16px 18px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 18px;
    border-top: 1px solid var(--line);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.99);
    }
  }
  @keyframes sheet {
    from {
      transform: translateY(100%);
    }
  }
  /* phones: dialogs are bottom sheets, thumb-reachable, like a mobile editor */
  @media (max-width: 860px), (max-height: 500px) and (pointer: coarse) {
    .backdrop {
      place-items: end stretch;
      padding: 0;
    }
    .modal,
    .modal.wide {
      width: 100%;
      max-height: 88vh;
      border-radius: 16px 16px 0 0;
      border-bottom: none;
      padding-bottom: env(safe-area-inset-bottom);
      animation: sheet 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .head::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 6px;
      width: 36px;
      height: 4px;
      margin-left: -18px;
      border-radius: 2px;
      background: var(--line-2);
    }
    .head {
      position: relative;
      height: 52px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .backdrop,
    .modal {
      animation: none !important;
    }
  }
</style>
