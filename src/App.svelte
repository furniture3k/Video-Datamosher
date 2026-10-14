<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from './lib/store.svelte';
  import { ffmpeg } from './lib/ffmpeg';
  import { addFiles } from './lib/media';
  import { chaos, mutate } from './engine/presets';
  import { randomSeed } from './engine/rng';
  import TopBar from './components/TopBar.svelte';
  import MediaBin from './components/MediaBin.svelte';
  import Player from './components/Player.svelte';
  import Timeline from './components/Timeline.svelte';
  import Inspector from './components/Inspector.svelte';
  import Toasts from './components/Toasts.svelte';
  import PresetsDialog from './dialogs/PresetsDialog.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import VariationsDialog from './dialogs/VariationsDialog.svelte';
  import HelpDialog from './dialogs/HelpDialog.svelte';
  import ShareDialog from './dialogs/ShareDialog.svelte';
  import AddEffectDialog from './dialogs/AddEffectDialog.svelte';
  import GenerateDialog from './dialogs/GenerateDialog.svelte';
  import RecordDialog from './dialogs/RecordDialog.svelte';
  import LiveMode from './dialogs/LiveMode.svelte';
  import { saveProjectFile } from './lib/projectio.svelte';
  import { localSet } from './lib/storage';
  import * as edit from './lib/edit';

  let dragging = $state(false);

  onMount(() => {
    ffmpeg.onStatus = (s) => (store.status.engine = s);
    store.restore();
    ffmpeg.warmup().catch((e) => (store.status.error = 'Could not load the video engine: ' + e.message));
  });

  $effect(() => {
    document.documentElement.dataset.theme = store.ui.theme;
  });

  function inField(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!t) return false;
    // switches/checkboxes keep focus after a click; only Space should go to them
    if (t.tagName === 'INPUT' && ['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)) return e.key === ' ';
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }

  function runChaos() {
    if (!store.project.clips.length) return store.toast('Add a clip first.');
    store.set(chaos($state.snapshot(store.project) as never, store.totalFrames, randomSeed(), store.ui.chaosIntensity));
    
  }
  function runMutate() {
    if (!store.project.effects.length) return store.toast('Nothing to nudge yet. Add an effect first.');
    store.set(mutate($state.snapshot(store.project) as never, store.totalFrames, 0.25));
  }

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProjectFile();
      return;
    }
    if (inField(e)) return;
    if (mod && !store.ui.dialog) {
      const k = e.key.toLowerCase();
      if (k === 'c' && edit.copySelected()) e.preventDefault();
      else if (k === 'v' && edit.paste()) e.preventDefault();
      else if (k === 'x' && edit.copySelected()) (e.preventDefault(), edit.deleteSelected());
      else if (k === 'k') (e.preventDefault(), edit.splitAtPlayhead());
      else if (k === 'd' && edit.duplicateSelected()) e.preventDefault();
      return;
    }
    if (mod || e.altKey) return;
    if (store.ui.dialog === 'live') return;
    if (e.key === 'Escape') {
      if (store.ui.dialog) store.ui.dialog = null;
      else if (store.ui.selectedClips.length || store.ui.selectedTransition) {
        store.ui.selectedClips = [];
        store.ui.selectedTransition = null;
      } else if (store.ui.welcome) {
        store.ui.welcome = false;
        localSet('seenWelcome', true);
      }
      return;
    }
    if (store.ui.dialog || store.ui.welcome) return;
    const n = store.render?.frames.length ?? 0;
    const step = e.shiftKey ? 10 : 1;
    const mosh = store.showingMosh;
    const stepBy = (d: number) => {
      store.ui.playing = false;
      if (mosh) store.seekFrame(store.ui.playhead + d);
      else store.seek(store.ui.time + d / store.project.encoder.fps);
    };
    switch (e.key) {
      case ' ':
        e.preventDefault();
        store.ui.playing = !store.ui.playing;
        break;
      case 'ArrowRight':
        e.preventDefault();
        stepBy(step);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        stepBy(-step);
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        // jump to the previous / next cut
        e.preventDefault();
        const edges = [0, ...store.cuts.map((c) => c / store.project.encoder.fps), store.duration];
        const t = store.ui.time;
        const to = e.key === 'ArrowDown' ? edges.find((x) => x > t + 1e-3) : [...edges].reverse().find((x) => x < t - 1e-3);
        if (to !== undefined) store.seek(to);
        break;
      }
      case 'Home':
        if (mosh) store.seekFrame(0);
        else store.seek(0);
        break;
      case 'End':
        if (mosh) store.seekFrame(n - 1);
        else store.seek(store.duration);
        break;
      case 's':
        edit.splitAtPlayhead();
        break;
      case 't':
        edit.transitionAtPlayhead('melt');
        break;
      case 'n':
        store.ui.snap = !store.ui.snap;
        break;
      case '=':
      case '+':
        edit.zoom(1.5);
        break;
      case '-':
        edit.zoom(1 / 1.5);
        break;
      case '\\':
        edit.zoomFit();
        break;
      case 'i':
        store.ui.loop = [store.ui.playhead, Math.max(store.ui.playhead + 1, store.ui.loop?.[1] ?? n)];
        break;
      case 'o':
        store.ui.loop = [Math.min(store.ui.loop?.[0] ?? 0, store.ui.playhead), store.ui.playhead + 1];
        break;
      case 'l':
        store.ui.loopOn = !store.ui.loopOn;
        break;
      case 'x':
        store.ui.loop = null;
        break;
      case 'r':
        runChaos();
        break;
      case 'm':
        runMutate();
        break;
      case 'c':
        store.ui.compare = store.ui.compare === 'off' ? 'split' : 'off';
        break;
      case 'e':
        if (store.project.clips.length || store.project.texts.length) store.ui.dialog = 'export';
        break;
      case 'p':
        store.ui.dialog = 'presets';
        break;
      case 'a':
        store.ui.dialog = 'addEffect';
        break;
      case 'v':
        if (store.project.clips.length) store.ui.dialog = 'variations';
        break;
      case 'k': {
        const src = store.playFrame;
        store.edit((p) => {
          const m = p.encoder.keyMarkers;
          const i = m.indexOf(src);
          if (i >= 0) m.splice(i, 1);
          else m.push(src);
        });
        break;
      }
      case 'd':
        if (!edit.duplicateSelected() && store.ui.selectedEffect) store.duplicateEffect(store.ui.selectedEffect);
        break;
      case 'Delete':
      case 'Backspace':
        if (!edit.deleteSelected() && store.ui.selectedEffect) store.removeEffect(store.ui.selectedEffect);
        break;
      case '?':
        store.ui.dialog = 'help';
        break;
      case 'Enter':
        store.doRender(true);
        break;
    }
  }

  function resizeDown(e: PointerEvent) {
    const y0 = e.clientY;
    const h0 = store.ui.timelineHeight;
    const move = (ev: PointerEvent) => (store.ui.timelineHeight = Math.max(150, Math.min(window.innerHeight - 220, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      store.setPref('timelineHeight', store.ui.timelineHeight);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="app"
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragging = true;
    }
  }}
  ondragleave={(e) => {
    if (e.relatedTarget === null) dragging = false;
  }}
  ondrop={onDrop}
>
  <TopBar onchaos={runChaos} onmutate={runMutate} />
  <main>
    <aside class="left" class:mshow={store.ui.mobilePanel === 'media'}><MediaBin /></aside>
    <section class="center"><Player /></section>
    <aside class="right" class:mshow={store.ui.mobilePanel === 'inspector'}><Inspector /></aside>
  </main>
  <nav class="mtabs" aria-label="Panels">
    {#each [['timeline', 'Timeline'], ['media', 'Media'], ['inspector', 'Inspector']] as [id, label]}
      <button class:on={store.ui.mobilePanel === id} onclick={() => (store.ui.mobilePanel = id as never)}>
        {label}{#if id === 'inspector' && (store.ui.selectedClips.length || store.ui.selectedTransition || store.ui.selectedEffect)}<span class="dot"></span>{/if}
      </button>
    {/each}
  </nav>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resizer" title="Drag to resize the timeline" onpointerdown={resizeDown}></div>
  <footer class:mshow={store.ui.mobilePanel === 'timeline'} style="--tlh:{store.ui.timelineHeight}px"><Timeline /></footer>

  {#if dragging}
    <div class="dropzone"><div class="label">Drop to import</div></div>
  {/if}
</div>

{#if store.ui.dialog === 'presets'}<PresetsDialog />{/if}
{#if store.ui.dialog === 'export'}<ExportDialog />{/if}
{#if store.ui.dialog === 'variations'}<VariationsDialog />{/if}
{#if store.ui.dialog === 'help'}<HelpDialog />{/if}
{#if store.ui.dialog === 'share'}<ShareDialog />{/if}
{#if store.ui.dialog === 'addEffect'}<AddEffectDialog />{/if}
{#if store.ui.dialog === 'generate'}<GenerateDialog />{/if}
{#if store.ui.dialog === 'record'}<RecordDialog />{/if}
{#if store.ui.dialog === 'live'}<LiveMode />{/if}
<Toasts />

<style>
  /* panels butt against each other with 1px hairlines, like an editing suite */
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    overflow: hidden;
    background: var(--line);
    position: relative;
  }
  main {
    display: grid;
    grid-template-columns: 260px 1fr 330px;
    min-height: 0;
    gap: 1px;
    border-top: 1px solid var(--line);
  }
  .resizer {
    height: 5px;
    cursor: ns-resize;
    background: var(--line);
    border-top: 1px solid var(--line);
  }
  .resizer:hover {
    background: var(--line-2);
  }
  aside,
  section,
  footer {
    min-height: 0;
    min-width: 0;
    background: var(--surface);
  }
  .dropzone {
    position: absolute;
    inset: 0;
    background: rgba(12, 12, 12, 0.72);
    outline: 1px solid var(--accent);
    outline-offset: -12px;
    display: grid;
    place-items: center;
    z-index: 50;
    pointer-events: none;
  }
  .dropzone .label {
    color: var(--accent);
    font-size: 13px;
  }
  @media (max-width: 1100px) {
    main {
      grid-template-columns: 220px 1fr 300px;
    }
  }
  footer {
    height: var(--tlh);
  }
  .mtabs {
    display: none;
  }
  /* Phones: player on top, then one panel at a time (timeline / media / inspector) filling the rest */
  @media (max-width: 860px), (max-height: 500px) and (pointer: coarse) {
    .app {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    main {
      display: contents;
    }
    .center {
      order: 1;
      flex: none;
    }
    .mtabs {
      order: 2;
      display: flex;
      flex: none;
      height: 38px;
      background: var(--surface);
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
    }
    .mtabs button {
      flex: 1;
      height: 100%;
      border: none;
      border-radius: 0;
      background: none;
      color: var(--text-3);
      font-size: 13px;
      gap: 5px;
    }
    .mtabs button.on {
      color: var(--text);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
    }
    .left,
    .right,
    footer {
      order: 3;
      display: none;
      flex: 1;
      min-height: 0;
      height: auto;
    }
    .left.mshow,
    .right.mshow,
    footer.mshow {
      display: block;
    }
    .resizer {
      display: none;
    }
  }
  /* Phones held sideways: player on the left, panels on the right */
  @media (max-height: 500px) and (orientation: landscape) and (pointer: coarse) {
    .app {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: auto auto minmax(0, 1fr);
    }
    :global(header) {
      grid-column: 1 / -1;
    }
    .center {
      grid-column: 1;
      grid-row: 2 / 4;
      min-height: 0;
      overflow: auto;
    }
    .mtabs {
      grid-column: 2;
      grid-row: 2;
    }
    .left,
    .right,
    footer {
      grid-column: 2;
      grid-row: 3;
    }
  }
</style>
