<script lang="ts">
  // Depth for any title or shape: in front of everything, or behind the subject cut out of the
  // footage (it shows between the subject and the background).
  import { store } from '../lib/store.svelte';
  import { hasMattes } from '../lib/mattes.svelte';
  import Field from './Field.svelte';
  import type { Layer } from '../engine/layers';

  let { layer }: { layer: Layer } = $props();
  const ready = $derived(hasMattes(store.project));

  function set(v: string) {
    const id = layer.id;
    store.edit((p) => {
      const l = p.layers.find((x) => x.id === id);
      if (!l) return;
      if (v === 'behind' || v === 'inside') l.depth = v;
      else delete l.depth;
    });
  }
</script>

<div class="label">Depth</div>
<Field
  type="select"
  label="Depth"
  value={layer.depth ?? 'front'}
  options={[
    { value: 'front', label: 'In front', hint: 'Over everything.' },
    { value: 'behind', label: 'Behind the subject', hint: 'Hidden wherever the subject is: it shows between the subject and the background.' },
    { value: 'inside', label: 'Only on the subject', hint: 'Shown only where the subject is, like a pattern printed on it (a track matte).' },
  ]}
  help={ready ? 'In front of everything, behind the subject you cut out of the footage, or only on it.' : 'To put this behind a subject, cut the subject out of a clip first (Clip tab, Motion).'}
  onchange={set}
/>
