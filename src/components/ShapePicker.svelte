<script lang="ts">
  // Pick a shape to add at the playhead, draw one with the pen, or mark something that moves (a
  // box, arrow and label that follow it). Each button shows the shape as it will be drawn.
  import { store } from '../lib/store.svelte';
  import { addShape } from '../lib/edit';
  import { startMark } from '../lib/motion.svelte';
  import { SHAPES, newShape, shapeStrokes } from '../engine/shapes';
  import type { ShapeKind } from '../engine/layers';
  import Icon from './Icon.svelte';

  let { onpick }: { onpick?: () => void } = $props();

  /** an outline of the shape in a 24×24 box */
  function preview(kind: ShapeKind): string {
    const s = newShape(kind, '', '', 0, 1);
    const k = Math.max(s.w, s.h);
    const strokes = shapeStrokes({ ...s, w: (s.w / k) * 18, h: (s.h / k) * 18 }, 1, 1);
    return strokes.map((st) => 'M' + st.pts.map(([x, y]) => `${(x + 12).toFixed(1)} ${(y + 12).toFixed(1)}`).join('L') + (st.closed ? 'Z' : '')).join(' ');
  }
  const kinds = SHAPES.filter((s) => s.value !== 'pen');
  const done = () => onpick?.();
</script>

<div class="picker" role="group" aria-label="Add a shape">
  {#each kinds as s (s.value)}
    <button class="kind" title={s.hint} aria-label={`Add ${s.label.toLowerCase()}`} onclick={() => (addShape(s.value), done())}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d={preview(s.value)} class:hl={s.value === 'highlight'} /></svg>
      <span>{s.label}</span>
    </button>
  {/each}
  <button class="kind" class:on={store.ui.pen} title="Draw a line by hand on the player" aria-label="Draw with the pen" onclick={() => ((store.ui.pen = !store.ui.pen), done())}>
    <Icon name="pen" size={20} /><span>Pen</span>
  </button>
  <button class="kind wide" class:on={store.ui.trackThen === 'mark'} title="Box something that moves: it's tracked, then boxed, arrowed and labelled, and they all follow it" aria-label="Mark something moving" onclick={() => (startMark(), done())}>
    <Icon name="target" size={20} /><span>Mark something moving</span>
  </button>
</div>

<style>
  .picker {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 4px;
  }
  .kind {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    height: auto;
    padding: 6px 4px;
    font-size: 11px;
  }
  .kind.wide {
    grid-column: span 2;
    white-space: normal;
  }
  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  path.hl {
    stroke-width: 6;
    opacity: 0.5;
    stroke-linecap: butt;
  }
</style>
