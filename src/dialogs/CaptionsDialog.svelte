<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { localGet, localSet } from '../lib/storage';
  import { captionJob, transcribe, applyCaptions, downloadSubtitles, MODELS } from '../lib/captions.svelte';
  import { CAPTION_STYLES, type CaptionStyle, type Word } from '../engine/captions';
  import { CLIP_AUDIO } from '../engine/types';
  import { audioSources } from '../engine/timeline';

  const tracks = $derived(store.project.tracks.filter((t) => t.kind === 'audio'));
  // speech is usually the clips' own sound
  let source = $state(audioSources(store.project).some((s) => s.clip.track === 'v1' || s.clip.track === CLIP_AUDIO) ? CLIP_AUDIO : 'mix');
  let model = $state(localGet('captionModel', MODELS[0].id));
  let language = $state(localGet('captionLang', ''));
  let style = $state<CaptionStyle>(localGet('captionStyle', 'clean'));
  let replace = $state(true);
  let words = $state.raw<Word[] | null>(null);
  // an old run's message (from the last time this was open) isn't news
  if (!captionJob.running) captionJob.error = '';
  const existing = $derived(store.project.texts.filter((t) => t.caption).length);
  const LANGS = [['', 'Detect'], ['english', 'English'], ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German'], ['italian', 'Italian'], ['portuguese', 'Portuguese'], ['dutch', 'Dutch'], ['japanese', 'Japanese'], ['korean', 'Korean'], ['chinese', 'Chinese'], ['russian', 'Russian'], ['arabic', 'Arabic'], ['hindi', 'Hindi']];

  async function listen() {
    localSet('captionModel', model);
    localSet('captionLang', language);
    words = null;
    try {
      words = await transcribe(source, { model, language });
      if (!words.length) captionJob.error = 'No speech was found.';
    } catch {
      /* shown from captionJob.error */
    }
  }
  function add() {
    if (!words) return;
    localSet('captionStyle', style);
    const n = applyCaptions(words, style, replace);
    store.ui.dialog = null;
    store.toast(`${n} captions added.`, 'ok');
  }
</script>

<Modal title="Auto captions" onclose={() => (store.ui.dialog = null)}>
  <div class="col">
    <p class="small muted">Listens to the sound with a speech model that runs on this device (nothing is uploaded) and adds the words as titles. The model is downloaded once, the first time.</p>
    <div class="grid">
      <label>Listen to
        <select bind:value={source}>
          <option value="mix">Everything</option>
          {#each tracks as t}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </label>
      <label>Model
        <select bind:value={model}>{#each MODELS as m}<option value={m.id}>{m.name}</option>{/each}</select>
      </label>
      {#if !model.endsWith('.en')}
        <label>Language
          <select bind:value={language}>{#each LANGS as [v, l]}<option value={v}>{l}</option>{/each}</select>
        </label>
      {/if}
      <label>Style
        <select bind:value={style}>{#each CAPTION_STYLES as s}<option value={s.id}>{s.name}</option>{/each}</select>
      </label>
    </div>
    <div class="small faint">{CAPTION_STYLES.find((s) => s.id === style)?.hint}</div>
    {#if captionJob.running}
      <div class="prog">
        <div class="bar"><div style="width:{Math.round(captionJob.progress * 100)}%"></div></div>
        <span class="small mono">{captionJob.stage}…{captionJob.progress ? ` ${Math.round(captionJob.progress * 100)}%` : ''}</span>
      </div>
    {/if}
    {#if captionJob.error}<div class="small err">{captionJob.error}</div>{/if}
    {#if words?.length}
      <div class="preview small">{words.map((w) => w.text).join(' ').slice(0, 400)}{words.length > 80 ? '…' : ''}</div>
      {#if existing}<label class="row small"><input type="checkbox" bind:checked={replace} />Replace the {existing} captions already there</label>{/if}
    {/if}
    {#if existing}
      <div class="row small">
        <span class="faint grow">Subtitles file of the captions on the timeline:</span>
        <button class="small" onclick={() => downloadSubtitles('srt')}>.srt</button>
        <button class="small" onclick={() => downloadSubtitles('vtt')}>.vtt</button>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <button onclick={() => (store.ui.dialog = null)}>Close</button>
    {#if words?.length}
      <button class="primary" onclick={add}><Icon name="text" />Add captions</button>
    {:else}
      <button class="primary" onclick={listen} disabled={captionJob.running}>{captionJob.running ? 'Listening…' : 'Listen'}</button>
    {/if}
  {/snippet}
</Modal>

<style>
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
  .prog {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bar {
    flex: 1;
    height: 2px;
    background: var(--line-2);
  }
  .bar div {
    height: 100%;
    background: var(--accent);
  }
  .preview {
    max-height: 120px;
    overflow: auto;
    padding: 6px 8px;
    background: var(--surface-2);
    border-radius: var(--r);
    line-height: 1.4;
  }
  .err {
    color: var(--danger);
  }
  .grid select {
    width: 100%;
    min-width: 0;
  }
</style>
