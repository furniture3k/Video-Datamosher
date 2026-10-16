<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { saveProjectFile, loadProjectFile, startNewProject } from '../lib/projectio.svelte';
  import { hasSavePicker } from '../lib/storage';
  import { reportProblem } from '../lib/report';
  import { goHome } from '../lib/projects.svelte';
  import { loadExample } from '../lib/media';
  import { randomSeed } from '../engine/rng';
  import Icon from './Icon.svelte';
  import ChaosDial from './ChaosDial.svelte';
  import Logo from './Logo.svelte';
  import { closeCompound } from '../lib/compound.svelte';
  let { onchaos, onmutate }: { onchaos: () => void; onmutate: () => void } = $props();
  let loadInput: HTMLInputElement;
  let menuOpen = $state(false);
  const hasClips = $derived(store.project.clips.length > 0 || store.project.texts.length > 0);
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<header class:nested={store.seqStack.length > 0}>
  <button class="brand ghost" class:busy={store.status.busy} title={store.status.busy ? 'Rendering the mosh… (click for all projects)' : 'All projects'} aria-label="All projects" onclick={goHome}>
    <Logo size={20} />
    <span class="word">moshpit</span>
  </button>
  <input
    class="name"
    value={store.project.name}
    aria-label="Project name"
    spellcheck="false"
    onchange={(e) => store.edit((p) => (p.name = (e.target as HTMLInputElement).value))}
  />

  {#if store.seqStack.length}
    <div class="crumbs" role="navigation" aria-label="Compound clips" title="Editing inside {store.seqStack.map((s) => s.name).join(' › ')}">
      <span class="small faint">Main ›</span>
      <span class="small cur">{store.seqStack.map((s) => s.name).join(' › ')}</span>
      <button class="small primary" onclick={() => closeCompound()} title="Close compound: it's rendered again and you're back in the timeline above">Done</button>
    </div>
  {/if}
  <div class="sep"></div>
  <button class="icon ghost" title="Undo  Ctrl+Z" aria-label="Undo" disabled={!store.historySize.undo} onclick={() => store.undo()}><Icon name="undo" /></button>
  <button class="icon ghost" title="Redo  Ctrl+Shift+Z" aria-label="Redo" disabled={!store.historySize.redo} onclick={() => store.redo()}><Icon name="redo" /></button>
  <div class="sep"></div>

  <nav class="tools" data-tour="mosh">
    <button class="ghost" onclick={() => (store.ui.dialog = 'presets')} title="Presets  P"><Icon name="list" /><span class="lbl">Presets</span></button>
    <div class="roll">
      <button class="ghost" onclick={onchaos} disabled={!hasClips} title="Roll a random effect stack  R. Locked settings and pinned effects stay put."><Icon name="dice" /><span class="lbl">Randomize</span></button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={store.ui.chaosIntensity}
        title="How wild the roll is: {Math.round(store.ui.chaosIntensity * 100)}%"
        aria-label="Randomize amount"
      />
    </div>
    {#if store.ui.advanced}<button class="ghost" onclick={onmutate} disabled={!store.project.effects.length} title="Nudge unlocked settings a little  U"><Icon name="nudge" /><span class="lbl">Nudge</span></button>{/if}
    <button class="ghost" onclick={() => (store.ui.dialog = 'variations')} disabled={!hasClips} title="Compare several variations side by side  V"><Icon name="grid" /><span class="lbl">Variations</span></button>
    <ChaosDial />
    <button class="ghost" onclick={() => (store.ui.dialog = 'snapshots')} title="Snapshots: saved versions to restore or compare  Ctrl+Shift+S saves one"><Icon name="history" /><span class="lbl">Snapshots</span></button>
  </nav>

  {#if store.ui.advanced}
  <label class="seed" title="Every random choice comes from this number. Same seed, same result.">
    <span class="label">Seed</span>
    <input
      type="number"
      value={store.project.globalSeed}
      onchange={(e) => store.edit((p) => (p.globalSeed = +(e.target as HTMLInputElement).value || 0))}
    />
    <button class="icon ghost" title="New seed" aria-label="New seed" onclick={() => store.edit((p) => (p.globalSeed = randomSeed()))}><Icon name="reset" size={14} /></button>
  </label>
  {/if}

  <div class="spacer"></div>

  <div class="seg" role="group" aria-label="Interface detail">
    <button class:on={!store.ui.advanced} onclick={() => store.setPref('advanced', false)}>Simple</button>
    <button class:on={store.ui.advanced} onclick={() => store.setPref('advanced', true)}>Advanced</button>
  </div>
  <button onclick={() => (store.ui.dialog = 'live')} title="Real-time mosh of your camera, screen or a video" aria-label="Live"><Icon name="live" /><span class="txt">Live</span></button>
  <button class="primary" data-tour="export" onclick={() => (store.ui.dialog = 'export')} disabled={!hasClips} title="Export  E"><Icon name="export" />Export</button>

  <div class="menu-wrap">
    <button class="icon ghost" onclick={(e) => (e.stopPropagation(), (menuOpen = !menuOpen))} aria-label="More" title="More"><Icon name="more" /></button>
    {#if menuOpen}
      <div class="menu" role="menu">
        <button class="ghost" onclick={() => saveProjectFile()}><Icon name="save" />Save project<span class="kbd">Ctrl S</span></button>
        {#if hasSavePicker()}<button class="ghost" onclick={() => saveProjectFile(true)}><Icon name="save" />Save project as…</button>{/if}
        <button class="ghost" onclick={() => loadInput.click()}><Icon name="folder" />Open project…</button>
        <button class="ghost" onclick={() => (store.ui.dialog = 'share')}><Icon name="link" />Share code…</button>
        <button class="ghost" disabled={!hasClips} onclick={() => (store.ui.dialog = 'bake')}><Icon name="film" />Bake the mosh into a clip…</button>
        <button class="ghost" disabled={!hasClips} onclick={() => (store.ui.dialog = 'captions')}><Icon name="text" />Auto captions…</button>
        <hr />
        <button class="ghost" onclick={() => loadExample()}><Icon name="gen" />Load example</button>
        <button class="ghost" onclick={startNewProject}><Icon name="file" />New project</button>
        <hr />
        <button class="ghost" onclick={() => store.setPref('autoRender', !store.ui.autoRender)}
          ><Icon name={store.ui.autoRender ? 'check' : 'x'} />Auto-render</button
        >
        <button class="ghost" onclick={() => store.setPref('advanced', !store.ui.advanced)}
          ><Icon name={store.ui.advanced ? 'check' : 'x'} />Advanced controls</button
        >
        <button class="ghost" onclick={() => store.setPref('theme', store.ui.theme === 'dark' ? 'light' : 'dark')}
          ><Icon name="theme" />{store.ui.theme === 'dark' ? 'Light' : 'Dark'} theme</button
        >
        <button class="ghost" onclick={() => (store.ui.dialog = 'storage')}><Icon name="storage" />Storage…</button>
        <hr />
        <button class="ghost" onclick={() => (store.ui.dialog = 'help')}><Icon name="help" />Help & shortcuts<span class="kbd">?</span></button>
        <button class="ghost" onclick={() => (store.ui.dialog = 'whatsnew')}><Icon name="sparkle" />What's new</button>
        <button class="ghost" onclick={() => reportProblem()}><Icon name="bug" />Report a problem…</button>
      </div>
    {/if}
  </div>
  <input
    bind:this={loadInput}
    type="file"
    accept=".json,application/json"
    hidden
    onchange={(e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) loadProjectFile(f);
      (e.target as HTMLInputElement).value = '';
    }}
  />
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    height: 46px;
    background: var(--surface);
    min-width: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 8px 0 4px;
    color: var(--text);
  }
  .brand.busy :global(.logo) {
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .word {
    font-weight: 750;
    font-size: 15px;
    letter-spacing: -0.03em;
  }
  .name {
    background: transparent;
    border-color: transparent;
    color: var(--text-2);
    width: 150px;
  }
  .name:hover,
  .name:focus {
    border-color: var(--line-2);
    color: var(--text);
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    border: 1px solid var(--accent);
    border-radius: var(--r);
    height: 28px;
  }
  .crumbs .cur {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }
  .crumbs span {
    white-space: nowrap;
  }
  /* inside a compound the breadcrumb needs the room: tools show icons only */
  header.nested .tools .lbl {
    display: none;
  }
  .crumbs button {
    height: 22px;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--line-2);
    margin: 0 4px;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .roll {
    display: flex;
    align-items: center;
  }
  .roll input {
    width: 54px;
    margin-right: 6px;
  }
  .seed {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }
  .seed input {
    width: 92px;
  }
  .spacer {
    flex: 1;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 40;
    display: flex;
    flex-direction: column;
    padding: 4px;
    min-width: 220px;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    border-radius: var(--r);
    box-shadow: var(--shadow);
  }
  .menu button {
    justify-content: flex-start;
    color: var(--text);
    height: 28px;
  }
  .menu .kbd {
    margin-left: auto;
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--line-2);
    width: 100%;
    margin: 4px 0;
  }
  @media (max-width: 1180px) {
    .seed {
      display: none;
    }
  }
  /* laptop widths: tools become icon buttons so Export always fits */
  @media (max-width: 1280px) and (min-width: 861px) {
    .tools .lbl {
      display: none;
    }
    .name {
      width: 120px;
    }
  }
  @media (max-width: 1000px) and (min-width: 861px) {
    .seg,
    .txt {
      display: none;
    }
  }
  @media (max-width: 860px), (max-height: 500px) and (pointer: coarse) {
    header {
      height: auto;
      flex-wrap: wrap;
      padding: 6px 12px;
      row-gap: 6px;
    }
    .tools {
      order: 10;
      width: calc(100% + 24px);
      margin: 0 -12px;
      padding: 0 8px;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tools::-webkit-scrollbar {
      display: none;
    }
    .tools > * {
      flex: none;
    }
    .name {
      flex: 1;
      width: auto;
      min-width: 60px;
    }
    .txt,
    .word {
      display: none;
    }
    .spacer,
    .sep,
    .seg {
      display: none;
    }
  }
</style>
