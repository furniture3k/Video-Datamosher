<script lang="ts">
  // Labelled control used by the clip / encoder / audio panels.
  import type { Snippet } from 'svelte';
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
    options?: { value: string | number; label: string }[];
    unit?: string;
    onchange: (v: never) => void;
    children?: Snippet;
  } = $props();
  const set = (v: unknown) => onchange(v as never);
</script>

<div class="field" class:inline={type === 'bool' || type === 'number'}>
  <div class="top">
    <span class="lab" class:has-help={!!help} title={help}>{label}</span>
    {#if type === 'range' || type === 'number'}
      <input class="val" type="number" {min} {max} {step} {value} aria-label={label} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
      {#if unit}<span class="unit">{unit}</span>{/if}
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
  {@render children?.()}
</div>

<style>
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
