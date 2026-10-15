<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { askText, ask } from '../lib/ask';
  import { store } from '../lib/store.svelte';
  import { snapshots, loadSnapshots, takeSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot } from '../lib/snapshots.svelte';

  let showAuto = $state(true);
  loadSnapshots();
  const list = $derived(snapshots.list.filter((s) => showAuto || !s.auto));

  const when = (t: number) => {
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  async function save() {
    const name = await askText('Snapshot name', `Snapshot ${snapshots.list.filter((s) => !s.auto).length + 1}`);
    if (name === null) return;
    const s = await takeSnapshot(name || undefined);
    if (s) store.toast('Snapshot saved.', 'ok');
    else store.toast('Nothing to save yet.', 'error');
  }
  async function rename(id: string, name: string) {
    const n = await askText('Rename snapshot', name);
    if (n) renameSnapshot(id, n);
  }
  async function remove(id: string, name: string) {
    if (await ask(`Delete ${name}?`)) deleteSnapshot(id);
  }
  function compare(id: string) {
    store.ui.compareSnap = id;
    if (store.ui.compare === 'off') store.ui.compare = 'split';
    store.ui.dialog = null;
  }
</script>

<Modal title="Snapshots" wide>
  <div class="row bar">
    <button class="primary" onclick={save}><Icon name="save" size={14} />Save snapshot<span class="kbd">Ctrl Shift S</span></button>
    <span class="grow"></span>
    {#if store.ui.compareSnap}
      <button onclick={() => (store.ui.compareSnap = null)}>Compare with source again</button>
    {/if}
    <label class="row small"><input type="checkbox" bind:checked={showAuto} />Automatic</label>
  </div>
  <p class="small muted">
    A snapshot keeps the whole edit and mosh. Automatic ones are taken before Randomize, presets, recipes and Variations replace your stack. <b>Compare</b> shows a snapshot next to the current mosh (A/B in the player).
  </p>
  {#if !list.length}
    <p class="muted empty">No snapshots yet.</p>
  {:else}
    <div class="grid">
      {#each list as s (s.id)}
        <div class="card" class:cmp={store.ui.compareSnap === s.id}>
          {#if s.thumb}<img src={s.thumb} alt="" />{:else}<div class="ph"></div>{/if}
          <div class="meta">
            <div class="nm" title={s.name}>{s.name}</div>
            <div class="small faint">{when(s.at)} · {s.project.effects.length} effect{s.project.effects.length === 1 ? '' : 's'}{s.auto ? ' · auto' : ''}</div>
          </div>
          <div class="acts">
            <button onclick={() => (restoreSnapshot(s.id), (store.ui.dialog = null))} title="Make this the current project (undo brings back what you had)">Restore</button>
            <button onclick={() => compare(s.id)} disabled={!store.render} title="A/B this snapshot against the current mosh">Compare</button>
            <button class="icon ghost" title="Rename" aria-label="Rename" onclick={() => rename(s.id, s.name)}><Icon name="pen" size={13} /></button>
            <button class="icon ghost" title="Delete" aria-label="Delete" onclick={() => remove(s.id, s.name)}><Icon name="trash" size={13} /></button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .bar {
    gap: 8px;
    margin-bottom: 8px;
  }
  .empty {
    padding: 24px 0;
    text-align: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    background: var(--surface-2);
    min-width: 0;
  }
  .card.cmp {
    border-color: var(--accent);
  }
  img,
  .ph {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 2px;
    background: var(--bg, #000);
  }
  .nm {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acts {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .acts button:not(.icon) {
    flex: 1;
  }
</style>
