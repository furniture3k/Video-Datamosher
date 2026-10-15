<script lang="ts">
  // The Frame Sequencer's pattern: one column per step, one row per move. Click or drag to paint.
  import { store } from '../lib/store.svelte';
  import { localGet, localSet } from '../lib/storage';
  import { SEQ_STEPS, randomSteps, stepsOf, type SeqStep } from '../engine/effects/bend';
  import { makeRng, randomSeed } from '../engine/rng';
  import type { EffectInstance } from '../engine/types';

  let { effect }: { effect: EffectInstance } = $props();
  const steps = $derived(stepsOf(effect));
  const stepLen = $derived(Math.max(1, Math.round(Number(effect.params.stepLen ?? 3))));
  // the step under the playhead lights up
  const live = $derived.by(() => {
    const f = store.playFrame;
    if (f < effect.start || f >= effect.end) return -1;
    return Math.floor((f - effect.start) / stepLen) % steps.length;
  });

  function setSteps(next: SeqStep[], key: string | null = null) {
    store.edit(() => (effect.data = { ...(effect.data ?? {}), steps: next }), key);
  }
  let paint: SeqStep | null = null;
  function down(e: PointerEvent, i: number, op: SeqStep) {
    e.preventDefault();
    paint = steps[i] === op ? 'keep' : op;
    const next = [...steps];
    next[i] = paint;
    setSteps(next, 'seq' + effect.id);
    window.addEventListener('pointerup', () => (paint = null), { once: true });
  }
  function enter(i: number, op: SeqStep) {
    if (!paint) return;
    // painting a move only fills that move's row; erasing clears any row
    if (paint !== 'keep' && paint !== op) return;
    if (steps[i] === paint) return;
    const next = [...steps];
    next[i] = paint;
    setSteps(next, 'seq' + effect.id);
  }
  function resize(n: number) {
    setSteps(Array.from({ length: n }, (_, i) => steps[i % steps.length] ?? 'keep'));
  }
  const shift = (d: number) => setSteps(steps.map((_, i) => steps[(i - d + steps.length) % steps.length]));
  function copy() {
    localSet('seqClipboard', steps);
    store.toast('Pattern copied.', 'ok', 1500);
  }
  const clip = $derived(localGet<SeqStep[] | null>('seqClipboard', null));
</script>

<div class="seq">
  <div class="row bar small">
    <label class="row">Steps
      <select value={steps.length} onchange={(e) => resize(+(e.target as HTMLSelectElement).value)}>
        {#each [4, 6, 8, 12, 16, 24, 32] as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <span class="grow"></span>
    <button class="mini" title="Shift the pattern left" onclick={() => shift(-1)}>◀</button>
    <button class="mini" title="Shift the pattern right" onclick={() => shift(1)}>▶</button>
    <button class="mini" title="Random pattern" onclick={() => setSteps(randomSteps(makeRng(randomSeed()), steps.length))}>Random</button>
    <button class="mini" title="Clear every step" onclick={() => setSteps(steps.map(() => 'keep'))}>Clear</button>
    <button class="mini" title="Copy this pattern" onclick={copy}>Copy</button>
    <button class="mini" title="Paste the copied pattern" disabled={!clip} onclick={() => clip && setSteps([...clip])}>Paste</button>
  </div>
  <div class="grid" style="--n:{steps.length}" role="grid" aria-label="Sequencer pattern">
    {#each SEQ_STEPS as s (s.id)}
      <div class="rlabel" title={s.hint} style="--c:{s.color}">{s.label}</div>
      {#each steps as st, i}
        <button
          class="cell"
          class:on={st === s.id}
          class:live={live === i}
          class:beat={i % 4 === 0}
          style="--c:{s.color}"
          aria-label="{s.label} on step {i + 1}"
          aria-pressed={st === s.id}
          onpointerdown={(e) => down(e, i, s.id)}
          onpointerenter={() => enter(i, s.id)}
        ></button>
      {/each}
    {/each}
  </div>
  <div class="small faint">Each step lasts {stepLen} frame{stepLen === 1 ? '' : 's'}; the pattern repeats along the bar. Empty steps play the footage as it is.</div>
</div>

<style>
  .seq {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bar {
    gap: 2px;
    flex-wrap: wrap;
  }
  .bar select {
    height: 22px;
  }
  .mini {
    height: 22px;
    padding: 0 6px;
    font-size: 11px;
  }
  .grid {
    display: grid;
    grid-template-columns: 52px repeat(var(--n), minmax(0, 1fr));
    gap: 2px;
    user-select: none;
    touch-action: none;
  }
  .rlabel {
    font-size: 10px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .rlabel::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 1px;
    background: var(--c);
  }
  .cell {
    height: 18px;
    min-width: 0;
    padding: 0;
    border-radius: 2px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
  }
  .cell.beat {
    border-left-color: var(--text-3, var(--line-2));
  }
  .cell.on {
    background: var(--c);
    border-color: var(--c);
  }
  .cell.live {
    box-shadow: inset 0 -2px 0 var(--text);
  }
</style>
