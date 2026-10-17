<script lang="ts">
  // A panel that slides up over the timeline while the preview stays in view, so every change is
  // seen as it's made. Swipe the grip down (or tap Done) to close.
  import type { Snippet } from 'svelte';
  import Icon from '../components/Icon.svelte';
  let { title, onclose, children, tall = false }: { title: string; onclose: () => void; children: Snippet; tall?: boolean } = $props();
  let dy = $state(0);
  function gripDown(e: PointerEvent) {
    // the Done button: capturing the pointer would send its click to the header instead
    if ((e.target as Element).closest('button')) return;
    const y0 = e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => (dy = Math.max(0, ev.clientY - y0));
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (ev.type === 'pointerup' && dy > 70) onclose();
      dy = 0;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
</script>

<div class="sheet" class:tall style:transform={dy ? `translateY(${dy}px)` : undefined} role="dialog" aria-label={title}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="head" onpointerdown={gripDown}>
    <span class="grip"></span>
    <h3>{title}</h3>
    <button class="done" onclick={onclose} aria-label="Done"><Icon name="check" size={18} stroke={1.8} /></button>
  </div>
  <div class="body">{@render children()}</div>
</div>

<style>
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-top: 1px solid var(--line-2);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
    animation: up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    height: 50px;
    padding: 8px 8px 0 18px;
    touch-action: none;
  }
  .grip {
    position: absolute;
    left: 50%;
    top: 7px;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: var(--line-2);
  }
  h3 {
    flex: 1;
    font-size: 15px;
    font-weight: 650;
  }
  .done {
    width: 40px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 18px;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  @keyframes up {
    from {
      transform: translateY(100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>
