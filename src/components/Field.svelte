<script lang="ts">
  // Generic labelled control used by the clip / encoder / audio panels.
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

<div class="field" class:inline={type === 'bool'}>
  <div class="lab row">
    <span class="grow" title={help}>{label}{#if help}<span class="q" title={help}>?</span>{/if}</span>
    {#if type === 'range'}
      <input type="number" {min} {max} {step} value={value} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
      {#if unit}<span class="small muted">{unit}</span>{/if}
    {/if}
    {#if type === 'bool'}
      <input type="checkbox" class="switch" checked={!!value} onchange={(e) => set((e.target as HTMLInputElement).checked)} />
    {/if}
  </div>
  {#if type === 'range'}
    <input type="range" {min} {max} {step} value={value} oninput={(e) => set(+(e.target as HTMLInputElement).value)} />
  {:else if type === 'select'}
    <select value={value} onchange={(e) => {
      const raw = (e.target as HTMLSelectElement).value;
      set(typeof options[0]?.value === 'number' ? +raw : raw);
    }}>
      {#each options as o}<option value={o.value}>{o.label}</option>{/each}
    </select>
  {:else if type === 'number'}
    <input type="number" {min} {max} {step} value={value} onchange={(e) => set(+(e.target as HTMLInputElement).value)} />
  {/if}
  {@render children?.()}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 0;
  }
  .lab {
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
  select {
    width: 100%;
  }
</style>
