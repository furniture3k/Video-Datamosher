<script lang="ts">
  // The canvas: set the picture in like a card on a colour, a gradient or a blurred copy of
  // itself, with round corners, a border and a shadow. Titles and shapes still use the whole frame.
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import { CANVAS_PRESETS, DEFAULT_CANVAS, hasCanvas, type Canvas } from '../engine/canvas';

  const c = $derived(store.project.canvas);
  const on = $derived(hasCanvas(c));

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
    ]}
    help="What's behind the picture."
    onchange={(v: Canvas['bg']) => set('bg', v)}
  />
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
  <Field label="Shadow" min={0} max={1} step={0.01} value={c.shadow ?? 0} help="A soft shadow under the picture." onchange={(v: number) => set('shadow', v || undefined)} />
{/if}

<style>
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
