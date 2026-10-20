<script lang="ts">
  // Styles for shapes and stickers: one click puts a look on the selected shapes (colour, line, glow,
  // wobble, shadow and outline); save your own. New shapes take the look from then on.
  import { store } from '../lib/store.svelte';
  import { allShapeStyles, deleteShapeStyle, saveShapeStyle, shapeStyles, styleShapes } from '../lib/styles.svelte';
  import { BUILTIN_SHAPE_STYLES, hasShapeStyle } from '../engine/styles';
  import type { ShapeLayer } from '../engine/layers';

  let { shape }: { shape: ShapeLayer } = $props();
  const ids = $derived([...new Set([shape.id, ...store.ui.selectedClips.filter((id) => store.project.layers.some((l) => l.id === id))])]);
  const builtin = new Set(BUILTIN_SHAPE_STYLES.map((s) => s.id));
</script>

<div class="styles">
  <div class="row"><span class="label grow">Style</span><button class="ghost small" onclick={() => saveShapeStyle(shape)} title="Keep this look as a style of your own, for every project">Save style</button></div>
  <div class="chips" role="group" aria-label="Shape styles">
    {#each allShapeStyles() as s (s.id)}
      <span class="chipwrap">
        <button class="chip" class:on={hasShapeStyle(shape, s)} aria-pressed={hasShapeStyle(shape, s)} title={`${s.name}: put this look on ${ids.length > 1 ? 'the selected shapes' : 'the shape'}`} onclick={() => styleShapes(ids, s)}>
          <i style="background:{s.color ?? '#fff'};box-shadow:{s.glow ? `0 0 6px ${s.color}` : 'none'}"></i>{s.name}
        </button>
        {#if !builtin.has(s.id)}<button class="del ghost" aria-label={`Delete the style ${s.name}`} title={`Delete the style “${s.name}”`} onclick={() => deleteShapeStyle(s.id)}>×</button>{/if}
      </span>
    {/each}
  </div>
  {#if shapeStyles.saved.length === 0}<span class="small faint">Pick one to restyle the shape; new shapes take the look.</span>{/if}
</div>

<style>
  .styles {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chipwrap {
    display: inline-flex;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font-size: 11px;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: var(--surface-2);
  }
  .chip.on {
    border-color: var(--accent);
  }
  .chip i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.4);
  }
  .del {
    padding: 0 4px;
  }
</style>
