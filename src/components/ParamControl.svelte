<script lang="ts">
  import { store } from '../lib/store.svelte';
  import type { ParamDef } from '../engine/effects';
  import type { EffectInstance } from '../engine/types';
  import { randomParam } from '../engine/presets';
  import { makeRng, randomSeed } from '../engine/rng';
  import AutomationEditor from './AutomationEditor.svelte';
  import Icon from './Icon.svelte';

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

<div class="pc" class:locked class:automated={!!auto}>
  <div class="top">
    <span class="label-text" title={def.help}>{def.label}</span>
    <div class="tools">
      {#if automatable}
        <button class="icon ghost" class:on={!!auto} title="Automate over time (curve or LFO)" aria-label="Automate" onclick={toggleAuto}><Icon name="curve" size={13} /></button>
      {/if}
      <button class="icon ghost" title="Randomize this" aria-label="Randomize" onclick={dice}><Icon name="dice" size={13} /></button>
      <button class="icon ghost" class:on={locked} title={locked ? 'Locked: Randomize and Nudge skip this' : 'Lock against Randomize and Nudge'} aria-label="Lock" onclick={toggleLock}
        ><Icon name={locked ? 'lock' : 'unlock'} size={13} /></button
      >
    </div>
    {#if def.type === 'number' || def.type === 'int'}
      {#if !auto}
        <input class="val" type="number" min={def.min} max={def.max} step={def.type === 'int' ? 1 : (def.step ?? 0.01)} value={value} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
        {#if def.unit}<span class="unit">{def.unit}</span>{/if}
      {:else}
        <span class="val auto mono">auto</span>
      {/if}
    {:else if def.type === 'bool' && !auto}
      <input type="checkbox" class="switch" checked={!!value} aria-label={def.label} onchange={(e) => set((e.target as HTMLInputElement).checked)} />
    {:else if def.type === 'bool'}
      <span class="val auto mono">auto</span>
    {/if}
  </div>
  {#if auto}
    <AutomationEditor {effect} {def} />
  {:else if def.type === 'number' || def.type === 'int'}
    <input
      type="range"
      aria-label={def.label}
      title="Double-click to reset"
      min={isLog ? 0 : def.min}
      max={isLog ? 1 : def.max}
      step={isLog ? 0.001 : def.type === 'int' ? 1 : (def.step ?? 0.01)}
      value={toSlider(Number(value))}
      oninput={(e) => set(fromSlider(+(e.target as HTMLInputElement).value))}
      ondblclick={() => set(def.default)}
    />
  {:else if def.type === 'select'}
    {#if def.options.length <= 3}
      <div class="seg full">
        {#each def.options as o}
          <button class:on={value === o.value} onclick={() => set(o.value)}>{o.label}</button>
        {/each}
      </div>
    {:else}
      <select value={value} aria-label={def.label} onchange={(e) => set((e.target as HTMLSelectElement).value)}>
        {#each def.options as o}<option value={o.value}>{o.label}</option>{/each}
      </select>
    {/if}
  {:else if def.type === 'frame'}
    <div class="row">
      <input type="range" aria-label={def.label} min="0" max={Math.max(0, store.totalFrames - 1)} value={Number(value)} oninput={(e) => set(+(e.target as HTMLInputElement).value)} />
      <input class="val" type="number" min="0" max={store.totalFrames} value={value} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
      <button class="icon ghost" title="Use playhead position" aria-label="Use playhead" onclick={() => set(playSrc)}><Icon name="import" size={13} /></button>
    </div>
  {/if}
</div>

<style>
  .pc {
    padding: 6px 0 4px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .label-text {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: var(--text-2);
    cursor: help;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pc:hover .label-text {
    color: var(--text);
  }
  .pc.locked .label-text::after {
    content: ' ·locked';
    color: var(--text-3);
    font-size: 11px;
  }
  .tools {
    display: flex;
    opacity: 0;
  }
  .pc:hover .tools,
  .tools:focus-within {
    opacity: 1;
  }
  .tools button {
    width: 22px;
    height: 22px;
  }
  .tools button.on {
    opacity: 1;
  }
  .pc.locked .tools,
  .pc.automated .tools {
    opacity: 1;
  }
  .val {
    width: 64px;
    height: 22px;
    border-color: transparent;
    background: transparent;
    color: var(--text);
  }
  .val:hover,
  .val:focus {
    border-color: var(--line-2);
    background: var(--bg);
  }
  .val.auto {
    width: auto;
    font-size: 11px;
    color: var(--accent);
  }
  .unit {
    font-size: 11px;
    color: var(--text-3);
    margin-left: -4px;
    min-width: 14px;
  }
  .seg.full {
    display: flex;
    margin-top: 4px;
  }
  .seg.full button {
    flex: 1;
    font-size: 11.5px;
    padding: 0 4px;
  }
  select {
    width: 100%;
    margin-top: 4px;
  }
  @media (hover: none) {
    .tools {
      opacity: 1;
    }
  }
</style>
