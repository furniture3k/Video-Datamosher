<script lang="ts">
  // Flipbook: pick pictures (or clips) from the media, and they swap on every beat or every few
  // frames from the playhead on, on a new track above, filling the frame.
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { localGet, localSet } from '../lib/storage';
  import { beatInfo, refreshBeats } from '../lib/beatinfo.svelte';
  import { addFlipbook } from '../lib/edit';
  import { beatPoints } from '../engine/wordbeats';
  import { flipTimes, type FlipOrder } from '../engine/flipbook';
  import { timelineDuration } from '../engine/timeline';
  import { tc } from '../lib/timecode';

  const media = $derived(store.project.media.filter((m) => m.hasVideo && m.source.kind !== 'adjust'));
  // the stills, to start with
  let picked = $state<string[]>(store.project.media.filter((m) => m.hasVideo && m.source.kind === 'file' && m.source.isImage).map((m) => m.id));
  let on = $state<'beats' | 'frames'>(localGet('flipOn', 'beats'));
  let every = $state(localGet('flipEvery', 1));
  let frames = $state(localGet('flipFrames', 3));
  let order = $state<FlipOrder>(localGet('flipOrder', 'order'));
  let length = $state(localGet('flipLength', 4));
  const from = store.ui.time;
  if (beatInfo.status !== 'ready' && beatInfo.status !== 'working') refreshBeats();
  const fps = $derived(store.project.encoder.fps);
  const to = $derived(Math.min(from + length, Math.max(from + 0.5, timelineDuration(store.project) || from + length)));
  const times = $derived(on === 'beats' ? (beatInfo.status === 'ready' ? flipTimes(from, to, { beats: beatPoints(beatInfo.beats, every), fps }) : []) : flipTimes(from, to, { frames, fps }));

  const toggle = (id: string) => (picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  function add() {
    const n = addFlipbook(picked, times, to, order);
    if (!n) return;
    for (const [k, v] of Object.entries({ flipOn: on, flipEvery: every, flipFrames: frames, flipOrder: order, flipLength: length })) localSet(k, v);
    store.ui.dialog = null;
    store.toast(`Flipbook: ${n} pictures on a new track.`, 'ok');
  }
</script>

<Modal title="Flipbook" onclose={() => (store.ui.dialog = null)}>
  <div class="col">
    <p class="small muted">Pick pictures or clips: they swap on every beat (or every few frames) from the playhead ({tc(from, fps)}) on, on a new track above, filling the frame. Videos carry on where they were left.</p>
    <div class="grid" role="group" aria-label="Pictures">
      {#each media as m (m.id)}
        <button class="pic" class:on={picked.includes(m.id)} aria-pressed={picked.includes(m.id)} title={m.source.name} onclick={() => toggle(m.id)}>
          {#if m.thumb}<img src={m.thumb} alt="" />{:else}<span class="small">{m.source.name}</span>{/if}
          {#if picked.includes(m.id)}<span class="n">{picked.indexOf(m.id) + 1}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="opts">
      <label>Swap
        <select bind:value={on} aria-label="Swap">
          <option value="beats">On the beat</option>
          <option value="frames">Every few frames</option>
        </select>
      </label>
      {#if on === 'beats'}
        <label>Every
          <select bind:value={every} aria-label="Every">
            {#each [0.25, 0.5, 1, 2] as n}<option value={n}>{n === 0.25 ? '¼ beat' : n === 0.5 ? '½ beat' : n === 1 ? 'beat' : `${n} beats`}</option>{/each}
          </select>
        </label>
      {:else}
        <label>Every
          <select bind:value={frames} aria-label="Frames">
            {#each [1, 2, 3, 4, 6, 8, 12] as n}<option value={n}>{n} frame{n > 1 ? 's' : ''}</option>{/each}
          </select>
        </label>
      {/if}
      <label>Order
        <select bind:value={order} aria-label="Order">
          <option value="order">In order</option>
          <option value="random">Shuffled</option>
          <option value="pingpong">Back and forth</option>
        </select>
      </label>
      <label>For
        <select bind:value={length} aria-label="For">
          {#each [1, 2, 4, 8, 16, 60] as n}<option value={n}>{n === 60 ? 'the rest' : `${n} s`}</option>{/each}
        </select>
      </label>
    </div>
    <div class="small faint" aria-live="polite">
      {#if picked.length < 1}Pick at least one picture.
      {:else if on === 'beats' && beatInfo.status === 'working'}Listening for the beat…
      {:else if on === 'beats' && beatInfo.status !== 'ready'}No beat yet: put some music on an audio track (or swap every few frames).
      {:else}{times.length} swaps, {tc(from, fps)} to {tc(to, fps)}.{/if}
    </div>
    <div class="row end">
      <button class="ghost" onclick={() => (store.ui.dialog = null)}>Cancel</button>
      <button class="primary" disabled={!picked.length || !times.length} onclick={add}><Icon name="film" />Add flipbook</button>
    </div>
  </div>
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 6px;
    max-height: 40vh;
    overflow: auto;
  }
  .pic {
    position: relative;
    height: 56px;
    padding: 0;
    overflow: hidden;
  }
  .pic img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.55;
  }
  .pic.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .pic.on img {
    opacity: 1;
  }
  .n {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 11px;
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 8px;
    padding: 0 5px;
  }
  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
  .opts label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .end {
    justify-content: flex-end;
  }
</style>
