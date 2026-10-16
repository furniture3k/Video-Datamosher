<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import FrameDiagram from '../components/FrameDiagram.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { ALL_EFFECTS } from '../engine/effects';
  import { FAMILIES, guideOf } from '../lib/effectguide';

  let where = $state<'all' | 'playhead'>('all');
  let query = $state('');
  // Simple mode shows the effects that look the most different from each other first
  let showAll = $state(store.ui.advanced);
  const q = $derived(query.trim().toLowerCase());
  const match = (d: (typeof ALL_EFFECTS)[number]) => !q || (d.name + ' ' + d.description + ' ' + guideOf(d.type).looks).toLowerCase().includes(q);
  const groups = $derived(
    FAMILIES.map((f) => ({ ...f, items: ALL_EFFECTS.filter((d) => guideOf(d.type).family === f.id && match(d) && (showAll || q || guideOf(d.type).essential)) })).filter((g) => g.items.length),
  );
  const hidden = $derived(ALL_EFFECTS.filter((d) => !guideOf(d.type).essential).length);
  const clip = $derived(store.selectedClip);
  function add(type: string) {
    if (where === 'all' && !clip) store.addEffect(type, [0, store.totalFrames]);
    else if (where === 'all') store.addEffect(type);
    else {
      const total = store.totalFrames;
      const src = store.playFrame;
      store.addEffect(type, [src, Math.min(total, src + Math.round(store.fps * 2))]);
    }
    store.ui.dialog = null;
  }
</script>

<Modal title="Add a mosh effect" wide>
  <div class="bar">
    <div class="search">
      <Icon name="fx" size={14} />
      <input placeholder="Search effects: smear, glitch, colour…" bind:value={query} aria-label="Search effects" />
    </div>
    <div class="seg" role="group" aria-label="Place on">
      <button class:on={where === 'all'} onclick={() => (where = 'all')}>{clip ? 'Selected clip' : 'Whole video'}</button>
      <button class:on={where === 'playhead'} onclick={() => (where = 'playhead')}>2 s at playhead</button>
    </div>
  </div>

  <div class="fams">
    {#each groups as g (g.id)}
      <section>
        <header>
          <h4>{g.title}</h4>
          <p>{g.note}</p>
        </header>
        <div class="items">
          {#each g.items as d (d.type)}
            {@const gd = guideOf(d.type)}
            <button class="item" style="--c:{d.color}" onclick={() => add(d.type)} title={d.description}>
              <span class="top">
                <span class="code">{d.icon}</span>
                <span class="nm">{d.name}</span>
                {#if d.type === 'kill'}<span class="start">start here</span>{/if}
              </span>
              <span class="ds">{gd.looks || d.description}</span>
              {#if gd.diagram}<FrameDiagram cells={gd.diagram} />{/if}
            </button>
          {/each}
        </div>
      </section>
    {/each}
    {#if !groups.length}
      <p class="muted small">Nothing matches “{query}”.</p>
    {/if}
  </div>

  {#snippet footer()}
    <div class="legend small faint">
      <span><i class="k"></i>full picture</span><span><i class="r"></i>repeated</span><span><i class="m"></i>moved</span><span><i class="f"></i>borrowed</span><span><i class="g"></i>damaged</span>
    </div>
    {#if !q}
      <button class="ghost" onclick={() => (showAll = !showAll)}>{showAll ? 'Show the essentials' : `Show all effects (+${hidden})`}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .search {
    flex: 1;
    min-width: 200px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    background: var(--bg);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    border: none;
    background: none;
    padding: 0;
    height: 32px;
  }
  .fams {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  h4 {
    font-size: 13px;
    font-weight: 650;
  }
  header p {
    color: var(--text-3);
    font-size: 12px;
  }
  .items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 8px;
  }
  .item {
    height: auto;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 8px;
    padding: 12px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    text-align: left;
    white-space: normal;
  }
  .item:hover:not(:disabled) {
    background: var(--surface-3);
    border-color: color-mix(in srgb, var(--c) 60%, var(--line-2));
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  .nm {
    font-weight: 600;
  }
  .start {
    margin-left: auto;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .ds {
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.45;
  }
  .legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-right: auto;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend i {
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .k {
    background: var(--f-i);
  }
  .r {
    background: var(--f-dup);
  }
  .m {
    background: var(--f-moved);
  }
  .f {
    background: var(--f-spliced);
  }
  .g {
    background: var(--f-glitch);
  }
</style>
