<script lang="ts">
  // Pin a title or shape to a surface tracked in a clip (a screen, a wall, a sign): from where it
  // is now it moves, turns and leans with the surface. Everything selected is pinned together.
  import { store } from '../lib/store.svelte';
  import { pinToSurface, unpinSurface } from '../lib/motion.svelte';
  import { mediaOf } from '../engine/timeline';
  import type { Layer } from '../engine/layers';
  import Field from './Field.svelte';

  let { layer }: { layer: Layer } = $props();

  /** every surface tracked in the project, with the clip it was tracked in */
  const surfaces = $derived(store.project.clips.flatMap((c) => (c.planes ?? []).map((p) => ({ clipId: c.id, id: p.id, name: p.name, from: mediaOf(store.project, c.mediaId)?.source.name ?? 'clip' }))));
  /** the layers the pin applies to: this one, and any others selected with it */
  const targets = $derived([...new Set([layer.id, ...store.ui.selectedClips.filter((id) => store.project.layers.some((l) => l.id === id))])]);

  function pin(v: string) {
    const s = surfaces.find((x) => x.id === v);
    if (s) pinToSurface(targets, s.clipId, s.id);
  }
</script>

<div class="label">Surface</div>
{#if layer.surface}
  <div class="row small faint">Pinned to a tracked surface: it moves, turns and leans with it. <button class="small ghost" onclick={() => unpinSurface(targets)}>Unpin</button></div>
{:else if surfaces.length}
  <Field
    type="select"
    label={targets.length > 1 ? `Pin ${targets.length} layers to a surface` : 'Pin to a surface'}
    value=""
    options={[{ value: '', label: 'Choose a surface…' }, ...surfaces.map((s) => ({ value: s.id, label: `${s.name} (${s.from})` }))]}
    help="Keeps it on a screen, wall or sign you tracked: from where it is now it moves, turns and leans with the surface. Move the playhead to where it should sit first."
    onchange={pin}
  />
{:else}
  <p class="small faint">Track a surface in a clip (Motion, on the clip) and this can be pinned to it.</p>
{/if}
