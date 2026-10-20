<script lang="ts">
  // Steal this edit: pick a reference video (a screen recording of a Reel, say) and moshpit measures
  // how it was cut, its frame rate, colours and frame, and cuts your clips the same way. "What I
  // found" can be tweaked before it is applied.
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { beatInfo, refreshBeats } from '../lib/beatinfo.svelte';
  import { applySteal, footageSeconds, measureReference, planFor, stealState } from '../lib/steal.svelte';
  import type { StealPlan, StealResult } from '../engine/steal';

  /** from the home screen: it also asks for the footage and starts a project with it */
  let { fromHome = false, onclose }: { fromHome?: boolean; onclose?: () => void } = $props();
  const close = () => (onclose ? onclose() : (store.ui.dialog = null));

  let result = $state<(StealResult & { width: number; height: number }) | null>(null);
  let name = $state('');
  let error = $state('');
  let files = $state<File[]>([]);
  let faster = $state(1);
  let grade = $state(1);
  let useStep = $state(true);
  let useCard = $state(true);
  let seconds = $state(0);
  let working = $state(false);
  if (!fromHome && beatInfo.status !== 'ready' && beatInfo.status !== 'working') refreshBeats();

  const mine = $derived(fromHome ? 0 : footageSeconds());
  const period = $derived(!fromHome && beatInfo.status === 'ready' && beatInfo.bpm ? 60 / beatInfo.bpm : undefined);
  /** the plan from what was found, then the tweaks */
  const plan = $derived.by<StealPlan | null>(() => {
    if (!result) return null;
    const total = seconds || Math.min(result.duration, mine || result.duration);
    const p = planFor(result, total, { grade, beatPeriod: period });
    // cutting faster or slower scales every shot (and the last one is trimmed to fit)
    if (faster !== 1) {
      const scaled: number[] = [];
      let t = 0;
      for (let i = 0; t < total - 1e-6; i++) {
        const len = Math.min((p.shots[i % p.shots.length] ?? 1) / faster, total - t);
        if (len < 0.08) break;
        scaled.push(Math.round(len * 1000) / 1000);
        t += len;
      }
      p.shots = scaled;
    }
    if (!useStep) delete p.stepFps;
    if (!useCard) delete p.card;
    return p;
  });

  async function pick(f: File | undefined) {
    if (!f) return;
    error = '';
    result = null;
    name = f.name;
    working = true;
    try {
      result = await measureReference(f);
      seconds = Math.round(Math.min(result.duration, mine || result.duration) * 10) / 10;
      useStep = !!result.effective.stepFps;
      useCard = !!result.borders;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      working = false;
    }
  }
  async function apply() {
    if (!result || !plan) return;
    working = true;
    try {
      await applySteal(result, plan, fromHome ? files : undefined);
      close();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      working = false;
    }
  }
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const beatWord = (n: number) => (n === 0.25 ? 'a quarter beat' : n === 0.5 ? 'half a beat' : n === 1 ? 'a beat' : `${n} beats`);
</script>

