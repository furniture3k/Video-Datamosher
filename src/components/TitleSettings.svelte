<script lang="ts">
  // The rest of a title's look: letters, outline, how it goes out, strobe and boil, and copies
  // filling the frame. (Words, place, font, colour and the entrance are in the Clip tab above.)
  import { store } from '../lib/store.svelte';
  import { TEXT_ANIMS } from '../lib/text';
  import Field from './Field.svelte';
  import BeatChips from './BeatChips.svelte';
  import TrailSettings from './TrailSettings.svelte';
  import PinSettings from './PinSettings.svelte';
  import TiltSettings from './TiltSettings.svelte';
  import DepthSettings from './DepthSettings.svelte';
  import EffectsSettings from './EffectsSettings.svelte';
  import { setColourRun, wordSpans } from '../engine/textlayout';
  import ParticleSettings from './ParticleSettings.svelte';
  import type { LineStyle, TextAnim, TextLayer } from '../engine/layers';

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

  const lines = $derived(title.text.split('\n'));
  const words = $derived(wordSpans(title.text));
  let pickWord = $state(0);
  const wordColour = (i: number) => title.colourRuns?.find((r) => words[i] && r.from <= words[i].from && r.to >= words[i].to)?.color;

  /** change one line's own look (an empty look is taken away) */
  function setLine(i: number, patch: Partial<LineStyle>) {
    const id = title.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind !== 'text') return;
        const arr: LineStyle[] = [...(l.lines ?? [])];
        while (arr.length <= i) arr.push({});
        const next: Record<string, unknown> = { ...arr[i], ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined || (k === 'size' && next[k] === 1)) delete next[k];
        arr[i] = next as LineStyle;
        while (arr.length && !Object.keys(arr[arr.length - 1]).length) arr.pop();
        if (arr.length) l.lines = arr;
        else delete l.lines;
      },
      'line' + i + id,
    );
  }
  /** colour the picked word (null: back to the title's colour) */
  function colourWord(color: string | null) {
    const w = words[pickWord];
    const id = title.id;
    if (!w) return;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind !== 'text') return;
        const runs = setColourRun(l.colourRuns, w.from, w.to, color);
        if (runs.length) l.colourRuns = runs;
        else delete l.colourRuns;
      },
      'wordcolour' + pickWord + id,
    );
  }
</script>

<div class="label">Colour</div>
<Field type="bool" label="Gradient" value={!!title.gradient} help="The letters shade from the title's colour into a second one." onchange={(v: boolean) => set('gradient', v ? { to: '#ff2a6d', angle: 90 } : undefined)} />
{#if title.gradient}
  <label class="row small">Ends in <input type="color" value={title.gradient.to} oninput={(e) => set('gradient', { ...title.gradient!, to: (e.target as HTMLInputElement).value })} aria-label="Gradient end colour" /></label>
  <Field label="Gradient angle" unit="°" min={0} max={360} step={1} value={title.gradient.angle} help="0 shades from left to right, 90 from the top down." onchange={(v: number) => set('gradient', { ...title.gradient!, angle: v })} />
{/if}
{#if words.length > 1}
  <div class="chips" role="group" aria-label="Words to colour">
    {#each words as w, i (i)}
      <button class="chip small" class:on={pickWord === i} style="color:{wordColour(i) ?? 'inherit'}" aria-pressed={pickWord === i} onclick={() => (pickWord = i)}>{w.word}</button>
    {/each}
  </div>
  <div class="row">
    <label class="row small grow">Colour of “{words[Math.min(pickWord, words.length - 1)]?.word}” <input type="color" value={wordColour(Math.min(pickWord, words.length - 1)) ?? title.color} oninput={(e) => colourWord((e.target as HTMLInputElement).value)} aria-label="Colour of the word" /></label>
    <button class="small ghost" onclick={() => colourWord(null)}>Clear</button>
  </div>
{/if}
{#if lines.length > 1}
  <div class="label">Lines</div>
  {#each lines as ln, i (i)}
    <div class="lnrow">
      <span class="small grow ln">{i + 1}. {ln || '(empty)'}</span>
      <input type="color" value={title.lines?.[i]?.color ?? title.color} oninput={(e) => setLine(i, { color: (e.target as HTMLInputElement).value })} aria-label="Line {i + 1} colour" />
      <select class="small" value={title.lines?.[i]?.font ?? ''} aria-label="Line {i + 1} typeface" onchange={(e) => setLine(i, { font: ((e.target as HTMLSelectElement).value || undefined) as LineStyle['font'] })}>
        <option value="">Same</option>
        {#each ['sans', 'serif', 'mono', 'impact'] as f}<option value={f}>{f}</option>{/each}
      </select>
    </div>
    <Field label="Line {i + 1} size" unit="×" min={0.3} max={3} step={0.05} value={title.lines?.[i]?.size ?? 1} help="This line's size, as a multiple of the title's." onchange={(v: number) => setLine(i, { size: v })} />
  {/each}
{/if}

<div class="label">Letters</div>
<Field label="Letter spacing" min={-0.1} max={1} step={0.01} value={title.spacing ?? 0} help="Space between letters, as a share of the letter size." onchange={(v: number) => set('spacing', v)} />
<Field label="Line spacing" unit="×" min={0.6} max={3} step={0.05} value={title.lineHeight ?? 1.2} help="Space between lines, as a multiple of the letter size." onchange={(v: number) => set('lineHeight', v === 1.2 ? undefined : v)} />
<Field
  type="select"
  label="Width"
  value={title.fit ?? ''}
  options={[
    { value: '', label: 'Keep inside the frame' },
    { value: 'width', label: 'Fit to the frame width' },
    { value: 'none', label: 'Let it run off the edges' },
  ]}
  help="Keep inside: its Size, but smaller when a line would run off the sides (a tall 9:16 frame is narrow). Fit: as big as fits across the frame, whatever the words (Size is then ignored). Run off: its Size, cut off by the edges."
  onchange={(v: string) => set('fit', (v || undefined) as never)}
/>

<Field label="Curve" min={-1} max={1} step={0.01} value={title.curve ?? 0} help="Bends the line into an arc: up into an arch (+) or down into a smile (−). The letters follow it, turned to suit." onchange={(v: number) => set('curve', v)} />

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
<TrailSettings layer={title} />
<EffectsSettings layer={title} />
<DepthSettings layer={title} />
<TiltSettings layer={title} />
<PinSettings layer={title} />
<ParticleSettings layer={title} />

<style>
  .label {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 2px 8px;
    border: 1px solid var(--line-2);
    border-radius: 10px;
    background: var(--surface-2);
  }
  .chip.on {
    border-color: var(--accent);
  }
  .lnrow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ln {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
