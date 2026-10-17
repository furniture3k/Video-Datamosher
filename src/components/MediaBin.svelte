<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { addFiles, addToTimeline, addAdjustmentLayer } from '../lib/media';
  import { mediaState } from '../lib/mediastate.svelte';
  import { removeMedia, setTransition, transitionAtPlayhead, insertEdit, overwriteEdit, placeOnTop, appendEdit } from '../lib/edit';
  import { BLEND_TRANSITIONS, MOSH_TRANSITIONS } from '../engine/timeline';
  import type { MediaItem, TransitionType } from '../engine/types';
  import Icon from './Icon.svelte';
  let fileInput = $state<HTMLInputElement>();
  let tab = $state<'media' | 'transitions'>('media');
  const picked = $derived(store.project.media.find((m) => m.id === store.ui.selectedMedia));

  const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const uses = $derived.by(() => {
    const m = new Map<string, number>();
    for (const c of store.project.clips) m.set(c.mediaId, (m.get(c.mediaId) ?? 0) + 1);
    return m;
  });
  const kind = (m: MediaItem) => (m.source.kind === 'adjust' ? 'adjust' : m.source.kind === 'file' && m.source.compound ? 'compound' : m.source.kind === 'file' && m.source.isImage ? 'image' : !m.hasVideo ? 'audio' : 'video');

  function dragMedia(e: DragEvent, m: MediaItem) {
    e.dataTransfer!.setData('application/x-moshpit-media', m.id);
    e.dataTransfer!.effectAllowed = 'copy';
  }
  function dragTransition(e: DragEvent, t: string) {
    e.dataTransfer!.setData('application/x-moshpit-transition', t);
    e.dataTransfer!.effectAllowed = 'copy';
  }
  function applyTransition(t: TransitionType) {
    if (store.ui.selectedTransition) setTransition(store.ui.selectedTransition, t);
    else transitionAtPlayhead(t);
  }
</script>