<Modal title="Steal this edit" onclose={close}>
  <div class="col">
    <p class="small muted">Pick a video you like the edit of. moshpit measures how it was cut and made, then cuts {fromHome ? 'your footage' : 'your clips'} the same way. Nothing leaves your device.</p>
    <label class="row pickref">
      <span class="btn primary">{result ? 'Pick another reference' : 'Pick the reference video'}</span>
      <input type="file" accept="video/*,.mkv,.avi,.mov" aria-label="Reference video" hidden onchange={(e) => ((e.target as HTMLInputElement).files?.[0] && pick((e.target as HTMLInputElement).files![0]), ((e.target as HTMLInputElement).value = ''))} />
      <span class="small faint grow">{name}</span>
    </label>
    {#if working || stealState.running}<p class="small" aria-live="polite">{stealState.stage || 'Working'}…</p>{/if}
    {#if error}<p class="small warn" role="alert">{error}</p>{/if}

    {#if result && plan}
      <div class="found" aria-live="polite">
        <b>What I found</b>
        <ul>
          <li>{result.cuts.length ? `${result.shots.count} shots, ${result.shots.median.toFixed(1)} s in the middle (${result.shots.min.toFixed(1)} to ${result.shots.max.toFixed(1)} s)` : 'No cuts: one long shot'}</li>
          {#if result.beat}<li>Cuts on the beat: {pct(result.beat.onBeat)} of them, {result.beat.bpm} beats a minute, a shot about {beatWord(result.beat.every)}</li>{/if}
          <li>{result.effective.stepFps ? `${result.effective.stepFps} pictures a second (a step print)` : `${Math.round(result.effective.fps)} pictures a second, nothing held`}</li>
          <li>Colours: <span class="sw">{#each result.palette as p}<i style="background:{p.hex}" title="{p.hex} {pct(p.share)}"></i>{/each}</span></li>
          <li>{result.borders ? `A frame round the picture (bars or a card), ${pct(Math.max(result.borders.top, result.borders.bottom, result.borders.left, result.borders.right))} wide` : 'The picture fills the frame'}</li>
          <li>{result.text.density > 0.02 ? `Lots of text${result.text.where ? ` (mostly ${result.text.where})` : ''}: add titles with Script` : 'Hardly any text'}</li>
        </ul>
      </div>
      <div class="tweaks">
        <label>Cut it {faster === 1 ? 'as fast' : faster > 1 ? `${faster.toFixed(1)}× faster` : `${(1 / faster).toFixed(1)}× slower`}
          <input type="range" min="0.5" max="2" step="0.1" bind:value={faster} aria-label="How fast to cut" />
        </label>
        <label>Length (s)
          <input type="number" min="1" max="600" step="0.5" bind:value={seconds} aria-label="Length" />
        </label>
        <label>Its colours on yours
          <input type="range" min="0" max="1" step="0.05" bind:value={grade} aria-label="Grade amount" />
        </label>
        {#if result.effective.stepFps}<label class="row"><input type="checkbox" bind:checked={useStep} />Step print at {result.effective.stepFps} pictures a second</label>{/if}
        {#if result.borders}<label class="row"><input type="checkbox" bind:checked={useCard} />The frame round the picture</label>{/if}
      </div>
      {#if fromHome}
        <label class="row pickref">
          <span class="btn">{files.length ? `${files.length} clip${files.length > 1 ? 's' : ''} chosen` : 'Pick your footage'}</span>
          <input type="file" multiple accept="video/*,.mkv,.avi,.mov" aria-label="Your footage" hidden onchange={(e) => ((files = [...((e.target as HTMLInputElement).files ?? [])]), ((e.target as HTMLInputElement).value = ''))} />
        </label>
      {:else if !mine}
        <p class="small warn">Put some clips on the timeline first: they are what gets cut.</p>
      {/if}
      <p class="small faint">{plan.shots.length} shots over {plan.shots.reduce((s, v) => s + v, 0).toFixed(1)} s{plan.stepFps ? `, ${plan.stepFps} fps` : ''}{plan.card ? ', with a frame' : ''}.</p>
    {/if}
    <div class="row end">
      <button class="ghost" onclick={close}>Cancel</button>
      <button class="primary" disabled={!result || !plan || working || (fromHome ? !files.length : !mine)} onclick={apply}>Cut my clips like this</button>
    </div>
  </div>
</Modal>

<style>
  .pickref {
    gap: 10px;
    align-items: center;
    cursor: pointer;
  }
  .btn {
    padding: 6px 12px;
    border-radius: var(--r, 6px);
    border: 1px solid var(--line-2);
  }
  .btn.primary {
    background: var(--accent);
    color: #000;
    border-color: transparent;
    font-weight: 600;
  }
  .found ul {
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 12px;
    line-height: 1.7;
  }
  .sw {
    display: inline-flex;
    gap: 2px;
    vertical-align: middle;
  }
  .sw i {
    width: 18px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid var(--line-2);
  }
  .tweaks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 8px;
    font-size: 12px;
  }
  .tweaks label:not(.row) {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .end {
    justify-content: flex-end;
  }
</style>
