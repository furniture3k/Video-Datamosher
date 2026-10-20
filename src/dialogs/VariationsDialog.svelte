<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import MiniPlayer from '../components/MiniPlayer.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { renderPreview, Cancelled } from '../lib/renderer';
  import { breed, chaos, mutate } from '../engine/presets';
  import { randomSeed } from '../engine/rng';
  import { EFFECTS } from '../engine/effects';
  import { takeSnapshot } from '../lib/snapshots.svelte';
  import { beatInfo } from '../lib/beatinfo.svelte';
  import type { Project } from '../engine/types';

  type Item = { project: Project; jpegs: Uint8Array[] | null; error?: string; parent?: boolean };
  let count = $state(6);
  let mode = $state<'mutate' | 'chaos'>(store.project.effects.length ? 'mutate' : 'chaos');
  let amount = $state(0.35);
  let items = $state<Item[]>([]);
  /** earlier generations (Back) */
  let history = $state<Item[][]>([]);
  let picked = $state<number[]>([]);
  let keepParents = $state(true);
  let running = $state(false);
  let signal = { cancelled: false };

  async function renderAll(list: Item[]) {
    signal.cancelled = true;
    signal = { cancelled: false };
    const my = signal;
    items = list;
    picked = [];
    running = true;
    for (const it of items) {
      if (my.cancelled) break;
      if (it.jpegs) continue;
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

  function generate() {
    const base = $state.snapshot(store.project) as Project;
    const total = store.totalFrames;
    history = [];
    renderAll(
      Array.from({ length: count }, () => ({
        project: mode === 'mutate' ? mutate(base, total, amount, randomSeed(), store.ui.chaosGraphics) : chaos(base, total, randomSeed(), store.ui.chaosIntensity, store.ui.chaosGraphics ? { beats: beatInfo.beats } : undefined),
        jpegs: null,
      })),
    );
  }

  /** The next generation: children of the picked tiles (and, optionally, the parents themselves). */
  function breedNext() {
    const parents = picked.map((i) => items[i]);
    if (!parents.length) return;
    const total = store.totalFrames;
    const ps = parents.map((p) => $state.snapshot(p.project) as Project);
    const kept: Item[] = keepParents ? parents.map((p) => ({ project: p.project, jpegs: p.jpegs, parent: true })) : [];
    const n = Math.max(1, count - kept.length);
    const kids: Item[] = Array.from({ length: n }, () => ({
      // one parent: nudged copies; two or more: crossover
      project: ps.length > 1 ? breed(ps, total, randomSeed(), amount * 0.4, store.ui.chaosGraphics) : mutate(ps[0], total, amount, randomSeed(), store.ui.chaosGraphics),
      jpegs: null,
    }));
    history = [...history, items];
    renderAll([...kept, ...kids]);
  }

  function back() {
    const prev = history.at(-1);
    if (!prev) return;
    history = history.slice(0, -1);
    renderAll(prev);
  }

  function toggle(i: number) {
    picked = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i];
  }

  async function use(p: Project) {
    signal.cancelled = true;
    if (store.project.effects.length) await takeSnapshot('Before Variations', true);
    // a plain copy: the tile's project is this dialog's state
    store.set($state.snapshot(p) as Project);
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
    <label class="row">{mode === 'mutate' || history.length ? 'Mutation' : 'Strength'} <input type="range" min="0.05" max="1" step="0.05" bind:value={amount} style="width:100px" /></label>
    <label class="row" title="Also change the titles, shapes and canvas: fonts, colours, entrances, places, timing on the beat"><input type="checkbox" checked={store.ui.chaosGraphics} onchange={(e) => store.setPref('chaosGraphics', (e.target as HTMLInputElement).checked)} />Titles &amp; graphics</label>
    <label class="row">Count
      <select bind:value={count}>{#each [4, 6, 9, 12] as n}<option value={n}>{n}</option>{/each}</select>
    </label>
    <span class="grow"></span>
    <button onclick={generate}>New batch</button>
  </div>
  <div class="row bar small breed">
    <span class="gen mono">Generation {history.length + 1}</span>
    <button class="ghost" onclick={back} disabled={!history.length} title="Back to the previous generation"><Icon name="undo" size={14} />Back</button>
    <span class="grow faint">Tick the ones you like, then breed them: their children mix the stacks and settings.</span>
    <label class="row"><input type="checkbox" bind:checked={keepParents} />Keep parents</label>
    <button class="primary" onclick={breedNext} disabled={!picked.length || running}>{picked.length > 1 ? `Breed ${picked.length}` : picked.length ? 'Evolve 1' : 'Breed'}</button>
  </div>
  <div class="grid">
    {#each items as it, i}
      <div class="cell" class:on={picked.includes(i)}>
        <button class="pv" onclick={() => toggle(i)} disabled={!it.jpegs} title="Pick as a parent">
          {#if it.jpegs}
            <MiniPlayer jpegs={it.jpegs} fps={store.project.encoder.fps} />
          {:else if it.error}
            <div class="ph small">{it.error.slice(0, 80)}</div>
          {:else}
            <div class="ph small muted">{running ? 'rendering…' : 'waiting'}</div>
          {/if}
          {#if picked.includes(i)}<span class="tick"><Icon name="check" size={14} /></span>{/if}
        </button>
        <div class="row foot">
          <span class="small mono faint grow">{String.fromCharCode(65 + i)}{it.parent ? '·parent' : ''}&ensp;{it.project.effects.map((e) => EFFECTS[e.type]?.icon).join(' ')}</span>
          <button class="small" onclick={() => use(it.project)} disabled={!it.jpegs}>Use</button>
        </div>
      </div>
    {/each}
  </div>
</Modal>

<style>
  .bar {
    flex-wrap: wrap;
    gap: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 10px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    background: var(--surface-2);
    border: 1px solid transparent;
    border-radius: var(--r);
  }
  .cell.on {
    border-color: var(--accent);
  }
  .pv {
    position: relative;
    height: auto;
    padding: 0;
    display: block;
    background: none;
    border: none;
  }
  .tick {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent);
    color: #000;
  }
  .foot {
    gap: 6px;
  }
  .breed {
    margin-top: 6px;
  }
  .gen {
    font-weight: 600;
  }
  @media (max-width: 600px) {
    /* the hint gets its own line on phones */
    .breed .grow {
      order: 10;
      flex-basis: 100%;
    }
  }
  .ph {
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    background: var(--bg);
    white-space: normal;
  }
</style>
