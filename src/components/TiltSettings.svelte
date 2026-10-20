<script lang="ts">
  // Perspective for any title or shape: leaned back or turned to the side, as if it stood on a
  // wall or a sign rather than on the screen.
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import type { Layer } from '../engine/layers';

  let { layer }: { layer: Layer } = $props();
  const tilt = $derived(layer.tilt ?? [0, 0]);

  function set(i: 0 | 1, v: number) {
    const id = layer.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (!l) return;
        const t: [number, number] = [...(l.tilt ?? [0, 0])] as [number, number];
        t[i] = v;
        if (!t[0] && !t[1]) delete l.tilt;
        else l.tilt = t;
      },
      'tilt' + i + id,
    );
  }
</script>

<div class="label">Perspective</div>
<Field label="Lean back" unit="°" min={-75} max={75} step={1} value={tilt[0]} help="Tips the top away (+) or towards you (−), like a sign leaning back." onchange={(v: number) => set(0, v)} />
<Field label="Turn sideways" unit="°" min={-75} max={75} step={1} value={tilt[1]} help="Turns the right edge away (+) or towards you (−), like a sign seen from the side." onchange={(v: number) => set(1, v)} />
