<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import Modal from '../components/Modal.svelte';
  import FrameDiagram from '../components/FrameDiagram.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { ALL_EFFECTS } from '../engine/effects';
  import { FAMILIES, guideOf } from '../lib/effectguide';
  import { fxPrefs, toggleFavourite } from '../lib/fxprefs.svelte';
  import { localGet, localSet } from '../lib/storage';
  import EffectPreview from '../components/EffectPreview.svelte';
  import { onDestroy } from 'svelte';

  let where = $state<'all' | 'playhead'>('all');
  let query = $state('');
  // Simple mode shows the effects that look the most different from each other first
  let showAll = $state(store.ui.advanced);
  const q = $derived(query.trim().toLowerCase());
  const match = (d: (typeof ALL_EFFECTS)[number]) => !q || (d.name + ' ' + t(d.name) + ' ' + d.description + ' ' + guideOf(d.type).looks).toLowerCase().includes(q);
  const groups = $derived([
    // your favourites first (☆ on any effect)
    ...(!q && fxPrefs.favourites.length
      ? [{ id: 'fav', title: 'Favourites', note: 'Effects you starred.', items: ALL_EFFECTS.filter((d) => fxPrefs.favourites.includes(d.type)) }]
      : []),
    ...FAMILIES.map((f) => ({ ...f, items: ALL_EFFECTS.filter((d) => guideOf(d.type).family === f.id && match(d) && (showAll || q || guideOf(d.type).essential || fxPrefs.favourites.includes(d.type))) })),
  ].filter((g) => g.items.length));
  const hidden = $derived(ALL_EFFECTS.filter((d) => !guideOf(d.type).essential).length);
  const clip = $derived(store.selectedClip);
  // live previews on your own footage (each one is a real render, so only for shorter timelines)
  const PREVIEW_MAX_S = 30;
  // (they start when the pointer rests on an effect: touch screens have no resting pointer, a tap adds it)
  const canHover = typeof matchMedia === 'undefined' || matchMedia('(hover: hover)').matches;
  const canPreview = $derived(canHover && store.project.clips.length > 0 && store.duration <= PREVIEW_MAX_S);
  let previewOn = $state(localGet('fxLivePreview', true));
  let hovered = $state<string | null>(null);
  let previewType = $state<string | null>(null);
  let hoverTimer = 0;
  onDestroy(() => clearTimeout(hoverTimer));
  function hover(type: string | null) {
    hovered = type;
    clearTimeout(hoverTimer);
    // wait for the pointer to rest, so sweeping across the grid doesn't start a render per effect
    if (type) hoverTimer = window.setTimeout(() => hovered === type && (previewType = type), 650);
  }
  function rangeFor(type: string): [number, number] {
    const total = store.totalFrames;
    if (where === 'playhead') return [store.playFrame, Math.min(total, store.playFrame + Math.round(store.fps * 2))];
    return clip ? store.defaultRange(type) : [0, total];
  }

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
    {#if canPreview}
      <label class="pvt small" title="Rest the pointer on an effect to see it on your own footage">
        <input type="checkbox" bind:checked={previewOn} onchange={() => localSet('fxLivePreview', previewOn)} />Preview on my footage
      </label>
    {/if}
    <div class="seg" role="group" aria-label="Place on">
      <button class:on={where === 'all'} onclick={() => (where = 'all')}>{clip ? 'Selected clip' : 'Whole video'}</button>
      <button class:on={where === 'playhead'} onclick={() => (where = 'playhead')}>2 s at playhead</button>
    </div>
  </div>

  {#if canPreview && previewOn}
    <div class="livepv">
      {#if previewType}
        {#key previewType + where}<EffectPreview type={previewType} range={rangeFor(previewType)} />{/key}
      {:else}
        <div class="hint small faint">Rest the pointer on an effect to see it on your own footage.</div>
      {/if}
    </div>
  {/if}

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
            {@const fav = fxPrefs.favourites.includes(d.type)}
            <div class="cell">
            <button class="item" style="--c:{d.color}" onclick={() => add(d.type)} title={d.description} onmouseenter={() => previewOn && canPreview && hover(d.type)} onmouseleave={() => hover(null)} onfocus={() => previewOn && canPreview && hover(d.type)}>
              <span class="top">
                <span class="code">{d.icon}</span>
                <span class="nm">{t(d.name)}</span>
                {#if d.type === 'kill'}<span class="start">start here</span>{/if}
              </span>
              <span class="ds">{gd.looks || d.description}</span>
              {#if gd.diagram}<FrameDiagram cells={gd.diagram} />{/if}
            </button>
            <button class="star" class:on={fav} onclick={() => toggleFavourite(d.type)} aria-pressed={fav} aria-label="Favourite" title={fav ? 'Favourite (click to unstar)' : 'Add to favourites'}>{fav ? '★' : '☆'}</button>
            </div>
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
  .pvt {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .livepv {
    width: min(420px, 100%);
    margin: 0 auto 14px;
  }
  .livepv .hint {
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    border: 1px dashed var(--line-2);
    border-radius: var(--r);
    text-align: center;
    padding: 12px;
  }
  .cell {
    position: relative;
    display: flex;
  }
  .cell .item {
    flex: 1;
  }
  .star {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: none;
    font-size: 15px;
    color: var(--text-3);
  }
  .star:hover,
  .star.on {
    color: var(--warn);
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
    padding-right: 22px;
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
