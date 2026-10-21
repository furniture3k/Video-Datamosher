<script lang="ts">
  // Using a template: pick your clips (and a song for the beat ones), or try it with sample footage.
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { templateAccept, useTemplate, type Template } from '../lib/starters.svelte';

  let { t, onclose }: { t: Template; onclose: () => void } = $props();
  let input: HTMLInputElement;
  let picked = $state<File[]>([]);
  let working = $state(false);
  // (a copy to edit: the template keeps its own)
  // svelte-ignore state_referenced_locally
  let words = $state(t.words ?? '');

  // (by the name too: some systems give sound files no type)
  const isSound = (f: File) => f.type.startsWith('audio/') || (!f.type && /\.(mp3|wav|m4a|flac|ogg|opus|aac)$/i.test(f.name));
  const visual = $derived(picked.filter((f) => !isSound(f)));
  const songs = $derived(picked.filter(isSound));
  const tooFew = $derived(visual.length < t.clips[0]);
  const count = $derived(t.clips[0] === t.clips[1] ? `${t.clips[0]}` : `${t.clips[0]}–${t.clips[1]}`);

  function add(files: FileList | null) {
    if (!files) return;
    picked = [...picked, ...files];
  }

  async function go(withFiles: boolean) {
    working = true;
    try {
      // more clips than the template is made for: the first ones are used
      const files = withFiles ? [...visual.slice(0, t.clips[1]), ...songs.slice(0, 1)] : null;
      await useTemplate(t, files, words);
      onclose();
    } catch (e) {
      store.toast('Could not set up the template: ' + ((e as Error)?.message ?? e), 'error', 6000);
    } finally {
      working = false;
    }
  }
</script>

<Modal title={t.name} onclose={() => !working && onclose()}>
  <div class="col">
    <video class="pv" src="examples/{t.thumb}.webm" poster="examples/{t.thumb}.jpg" muted loop playsinline autoplay></video>
    <p>{t.description}</p>
    <p class="small muted"><b>{count} clip{t.clips[1] === 1 ? '' : 's'}{t.music ? ', and a song if you have one' : ''}.</b> {t.hint}</p>
    {#if t.words !== undefined}
      <label class="words"
        ><span class="small">Your words <span class="faint">· {t.wordsHint ?? 'Change them any time after.'}</span></span>
        <textarea rows="3" bind:value={words} spellcheck="false" disabled={working}></textarea></label
      >
    {/if}
    <button class="pick" onclick={() => input.click()} disabled={working}><Icon name="import" />{picked.length ? 'Add more…' : t.music ? 'Choose clips and a song…' : 'Choose clips…'}</button>
    <input bind:this={input} type="file" multiple hidden accept={templateAccept(t)} onchange={(e) => (add((e.target as HTMLInputElement).files), ((e.target as HTMLInputElement).value = ''))} />
    {#if picked.length}
      <ul class="files small">
        {#each picked as f, i (i)}
          <li>
            <Icon name={isSound(f) ? 'music' : 'film'} size={13} /><span class="grow">{f.name}</span>
            <button class="icon ghost" aria-label="Remove {f.name}" onclick={() => (picked = picked.filter((_, j) => j !== i))} disabled={working}><Icon name="x" size={12} /></button>
          </li>
        {/each}
      </ul>
      {#if visual.length > t.clips[1]}<p class="small faint">It's made for up to {t.clips[1]}; the first {t.clips[1]} are used.</p>{/if}
    {/if}
    {#if working}<p class="small muted" role="status">{store.status.engine || 'Setting it up…'}</p>{:else if t.slow}<p class="small faint">It looks at your footage to set this up, so it takes a little while.</p>{/if}
  </div>
  {#snippet footer()}
    <button onclick={() => go(false)} disabled={working}>Try with sample footage</button>
    <button class="primary" onclick={() => go(true)} disabled={working || tooFew} title={tooFew ? `Choose at least ${t.clips[0]}` : ''}>Use my clips</button>
  {/snippet}
</Modal>

<style>
  .col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pv {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--r);
    background: var(--surface-2);
  }
  .pick {
    align-self: flex-start;
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
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .files li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
