<script lang="ts">
  // A picture on a track above, collage style: a card round it (a border or a polaroid's paper, round
  // corners, a shadow, a caption), a shape it shows through that can grow, spin or pulse, and a pop-in.
  import { store } from '../lib/store.svelte';
  import { setPop, startOnBeat } from '../lib/graphicsops.svelte';
  import type { ClipCard, ClipMask, MaskShape } from '../engine/cardmask';
  import type { PopMode } from '../engine/keys';
  import type { Clip } from '../engine/types';
  import Field from './Field.svelte';
  import BeatChips from './BeatChips.svelte';

  let { clip }: { clip: Clip } = $props();
  const card = $derived(clip.card);
  const mask = $derived(clip.mask);
  const pop = $derived(clip.pop);

  const CARDS: { id: string; name: string; card: ClipCard }[] = [
    { id: 'plain', name: 'Round card', card: { border: 0, borderColor: '#ffffff', radius: 0.08, shadow: 0.5 } },
    { id: 'border', name: 'White border', card: { border: 0.012, borderColor: '#ffffff', radius: 0.02, shadow: 0.5 } },
    { id: 'polaroid', name: 'Polaroid', card: { border: 0.025, borderColor: '#fbfaf5', radius: 0, shadow: 0.6, caption: '' } },
  ];
  function edit(fn: (c: Clip) => void, key: string) {
    const id = clip.id;
    store.edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) fn(c);
    }, key + id);
  }
  const setCard = (patch: Partial<ClipCard> | null) => edit((c) => (patch ? (c.card = { border: 0.012, borderColor: '#ffffff', radius: 0.04, shadow: 0.5, ...(c.card ?? {}), ...patch }) : delete c.card), 'card' + JSON.stringify(Object.keys(patch ?? {})));
  const setMask = (patch: Partial<ClipMask> | null) => edit((c) => (patch ? (c.mask = { shape: 'circle', size: 0.9, x: 0.5, y: 0.5, ...(c.mask ?? {}), ...patch }) : delete c.mask), 'mask' + JSON.stringify(Object.keys(patch ?? {})));
  const setCardNum = (k: 'border' | 'radius' | 'shadow') => (v: number) => setCard({ [k]: v });
  const setMaskNum = (k: 'size' | 'x' | 'y' | 'rotate' | 'spin' | 'grow' | 'pulse') => (v: number) => setMask({ [k]: v === 0 && ['spin', 'grow', 'pulse'].includes(k) ? undefined : v });
  const popBy = (patch: Partial<NonNullable<Clip['pop']>>) => setPop(clip.id, { mode: 'pop', dur: 0.3, ease: true, ...(pop ?? {}), ...patch });
</script>

