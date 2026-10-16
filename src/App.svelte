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
  import SnapshotsDialog from './dialogs/SnapshotsDialog.svelte';
  import BeatEditDialog from './dialogs/BeatEditDialog.svelte';
  import BakeDialog from './dialogs/BakeDialog.svelte';
  import CompoundDialog from './dialogs/CompoundDialog.svelte';
  import CaptionsDialog from './dialogs/CaptionsDialog.svelte';
  import { takeSnapshot } from './lib/snapshots.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import VariationsDialog from './dialogs/VariationsDialog.svelte';
  import HelpDialog from './dialogs/HelpDialog.svelte';
  import ShareDialog from './dialogs/ShareDialog.svelte';
  import AddEffectDialog from './dialogs/AddEffectDialog.svelte';
  import GenerateDialog from './dialogs/GenerateDialog.svelte';
  import RecordDialog from './dialogs/RecordDialog.svelte';
  import LiveMode from './dialogs/LiveMode.svelte';
  import MobileEditor from './mobile/MobileEditor.svelte';
  import { saveProjectFile } from './lib/projectio.svelte';
  import { localSet } from './lib/storage';
  import * as edit from './lib/edit';

  let dragging = $state(false);
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
    if (store.project.effects.length) takeSnapshot('Before Randomize', true);
    store.set(chaos($state.snapshot(store.project) as never, store.totalFrames, randomSeed(), store.ui.chaosIntensity));
    
  }
  function runMutate() {
    if (!store.project.effects.length) return store.toast('Nothing to nudge yet. Add an effect first.');
    store.set(mutate($state.snapshot(store.project) as never, store.totalFrames, 0.25));
  }

  /** J / K / L shuttle: each press of L (or J) doubles the speed in that direction, K stops. */
  function shuttle(dir: 1 | -1) {
    const s = store.ui.shuttle;
    store.ui.shuttle = store.ui.playing && Math.sign(s) === dir ? Math.max(-16, Math.min(16, s * 2)) : dir;
    store.ui.playing = true;
  }

  const media = () => store.project.media.find((m) => m.id === store.ui.selectedMedia) ?? null;
  function sourceEdit(fn: (m: NonNullable<ReturnType<typeof media>>) => void) {
    const m = media();
    if (!m) return store.toast('Pick a clip in the Media panel first (click it).');
    fn(m);
  }

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod && k === 's') {
      e.preventDefault();
      if (e.shiftKey) takeSnapshot().then((s) => store.toast(s ? `Saved ${s.name}.` : 'Nothing to save yet.', s ? 'ok' : 'error'));
      else saveProjectFile();
      return;
    }
    if (inField(e)) return;
    if (store.ui.dialog === 'live') return;
    if (mod && !store.ui.dialog) {
      if (k === 'c' && edit.copySelected()) e.preventDefault();
      else if (k === 'v' && edit.paste()) e.preventDefault();
      else if (k === 'x' && edit.copySelected()) (e.preventDefault(), edit.deleteSelected());
      else if (k === 'k' || k === 'b' || k === '\\') (e.preventDefault(), edit.splitAtPlayhead());
      else if (k === 'd' && edit.duplicateSelected()) e.preventDefault();
      else if (k === 't') (e.preventDefault(), edit.transitionAtPlayhead('melt'));
      else if (k === 'a') (e.preventDefault(), (store.ui.selectedClips = [...store.project.clips.filter((c) => !edit.lockedTrack(c.track)).map((c) => c.id), ...store.project.texts.map((t) => t.id)]));
      else if (k === '=' || k === '+') (e.preventDefault(), edit.zoom(1.5));
      else if (k === '-') (e.preventDefault(), edit.zoom(1 / 1.5));
      return;
    }
    if (e.altKey && !store.ui.dialog) {
      // e.code: Alt changes e.key on macOS
      const c = e.code;
      if (c === 'KeyX') (e.preventDefault(), edit.markIn(null), edit.markOut(null));
      else if (c === 'KeyI') (e.preventDefault(), edit.markIn(null));
      else if (c === 'KeyO') (e.preventDefault(), edit.markOut(null));
      else if (c === 'KeyT') (e.preventDefault(), edit.transitionAtPlayhead('dissolve'));
      return;
    }
    if (mod) return;
    if (e.key === 'Escape') {
      if (store.ui.trackPick || store.ui.eyedropper || store.ui.paintEffect) ((store.ui.trackPick = null), (store.ui.eyedropper = false), (store.ui.paintEffect = null));
      else if (store.ui.dialog) store.ui.dialog = null;
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
    if (store.ui.dialog || store.ui.welcome) return;
    const fps = store.project.encoder.fps;
    const stepBy = (frames: number) => {
      store.ui.playing = false;
      store.seek(Math.round(store.ui.time * fps + frames) / fps);
    };
    const sh = e.shiftKey;
    switch (k) {
      case ' ':
        e.preventDefault();
        store.ui.shuttle = 1;
        store.ui.playing = !store.ui.playing;
        break;
      case 'l':
        shuttle(1);
        break;
      case 'j':
        shuttle(-1);
        break;
      case 'k':
        if (sh) {
          // force a clean keyframe here
          const src = store.playFrame;
          store.edit((p) => {
            const m = p.encoder.keyMarkers;
            const i = m.indexOf(src);
            if (i >= 0) m.splice(i, 1);
            else m.push(src);
          });
        } else {
          store.ui.playing = false;
          store.ui.shuttle = 1;
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        stepBy(sh ? fps : 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        stepBy(sh ? -fps : -1);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        store.ui.playing = false;
        if (sh) edit.jumpMarker(k === 'ArrowDown' ? 1 : -1);
        else edit.jumpEdit(k === 'ArrowDown' ? 1 : -1);
        break;
      case 'Home':
        store.ui.playing = false;
        store.seek(0);
        break;
      case 'End':
        store.ui.playing = false;
        store.seek(store.duration);
        break;
      case 'i':
        edit.markIn();
        break;
      case 'o':
        edit.markOut();
        break;
      case 'x':
        edit.markClip();
        break;
      case '/':
        store.ui.loopOn = !store.ui.loopOn;
        break;
      case 'a':
        if (sh) store.ui.dialog = 'addEffect';
        else store.ui.tool = 'select';
        break;
      case 'b':
        store.ui.tool = 'blade';
        break;
      case 't':
        store.ui.tool = 'trim';
        break;
      case 's':
        if (sh) store.ui.scopes = !store.ui.scopes;
        else edit.splitAtPlayhead();
        break;
      case 'm':
        edit.toggleMarker();
        break;
      case 'd':
        if (!edit.toggleEnabled() && store.ui.selectedEffect) store.edit(() => (store.selected!.enabled = !store.selected!.enabled));
        break;
      case ',':
      case '<':
        edit.nudgeSelected(sh ? -10 : -1);
        break;
      case '.':
      case '>':
        edit.nudgeSelected(sh ? 10 : 1);
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
      case 'z':
        if (sh) edit.zoomFit();
        break;
      case '\\':
        edit.zoomFit();
        break;
      case 'r':
        if (sh) edit.freezeAtPlayhead();
        else runChaos();
        break;
      case 'u':
        runMutate();
        break;
      case 'g':
        // a Frame Sequencer at the playhead
        if (store.project.clips.length) store.addEffect('sequence');
        break;
      case 'q': {
        // Chaos dial: Q wilder, Shift+Q calmer
        const v = Math.round(Math.min(2, Math.max(0, (store.project.chaos ?? 1) + (sh ? -0.25 : 0.25))) * 20) / 20;
        store.edit((p) => (v === 1 ? delete p.chaos : (p.chaos = v)), 'chaos');
        store.toast(`Chaos ${Math.round(v * 100)}%`);
        break;
      }
      case 'c':
        store.ui.compare = store.ui.compare === 'off' ? 'split' : 'off';
        break;
      case 'e':
        if (store.project.clips.length || store.project.texts.length) store.ui.dialog = 'export';
        break;
      case 'p':
        store.ui.dialog = 'presets';
        break;
      case 'v':
        if (store.project.clips.length) store.ui.dialog = 'variations';
        break;
      case 'F9':
        e.preventDefault();
        sourceEdit(edit.insertEdit);
        break;
      case 'F10':
        e.preventDefault();
        sourceEdit(edit.overwriteEdit);
        break;
      case 'F12':
        e.preventDefault();
        sourceEdit(sh ? edit.appendEdit : edit.placeOnTop);
        break;
      case 'Delete':
      case 'Backspace':
        if (!edit.deleteSelected(sh) && store.ui.selectedEffect) store.removeEffect(store.ui.selectedEffect);
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
  {#if phone}
    <MobileEditor onchaos={runChaos} />
  {:else}
    <TopBar onchaos={runChaos} onmutate={runMutate} />
    <main>
      <aside class="left"><MediaBin /></aside>
      <section class="center"><Player /></section>
      <aside class="right"><Inspector /></aside>
    </main>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resizer" title="Drag to resize the timeline" onpointerdown={resizeDown}></div>
    <footer style="--tlh:{store.ui.timelineHeight}px"><Timeline /></footer>
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
      grid-template-columns: 220px 1fr 300px;
    }
  }
  footer {
    height: var(--tlh);
  }
  .app.phone {
    display: block;
  }
</style>
