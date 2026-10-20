<script lang="ts">
  // A shape's settings: its kind, line, fill, glow, how it draws on and the hand-drawn wobble.
  // Changes to the look are remembered for the next shape.
  import { store } from '../lib/store.svelte';
  import { deleteSelected, rememberShapeLook } from '../lib/edit';
  import { SHAPES } from '../engine/shapes';
  import type { ShapeLayer } from '../engine/layers';
  import Field from './Field.svelte';
  import BeatChips from './BeatChips.svelte';
  import Icon from './Icon.svelte';
  import TrailSettings from './TrailSettings.svelte';
  import SurfaceSettings from './SurfaceSettings.svelte';
  import TiltSettings from './TiltSettings.svelte';
  import DepthSettings from './DepthSettings.svelte';
  import ParticleSettings from './ParticleSettings.svelte';

  let { shape }: { shape: ShapeLayer } = $props();

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  const LOOK = new Set(['color', 'width', 'fill', 'glow', 'drawOn', 'boil']);

  /** set (or, with undefined, clear) one setting; slider drags are one undo step */
  function set<K extends keyof ShapeLayer>(k: K, v: ShapeLayer[K] | undefined) {
    const id = shape.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind !== 'shape') return;
        if (v === undefined || v === 0) delete l[k];
        else l[k] = v;
        if (LOOK.has(k as string)) rememberShapeLook(l);
      },
      'shape' + String(k) + id,
    );
  }
  const closed = $derived(!['line', 'arrow', 'underline', 'highlight', 'pen', 'bracket'].includes(shape.shape));
</script>

<div class="col">
  <div class="row"><b class="grow">Shape</b><span class="small faint mono">{fmt(shape.start)}</span></div>
  <div class="kinds">
    {#each SHAPES.filter((s) => s.value !== 'pen' || shape.shape === 'pen') as s (s.value)}
      <button class="small" class:on={shape.shape === s.value} title={s.hint} onclick={() => set('shape', s.value)}>{s.label}</button>
    {/each}
  </div>
  <Field label="Start" unit="s" min={0} max={Math.max(1, store.duration)} step={0.05} value={shape.start} help="When it appears." onchange={(v: number) => set('start', v)} />
  <Field label="Duration" unit="s" min={0.05} max={60} step={0.05} value={shape.duration} help="How long it stays." onchange={(v: number) => set('duration', Math.max(0.05, v))}>
    <BeatChips counts={[0.25, 0.5, 1, 2, 4]} onpick={(v) => set('duration', v)} />
  </Field>
  <div class="row">
    <label class="row small grow">Colour <input type="color" value={shape.color} oninput={(e) => set('color', (e.target as HTMLInputElement).value)} aria-label="Line colour" /></label>
    {#if closed}
      <label class="row small">Fill <input type="checkbox" checked={!!shape.fill} onchange={(e) => set('fill', (e.target as HTMLInputElement).checked ? shape.color : undefined)} aria-label="Filled" /></label>
      {#if shape.fill}<input type="color" value={shape.fill} oninput={(e) => set('fill', (e.target as HTMLInputElement).value)} aria-label="Fill colour" />{/if}
    {/if}
  </div>
  {#if shape.shape !== 'highlight'}
    <Field label="Line width" min={0.001} max={0.06} step={0.001} value={shape.width} help="How thick the line is, as a share of the frame height." onchange={(v: number) => set('width', Math.max(0.001, v))} />
  {/if}
  <Field label="Width" min={0.01} max={2} step={0.005} value={shape.w} help="As a share of the frame width. You can also drag a corner on the player." onchange={(v: number) => set('w', Math.max(0.01, v))} />
  <Field label="Height" min={0.005} max={2} step={0.005} value={shape.h} help="As a share of the frame height." onchange={(v: number) => set('h', Math.max(0.005, v))} />
  <Field label="Horizontal" min={0} max={1} step={0.01} value={shape.x} help="0 = left edge, 1 = right edge." onchange={(v: number) => set('x', v)} />
  <Field label="Vertical" min={0} max={1} step={0.01} value={shape.y} help="0 = top, 1 = bottom." onchange={(v: number) => set('y', v)} />
  <Field label="Rotation" unit="°" min={-180} max={180} step={0.5} value={shape.rotate ?? 0} help="Turns it about its middle. You can also drag the round handle on the player." onchange={(v: number) => set('rotate', v)} />
  {#if shape.shape === 'line' || shape.shape === 'arrow'}
    <Field label="Bend" min={-1} max={1} step={0.01} value={shape.bend ?? 0} help="Bows the line out into a curve, one way or the other." onchange={(v: number) => set('bend', v)} />
  {/if}
  {#if shape.shape === 'arrow'}
    <Field label="Head" min={0.05} max={0.6} step={0.01} value={shape.head ?? 0.22} help="Size of the arrowhead, as a share of the arrow's length." onchange={(v: number) => set('head', v)} />
  {/if}
  {#if shape.shape === 'tunnel'}
    <Field label="Boxes" min={2} max={20} step={1} value={shape.count ?? 6} help="How many boxes, one inside another." onchange={(v: number) => set('count', Math.round(v))} />
  {/if}
  <div class="label">Look</div>
  <Field label="Draws on" unit="s" min={0} max={4} step={0.05} value={shape.drawOn ?? 0} help="Draws itself on, like a pen, over this long (0: appears at once)." onchange={(v: number) => set('drawOn', v)}>
    <BeatChips onpick={(v) => set('drawOn', v)} />
  </Field>
  <Field label="Glow" min={0} max={1} step={0.01} value={shape.glow ?? 0} help="A soft light around the line, in its colour." onchange={(v: number) => set('glow', v)} />
  <Field label="Hand-drawn" min={0} max={1} step={0.01} value={shape.boil ?? 0} help="Wobbles like it was drawn again on every few frames." onchange={(v: number) => set('boil', v)} />
  <TrailSettings layer={shape} />
  <DepthSettings layer={shape} />
  <TiltSettings layer={shape} />
  <SurfaceSettings layer={shape} />
  <ParticleSettings layer={shape} />
  <Field label="Fade" unit="s" min={0} max={3} step={0.05} value={shape.fade} help="Fade in and out." onchange={(v: number) => set('fade', v)} />
  {#if shape.follow?.length}
    <div class="row small faint">Follows a tracked object. <button class="small ghost" onclick={() => set('follow', undefined)}>Stop following</button></div>
  {/if}
  <Field type="bool" label="Melt with the video" value={shape.moshed} help="Burn it into the footage before moshing, so it smears and melts with everything else. Off = clean on top." onchange={(v: boolean) => store.edit(() => (shape.moshed = v))} />
  <button class="ghost" onclick={() => deleteSelected()}><Icon name="trash" />Delete shape</button>
</div>

<style>
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 4px;
  }
</style>
