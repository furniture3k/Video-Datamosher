<script lang="ts">
  // Templates (in the editor): the whole style of an edit people post (words behind a cut-out subject, word-per-beat
  // lyrics, pop-up collages, tour posters, red notes…) put on the clips already in the project in one go.
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import StarterCard from '../home/StarterCard.svelte';
  import { store } from '../lib/store.svelte';
  import { applyLook, TEMPLATES, type Template } from '../lib/starters.svelte';
  import { VIDEO_TRACK } from '../engine/types';

  const looks = TEMPLATES.filter((t) => t.look);
  const more = TEMPLATES.filter((t) => !t.look);
  let picked = $state<Template | null>(null);
  let words = $state('');
  let working = $state(false);
  const hasClips = $derived(store.project.clips.some((c) => c.track === VIDEO_TRACK));
  const hasMusic = $derived(store.project.media.some((m) => !m.hasVideo));

  function pick(t: Template) {
    picked = t;
    words = t.words ?? '';
  }

  async function apply() {
    if (!picked) return;
    working = true;
    try {
      await applyLook(picked, words);
      store.ui.dialog = null;
    } catch (e) {
      store.toast((e as Error)?.message ?? String(e), 'error', 6000);
    } finally {
      working = false;
    }
  }
</script>

<Modal title={picked ? picked.name : 'Templates'} wide onclose={() => !working && (store.ui.dialog = null)}>
  {#if !picked}
    <p class="small muted lead">Pick one and it is made from the clips on your timeline: titles, marks, cut-outs, layout and timing. Everything it adds can be changed after, and one Undo takes it off.</p>
    {#if !hasClips}<p class="small warn"><Icon name="import" size={13} /> Import some clips and put them on the timeline first.</p>{/if}
    <h4>Make it look like…</h4>
    <div class="grid">
      {#each looks as t (t.id)}<StarterCard s={t} badge={t.aspect === '9:16' ? '9:16' : t.music ? '♪ beat' : ''} onclick={() => pick(t)} />{/each}
    </div>
    <h4>More</h4>
    <div class="grid">
      {#each more as t (t.id)}<StarterCard s={t} badge={t.aspect === '9:16' ? '9:16' : t.music ? '♪ beat' : ''} onclick={() => pick(t)} />{/each}
    </div>
  {:else}
    <div class="col">
      <video class="pv" src="examples/{picked.thumb}.webm" poster="examples/{picked.thumb}.jpg" muted loop playsinline autoplay></video>
      <p>{picked.description}</p>
      <p class="small muted">{picked.hint}</p>
      {#if picked.music && !hasMusic}<p class="small faint"><Icon name="music" size={13} /> Put a song on the music track first and it lands on the beat.</p>{/if}
      {#if picked.aspect}<p class="small faint">The video becomes {picked.aspect}.</p>{/if}
      {#if picked.words !== undefined}
        <label class="words"
          ><span class="small">Your words <span class="faint">· {picked.wordsHint ?? 'Change them any time after.'}</span></span>
          <textarea rows="3" bind:value={words} spellcheck="false" disabled={working}></textarea></label
        >
      {/if}
      {#if working}<p class="small muted" role="status">{store.status.engine || 'Setting it up…'}</p>{:else if picked.slow}<p class="small faint">It looks at your footage to set this up, so it takes a little while.</p>{/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if picked}
      <button onclick={() => (picked = null)} disabled={working}><Icon name="back" />All templates</button>
      <button class="primary" onclick={apply} disabled={working || !hasClips} title={hasClips ? '' : 'Put some clips on the timeline first'}><Icon name="sparkle" />{working ? 'Working…' : 'Put it on my clips'}</button>
    {:else}
      <button onclick={() => (store.ui.dialog = null)}>Close</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .lead {
    margin-bottom: 10px;
  }
  .warn {
    color: var(--warn, #e0b341);
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  h4 {
    font-size: 13px;
    font-weight: 650;
    margin: 12px 0 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pv {
    width: 100%;
    max-height: 46vh;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    border-radius: var(--r);
    background: var(--surface-2);
  }
  .words {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .words textarea {
    resize: vertical;
    min-height: 60px;
    font: inherit;
  }
</style>
