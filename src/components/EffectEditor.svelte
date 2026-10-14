<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { EFFECTS } from '../engine/effects';
  import { randomizeEffect } from '../engine/presets';
  import { makeRng, randomSeed } from '../engine/rng';
  import ParamControl from './ParamControl.svelte';
  import Icon from './Icon.svelte';
  import type { EffectInstance } from '../engine/types';
  import { layoutVideo } from '../engine/timeline';
  import { markedRange } from '../lib/edit';

  let { effect }: { effect: EffectInstance } = $props();
  const def = $derived(EFFECTS[effect.type]);
  // settings that don't apply to the current mode are left out entirely
  const applicable = $derived(def.params.filter((p) => !p.show || p.show(effect.params)));
  const params = $derived(applicable.filter((p) => store.ui.advanced || !p.advanced));
  const hidden = $derived(applicable.length - params.length);
  const playSrc = $derived(store.playFrame);
  const total = $derived(store.totalFrames);
  const sec = (f: number) => (f / store.fps).toFixed(2);

  function randomize() {
    const r = randomizeEffect($state.snapshot(effect) as EffectInstance, makeRng(randomSeed()), total);
    store.edit(() => {
      effect.params = r.params;
      effect.seed = r.seed;
    });
  }
  const rangeLocked = $derived(effect.locks.includes('__range'));
  let showInfo = $state(false);
  const marked = $derived(store.ui.inPoint !== null || store.ui.outPoint !== null ? markedRange() : null);
  const clipUnder = $derived(layoutVideo(store.project).find((p) => store.ui.time >= p.start && store.ui.time < p.end));
  function fitTo(a: number, b: number) {
    const f = store.fps;
    store.edit(() => {
      effect.start = Math.max(0, Math.round(a * f));
      effect.end = Math.max(effect.start + 1, Math.min(total, Math.round(b * f)));
    });
  }
  const info = $derived(showInfo || store.ui.tips);
</script>

<div class="editor" style="--c:{def.color}">
  <div class="title">
    <span class="code">{def.icon}</span>
    <input
      class="name"
      value={effect.name || def.name}
      aria-label="Effect name"
      spellcheck="false"
      onchange={(e) => store.edit(() => (effect.name = (e.target as HTMLInputElement).value === def.name ? undefined : (e.target as HTMLInputElement).value))}
    />
    <button class="icon ghost" class:on={info} title="What does this do?" aria-label="About this effect" onclick={() => (store.ui.tips ? store.setPref('tips', false) : (showInfo = !showInfo))}><Icon name="help" size={14} /></button>
    <button class="icon ghost" title="Randomize unlocked settings" aria-label="Randomize settings" onclick={randomize}><Icon name="dice" size={14} /></button>
  </div>
  {#if info}<p class="desc small muted">{def.description}</p>{/if}

  <section>
    <div class="sh">
      <span class="label">Range</span>
      <span class="mono faint small">{sec(effect.start)}–{sec(effect.end)}s · {effect.end - effect.start}f</span>
      <button
        class="icon ghost tiny"
        class:on={rangeLocked}
        title={rangeLocked ? 'Range locked for Nudge' : 'Lock range for Nudge'}
        aria-label="Lock range"
        onclick={() => store.edit(() => (effect.locks = rangeLocked ? effect.locks.filter((l) => l !== '__range') : [...effect.locks, '__range']))}
        ><Icon name={rangeLocked ? 'lock' : 'unlock'} size={12} /></button
      >
    </div>
    <div class="range">
      <label class="small">
        <span class="faint">In</span>
        <input type="number" min="0" max={total} value={effect.start} onchange={(e) => store.edit(() => (effect.start = Math.max(0, Math.min(effect.end - 1, +(e.target as HTMLInputElement).value))))} />
      </label>
      <button class="tiny" title="Set in point to playhead" onclick={() => store.edit(() => (effect.start = Math.min(effect.end - 1, playSrc)))}>Mark in</button>
      <label class="small">
        <span class="faint">Out</span>
        <input type="number" min="1" max={total} value={effect.end} onchange={(e) => store.edit(() => (effect.end = Math.max(effect.start + 1, Math.min(total, +(e.target as HTMLInputElement).value))))} />
      </label>
      <button class="tiny" title="Set out point to playhead" onclick={() => store.edit(() => (effect.end = Math.max(effect.start + 1, playSrc + 1)))}>Mark out</button>
      <button class="tiny ghost" title="Cover the whole timeline" onclick={() => store.edit(() => ((effect.start = 0), (effect.end = total)))}>All</button>
      {#if marked}
        <button class="tiny ghost" title="Cover the In–Out range marked with I and O" onclick={() => fitTo(marked[0], marked[1])}>In–Out</button>
      {/if}
      {#if clipUnder}
        <button class="tiny ghost" title="Cover the clip under the playhead" onclick={() => fitTo(clipUnder.start, clipUnder.end)}>Clip</button>
      {/if}
    </div>
    <div class="small faint">{((effect.end - effect.start) / store.fps).toFixed(2)} s long. Drag the bar's ends on the timeline to change it.</div>
  </section>

  <section>
    <div class="sh"><span class="label">Settings</span></div>
    {#each params as p (p.key)}
      <ParamControl {effect} def={p} />
    {/each}
    {#if hidden}
      <button class="ghost more small" onclick={() => store.setPref('advanced', true)}>Show {hidden} more</button>
    {/if}
  </section>

  {#if store.ui.advanced}
    <section>
      <div class="sh">
        <span class="label">Seed</span>
        <input class="seed" type="number" value={effect.seed} onchange={(e) => store.edit(() => (effect.seed = +(e.target as HTMLInputElement).value))} />
        <button class="icon ghost tiny" title="New seed" aria-label="New seed" onclick={() => store.edit(() => (effect.seed = randomSeed()))}><Icon name="reset" size={12} /></button>
        <button
          class="icon ghost tiny"
          class:on={effect.locks.includes('__seed')}
          title="Lock seed"
          aria-label="Lock seed"
          onclick={() => store.edit(() => (effect.locks = effect.locks.includes('__seed') ? effect.locks.filter((l) => l !== '__seed') : [...effect.locks, '__seed']))}
          ><Icon name={effect.locks.includes('__seed') ? 'lock' : 'unlock'} size={12} /></button
        >
      </div>
    </section>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    padding-bottom: 24px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 6px 6px 12px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 14px;
    background: transparent;
    border-color: transparent;
    padding-left: 2px;
  }
  .name:hover,
  .name:focus {
    border-color: var(--line-2);
  }
  .desc {
    padding: 0 12px 8px;
    line-height: 1.5;
  }
  section {
    padding: 0 12px;
    border-top: 1px solid var(--line);
  }
  .sh {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
  }
  .sh .label {
    flex: 1;
  }
  .range {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 6px 8px;
    align-items: center;
    padding-bottom: 10px;
  }
  .range label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .range input {
    width: 70px;
  }
  .range .ghost {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
  }
  .tiny {
    height: 22px;
    padding: 0 7px;
    font-size: 11.5px;
  }
  button.icon.tiny {
    width: 22px;
    padding: 0;
  }
  .more {
    align-self: flex-start;
    margin: 6px 0 2px -6px;
    color: var(--text-2);
  }
  .seed {
    width: 100px;
  }
</style>