<div class="label">Card</div>
<div class="chips" role="group" aria-label="Card styles">
  <button class="chip" class:on={!card} aria-pressed={!card} onclick={() => setCard(null)}>None</button>
  {#each CARDS as c (c.id)}
    <button class="chip" aria-pressed={!!card && JSON.stringify([card.border, card.radius, card.caption !== undefined]) === JSON.stringify([c.card.border, c.card.radius, c.card.caption !== undefined])} class:on={!!card && JSON.stringify([card.border, card.radius, card.caption !== undefined]) === JSON.stringify([c.card.border, c.card.radius, c.card.caption !== undefined])} onclick={() => edit((x) => (x.card = { ...c.card }), 'cardpreset')}>{c.name}</button>
  {/each}
</div>
{#if card}
  <Field label="Border" min={0} max={0.08} step={0.001} value={card.border} help="The paper's width all round, as a share of the frame height (0: none)." onchange={setCardNum('border')} />
  <label class="row small">Paper colour <input type="color" value={card.borderColor} oninput={(e) => setCard({ borderColor: (e.target as HTMLInputElement).value })} aria-label="Paper colour" /></label>
  <Field label="Round corners" min={0} max={0.5} step={0.005} value={card.radius} help="How round the corners are, as a share of the picture's shorter side." onchange={setCardNum('radius')} />
  <Field label="Shadow" min={0} max={1} step={0.01} value={card.shadow} help="A soft shadow under the card." onchange={setCardNum('shadow')} />
  <label class="row small grow">Caption
    <input type="text" value={card.caption ?? ''} placeholder="(none)" aria-label="Caption" oninput={(e) => setCard({ caption: (e.target as HTMLInputElement).value === '' && card.caption === undefined ? undefined : (e.target as HTMLInputElement).value })} />
  </label>
  <p class="small faint">A caption makes room for a strip of paper under the picture, like a polaroid. (Cards work on tracks above the main one.)</p>
{/if}

<div class="label">Mask</div>
<div class="chips" role="group" aria-label="Mask shapes">
  <button class="chip" class:on={!mask} aria-pressed={!mask} onclick={() => setMask(null)}>None</button>
  {#each [['circle', 'Circle'], ['rect', 'Box'], ['triangle', 'Triangle'], ['star', 'Star'], ['text', 'Text']] as [id, name] (id)}
    <button class="chip" class:on={mask?.shape === id} aria-pressed={mask?.shape === id} onclick={() => setMask({ shape: id as MaskShape })}>{name}</button>
  {/each}
</div>
{#if mask}
  {#if mask.shape === 'text'}
    <label class="row small grow">Words <input type="text" value={mask.text ?? 'MOSH'} aria-label="Mask words" oninput={(e) => setMask({ text: (e.target as HTMLInputElement).value })} /></label>
  {/if}
  <Field label="Size" min={0.05} max={2} step={0.01} value={mask.size} help="As a share of the picture's shorter side." onchange={setMaskNum('size')} />
  <Field label="Across" min={0} max={1} step={0.01} value={mask.x} help="Where its middle is: 0 the left edge, 1 the right." onchange={setMaskNum('x')} />
  <Field label="Down" min={0} max={1} step={0.01} value={mask.y} help="Where its middle is: 0 the top, 1 the bottom." onchange={setMaskNum('y')} />
  <Field label="Turn" unit="°" min={-180} max={180} step={1} value={mask.rotate ?? 0} help="Turns the shape." onchange={setMaskNum('rotate')} />
  <Field label="Grows in" unit="s" min={0} max={4} step={0.05} value={mask.grow ?? 0} help="Grows from nothing over this long (0: already full size)." onchange={setMaskNum('grow')}>
    <BeatChips onpick={(v) => setMask({ grow: v })} />
  </Field>
  <Field label="Spins" unit="°/s" min={-720} max={720} step={5} value={mask.spin ?? 0} help="Turns at this speed." onchange={setMaskNum('spin')} />
  <Field label="Breathes" min={0} max={1} step={0.01} value={mask.pulse ?? 0} help="In and out by this share of its size, twice a second." onchange={setMaskNum('pulse')} />
{/if}

<div class="label">Pop in</div>
<div class="chips" role="group" aria-label="Pop in">
  <button class="chip" class:on={!pop} aria-pressed={!pop} onclick={() => setPop(clip.id, null)}>None</button>
  {#each [['snap', 'Snap'], ['pop', 'Pop'], ['slide', 'Slide']] as [id, name] (id)}
    <button class="chip" class:on={pop?.mode === id} aria-pressed={pop?.mode === id} onclick={() => popBy({ mode: id as PopMode })}>{name}</button>
  {/each}
</div>
{#if pop && pop.mode !== 'snap'}
  <Field label="Takes" unit="s" min={0.04} max={2} step={0.01} value={pop.dur} help="How long it takes to settle." onchange={(v: number) => popBy({ dur: v })}>
    <BeatChips counts={[0.25, 0.5, 1]} onpick={(v) => popBy({ dur: v })} />
  </Field>
  <Field type="bool" label="Smooth" value={pop.ease} help="Eased in and out. Off: straight lines, hard and mechanical." onchange={(v: boolean) => popBy({ ease: v })} />
  {#if pop.mode === 'slide'}
    <Field type="select" label="From" value={pop.from ?? 'left'} options={[{ value: 'left', label: 'The left' }, { value: 'right', label: 'The right' }, { value: 'top', label: 'The top' }, { value: 'bottom', label: 'The bottom' }]} help="Which side it comes in from." onchange={(v: string) => popBy({ from: v as 'left' | 'right' | 'top' | 'bottom' })} />
  {/if}
{/if}
<button class="small" onclick={() => startOnBeat(clip.id)} title="Move the clip so it starts on the nearest beat of the music">Start on the beat</button>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 3px 10px;
    font-size: 11px;
    border: 1px solid var(--line-2);
    border-radius: 12px;
    background: var(--surface-2);
  }
  .chip.on {
    border-color: var(--accent);
  }
  input[type='text'] {
    width: 100%;
  }
</style>
