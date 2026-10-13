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
  import Welcome from './dialogs/Welcome.svelte';
  import { saveProjectFile } from './lib/projectio.svelte';
  import { localSet } from './lib/storage';

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
    if (!store.project.clips.length) return store.toast('Add a clip first, then roll the dice.');
    store.set(chaos($state.snapshot(store.project) as never, store.totalFrames, randomSeed(), store.ui.chaosIntensity));
    store.toast('🎲 New random mosh rolled. Lock settings you like, then roll again.');
  }
  function runMutate() {
    if (!store.project.effects.length) return store.toast('Nothing to mutate yet. Add an effect or roll Chaos first.');
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
    if (inField(e) || mod || e.altKey) return;
    if (store.ui.dialog === 'live') return;
    if (e.key === 'Escape') {
      if (store.ui.dialog) store.ui.dialog = null;
      else if (store.ui.welcome) {
        store.ui.welcome = false;
        localSet('seenWelcome', true);
      }
      return;
    }
    if (store.ui.dialog || store.ui.welcome) return;
    const n = store.render?.frames.length ?? 0;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        store.ui.playing = !store.ui.playing;
        break;
      case 'ArrowRight':
        e.preventDefault();
        store.ui.playing = false;
        store.ui.playhead = Math.min(n - 1, store.ui.playhead + step);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        store.ui.playing = false;
        store.ui.playhead = Math.max(0, store.ui.playhead - step);
        break;
      case 'Home':
        store.ui.playhead = 0;
        break;
      case 'End':
        store.ui.playhead = Math.max(0, n - 1);
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
        if (store.project.clips.length) store.ui.dialog = 'export';
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
        const src = store.render?.frames[store.ui.playhead]?.src ?? 0;
        store.edit((p) => {
          const m = p.encoder.keyMarkers;
          const i = m.indexOf(src);
          if (i >= 0) m.splice(i, 1);
          else m.push(src);
        });
        break;
      }
      case 'd':
        if (store.ui.selectedEffect) store.duplicateEffect(store.ui.selectedEffect);
        break;
      case 'Delete':
      case 'Backspace':
        if (store.ui.selectedEffect) store.removeEffect(store.ui.selectedEffect);
        break;
      case '?':
        store.ui.dialog = 'help';
        break;
      case 'Enter':
        store.doRender(true);
        break;
    }
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
    <aside class="left"><MediaBin /></aside>
    <section class="center"><Player /></section>
    <aside class="right"><Inspector /></aside>
  </main>
  <footer><Timeline /></footer>

  {#if dragging}
    <div class="dropzone"><div>Drop videos or images to add them</div></div>
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
{#if store.ui.welcome}<Welcome />{/if}
<Toasts />

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr auto;
    position: relative;
  }
  main {
    display: grid;
    grid-template-columns: 270px 1fr 360px;
    min-height: 0;
    gap: 8px;
    padding: 0 8px;
  }
  aside,
  section {
    min-height: 0;
    min-width: 0;
  }
  footer {
    padding: 8px;
  }
  .dropzone {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border: 3px dashed var(--accent);
    display: grid;
    place-items: center;
    font-size: 26px;
    font-weight: 700;
    z-index: 50;
    pointer-events: none;
  }
  @media (max-width: 1100px) {
    main {
      grid-template-columns: 230px 1fr 320px;
    }
  }
  @media (max-width: 860px) {
    :global(html),
    :global(body) {
      overflow: auto;
    }
    .app {
      height: auto;
      min-height: 100%;
      display: flex;
      flex-direction: column;
    }
    main {
      display: flex;
      flex-direction: column;
      padding: 0 16px;
    }
    footer {
      padding: 8px 16px;
    }
    .center {
      order: -1;
      height: 62vw;
      min-height: 280px;
    }
    .right {
      height: 75vh;
    }
    .left {
      max-height: 60vh;
    }
  }
</style>
