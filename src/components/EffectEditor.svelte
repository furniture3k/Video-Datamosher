<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { randomizeEffect } from '../engine/presets';
  import { makeRng, randomSeed } from '../engine/rng';
  import ParamControl from './ParamControl.svelte';
  import type { EffectInstance } from '../engine/types';

  let { effect }: { effect: EffectInstance } = $props();
  const def = $derived(EFFECTS[effect.type]);
  const params = $derived(def.params.filter((p) => store.ui.advanced || !p.advanced));
  const hidden = $derived(def.params.length - params.length);
  const playSrc = $derived(store.render?.frames[store.ui.playhead]?.src ?? 0);
  const total = $derived(store.totalFrames);
  const sec = (f: number) => (f / store.fps).toFixed(2) + 's';

  function randomize() {
    const r = randomizeEffect($state.snapshot(effect) as EffectInstance, makeRng(randomSeed()), total);
    store.edit(() => {
      effect.params = r.params;
      effect.seed = r.seed;
    });
  }
  const rangeLocked = $derived(effect.locks.includes('__range'));
</script>

<div class="editor" style="--c:{def.color}">
  <div class="title row">
    <span class="ic">{def.icon}</span>
    <input
      class="grow name"
      value={effect.name || def.name}
      onchange={(e) => store.edit(() => (effect.name = (e.target as HTMLInputElement).value === def.name ? undefined : (e.target as HTMLInputElement).value))}
    />
    <button title="Randomise all unlocked settings" onclick={randomize}>🎲</button>
  </div>
  <p class="desc small muted">{def.description}</p>

  <div class="range">
    <div class="row">
      <span class="section-title grow">Range</span>
      <button
        class="icon ghost tiny"
        class:on={rangeLocked}
        title="Lock range for Mutate"
        onclick={() => store.edit(() => (effect.locks = rangeLocked ? effect.locks.filter((l) => l !== '__range') : [...effect.locks, '__range']))}
        >{rangeLocked ? '🔒' : '🔓'}</button
      >
      <button class="tiny" onclick={() => store.edit(() => ((effect.start = 0), (effect.end = total)))}>Whole video</button>
    </div>
    <div class="row rr">
      <label class="small">from
        <input type="number" min="0" max={total} value={effect.start} onchange={(e) => store.edit(() => (effect.start = Math.max(0, Math.min(effect.end - 1, +(e.target as HTMLInputElement).value))))} />
      </label>
      <button class="tiny" title="Start at playhead" onclick={() => store.edit(() => (effect.start = Math.min(effect.end - 1, playSrc)))}>⇤ here</button>
      <label class="small">to
        <input type="number" min="1" max={total} value={effect.end} onchange={(e) => store.edit(() => (effect.end = Math.max(effect.start + 1, Math.min(total, +(e.target as HTMLInputElement).value))))} />
      </label>
      <button class="tiny" title="End at playhead" onclick={() => store.edit(() => (effect.end = Math.max(effect.start + 1, playSrc + 1)))}>here ⇥</button>
    </div>
    <div class="small muted mono">{sec(effect.start)} → {sec(effect.end)} · {effect.end - effect.start} frames</div>
  </div>

  <div class="params">
    {#each params as p (p.key)}
      <ParamControl {effect} def={p} />
    {/each}
    {#if hidden}
      <button class="ghost small more" onclick={() => store.setPref('advanced', true)}>+ {hidden} advanced setting{hidden > 1 ? 's' : ''}</button>
    {/if}
  </div>

  {#if store.ui.advanced}
    <div class="row seed small">
      <span class="muted grow" title="Random choices inside this effect come from this seed">Effect seed</span>
      <input type="number" value={effect.seed} onchange={(e) => store.edit(() => (effect.seed = +(e.target as HTMLInputElement).value))} />
      <button class="icon ghost tiny" title="New seed" onclick={() => store.edit(() => (effect.seed = randomSeed()))}>⟳</button>
      <button
        class="icon ghost tiny"
        class:on={effect.locks.includes('__seed')}
        title="Lock seed"
        onclick={() => store.edit(() => (effect.locks = effect.locks.includes('__seed') ? effect.locks.filter((l) => l !== '__seed') : [...effect.locks, '__seed']))}
        >{effect.locks.includes('__seed') ? '🔒' : '🔓'}</button
      >
    </div>
  {/if}
</div>

<style>
  .editor {
    border-top: 1px solid var(--line);
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ic {
    color: var(--c);
    font-size: 18px;
  }
  .name {
    font-weight: 700;
    font-size: 15px;
    background: transparent;
    border-color: transparent;
  }
  .name:hover {
    border-color: var(--line);
  }
  .desc {
    margin: 0;
    line-height: 1.45;
  }
  .range {
    background: var(--bg2);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .rr {
    flex-wrap: wrap;
  }
  .rr input {
    width: 64px;
  }
  .tiny {
    padding: 2px 6px;
    font-size: 11px;
    min-width: 0;
  }
  .params {
    display: flex;
    flex-direction: column;
  }
  .more {
    align-self: flex-start;
    color: var(--accent);
  }
  .seed input {
    width: 100px;
  }
</style>
