<script lang="ts">
  // Add a font: a Google Font (picked from a list made for these edits, or any family by name)
  // or a font file. It goes into the project and onto the selected titles.
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { store } from '../lib/store.svelte';
  import { GOOGLE_FONTS, addGoogleFont, importFonts } from '../lib/fonts.svelte';
  import type { FontRef } from '../engine/types';

  let search = $state('');
  let busy = $state('');
  let error = $state('');
  let fileInput = $state<HTMLInputElement>();

  const shown = $derived(GOOGLE_FONTS.filter((f) => !search.trim() || (f.family + ' ' + f.kind).toLowerCase().includes(search.trim().toLowerCase())));
  const kinds = $derived([...new Set(shown.map((f) => f.kind))]);
  const have = (family: string) => !!store.project.fonts?.some((f) => f.google === family);

  /** put the font on the selected titles and close */
  function use(f: FontRef) {
    const ids = store.ui.selectedClips;
    store.edit((p) => {
      for (const l of p.layers) if (ids.includes(l.id)) l.font = `font:${f.id}`;
    });
    store.ui.dialog = null;
    store.toast(`Added ${f.name}.`, 'ok');
  }
  async function google(family: string) {
    busy = family;
    error = '';
    try {
      use(await addGoogleFont(family));
    } catch (e) {
      error = navigator.onLine === false ? 'You are offline: Google Fonts need the internet (font files work offline).' : (e as Error).message;
    } finally {
      busy = '';
    }
  }
  async function files(list: FileList | null) {
    if (!list?.length) return;
    const added = await importFonts([...list]);
    if (added.length) use(added[0]);
  }
</script>

<Modal title="Add a font" onclose={() => (store.ui.dialog = null)}>
  <div class="col">
    <p class="small muted">Free fonts from Google Fonts (downloaded once and kept with the project), or a font file of your own. Titles look the same in the preview, the export and when they melt.</p>
    <div class="row">
      <input class="grow" type="search" bind:value={search} placeholder="Search, or type any Google Fonts name" aria-label="Search fonts" />
      <button disabled={!search.trim() || !!busy} onclick={() => google(search)} title="Add this family from Google Fonts">Add “{search.trim() || '…'}”</button>
    </div>
    {#if error}<div class="small err" role="alert">{error}</div>{/if}
    <div class="list">
      {#each kinds as k}
        <div class="kind small faint">{k}</div>
        <div class="fonts">
          {#each shown.filter((f) => f.kind === k) as f (f.family)}
            <button class="font" disabled={!!busy} onclick={() => google(f.family)} aria-label={`Add ${f.family}`}>
              <span>{f.family}</span>
              {#if busy === f.family}<span class="small faint">downloading…</span>{:else if have(f.family)}<span class="small faint">added</span>{/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
    <div class="row end">
      <input bind:this={fileInput} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" multiple hidden onchange={(e) => files((e.target as HTMLInputElement).files)} aria-label="Font file" />
      <button class="ghost" onclick={() => fileInput?.click()}><Icon name="add" />Font file…</button>
      <button class="ghost" onclick={() => (store.ui.dialog = null)}>Close</button>
    </div>
  </div>
</Modal>

<style>
  .list {
    max-height: min(50vh, 420px);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .kind {
    margin-top: 6px;
  }
  .fonts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 4px;
  }
  .font {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    text-align: left;
  }
  .err {
    color: var(--danger, #ff6b6b);
  }
  .end {
    justify-content: flex-end;
  }
</style>
