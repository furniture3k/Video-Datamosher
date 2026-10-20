<script lang="ts">
  // A subject effect's settings: what it does to the subject cut out of the footage.
  import { store } from '../lib/store.svelte';
  import { deleteSelected } from '../lib/edit';
  import { SUBJECT_EFFECTS } from '../lib/cutout.svelte';
  import type { ShapeLayer, SubjectFx } from '../engine/layers';
  import Field from './Field.svelte';
  import BeatChips from './BeatChips.svelte';
  import Icon from './Icon.svelte';

  let { shape }: { shape: ShapeLayer } = $props();
  const fx = $derived(shape.subject!);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

  function setFx(change: Partial<SubjectFx>) {
    const id = shape.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind === 'shape' && l.subject) Object.assign(l.subject, change);
      },
      'subject' + id + Object.keys(change).join(),
    );
  }
  function set<K extends 'start' | 'duration' | 'color' | 'fade' | 'moshed'>(k: K, v: ShapeLayer[K]) {
    const id = shape.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind === 'shape') l[k] = v;
      },
      'subjectl' + k + id,
    );
  }
  const colourFx = $derived(['fill', 'outline', 'glow', 'echo'].includes(fx.effect));
  const changesPicture = $derived(fx.effect === 'blur' || fx.effect === 'grade');
</script>

<div class="col">
  <div class="row"><b class="grow">Subject effect</b><span class="small faint mono">{fmt(shape.start)}</span></div>
  <div class="kinds">
    {#each SUBJECT_EFFECTS as s (s.value)}
      <button class="small" class:on={fx.effect === s.value} title={s.hint} onclick={() => setFx({ effect: s.value, ...s.fx })}>{s.label}</button>
    {/each}
  </div>
  <Field label="Start" unit="s" min={0} max={Math.max(1, store.duration)} step={0.05} value={shape.start} help="When it starts." onchange={(v: number) => set('start', v)} />
  <Field label="Duration" unit="s" min={0.05} max={120} step={0.05} value={shape.duration} help="How long it lasts." onchange={(v: number) => set('duration', Math.max(0.05, v))}>
    <BeatChips counts={[1, 2, 4]} onpick={(v) => set('duration', v)} />
  </Field>
  {#if colourFx}
    <label class="row small">Colour <input type="color" value={shape.color} oninput={(e) => set('color', (e.target as HTMLInputElement).value)} aria-label="Effect colour" /></label>
  {/if}
  <Field label={fx.effect === 'outline' ? 'Thickness' : fx.effect === 'glow' || fx.effect === 'blur' ? 'Size' : 'Amount'} min={0.02} max={1} step={0.01} value={fx.amount} help="How thick the outline is, how wide the glow or blur spreads." onchange={(v: number) => setFx({ amount: v })} />
  {#if fx.effect === 'echo'}
    <Field label="Copies" min={1} max={12} step={1} value={fx.copies ?? 3} help="How many copies trail behind." onchange={(v: number) => setFx({ copies: Math.round(v) })} />
    <Field label="Step across" min={-0.3} max={0.3} step={0.005} value={fx.dx ?? 0.04} help="How far each copy steps right (+) or left (−), as a share of the frame width." onchange={(v: number) => setFx({ dx: v })} />
    <Field label="Step down" min={-0.3} max={0.3} step={0.005} value={fx.dy ?? 0} help="How far each copy steps down (+) or up (−), as a share of the frame height." onchange={(v: number) => setFx({ dy: v })} />
  {/if}
  {#if changesPicture}
    <Field type="select" label="Applies to" value={fx.part ?? 'background'} options={[{ value: 'background', label: 'Everything but the subject' }, { value: 'subject', label: 'Only the subject' }]} help="Which part of the picture is changed." onchange={(v: string) => setFx({ part: v as 'subject' | 'background' })} />
  {/if}
  {#if fx.effect === 'grade'}
    <Field label="Brightness" min={0} max={2} step={0.01} value={fx.brightness ?? 1} help="1 leaves it as it is." onchange={(v: number) => setFx({ brightness: v })} />
    <Field label="Colour" min={0} max={2} step={0.01} value={fx.saturation ?? 1} help="0 is black and white; 1 leaves it as it is." onchange={(v: number) => setFx({ saturation: v })} />
    <Field label="Contrast" min={0} max={2} step={0.01} value={fx.contrast ?? 1} help="1 leaves it as it is." onchange={(v: number) => setFx({ contrast: v })} />
  {/if}
  <Field label="Fade" unit="s" min={0} max={3} step={0.05} value={shape.fade} help="Fade in and out." onchange={(v: number) => set('fade', v)} />
  {#if !changesPicture}
    <Field type="bool" label="Melt with the video" value={shape.moshed} help="Burn it into the footage before moshing, so it smears and melts with everything else. Off = clean on top." onchange={(v: boolean) => set('moshed', v)} />
  {:else}
    <p class="small faint">This one changes the picture under it, so it goes on top of the mosh (it can't melt).</p>
  {/if}
  <button class="ghost" onclick={() => deleteSelected()}><Icon name="trash" />Delete effect</button>
</div>

<style>
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 4px;
  }
</style>
