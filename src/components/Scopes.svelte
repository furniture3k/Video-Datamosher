<script lang="ts">
  // A floating scopes panel over the player: reads whatever picture is on screen ~8 times a second.
  import { onMount } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { localGet, localSet } from '../lib/storage';
  import { drawScope, type ScopeKind } from '../lib/scopes';

  let { source }: { source: () => HTMLCanvasElement | null } = $props();
  let kind = $state<ScopeKind>(localGet('scope', 'waveform'));
  let canvas: HTMLCanvasElement;
  const small = document.createElement('canvas');
  const KINDS: [ScopeKind, string][] = [
    ['waveform', 'Waveform'],
    ['parade', 'Parade'],
    ['vectorscope', 'Vector'],
    ['histogram', 'Histogram'],
  ];

  onMount(() => {
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 120) return;
      last = now;
      const src = source();
      if (!src?.width || !canvas) return;
      // a small copy is plenty for a scope and keeps it cheap
      const w = 160;
      const h = Math.max(1, Math.round((src.height * w) / src.width));
      small.width = w;
      small.height = h;
      const sc = small.getContext('2d', { willReadFrequently: true })!;
      sc.drawImage(src, 0, 0, w, h);
      drawScope(canvas, kind, sc.getImageData(0, 0, w, h).data, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="scopes" role="group" aria-label="Scopes">
  <div class="bar">
    {#each KINDS as [k, label]}
      <button class:on={kind === k} onclick={() => ((kind = k), localSet('scope', k))}>{label}</button>
    {/each}
    <button class="x" aria-label="Close scopes" title="Close  Shift S" onclick={() => (store.ui.scopes = false)}>×</button>
  </div>
  <canvas bind:this={canvas} width="256" height="150"></canvas>
</div>

<style>
  .scopes {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 3;
    background: rgba(0, 0, 0, 0.82);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bar {
    display: flex;
    gap: 2px;
  }
  .bar button {
    height: 20px;
    padding: 0 6px;
    font-size: 10px;
    background: none;
    border-color: transparent;
    color: var(--text-2);
  }
  .bar button.on {
    color: var(--text);
    border-color: var(--line-2);
  }
  .bar .x {
    margin-left: auto;
  }
  canvas {
    width: 256px;
    height: 150px;
    display: block;
  }
  @media (max-width: 600px) {
    canvas {
      width: 192px;
      height: 112px;
    }
  }
</style>
