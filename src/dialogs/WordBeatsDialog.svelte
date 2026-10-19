<script lang="ts">
  // Words on the beat: paste a sentence or lyrics, and each word (or line) becomes its own title,
  // one after another on the beats (or cuts) from the playhead on, on a new graphics row.
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { localGet, localSet } from '../lib/storage';
  import { beatInfo, refreshBeats } from '../lib/beatinfo.svelte';
  import { allStyles } from '../lib/styles.svelte';
  import { newText } from '../lib/edit';
  import { beatPoints, splitWords, wordSlots, wordTitles } from '../engine/wordbeats';
  import { applyStyle } from '../engine/styles';
  import { nextRow } from '../engine/layers';
  import { layoutVideo, uid } from '../engine/timeline';
  import { tc } from '../lib/timecode';

  let text = $state(localGet('wordBeatsText', ''));
  let per = $state<'word' | 'line'>(localGet('wordBeatsPer', 'word'));
  let on = $state<'beats' | 'cuts'>(localGet('wordBeatsOn', 'beats'));
  let every = $state(localGet('wordBeatsEvery', 1));
  let styleId = $state(localGet('wordBeatsStyle', 'slam'));
  let moshed = $state(false);
  const from = store.ui.time;
  if (beatInfo.status !== 'ready' && beatInfo.status !== 'working') refreshBeats();

  const pieces = $derived(splitWords(text, per));
  const points = $derived.by(() => {
    if (on === 'beats') return beatInfo.status === 'ready' ? beatPoints(beatInfo.beats, every) : [];
    const placed = layoutVideo(store.project);
    return [...placed.map((p) => p.start), placed.at(-1)?.end ?? 0];
  });
  const slots = $derived(wordSlots(pieces.length, points, from));
  const style = $derived(allStyles().find((s) => s.id === styleId) ?? allStyles()[0]);
  const fps = $derived(store.project.encoder.fps);

  function add() {
    const base = newText(0);
    applyStyle(base, style);
    base.moshed = moshed;
    const { id: _i, text: _t, start: _s, duration: _d, row: _r, ...like } = base;
    const row = nextRow(store.project.layers);
    const titles = wordTitles(pieces, slots, like, row, uid);
    if (!titles.length) return;
    store.edit((p) => p.layers.push(...titles));
    store.ui.selectedClips = [titles[0].id];
    for (const [k, v] of Object.entries({ wordBeatsText: text, wordBeatsPer: per, wordBeatsOn: on, wordBeatsEvery: every, wordBeatsStyle: styleId })) localSet(k, v);
    store.ui.dialog = null;
    store.toast(`Added ${titles.length} title${titles.length > 1 ? 's' : ''} on a new graphics row.`, 'ok');
  }
</script>

<Modal title="Words on the beat" onclose={() => (store.ui.dialog = null)}>
  <div class="col">
    <p class="small muted">Each word (or line) becomes its own title, one after another on the beat or on the cuts, from the playhead ({tc(from, fps)}) on.</p>
    <textarea rows="4" bind:value={text} placeholder="Everything works in my favor because I work for everything" aria-label="Words"></textarea>
    <div class="grid">
      <label>One title per
        <select bind:value={per} aria-label="One title per">
          <option value="word">Word</option>
          <option value="line">Line</option>
        </select>
      </label>
      <label>On
        <select bind:value={on} aria-label="On">
          <option value="beats">The beat</option>
          <option value="cuts">The cuts</option>
        </select>
      </label>
      {#if on === 'beats'}
        <label>Every
          <select bind:value={every} aria-label="Every">
            {#each [0.25, 0.5, 1, 2, 4] as n}<option value={n}>{n === 0.25 ? '¼ beat' : n === 0.5 ? '½ beat' : n === 1 ? 'beat' : `${n} beats`}</option>{/each}
          </select>
        </label>
      {/if}
      <label>Look
        <select bind:value={styleId} aria-label="Look">{#each allStyles() as s}<option value={s.id}>{s.name}</option>{/each}</select>
      </label>
    </div>
    <label class="row small"><input type="checkbox" bind:checked={moshed} /> Melt with the video</label>
    <div class="small faint" aria-live="polite">
      {#if on === 'beats' && beatInfo.status === 'working'}Listening for the beat…
      {:else if on === 'beats' && beatInfo.status !== 'ready'}No beat yet: put some music on an audio track (or pick cuts instead).
      {:else if !pieces.length}Type or paste some words.
      {:else if !slots.length}Nothing to put them on after the playhead.
      {:else}{slots.length} title{slots.length > 1 ? 's' : ''}, {tc(slots[0][0], fps)} to {tc(slots.at(-1)![1], fps)}{slots.length < pieces.length ? ` (the last ${pieces.length - slots.length} don't fit before the end)` : ''}.{/if}
    </div>
    <div class="row end">
      <button class="ghost" onclick={() => (store.ui.dialog = null)}>Cancel</button>
      <button class="primary" disabled={!slots.length} onclick={add}><Icon name="text" />Add titles</button>
    </div>
  </div>
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .end {
    justify-content: flex-end;
  }
</style>
