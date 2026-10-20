<script lang="ts">
  // Particles for any title or shape: many copies rising like bubbles, falling like snow or
  // confetti, or bursting out once (emoji and hearts make reactions).
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import type { Layer } from '../engine/layers';
  import type { Particles } from '../engine/particles';

  let { layer }: { layer: Layer } = $props();
  const pt = $derived(layer.particles);

  function set(change: Partial<Particles> | null) {
    const id = layer.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (!l) return;
        if (!change) delete l.particles;
        else l.particles = { kind: 'rise', count: 12, speed: 0.35, spread: 0.5, ...(l.particles ?? {}), ...change };
      },
      'particles' + id + Object.keys(change ?? {}).join(),
    );
  }
</script>

<Field
  type="select"
  label="Particles"
  value={pt?.kind ?? 'none'}
  options={[
    { value: 'none', label: 'Just one' },
    { value: 'rise', label: 'Rise', hint: 'Float up like bubbles or hearts.' },
    { value: 'fall', label: 'Fall', hint: 'Drift down like snow or confetti.' },
    { value: 'burst', label: 'Burst', hint: 'Fly out once from where it is.' },
  ]}
  help="Many copies of it, moving on their own (sizes and turns vary)."
  onchange={(v: string) => set(v === 'none' ? null : { kind: v as Particles['kind'] })}
/>
{#if pt}
  <Field label="How many" min={2} max={80} step={1} value={pt.count} help="Copies at once." onchange={(v: number) => set({ count: Math.round(v) })} />
  <Field label="Speed" min={0.05} max={2} step={0.01} value={pt.speed} help="Frame heights a second." onchange={(v: number) => set({ speed: v })} />
  <Field label="Spread" min={0} max={1.5} step={0.01} value={pt.spread} help="How wide they spread, as a share of the frame width." onchange={(v: number) => set({ spread: v })} />
{/if}
