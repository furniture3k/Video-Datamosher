<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { addFiles } from '../lib/media';
  import { clipDuration } from '../engine/mosh';
  import Icon from './Icon.svelte';
  let fileInput: HTMLInputElement;

  const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  function move(i: number, d: number) {
    store.edit((p) => {
      const j = i + d;
      if (j < 0 || j >= p.clips.length) return;
      const [c] = p.clips.splice(i, 1);
      p.clips.splice(j, 0, c);
    });
  }
  function remove(id: string) {
    store.edit((p) => (p.clips = p.clips.filter((c) => c.id !== id)));
    if (store.ui.selectedClip === id) store.ui.selectedClip = null;
  }
  function select(id: string) {
    store.ui.selectedClip = id;
    store.ui.tab = 'clip';
  }
  let dragFrom = -1;
</script>

<div class="bin">
  <div class="head">
    <span class="label">Media</span>
    <span class="faint mono small">{tc(store.project.clips.reduce((s, c) => s + clipDuration(c), 0))}</span>
  </div>

  <div class="actions">
    <button onclick={() => fileInput.click()} title="Import video or image files"><Icon name="import" />Import</button>
    <button onclick={() => (store.ui.dialog = 'record')} title="Record from camera or screen"><span class="rec"><Icon name="rec" size={12} /></span>Record</button>
    <button onclick={() => (store.ui.dialog = 'generate')} title="Generate a test clip"><Icon name="gen" />Generate</button>
  </div>
  <input
    bind:this={fileInput}
    type="file"
    multiple
    accept="video/*,image/*,.mkv,.avi,.mov,.gif"
    hidden
    onchange={(e) => {
      const f = (e.target as HTMLInputElement).files;
      if (f) addFiles(f);
      (e.target as HTMLInputElement).value = '';
    }}
  />

  {#if store.status.engine}
    <div class="status small muted">{store.status.engine}</div>
  {/if}

  <div class="list">
    {#each store.project.clips as c, i (c.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="clip"
        class:sel={store.ui.selectedClip === c.id}
        draggable="true"
        ondragstart={() => (dragFrom = i)}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragFrom >= 0 && dragFrom !== i) move(dragFrom, i - dragFrom);
          dragFrom = -1;
        }}
      >
        <button class="main" onclick={() => select(c.id)} title={c.source.name}>
          <span class="thumb">
            {#if c.thumb}<img src={c.thumb} alt="" />{/if}
            <span class="idx mono">{i + 1}</span>
          </span>
          <span class="meta">
            <span class="nm">{c.source.name}</span>
            <span class="sub mono">
              {tc(clipDuration(c))}{#if c.speed !== 1}&ensp;{c.speed}×{/if}{#if c.reverse}&ensp;rev{/if}{#if c.hasAudio}&ensp;♪{/if}
            </span>
          </span>
        </button>
        <div class="ctl">
          <button class="icon ghost" title="Move up" aria-label="Move up" disabled={i === 0} onclick={() => move(i, -1)}><Icon name="up" size={13} /></button>
          <button class="icon ghost" title="Move down" aria-label="Move down" disabled={i === store.project.clips.length - 1} onclick={() => move(i, 1)}><Icon name="down" size={13} /></button>
          <button class="icon ghost" title="Remove clip" aria-label="Remove clip" onclick={() => remove(c.id)}><Icon name="x" size={13} /></button>
        </div>
      </div>
    {:else}
      <button class="empty" onclick={() => fileInput.click()}>
        <span>Drop video or images here</span>
        <span class="faint small">mp4, mov, webm, mkv, avi, gif, png, jpg</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .bin {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 32px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--line);
  }
  .actions button {
    padding: 0 4px;
    gap: 5px;
  }
  .rec {
    color: var(--accent);
    display: flex;
  }
  .status {
    padding: 6px 12px;
    border-bottom: 1px solid var(--line);
  }
  .list {
    flex: 1;
    overflow: auto;
    min-height: 60px;
  }
  .clip {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--line);
    position: relative;
  }
  .clip.sel {
    background: var(--surface-2);
  }
  .clip.sel::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
  }
  .main {
    flex: 1;
    min-width: 0;
    height: auto;
    background: none;
    border: none;
    border-radius: 0;
    padding: 8px 4px 8px 12px;
    justify-content: flex-start;
    gap: 10px;
    text-align: left;
  }
  .main:hover:not(:disabled) {
    background: none;
  }
  .thumb {
    width: 64px;
    height: 36px;
    background: var(--bg);
    position: relative;
    flex: none;
    overflow: hidden;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .idx {
    position: absolute;
    left: 0;
    top: 0;
    font-size: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: #ddd;
    padding: 0 3px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    color: var(--text-3);
    font-size: 11px;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    padding-right: 4px;
    opacity: 0;
  }
  .clip:hover .ctl,
  .clip.sel .ctl {
    opacity: 1;
  }
  .ctl button {
    height: 16px;
    width: 20px;
  }
  .empty {
    margin: 12px;
    width: calc(100% - 24px);
    height: auto;
    padding: 24px 12px;
    flex-direction: column;
    gap: 4px;
    background: none;
    border: 1px dashed var(--line-2);
    color: var(--text-2);
    white-space: normal;
  }
  .empty:hover:not(:disabled) {
    border-color: var(--text-3);
    background: none;
  }
  @media (hover: none) {
    .ctl {
      opacity: 1;
    }
  }
</style>
