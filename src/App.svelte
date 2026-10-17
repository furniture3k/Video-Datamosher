<script lang="ts">
  import { layout, keep, togglePanel, PANEL } from './lib/layout.svelte';
  import { onMount } from 'svelte';
  import { store } from './lib/store.svelte';
  import { ffmpeg } from './lib/ffmpeg';
  import TopBar from './components/TopBar.svelte';
  import MediaBin from './components/MediaBin.svelte';
  import Player from './components/Player.svelte';
  import Timeline from './components/Timeline.svelte';
  import Inspector from './components/Inspector.svelte';
  import Toasts from './components/Toasts.svelte';
  import ExportQueue from './components/ExportQueue.svelte';
  import PresetsDialog from './dialogs/PresetsDialog.svelte';
  import SnapshotsDialog from './dialogs/SnapshotsDialog.svelte';
  import BeatEditDialog from './dialogs/BeatEditDialog.svelte';
  import BakeDialog from './dialogs/BakeDialog.svelte';
  import CompoundDialog from './dialogs/CompoundDialog.svelte';
  import CaptionsDialog from './dialogs/CaptionsDialog.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import VariationsDialog from './dialogs/VariationsDialog.svelte';
  import HelpDialog from './dialogs/HelpDialog.svelte';
  import ShareDialog from './dialogs/ShareDialog.svelte';
  import BatchDialog from './dialogs/BatchDialog.svelte';
  import ScriptConsent from './dialogs/ScriptConsent.svelte';
  import AddEffectDialog from './dialogs/AddEffectDialog.svelte';
  import GenerateDialog from './dialogs/GenerateDialog.svelte';
  import RecordDialog from './dialogs/RecordDialog.svelte';
  import LiveMode from './dialogs/LiveMode.svelte';
  import MobileEditor from './mobile/MobileEditor.svelte';
  import StorageDialog from './dialogs/StorageDialog.svelte';
  import WhatsNewDialog, { checkWhatsNew } from './dialogs/WhatsNewDialog.svelte';
  import { crashedSession } from './lib/recovery';
  import { collectEngineLog } from './lib/report';
  import { listenForIncoming, openFiles } from './lib/incoming';
  import Home from './home/Home.svelte';
  import { refreshThumb } from './lib/projects.svelte';
  import { hasContent, loadIndex } from './lib/projectindex';
  import { localGet, localSet } from './lib/storage';
  import Tour from './components/Tour.svelte';
  import CommandPalette from './dialogs/CommandPalette.svelte';
  import HistoryDialog from './dialogs/HistoryDialog.svelte';
  import { runKey, runChaos, runMutate } from './lib/commands.svelte';

  let dragging = $state(false);
  /** the saved project has been loaded (the tour waits for this) */
  let ready = $state(false);
  // the first time the editor shows, a short tour of it
  $effect(() => {
    if (ready && !store.ui.home && !store.ui.dialog && !store.ui.welcome && !localGet('seenWelcome', false)) store.ui.welcome = true;
  });
  // phones (and small tablets held either way) get the mobile editor
  const PHONE = '(max-width: 860px), (max-height: 500px) and (pointer: coarse)';
  const mq = typeof matchMedia !== 'undefined' ? matchMedia(PHONE) : null;
  let phone = $state(!!mq?.matches);
  onMount(() => {
    const on = () => (phone = !!mq?.matches);
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  });

  onMount(() => {
    ffmpeg.onStatus = (s) => (store.status.engine = s);
    collectEngineLog();
    // the last session died in the middle of a render or export (usually out of memory):
    // start with auto-render paused so the same mosh doesn't take the tab down again
    const crashed = crashedSession();
    if (crashed) store.ui.autoRender = false;
    store.restore(!crashed).then(async () => {
      ready = true;
      const saved = (await loadIndex()).length > 0;
      // the home screen first, unless the last project should open straight away (and there is one)
      store.ui.home = store.ui.startHome || (!hasContent(store.project) && saved);
      listenForIncoming();
      const updated = checkWhatsNew(saved || hasContent(store.project));
      if (crashed)
        store.toast(
          `moshpit closed while it was ${crashed.kind === 'export' ? 'exporting' : 'rendering'}, maybe because it ran out of memory. Auto-render is paused: try a lower preview resolution or fewer repeats, or restore a snapshot.`,
          'error',
          20000,
          { label: 'Resume auto-render', run: () => store.setPref('autoRender', true) },
        );
      else if (updated && !store.ui.dialog) store.ui.dialog = 'whatsnew';
    });
    ffmpeg.warmup().catch((e) => (store.status.error = 'Could not load the video engine: ' + e.message));
    // keep the open project's picture on the home screen current
    const thumbs = window.setInterval(() => !store.ui.home && !document.hidden && refreshThumb(), 20000);
    return () => clearInterval(thumbs);
  });

  $effect(() => {
    document.documentElement.dataset.theme = store.ui.theme;
  });

  function inField(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!t) return false;
    // switches/checkboxes keep focus after a click; only Space should go to them
    if (t.tagName === 'INPUT' && ['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)) return e.key === ' ';
    // a slider keeps focus after a drag: only the keys that move it go to it, the rest are shortcuts
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range') return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key);
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'color') return e.key === ' ' || e.key === 'Enter';
    // a button reached with the keyboard (Tab) is pressed with Enter, not Render
    // (after a mouse click it isn't :focus-visible; Space always plays, as in other editors)
    if (t.matches?.('button, a[href], summary, [role=button]') && e.key === 'Enter') {
      try {
        return t.matches(':focus-visible');
      } catch {
        return false;
      }
    }
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }




  /** Escape with the focus outside the dialog: an open Modal closes itself (through its onclose), so hand it the key. */
  function closeDialog() {
    const modal = document.querySelector('.modal[role=dialog]');
    if (modal) modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    else store.ui.dialog = null;
  }
  function onKey(e: KeyboardEvent) {
    // the home screen has no editor: only Escape (closing a dialog) applies
    if (store.ui.home) {
      if (e.key === 'Escape' && store.ui.dialog && !inField(e)) closeDialog();
      return;
    }
    const typing = inField(e);
    // Live mode has its own keys (Escape leaves it); only undo, save and the like reach the editor
    if (store.ui.dialog === 'live') {
      if (runKey(e, typing, true)) e.preventDefault();
      return;
    }
    if (e.key === 'Escape' && !typing && !(e.ctrlKey || e.metaKey || e.altKey)) {
      if (store.ui.trackPick || store.ui.eyedropper || store.ui.paintEffect) ((store.ui.trackPick = null), (store.ui.eyedropper = false), (store.ui.paintEffect = null));
      else if (store.ui.dialog) closeDialog();
      else if (store.ui.tool !== 'select') store.ui.tool = 'select';
      else if (store.ui.selectedClips.length || store.ui.selectedTransition) {
        store.ui.selectedClips = [];
        store.ui.selectedTransition = null;
      } else if (store.ui.welcome) {
        store.ui.welcome = false;
        localSet('seenWelcome', true);
      }
      return;
    }
    // everything else is a command (Help → Keyboard shortcuts changes which keys run which)
    if (runKey(e, typing, !!store.ui.dialog || store.ui.welcome)) e.preventDefault();
  }
  function resizeDown(e: PointerEvent) {
    const y0 = e.clientY;
    // from the height shown (the saved one can be taller than this window allows)
    const h0 = Math.max(150, Math.min(store.ui.timelineHeight, window.innerHeight - 220));
    const move = (ev: PointerEvent) => (store.ui.timelineHeight = Math.max(150, Math.min(window.innerHeight - 220, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      layout.timeline = store.ui.timelineHeight;
      keep();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Drag a side panel's edge to resize it (a click without moving folds it away or back). */
  function panelDown(e: PointerEvent, side: 'left' | 'right') {
    if ((e.target as HTMLElement).closest('button')) return;
    const x0 = e.clientX;
    const w0 = side === 'left' ? layout.left : layout.right;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      if (side === 'left') (layout.leftOpen = true), (layout.left = Math.max(PANEL.min, Math.min(PANEL.max, w0 + dx)));
      else (layout.rightOpen = true), (layout.right = Math.max(PANEL.min, Math.min(PANEL.max, w0 - dx)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved && ev.type === 'pointerup') togglePanel(side);
      else keep();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) openFiles([...e.dataTransfer.files]);
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="app"
  class:phone
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
  {#if store.ui.home}
    <Home />
  {:else if phone}
    <MobileEditor onchaos={runChaos} />
  {:else}
    <TopBar onchaos={runChaos} onmutate={runMutate} />
    <main style="--left:{layout.leftOpen ? layout.left + 'px' : '0px'};--right:{layout.rightOpen ? layout.right + 'px' : '0px'}">
      <aside class="left" data-tour="media" hidden={!layout.leftOpen}><MediaBin /></aside>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="colsize cl" title="Drag to resize the media panel" onpointerdown={(e) => panelDown(e, 'left')}>
        <button class="fold" aria-label={layout.leftOpen ? 'Fold away the media panel' : 'Show the media panel'} aria-expanded={layout.leftOpen} title={layout.leftOpen ? 'Fold away the media panel' : 'Show the media panel'} onclick={() => togglePanel('left')}>{layout.leftOpen ? '‹' : '›'}</button>
      </div>
      <section class="center"><Player /></section>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="colsize cr" title="Drag to resize the inspector" onpointerdown={(e) => panelDown(e, 'right')}>
        <button class="fold" aria-label={layout.rightOpen ? 'Fold away the inspector' : 'Show the inspector'} aria-expanded={layout.rightOpen} title={layout.rightOpen ? 'Fold away the inspector' : 'Show the inspector'} onclick={() => togglePanel('right')}>{layout.rightOpen ? '›' : '‹'}</button>
      </div>
      <aside class="right" hidden={!layout.rightOpen}><Inspector /></aside>
    </main>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resizer" title="Drag to resize the timeline" onpointerdown={resizeDown}></div>
    <footer data-tour="timeline" style="--tlh:{store.ui.timelineHeight}px"><Timeline /></footer>
  {/if}

  {#if dragging}
    <div class="dropzone"><div class="label">Drop to add to your project</div></div>
  {/if}
</div>

{#if store.ui.dialog === 'presets'}<PresetsDialog />{/if}
{#if store.ui.dialog === 'snapshots'}<SnapshotsDialog />{/if}
{#if store.ui.dialog === 'beatEdit'}<BeatEditDialog />{/if}
{#if store.ui.dialog === 'bake'}<BakeDialog />{/if}
{#if store.ui.dialog === 'compound'}<CompoundDialog />{/if}
{#if store.ui.dialog === 'captions'}<CaptionsDialog />{/if}
{#if store.ui.dialog === 'export'}<ExportDialog />{/if}
{#if store.ui.dialog === 'variations'}<VariationsDialog />{/if}
{#if store.ui.dialog === 'help'}<HelpDialog />{/if}
{#if store.ui.dialog === 'share'}<ShareDialog />{/if}
{#if store.ui.dialog === 'batch'}<BatchDialog />{/if}
{#if store.ui.dialog === 'addEffect'}<AddEffectDialog />{/if}
{#if store.ui.dialog === 'generate'}<GenerateDialog />{/if}
{#if store.ui.dialog === 'record'}<RecordDialog />{/if}
{#if store.ui.dialog === 'live'}<LiveMode />{/if}
{#if store.ui.dialog === 'storage'}<StorageDialog />{/if}
{#if store.ui.dialog === 'whatsnew'}<WhatsNewDialog />{/if}
{#if store.ui.dialog === 'palette' && !store.ui.home}<CommandPalette />{/if}
{#if store.ui.dialog === 'history'}<HistoryDialog />{/if}
{#if store.ui.welcome && !store.ui.home}<Tour {phone} />{/if}
<ScriptConsent />
<ExportQueue />
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
    grid-template-columns: var(--left) 6px minmax(0, 1fr) 6px var(--right);
    min-height: 0;
    gap: 0;
    border-top: 1px solid var(--line);
  }
  aside[hidden] {
    display: none;
  }
  /* each part in its own column, so a folded panel doesn't shift the others */
  main > .left {
    grid-column: 1;
  }
  main > .cl {
    grid-column: 2;
  }
  main > .center {
    grid-column: 3;
  }
  main > .cr {
    grid-column: 4;
  }
  main > .right {
    grid-column: 5;
  }
  /* the edges between the panels: drag to resize, the arrow folds a panel away */
  .colsize {
    position: relative;
    cursor: ew-resize;
    touch-action: none;
    background: var(--line);
  }
  .colsize:hover {
    background: var(--line-2);
  }
  .fold {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 14px;
    height: 36px;
    padding: 0;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    color: var(--text-2);
    opacity: 0;
    z-index: 2;
  }
  .colsize:hover .fold,
  .fold:focus-visible,
  main:has(aside[hidden]) .fold {
    opacity: 1;
  }
  @media (hover: none) {
    .fold {
      opacity: 1;
    }
  }
  .resizer {
    height: 5px;
    cursor: ns-resize;
    touch-action: none;
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
    background: rgba(11, 11, 13, 0.78);
    outline: 2px dashed var(--accent);
    outline-offset: -14px;
    border-radius: 24px;
    display: grid;
    place-items: center;
    z-index: 50;
    pointer-events: none;
  }
  .dropzone .label {
    color: var(--accent);
    font-size: 18px;
    font-weight: 650;
    letter-spacing: normal;
    text-transform: none;
  }
  @media (max-width: 1100px) {
    main {
      grid-template-columns: min(var(--left), 220px) 6px minmax(0, 1fr) 6px min(var(--right), 300px);
    }
  }
  footer {
    /* a height dragged on a taller window still leaves the player room on a shorter one */
    height: max(150px, min(var(--tlh), 100vh - 220px));
  }
  .app.phone {
    display: block;
  }
</style>
