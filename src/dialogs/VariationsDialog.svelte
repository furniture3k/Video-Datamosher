<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import MiniPlayer from '../components/MiniPlayer.svelte';
  import { store } from '../lib/store.svelte';
  import { renderPreview, Cancelled } from '../lib/renderer';
  import { chaos, mutate } from '../engine/presets';
  import { randomSeed } from '../engine/rng';
  import { EFFECTS } from '../engine/effects';
  import type { Project } from '../engine/types';

  let count = $state(6);
  let mode = $state<'mutate' | 'chaos'>(store.project.effects.length ? 'mutate' : 'chaos');
  let amount = $state(0.35);
  let items = $state<{ project: Project; jpegs: Uint8Array[] | null; error?: string }[]>([]);
  let running = $state(false);
  let signal = { cancelled: false };

  async function generate() {
    signal.cancelled = true;
    signal = { cancelled: false };
    const my = signal;
    const base = $state.snapshot(store.project) as Project;
    const total = store.totalFrames;
    items = Array.from({ length: count }, () => ({
      project: mode === 'mutate' ? mutate(base, total, amount, randomSeed()) : chaos(base, total, randomSeed(), store.ui.chaosIntensity),
      jpegs: null,
    }));
    running = true;
    for (const it of items) {
      if (my.cancelled) break;
      try {
        const r = await renderPreview(it.project, 240, undefined, my);
        it.jpegs = r.jpegs;
      } catch (e) {
        if (e instanceof Cancelled) break;
        it.error = (e as Error).message;
      }
    }
    if (!my.cancelled) running = false;
  }

  function pick(p: Project) {
    signal.cancelled = true;
    store.set(p);
    store.ui.dialog = null;
    
  }
  function close() {
    signal.cancelled = true;
    store.ui.dialog = null;
  }
  onMount(() => {
    generate();
    return () => (signal.cancelled = true);
  });
</script>

<Modal title="Variations" wide onclose={close}>
  <div class="row bar small">
    <div class="seg">
      <button class:on={mode === 'mutate'} disabled={!store.project.effects.length} onclick={() => (mode = 'mutate')}>Nudged copies</button>
      <button class:on={mode === 'chaos'} onclick={() => (mode = 'chaos')}>Random stacks</button>
    </div>
    {#if mode === 'mutate'}
      <label class="row">Strength <input type="range" min="0.05" max="1" step="0.05" bind:value={amount} style="width:100px" /></label>
    {/if}
    <label class="row">Count
      <select bind:value={count}>{#each [4, 6, 9, 12] as n}<option value={n}>{n}</option>{/each}</select>
    </label>
    <span class="grow"></span>
    <button class="primary" onclick={generate}>Render</button>
  </div>
  <p class="small faint note">Small previews. Locked settings and pinned effects are kept. Pick one to use it.</p>
  <div class="grid">
    {#each items as it, i}
      <button class="cell" onclick={() => pick(it.project)} disabled={!it.jpegs}>
        {#if it.jpegs}
          <MiniPlayer jpegs={it.jpegs} fps={store.project.encoder.fps} />
        {:else if it.error}
          <div class="ph small">{it.error.slice(0, 80)}</div>
        {:else}
          <div class="ph small muted">{running ? 'rendering…' : 'waiting'}</div>
        {/if}
        <span class="small mono faint">{String.fromCharCode(65 + i)}&ensp;{it.project.effects.map((e) => EFFECTS[e.type]?.icon).join(" ")}</span>
      </button>
    {/each}
  </div>
</Modal>

<style>
  .bar {
    flex-wrap: wrap;
    gap: 8px;
  }
  .note {
    margin: 8px 0 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 10px;
  }
  .cell {
    height: auto;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 6px;
    background: var(--surface-2);
  }
  .ph {
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    background: var(--bg);
    white-space: normal;
  }
</style>
