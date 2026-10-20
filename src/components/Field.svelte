<script lang="ts">
  // Labelled control used by the clip / encoder / audio panels.
  import type { Snippet } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { beatInfo, timeUnit } from '../lib/beatinfo.svelte';
  import { fromBeats, lengthFromBeats, lengthToBeats, toBeats } from '../engine/beattime';
  let {
    label,
    help = '',
    type = 'range',
    value,
    min = 0,
    max = 1,
    step = 1,
    options = [],
    unit = '',
    time,
    from = 0,
    onchange,
    children,
  }: {
    label: string;
    help?: string;
    type?: 'range' | 'bool' | 'select' | 'number';
    value: number | boolean | string;
    min?: number;
    max?: number;
    step?: number;
    options?: { value: string | number; label: string; hint?: string }[];
    unit?: string;
    /** a time in seconds that can be shown in beats: a moment on the timeline ('at'), or a length starting at `from` ('span') */
    time?: 'at' | 'span';
    from?: number;
    onchange: (v: never) => void;
    children?: Snippet;
  } = $props();
  const set = (v: unknown) => onchange(v as never);
  /** shown in beats: it is a time, the music has a tempo and beats are chosen as the unit */
  const beatsOn = $derived(!!time && timeUnit.beats && beatInfo.status === 'ready' && beatInfo.beats.length > 1 && typeof value === 'number');
  const toShown = (sec: number) => (time === 'at' ? toBeats(beatInfo.beats, sec) : lengthToBeats(beatInfo.beats, from, sec)) ?? sec;
  const fromShown = (n: number) => (time === 'at' ? fromBeats(beatInfo.beats, n) : lengthFromBeats(beatInfo.beats, from, n)) ?? n;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const shown = $derived(beatsOn ? round(toShown(value as number)) : value);
  /** A typed number, kept in the field's range (a cleared box goes back to the value, not 0). */
  function setTyped(el: HTMLInputElement) {
    const v = el.valueAsNumber;
    if (!Number.isFinite(v)) return void (el.value = String(shown));
    const sec = beatsOn ? fromShown(v) : v;
    const c = Math.max(min, Math.min(max, sec));
    el.value = String(beatsOn ? round(toShown(c)) : c);
    set(c);
  }
</script>

<div class="field" class:inline={type === 'bool' || type === 'number'}>
  <div class="top">
    <span class="lab" class:has-help={!!help} title={help}>{label}</span>
    {#if type === 'range' || type === 'number'}
      <input class="val" type="number" min={beatsOn ? undefined : min} max={beatsOn ? undefined : max} step={beatsOn ? 0.25 : step} value={shown} aria-label={label} onchange={(e) => setTyped(e.target as HTMLInputElement)} />
      {#if time && beatInfo.status === 'ready' && beatInfo.beats.length > 1}
        <button class="unit swap" title={beatsOn ? 'Shown in beats of the music: press for seconds' : 'Shown in seconds: press for beats of the music'} aria-label={`${label} in ${beatsOn ? 'beats' : 'seconds'}: switch`} onclick={() => (timeUnit.beats = !timeUnit.beats)}>{beatsOn ? 'beats' : 's'}</button>
      {:else if unit}<span class="unit">{unit}</span>{/if}
    {:else if type === 'bool'}
      <input type="checkbox" class="switch" checked={!!value} aria-label={label} onchange={(e) => set((e.target as HTMLInputElement).checked)} />
    {/if}
  </div>
  {#if type === 'range'}
    <input type="range" {min} {max} {step} {value} aria-label={label} oninput={(e) => set(+(e.target as HTMLInputElement).value)} />
  {:else if type === 'select'}
    <select {value} aria-label={label} onchange={(e) => {
      const raw = (e.target as HTMLSelectElement).value;
      set(typeof options[0]?.value === 'number' ? +raw : raw);
    }}>
      {#each options as o}<option value={o.value}>{o.label}</option>{/each}
    </select>
  {/if}
  {#if store.ui.tips}
    {@const hint = type === 'select' ? options.find((o) => o.value === value)?.hint : undefined}
    {#if help}<p class="hint">{help}</p>{/if}
    {#if hint}<p class="hint opt">{hint}</p>{/if}
  {/if}
  {@render children?.()}
</div>

<style>
  .swap {
    border: 0;
    background: transparent;
    color: var(--accent, inherit);
    cursor: pointer;
    padding: 0 2px;
    font: inherit;
    font-size: 11.5px;
    text-decoration: underline dotted;
  }
  .hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text-3);
  }
  .hint.opt {
    color: var(--text-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 5px 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .lab {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: var(--text-2);
  }
  .lab.has-help {
    cursor: help;
  }
  .field:hover .lab {
    color: var(--text);
  }
  .val {
    width: 64px;
    height: 22px;
    border-color: transparent;
    background: transparent;
  }
  .val:hover,
  .val:focus {
    border-color: var(--line-2);
    background: var(--bg);
  }
  .unit {
    font-size: 11px;
    color: var(--text-3);
    margin-left: -4px;
    min-width: 14px;
  }
  select {
    width: 100%;
  }
</style>
