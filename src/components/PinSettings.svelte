<script lang="ts">
  // Pin a title or shape to something tracked in a clip: a point or object, a face, or a flat
  // surface (a screen, a wall, a sign). From where it is now it moves with it (a surface also turns
  // and leans it). Everything selected is pinned together. One control for all three.
  import { store } from '../lib/store.svelte';
  import { pinToSurface, pinToPath, repin, unpin } from '../lib/motion.svelte';
  import { mediaOf } from '../engine/timeline';
  import type { Layer } from '../engine/layers';
  import Field from './Field.svelte';

  let { layer }: { layer: Layer } = $props();

  /** everything tracked in the project, with the clip it was tracked in */
  const things = $derived(
    store.project.clips.flatMap((c) => {
      const from = mediaOf(store.project, c.mediaId)?.source.name ?? 'clip';
      return [
        ...(c.paths ?? []).map((p) => ({ value: `${c.id}|path|${p.id}`, label: `${/^face/i.test(p.name) ? 'Face' : 'Point'}: ${p.name} (${from})` })),
        ...(c.planes ?? []).map((p) => ({ value: `${c.id}|plane|${p.id}`, label: `Surface: ${p.name} (${from})` })),
      ];
    }),
  );
  /** the layers the pin applies to: this one, and any others selected with it */
  const targets = $derived([...new Set([layer.id, ...store.ui.selectedClips.filter((id) => store.project.layers.some((l) => l.id === id))])]);
  const what = $derived(layer.pin ? (layer.pin.kind === 'surface' ? 'a tracked surface' : layer.pin.kind === 'face' ? 'a face' : 'a tracked point') : layer.surface ? 'a tracked surface' : 'something tracked');

  function pin(v: string) {
    const [clipId, kind, id] = v.split('|');
    if (kind === 'plane') pinToSurface(targets, clipId, id);
    else if (kind === 'path') pinToPath(targets, clipId, id);
  }
</script>

<div class="label">Pin</div>
{#if layer.surface || layer.follow?.length}
  <div class="row small faint">
    Pinned to {what}: it moves{layer.surface ? ', turns and leans' : ''} with it.
    {#if layer.pin}<button class="small ghost" onclick={() => repin(targets)} title="Pin it again from where it is at the playhead: after you moved it, or after the tracking changed">Pin again here</button>{/if}
    <button class="small ghost" onclick={() => unpin(targets)}>Unpin</button>
  </div>
{:else if things.length}
  <Field
    type="select"
    label={targets.length > 1 ? `Pin ${targets.length} layers to…` : 'Pin to…'}
    value=""
    options={[{ value: '', label: 'Choose something tracked…' }, ...things]}
    help="Keeps it on a tracked object, a face, or a screen, wall or sign: from where it is now it moves with it. Move the playhead to where it should sit first."
    onchange={pin}
  />
{:else}
  <p class="small faint">Track an object, find faces or track a surface in a clip (the Clip tab) and this can be pinned to it.</p>
{/if}
