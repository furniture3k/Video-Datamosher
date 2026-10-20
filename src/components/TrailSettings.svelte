<script lang="ts">
  // Stamp trail for any title or shape: every beat (or so many seconds) it steps on and leaves a
  // copy behind, like a rubber stamp walked across the frame.
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import BeatChips from './BeatChips.svelte';
  import type { Layer, Trail } from '../engine/layers';

  let { layer }: { layer: Layer } = $props();
  const tr = $derived(layer.trail);

  function set(change: Partial<Trail> | null) {
    const id = layer.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (!l) return;
        if (!change) delete l.trail;
        else l.trail = { every: 0.5, count: 4, dx: 0.06, dy: 0.04, ...(l.trail ?? {}), ...change };
      },
      'trail' + id + Object.keys(change ?? {}).join(),
    );
  }
</script>

<div class="label">Stamp trail</div>
<Field label="Copies" min={0} max={16} step={1} value={tr?.count ?? 0} help="Every beat (or the time below) it steps on and leaves a copy behind, this many times. 0: off." onchange={(v: number) => set(v >= 1 ? { count: Math.round(v) } : null)} />
{#if tr}
  <Field label="Every" unit="s" min={0.05} max={4} step={0.05} value={tr.every} help="How often it steps." onchange={(v: number) => set({ every: Math.max(0.05, v) })}>
    <BeatChips counts={[0.25, 0.5, 1, 2]} onpick={(v) => set({ every: v })} />
  </Field>
  <Field label="Step across" min={-0.5} max={0.5} step={0.005} value={tr.dx} help="How far each step goes right (+) or left (−), as a share of the frame width." onchange={(v: number) => set({ dx: v })} />
  <Field label="Step down" min={-0.5} max={0.5} step={0.005} value={tr.dy} help="How far each step goes down (+) or up (−), as a share of the frame height." onchange={(v: number) => set({ dy: v })} />
{/if}