<div class="bin">
  <div class="tabs" role="tablist" aria-label="Library">
    <button role="tab" class:active={tab === 'media'} aria-selected={tab === 'media'} onclick={() => (tab = 'media')}>Media<span class="count mono">{store.project.media.length || ''}</span></button>
    <button role="tab" class:active={tab === 'transitions'} aria-selected={tab === 'transitions'} onclick={() => (tab = 'transitions')}>Transitions</button>
  </div>

  {#if tab === 'media'}
    <div class="actions">
      <button onclick={() => fileInput?.click()} title="Import video, image or sound files"><Icon name="import" />Import</button>
      <button onclick={() => (store.ui.dialog = 'record')} title="Record from camera or screen"><span class="rec"><Icon name="rec" size={12} /></span>Record</button>
      <button onclick={() => (store.ui.dialog = 'generate')} title="Generate a test clip"><Icon name="gen" />Generate</button>
      <button onclick={() => addAdjustmentLayer()} title="Adjustment layer: a clip on a track above that re-colours everything below it while it's on screen (colour, LUT, fades)"><Icon name="theme" />Adjust</button>
    </div>
    <input
      bind:this={fileInput}
      type="file"
      multiple
      accept="video/*,image/*,audio/*,.mkv,.avi,.mov,.gif,.mp3,.wav,.m4a,.flac,.ogg"
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

    <div class="list" role="list" aria-label="Media">
      {#each store.project.media as m (m.id)}
        {@const st = mediaState[m.id]}
        {@const k = kind(m)}
        <div class="item" class:picked={store.ui.selectedMedia === m.id} draggable="true" ondragstart={(e) => dragMedia(e, m)} role="listitem" title="Drag onto the timeline, double-click to add it at the end, or click to pick it for Insert / Overwrite (F9 / F10)">
          <button class="main" ondblclick={() => addToTimeline(m)} onclick={() => (store.ui.selectedMedia = store.ui.selectedMedia === m.id ? null : m.id)}>
            <span class="thumb" class:audio={k === 'audio'}>
              {#if m.thumb}<img src={m.thumb} alt="" draggable="false" />{:else}<Icon name={k === 'audio' ? 'music' : k === 'adjust' ? 'theme' : 'film'} />{/if}
              {#if uses.get(m.id)}<span class="used mono" title="Clips using this media">{uses.get(m.id)}</span>{/if}
            </span>
            <span class="meta">
              <span class="nm">{m.source.name}</span>
              <span class="sub mono">
                {#if k === 'adjust'}adjustment layer{:else if k === 'image'}still{:else}{#if k === 'compound'}compound · {/if}{tc(m.duration)}{/if}{#if m.hasVideo && m.width}&ensp;{m.width}×{m.height}{/if}{#if m.hasAudio}&ensp;♪{/if}{#if st?.proxy === 'ready'}&ensp;<span class="proxy" title="Previews use a smaller copy of this video, so they're quicker{st.proxyHw ? ' (made with your device’s hardware encoder)' : ''}. Exports always use the original.">proxy</span>{/if}
              </span>
              {#if st?.proxy === 'working' || st?.proxy === 'pending'}
                <span class="prep small"><span class="pbar"><span style="width:{Math.round((st.progress ?? 0) * 100)}%"></span></span>preview copy</span>
              {/if}
            </span>
          </button>
          <div class="ctl">
            <button class="icon ghost" title="Add to the timeline" aria-label="Add to timeline" onclick={() => addToTimeline(m)}><Icon name="plus" size={13} /></button>
            <button class="icon ghost" title="Remove from project" aria-label="Remove media" onclick={() => removeMedia(m.id)}><Icon name="x" size={13} /></button>
          </div>
        </div>
      {:else}
        <button class="empty" onclick={() => fileInput?.click()}>
          <span>Drop video, images or music here</span>
          <span class="faint small">mp4, mov, webm, mkv, avi, gif, png, jpg, mp3, wav</span>
        </button>
      {/each}
    </div>
    {#if picked}
      <div class="srcedit" role="toolbar" aria-label="Edit the picked clip into the timeline">
        <span class="small faint nm">{picked.source.name}</span>
        <div class="row">
          <button class="small" title="Insert at the playhead: the main track splits there and moves along  F9" onclick={() => insertEdit(picked)}>Insert</button>
          <button class="small" title="Overwrite from the playhead: replaces what's on the main track for the clip's length  F10" onclick={() => overwriteEdit(picked)}>Overwrite</button>
          <button class="small" title="Place on top: on a video track above, at the playhead (picture-in-picture, overlays)  F12" onclick={() => placeOnTop(picked)}>On top</button>
          <button class="small" title="Append at the end of the main track  Shift F12" onclick={() => appendEdit(picked)}>Append</button>
        </div>
      </div>
    {/if}
  {:else}
    <div class="list trans">
      <p class="small muted hint">Drag onto a cut in the video track, or click to apply to the selected cut (or the one nearest the playhead).</p>
      <div class="label sect">Mosh</div>
      <div class="grid">
        {#each Object.entries(MOSH_TRANSITIONS) as [id, t]}
          <button class="tr mosh" draggable="true" ondragstart={(e) => dragTransition(e, id)} onclick={() => applyTransition(id as TransitionType)} title={t.description}>
            <span class="sw mosh"></span>{t.name}
          </button>
        {/each}
      </div>
      <div class="label sect">Classic</div>
      <div class="grid">
        {#each Object.entries(BLEND_TRANSITIONS) as [id, t]}
          <button class="tr" draggable="true" ondragstart={(e) => dragTransition(e, id)} onclick={() => applyTransition(id as TransitionType)} title={t.description}>
            <span class="sw {id}"></span>{t.name}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .proxy {
    padding: 0 4px;
    border: 1px solid var(--line-2);
    border-radius: 3px;
    font-size: 10px;
    letter-spacing: 0.04em;
  }
  .bin {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tabs {
    display: flex;
    height: 32px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .tabs button {
    flex: 1;
    height: 100%;
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text-3);
    font-size: 12px;
  }
  .tabs button.active {
    color: var(--text);
    box-shadow: inset 0 -1px 0 var(--text);
  }
  .count {
    font-size: 10px;
    color: var(--text-3);
    margin-left: 4px;
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
    min-width: 0;
    overflow: hidden;
  }
  @media (max-width: 1100px) and (min-width: 861px) {
    .actions :global(svg) {
      display: none;
    }
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
  .item {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--line);
    cursor: grab;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .main {
    flex: 1;
    min-width: 0;
    height: auto;
    background: none;
    border: none;
    border-radius: 0;
    padding: 7px 4px 7px 10px;
    justify-content: flex-start;
    gap: 10px;
    text-align: left;
    cursor: grab;
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
    display: grid;
    place-items: center;
    color: var(--text-3);
  }
  .thumb.audio {
    color: #7fd39b;
    background: color-mix(in srgb, #4fa06a 18%, var(--bg));
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .used {
    position: absolute;
    right: 0;
    bottom: 0;
    font-size: 10px;
    background: var(--accent);
    color: var(--accent-ink);
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
    /* (buttons don't wrap): in a narrow panel the size and "proxy" go on a second line, not off the edge */
    white-space: normal;
  }
  .prep {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-3);
    font-size: 10px;
  }
  .pbar {
    width: 40px;
    height: 2px;
    background: var(--line-2);
    display: block;
  }
  .pbar span {
    display: block;
    height: 100%;
    background: var(--text-2);
  }
  .ctl {
    display: flex;
    flex-direction: column;
    padding-right: 4px;
    opacity: 0;
  }
  .item:hover .ctl,
  .item:focus-within .ctl {
    opacity: 1;
  }
  .ctl button {
    height: 18px;
    width: 22px;
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
  .trans {
    padding: 10px;
  }
  .hint {
    margin: 0 0 6px;
    line-height: 1.4;
  }
  .sect {
    margin: 12px 0 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .tr {
    justify-content: flex-start;
    gap: 7px;
    font-size: 12px;
    cursor: grab;
    padding: 0 6px;
  }
  .sw {
    width: 18px;
    height: 12px;
    flex: none;
    border-radius: 2px;
    background: linear-gradient(90deg, #555 0 50%, #bbb 50%);
  }
  .sw.mosh {
    background: linear-gradient(90deg, #555, var(--accent), #bbb);
  }
  .sw.dissolve {
    background: linear-gradient(90deg, #555, #bbb);
  }
  .sw.dip {
    background: linear-gradient(90deg, #555, #000, #bbb);
  }
  .sw.dipwhite {
    background: linear-gradient(90deg, #555, #fff, #bbb);
  }
  .sw.circleopen {
    background: radial-gradient(circle, #bbb 40%, #555 42%);
  }
  .sw.pixelize {
    background: repeating-conic-gradient(#555 0 25%, #bbb 0 50%) 0 0 / 6px 6px;
  }
  .sw.wipeup,
  .sw.wipedown {
    background: linear-gradient(180deg, #555 0 50%, #bbb 50%);
  }
  @media (hover: none) {
    .ctl {
      opacity: 1;
    }
  }
  /* big enough to hit with a finger */
  @media (pointer: coarse) {
    .ctl {
      flex-direction: row;
      gap: 2px;
    }
    .ctl button {
      height: 36px;
      width: 36px;
    }
  }
  .item.picked {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .srcedit {
    border-top: 1px solid var(--line);
    padding: 6px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: none;
  }
  .srcedit .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .srcedit .row {
    gap: 4px;
    flex-wrap: wrap;
  }
  .srcedit button {
    flex: 1;
    padding: 0 6px;
  }
</style>
