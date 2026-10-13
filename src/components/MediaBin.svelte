<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { addFiles } from '../lib/media';
  import { clipDuration } from '../engine/mosh';
  let fileInput: HTMLInputElement;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

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

<div class="bin panel">
  <div class="head row">
    <span class="section-title grow">Clips</span>
    <span class="small muted mono">{fmt(store.project.clips.reduce((s, c) => s + clipDuration(c), 0))}</span>
  </div>

  <div class="add">
    <button class="primary" onclick={() => fileInput.click()}>＋ Add media</button>
    <button onclick={() => (store.ui.dialog = 'record')} title="Record from webcam or screen">● Record</button>
    <button onclick={() => (store.ui.dialog = 'generate')} title="Generate a test clip (fractals, patterns…)">✦ Generate</button>
  </div>
  <input bind:this={fileInput} type="file" multiple accept="video/*,image/*,.mkv,.avi,.mov,.gif" hidden onchange={(e) => {
    const f = (e.target as HTMLInputElement).files;
    if (f) addFiles(f);
    (e.target as HTMLInputElement).value = '';
  }} />

  {#if store.status.engine}
    <div class="small muted engine">⏳ {store.status.engine}</div>
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
        <button class="thumb ghost" onclick={() => select(c.id)} title="Edit clip settings">
          {#if c.thumb}<img src={c.thumb} alt="" />{:else}<div class="ph">{c.source.kind === 'generator' ? '✦' : '▶'}</div>{/if}
          <span class="idx mono">{i + 1}</span>
        </button>
        <div class="meta grow">
          <button class="nm ghost" onclick={() => select(c.id)} title={c.source.name}>{c.source.name}</button>
          <div class="small muted mono">
            {fmt(clipDuration(c))}
            {#if c.speed !== 1}· {c.speed}×{/if}
            {#if c.reverse}· ⇆{/if}
            {#if c.hasAudio}· ♪{/if}
          </div>
        </div>
        <div class="ctl">
          <button class="icon ghost" title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
          <button class="icon ghost" title="Move down" disabled={i === store.project.clips.length - 1} onclick={() => move(i, 1)}>↓</button>
          <button class="icon ghost" title="Remove clip" onclick={() => remove(c.id)}>✕</button>
        </div>
      </div>
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="empty" onclick={() => fileInput.click()}>
        <div class="big">⇪</div>
        <div>Drop videos here</div>
        <div class="small muted">MP4, MOV, WebM, MKV, AVI, GIF or images. Everything stays on your computer.</div>
        <div class="small muted">No footage? Use <b>✦ Generate</b> or <b>● Record</b>.</div>
      </div>
    {/each}
  </div>
  {#if store.project.clips.length > 1}
    <div class="small muted tip">Tip: the classic mosh is two clips plus the <b>Cut Transitions</b> preset. Drag clips to reorder them.</div>
  {/if}
</div>

<style>
  .bin {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 10px;
    gap: 8px;
    min-height: 0;
  }
  .add {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .add .primary {
    grid-column: span 2;
  }
  .engine {
    padding: 4px 2px;
  }
  .list {
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 60px;
  }
  .clip {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 5px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: var(--bg2);
  }
  .clip.sel {
    border-color: var(--accent);
  }
  .thumb {
    padding: 0;
    width: 72px;
    height: 44px;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
    flex: none;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .ph {
    display: grid;
    place-items: center;
    height: 100%;
    background: var(--panel2);
  }
  .idx {
    position: absolute;
    left: 3px;
    top: 2px;
    font-size: 10px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border-radius: 3px;
    padding: 0 3px;
  }
  .nm {
    padding: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    display: block;
    font-weight: 500;
    border: none;
  }
  .meta {
    overflow: hidden;
  }
  .ctl {
    display: flex;
    flex-direction: column;
  }
  .ctl button {
    padding: 0 5px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.2;
  }
  .empty {
    border: 2px dashed var(--line);
    border-radius: 10px;
    padding: 20px 12px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
  }
  .empty:hover {
    border-color: var(--accent);
  }
  .big {
    font-size: 30px;
  }
  .tip {
    border-top: 1px solid var(--line);
    padding-top: 6px;
  }
</style>
