<script lang="ts">
  // The canvas: set the picture in like a card on a colour, a gradient or a blurred copy of
  // itself, with round corners, a border and a shadow. Titles and shapes still use the whole frame.
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import { CANVAS_PRESETS, DEFAULT_CANVAS, hasCanvas, type Canvas } from '../engine/canvas';
  import { GRID_LAYOUTS } from '../engine/grid';
  import { arrangeGrid } from '../lib/edit';

  const c = $derived(store.project.canvas);
  const on = $derived(hasCanvas(c));
  const images = $derived(store.project.media.filter((m) => m.source.kind === 'file' && m.source.isImage));

  function set<K extends keyof Canvas>(k: K, v: Canvas[K] | undefined) {
    store.edit(
      (p) => {
        const cv = (p.canvas ??= { ...DEFAULT_CANVAS });
        if (v === undefined) delete cv[k];
        else cv[k] = v;
      },
      'canvas' + String(k),
    );
  }
  let gap = $state(0);
  const use = (cv: Canvas | undefined) => store.edit((p) => (cv ? (p.canvas = { ...cv }) : delete p.canvas));
</script>

<div class="label sect">Canvas</div>
<div class="presets" role="group" aria-label="Canvas">
  <button class="chip" class:on={!on} onclick={() => use(undefined)}>Full frame</button>
  {#each CANVAS_PRESETS as pr (pr.id)}
    <button class="chip" class:on={on && JSON.stringify(c) === JSON.stringify(pr.canvas)} onclick={() => use(pr.canvas)} title="Set the picture in on a backdrop">{pr.name}</button>
  {/each}
</div>
{#if on && c}
  <Field
    type="select"
    label="Backdrop"
    value={c.bg}
    options={[
      { value: 'color', label: 'Colour' },
      { value: 'gradient', label: 'Gradient' },
      { value: 'blur', label: 'Blurred picture' },
      { value: 'image', label: 'An image' },
    ]}
    help="What's behind the picture."
    onchange={(v: Canvas['bg']) => set('bg', v)}
  />
  {#if c.bg === 'image'}
    {#if images.length}
      <Field type="select" label="Image" value={c.image ?? ''} options={[{ value: '', label: 'Pick one…' }, ...images.map((m) => ({ value: m.id, label: m.source.name }))]} help="An image from your media, filling the frame behind the picture." onchange={(v: string) => set('image', v || undefined)} />
    {:else}
      <p class="small faint">Import an image (Media) to use it as the backdrop.</p>
    {/if}
  {/if}
  {#if c.bg !== 'blur'}
    <div class="row small">
      <label class="row grow">Colour <input type="color" value={c.color} oninput={(e) => set('color', (e.target as HTMLInputElement).value)} aria-label="Backdrop colour" /></label>
      {#if c.bg === 'gradient'}<label class="row">to <input type="color" value={c.color2 ?? c.color} oninput={(e) => set('color2', (e.target as HTMLInputElement).value)} aria-label="Second colour" /></label>{/if}
    </div>
    {#if c.bg === 'gradient'}
      <Field label="Angle" unit="°" min={-180} max={180} step={1} value={c.angle ?? 0} help="Which way the gradient runs (0: top to bottom)." onchange={(v: number) => set('angle', v)} />
    {/if}
  {:else}
    <Field label="Blur" min={0.05} max={1} step={0.01} value={c.blur ?? 0.5} help="How soft the copy of the picture behind is." onchange={(v: number) => set('blur', v)} />
  {/if}
  <Field label="Space round it" min={0.01} max={0.4} step={0.005} value={c.inset} help="How far the picture is set in from the edges, as a share of the frame's shorter side." onchange={(v: number) => set('inset', v)} />
  <Field label="Up / down" min={-0.3} max={0.3} step={0.005} value={c.shift ?? 0} help="Moves the picture up (−) or down (+), to leave room for a caption." onchange={(v: number) => set('shift', v || undefined)} />
  <Field label="Round corners" min={0} max={0.5} step={0.005} value={c.radius ?? 0} help="0: square corners; 0.5: as round as it gets." onchange={(v: number) => set('radius', v || undefined)} />
  <Field label="Border" min={0} max={0.08} step={0.001} value={c.border ?? 0} help="A frame round the picture, as a share of the frame height." onchange={(v: number) => set('border', v || undefined)} />
  {#if c.border}
    <label class="row small">Border colour <input type="color" value={c.borderColor ?? '#ffffff'} oninput={(e) => set('borderColor', (e.target as HTMLInputElement).value)} aria-label="Border colour" /></label>
  {/if}
  <Field
    type="select"
    label="Device"
    value={c.device ?? 'none'}
    options={[
      { value: 'none', label: 'None' },
      { value: 'phone', label: 'Phone' },
      { value: 'browser', label: 'Browser window' },
      { value: 'window', label: 'App window' },
      { value: 'laptop', label: 'Laptop' },
    ]}
    help="Draws a generic device round the picture, so it looks like it's playing on a screen."
    onchange={(v: string) => set('device', v === 'none' ? undefined : (v as Canvas['device']))}
  />
  <Field label="Shadow" min={0} max={1} step={0.01} value={c.shadow ?? 0} help="A soft shadow under the picture." onchange={(v: number) => set('shadow', v || undefined)} />
{/if}

<div class="label sect">Split screen</div>
<p class="small faint">Puts the clips under the playhead (on tracks above each other), or the selected ones, side by side or in a grid.</p>
<div class="grids" role="group" aria-label="Split screen">
  {#each GRID_LAYOUTS as g (g.id)}
    <button class="grid" title={g.name} aria-label={g.name} onclick={() => arrangeGrid(g.id, gap)}>
      <svg viewBox="0 0 18 32" width="18" height="32" aria-hidden="true">
        {#each g.cells as [x, y, w, h], i (i)}<rect x={x * 18 + 1} y={y * 32 + 1} width={w * 18 - 2} height={h * 32 - 2} rx="1" />{/each}
      </svg>
    </button>
  {/each}
</div>
<Field label="Gap" min={0} max={0.06} step={0.002} value={gap} help="Space between the cells, as a share of the frame's shorter side (set it before picking a layout)." onchange={(v: number) => (gap = v)} />

<style>
  .grids {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .grid {
    height: auto;
    padding: 4px 6px;
  }
  .grid rect {
    fill: var(--surface-3, #444);
    stroke: currentColor;
    stroke-width: 1;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 4px;
  }
  .chip.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
