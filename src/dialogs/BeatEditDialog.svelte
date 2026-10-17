<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { beatInfo, refreshBeats } from '../lib/beatinfo.svelte';
  import { takeSnapshot } from '../lib/snapshots.svelte';
  import { beatEdit, defaultBeatEdit, findDrops, type BeatEditOptions } from '../engine/beatedit';
  import { MOSH_TRANSITIONS } from '../engine/timeline';
  import { randomSeed } from '../engine/rng';
  import type { AudioFeatures } from '../engine/beats';
  import type { Project } from '../engine/types';

  const visual = $derived(store.project.media.filter((m) => m.hasVideo));
  // what's on the main track now, else every picture in the library
  const used = store.project.clips.filter((c) => c.track === 'v1').map((c) => c.mediaId);
  let o = $state<BeatEditOptions>(defaultBeatEdit(store.project.media.filter((m) => m.hasVideo && (!used.length || used.includes(m.id))).map((m) => m.id)));
  let f = $state.raw<AudioFeatures | null>(null);
  let error = $state('');
  let working = $state(false);

  refreshBeats().then(
    (x) => {
      f = x;
      if (!x || !x.beats.length) error = 'No music with a beat found. Put a song on an audio track (or pick the beat source in the Audio tab) first.';
    },
    (e) => (error = 'Could not listen to the music: ' + (e as Error).message),
  );

  const cuts = $derived(f ? Math.max(1, Math.ceil((o.onBars ? f.downbeats : f.beats).length / Math.max(1, o.every))) : 0);
  const drops = $derived(f && o.blooms ? findDrops(f).length : 0);

  function toggle(id: string) {
    o.media = o.media.includes(id) ? o.media.filter((x) => x !== id) : [...o.media, id];
  }
  async function apply() {
    if (!f) return;
    working = true;
    error = '';
    try {
      const next = beatEdit($state.snapshot(store.project) as Project, f, { ...$state.snapshot(o), seed: o.order === 'random' ? randomSeed() : o.seed });
      await takeSnapshot('Before auto-edit', true);
      store.set(next);
      store.ui.selectedClips = [];
      store.seek(0);
      store.ui.dialog = null;
      store.toast(`Cut ${next.clips.filter((c) => c.track === 'v1').length} clips to ${Math.round(f.bpm)} BPM.`, 'ok');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      working = false;
    }
  }
</script>

<Modal title="Auto-edit to the beat">
  <div class="col">
    <p class="small muted">
      Cuts your clips on the beat of the music, puts melts on the first beat of each bar and blooms where the music drops. Your current edit is kept in a snapshot.
    </p>
    <div class="small mono info">
      {#if beatInfo.status === 'working' && !f}listening to the music…{:else if f && f.beats.length}{Math.round(f.bpm)} BPM · {f.beats.length} beats{f.confidence < 0.2 ? ' · no steady beat, cuts may feel loose' : ''}{:else}no beat{/if}
    </div>

    <div class="label">Cut between</div>
    <div class="media">
      {#each visual as m (m.id)}
        <label class="m" class:on={o.media.includes(m.id)}>
          <input type="checkbox" checked={o.media.includes(m.id)} onchange={() => toggle(m.id)} />
          {#if m.thumb}<img src={m.thumb} alt="" />{/if}
          <span class="small nm">{m.source.name}</span>
        </label>
      {/each}
    </div>

    <div class="grid">
      <label>Cut every
        <select bind:value={o.every}>{#each [1, 2, 4, 8, 16] as n}<option value={n}>{n} {o.onBars ? (n === 1 ? 'bar' : 'bars') : n === 1 ? 'beat' : 'beats'}</option>{/each}</select>
      </label>
      <label>Count
        <select value={o.onBars ? 'bars' : 'beats'} onchange={(e) => (o.onBars = (e.target as HTMLSelectElement).value === 'bars')}>
          <option value="beats">Beats</option>
          <option value="bars">Bars</option>
        </select>
      </label>
      <label>Order
        <select bind:value={o.order}>
          <option value="sequence">In order</option>
          <option value="random">Shuffled</option>
        </select>
      </label>
      <label>Melts
        <select bind:value={o.melts}>
          <option value="none">None</option>
          <option value="bars">On each bar</option>
          <option value="all">On every cut</option>
        </select>
      </label>
      {#if o.melts !== 'none'}
        <label>Transition
          <select bind:value={o.melt}>{#each Object.entries(MOSH_TRANSITIONS) as [k, v]}<option value={k}>{v.name}</option>{/each}</select>
        </label>
      {/if}
    </div>
    <label class="row small"><input type="checkbox" bind:checked={o.blooms} />Bloom where the music drops{#if drops} ({drops} found){/if}</label>
    <label class="row small"><input type="checkbox" bind:checked={o.muteClips} />Mute the clips' own sound</label>
    {#if f}<div class="small faint">About {cuts} cuts.</div>{/if}
    {#if error}<div class="small err">{error}</div>{/if}
  </div>
  {#snippet footer()}
    <button onclick={() => (store.ui.dialog = null)}>Cancel</button>
    <button class="primary" onclick={apply} disabled={!f || !f.beats.length || !o.media.length || working}><Icon name="music" />Cut to the beat</button>
  {/snippet}
</Modal>

<style>
  .info {
    color: var(--accent);
  }
  .media {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 6px;
    max-height: 220px;
    overflow: auto;
  }
  .m {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    cursor: pointer;
    position: relative;
    opacity: 0.6;
  }
  .m.on {
    border-color: var(--accent);
    opacity: 1;
  }
  .m input {
    position: absolute;
    top: 6px;
    left: 6px;
  }
  .m img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    /* minmax(0, …): long option names mustn't widen the dialog past a phone screen */
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px 12px;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .err {
    color: var(--danger);
  }
  .grid select {
    width: 100%;
    min-width: 0;
  }
</style>
