<script lang="ts">
  import { store } from '../lib/store.svelte';
  import type { ParamDef } from '../engine/effects';
  import type { EffectInstance } from '../engine/types';
  import { randomParam } from '../engine/presets';
  import { makeRng, randomSeed } from '../engine/rng';
  import AutomationEditor from './AutomationEditor.svelte';

  let { effect, def }: { effect: EffectInstance; def: ParamDef } = $props();
  const value = $derived(effect.params[def.key]);
  const locked = $derived(effect.locks.includes(def.key));
  const auto = $derived(effect.auto[def.key]);
  const automatable = $derived(def.type === 'number' || def.type === 'int' || def.type === 'bool');
  const key = $derived(effect.id + def.key);

  function set(v: number | boolean | string) {
    store.edit(() => (effect.params[def.key] = v), key);
  }
  function toggleLock() {
    store.edit(() => (effect.locks = locked ? effect.locks.filter((l) => l !== def.key) : [...effect.locks, def.key]));
  }
  function toggleAuto() {
    store.edit(() => {
      if (auto) delete effect.auto[def.key];
      else if (def.type === 'number' || def.type === 'int')
        effect.auto[def.key] = { kind: 'curve', interp: 'smooth', points: [[0, def.min], [1, Number(value)]] };
      else effect.auto[def.key] = { kind: 'lfo', shape: 'square', rate: 4, min: 0, max: 1, phase: 0 };
    });
  }
  function dice() {
    set(randomParam(def, makeRng(randomSeed()), store.totalFrames));
  }
  // log-scale slider mapping
  const isLog = $derived((def.type === 'number' || def.type === 'int') && def.log && def.min >= 0);
  const toSlider = (v: number) => (isLog && 'max' in def ? Math.log(v + 1) / Math.log(def.max + 1) : v);
  const fromSlider = (s: number) => {
    if (!(def.type === 'number' || def.type === 'int')) return s;
    let v = isLog ? Math.exp(s * Math.log(def.max + 1)) - 1 : s;
    v = def.type === 'int' ? Math.round(v) : Math.round(v / (def.step ?? 0.01)) * (def.step ?? 0.01);
    return +v.toFixed(4);
  };
  const playSrc = $derived(store.render?.frames[store.ui.playhead]?.src ?? 0);
</script>

<div class="pc" class:locked>
  <div class="top row">
    <span class="label grow" title={def.help}>{def.label}<span class="q" title={def.help}>?</span></span>
    {#if def.type === 'number' || def.type === 'int'}
      {#if !auto}
        <input type="number" min={def.min} max={def.max} step={def.type === 'int' ? 1 : (def.step ?? 0.01)} value={value} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
        {#if def.unit}<span class="small muted">{def.unit}</span>{/if}
      {/if}
    {:else if def.type === 'bool' && !auto}
      <input type="checkbox" class="switch" checked={!!value} onchange={(e) => set((e.target as HTMLInputElement).checked)} />
    {/if}
    {#if automatable}
      <button class="mini" class:on={!!auto} title="Automate: change this over time (curve or LFO)" onclick={toggleAuto}>〰</button>
    {/if}
    <button class="mini" title="Randomise this setting" onclick={dice}>⚄</button>
    <button class="mini" class:on={locked} title={locked ? 'Locked: Chaos / Mutate will not change this' : 'Lock against Chaos / Mutate'} onclick={toggleLock}>{locked ? '🔒' : '🔓'}</button>
  </div>
  {#if auto}
    <AutomationEditor {effect} {def} />
  {:else if def.type === 'number' || def.type === 'int'}
    <input
      type="range"
      min={isLog ? 0 : def.min}
      max={isLog ? 1 : def.max}
      step={isLog ? 0.001 : def.type === 'int' ? 1 : (def.step ?? 0.01)}
      value={toSlider(Number(value))}
      oninput={(e) => set(fromSlider(+(e.target as HTMLInputElement).value))}
    />
  {:else if def.type === 'select'}
    <div class="seg">
      {#if def.options.length <= 3}
        {#each def.options as o}
          <button class:on={value === o.value} onclick={() => set(o.value)}>{o.label}</button>
        {/each}
      {:else}
        <select value={value} onchange={(e) => set((e.target as HTMLSelectElement).value)}>
          {#each def.options as o}<option value={o.value}>{o.label}</option>{/each}
        </select>
      {/if}
    </div>
  {:else if def.type === 'frame'}
    <div class="row">
      <input type="range" min="0" max={Math.max(0, store.totalFrames - 1)} value={Number(value)} oninput={(e) => set(+(e.target as HTMLInputElement).value)} />
      <input type="number" min="0" max={store.totalFrames} value={value} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
      <button class="mini" title="Use playhead position" onclick={() => set(playSrc)}>⌖</button>
    </div>
  {/if}
</div>

<style>
  .pc {
    padding: 5px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
  }
  .pc.locked .label {
    color: var(--accent3);
  }
  .label {
    font-size: 12.5px;
  }
  .q {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    margin-left: 5px;
    border-radius: 50%;
    border: 1px solid var(--faint);
    color: var(--muted);
    font-size: 9px;
    cursor: help;
    vertical-align: 1px;
  }
  .mini {
    padding: 0 4px;
    font-size: 11px;
    min-width: 0;
    background: transparent;
    border-color: transparent;
    opacity: 0.6;
  }
  .mini:hover,
  .mini.on {
    opacity: 1;
  }
  .seg {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    margin-top: 3px;
  }
  .seg button {
    flex: 1;
    font-size: 11.5px;
    padding: 4px 6px;
  }
  .seg select {
    width: 100%;
  }
</style>
