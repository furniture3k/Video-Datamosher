<script lang="ts">
  // The rest of a title's look: letters, outline, how it goes out, strobe and boil, and copies
  // filling the frame. (Words, place, font, colour and the entrance are in the Clip tab above.)
  import { store } from '../lib/store.svelte';
  import { TEXT_ANIMS } from '../lib/text';
  import Field from './Field.svelte';
  import BeatChips from './BeatChips.svelte';
  import type { TextAnim, TextLayer } from '../engine/layers';

  let { title }: { title: TextLayer } = $props();

  /** set (or, with undefined, clear) one setting; slider drags are one undo step */
  function set<K extends keyof TextLayer>(k: K, v: TextLayer[K] | undefined) {
    const id = title.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind !== 'text') return;
        if (v === undefined || v === false || v === 0 || v === 'none') delete l[k];
        else l[k] = v;
      },
      'title' + String(k) + id,
    );
  }
</script>

<div class="label">Letters</div>
<Field label="Letter spacing" min={-0.1} max={1} step={0.01} value={title.spacing ?? 0} help="Space between letters, as a share of the letter size." onchange={(v: number) => set('spacing', v)} />
<Field label="Line spacing" unit="×" min={0.6} max={3} step={0.05} value={title.lineHeight ?? 1.2} help="Space between lines, as a multiple of the letter size." onchange={(v: number) => set('lineHeight', v === 1.2 ? undefined : v)} />
<Field type="bool" label="Fit to the frame width" value={title.fit === 'width'} help="As big as fits across the frame, whatever the words (Size is then ignored)." onchange={(v: boolean) => set('fit', v ? 'width' : undefined)} />

<div class="label">Outline</div>
<Field label="Outline" min={0} max={0.3} step={0.005} value={title.stroke ?? 0} help="An outline around the letters, as a share of the letter size." onchange={(v: number) => set('stroke', v)} />
{#if (title.stroke ?? 0) > 0 || title.strokeOnly}
  <div class="row">
    <label class="row small grow">Outline colour <input type="color" value={title.strokeColor ?? '#000000'} oninput={(e) => set('strokeColor', (e.target as HTMLInputElement).value)} /></label>
    <Field type="bool" label="Only the outline" value={!!title.strokeOnly} help="Hollow letters: just the outline, in the outline colour." onchange={(v: boolean) => set('strokeOnly', v)} />
  </div>
{/if}

<div class="label">Moving</div>
<Field type="select" label="Goes out" value={title.exit ?? 'none'} options={TEXT_ANIMS} help="How the title leaves: an entrance played backwards." onchange={(v: TextAnim) => set('exit', v)} />
{#if title.exit && title.exit !== 'none'}
  <Field label="Takes" unit="s" min={0.05} max={4} step={0.05} value={title.animOut ?? 0.4} help="How long it takes to go." onchange={(v: number) => set('animOut', v)}>
    <BeatChips onpick={(s) => set('animOut', s)} />
  </Field>
{/if}
<Field label="Strobe" unit="/s" min={0} max={16} step={0.5} value={title.strobe ?? 0} help="Blinks on and off this many times a second (0: steady)." onchange={(v: number) => set('strobe', v)}>
  <BeatChips counts={[1, 2, 4]} onpick={(s) => set('strobe', Math.round((1 / s) * 100) / 100)} />
</Field>
<Field label="Boil" min={0} max={1} step={0.05} value={title.boil ?? 0} help="A hand-drawn wobble: the title shifts a little between a few positions, eight times a second." onchange={(v: number) => set('boil', v)} />

<div class="label">Copies</div>
<Field
  type="select"
  label="Repeat"
  value={title.repeat ?? 'none'}
  options={[
    { value: 'none', label: 'Just one' },
    { value: 'across', label: 'Side by side' },
    { value: 'down', label: 'One above another' },
    { value: 'both', label: 'Fill the frame' },
  ]}
  help="Copies of the title filling the frame, like a pattern."
  onchange={(v: string) => set('repeat', v === 'none' ? undefined : (v as TextLayer['repeat']))}
/>
{#if title.repeat}
  <Field label="Gap" min={0} max={3} step={0.05} value={title.repeatGap ?? 0.5} help="Space between copies, as a share of the letter size." onchange={(v: number) => set('repeatGap', v)} />
  {#if title.repeat !== 'both'}
    <Field label="Scroll" min={-2} max={2} step={0.05} value={title.scroll ?? 0} help="Copies run along like a ticker: frame widths a second (negative: the other way)." onchange={(v: number) => set('scroll', v)} />
  {/if}
{/if}

<style>
  .label {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-2);
  }
</style>
