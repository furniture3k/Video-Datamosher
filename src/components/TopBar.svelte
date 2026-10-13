<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { saveProjectFile, loadProjectFile } from '../lib/projectio.svelte';
  import { loadExample } from '../lib/media';
  import { randomSeed } from '../engine/rng';
  import Icon from './Icon.svelte';
  let { onchaos, onmutate }: { onchaos: () => void; onmutate: () => void } = $props();
  let loadInput: HTMLInputElement;
  let menuOpen = $state(false);
  const hasClips = $derived(store.project.clips.length > 0);
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<header>
  <div class="brand" title="moshpit">
    <span class="tally" class:busy={store.status.busy}></span>
    <span class="word mono">moshpit</span>
  </div>
  <input
    class="name"
    value={store.project.name}
    aria-label="Project name"
    spellcheck="false"
    onchange={(e) => store.edit((p) => (p.name = (e.target as HTMLInputElement).value))}
  />

  <div class="sep"></div>
  <button class="icon ghost" title="Undo  Ctrl+Z" aria-label="Undo" disabled={!store.historySize.undo} onclick={() => store.undo()}><Icon name="undo" /></button>
  <button class="icon ghost" title="Redo  Ctrl+Shift+Z" aria-label="Redo" disabled={!store.historySize.redo} onclick={() => store.redo()}><Icon name="redo" /></button>
  <div class="sep"></div>

  <nav class="tools">
    <button class="ghost" onclick={() => (store.ui.dialog = 'presets')} title="Presets  P"><Icon name="list" />Presets</button>
    <div class="roll">
      <button class="ghost" onclick={onchaos} disabled={!hasClips} title="Roll a random effect stack  R. Locked settings and pinned effects stay put."><Icon name="dice" />Randomize</button>
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
    <button class="ghost" onclick={onmutate} disabled={!store.project.effects.length} title="Nudge unlocked settings a little  M"><Icon name="nudge" />Nudge</button>
    <button class="ghost" onclick={() => (store.ui.dialog = 'variations')} disabled={!hasClips} title="Compare several variations side by side  V"><Icon name="grid" />Variations</button>
  </nav>

  <label class="seed" title="Every random choice comes from this number. Same seed, same result.">
    <span class="label">Seed</span>
    <input
      type="number"
      value={store.project.globalSeed}
      onchange={(e) => store.edit((p) => (p.globalSeed = +(e.target as HTMLInputElement).value || 0))}
    />
    <button class="icon ghost" title="New seed" aria-label="New seed" onclick={() => store.edit((p) => (p.globalSeed = randomSeed()))}><Icon name="reset" size={14} /></button>
  </label>

  <div class="spacer"></div>

  <div class="seg" role="group" aria-label="Interface detail">
    <button class:on={!store.ui.advanced} onclick={() => store.setPref('advanced', false)}>Simple</button>
    <button class:on={store.ui.advanced} onclick={() => store.setPref('advanced', true)}>Advanced</button>
  </div>
  <button onclick={() => (store.ui.dialog = 'live')} title="Real-time mosh of your camera, screen or a video" aria-label="Live"><Icon name="live" /><span class="txt">Live</span></button>
  <button class="primary" onclick={() => (store.ui.dialog = 'export')} disabled={!hasClips} title="Export  E"><Icon name="export" />Export</button>

  <div class="menu-wrap">
    <button class="icon ghost" onclick={(e) => (e.stopPropagation(), (menuOpen = !menuOpen))} aria-label="More" title="More"><Icon name="more" /></button>
    {#if menuOpen}
      <div class="menu" role="menu">
        <button class="ghost" onclick={saveProjectFile}><Icon name="save" />Save project<span class="kbd">Ctrl S</span></button>
        <button class="ghost" onclick={() => loadInput.click()}><Icon name="folder" />Open project…</button>
        <button class="ghost" onclick={() => (store.ui.dialog = 'share')}><Icon name="link" />Share code…</button>
        <hr />
        <button class="ghost" onclick={() => loadExample()}><Icon name="gen" />Load example</button>
        <button
          class="ghost"
          onclick={() => {
            if (confirm('Start a new project? Clips and effects will be cleared.')) {
              store.set({ ...$state.snapshot(store.project), clips: [], effects: [], name: 'Untitled' } as never);
              store.render = null;
            }
          }}><Icon name="file" />New project</button
        >
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
        <button class="ghost" onclick={() => (store.ui.dialog = 'help')}><Icon name="help" />Help & shortcuts<span class="kbd">?</span></button>
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
    height: 40px;
    background: var(--surface);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 0 4px;
  }
  .tally {
    width: 9px;
    height: 9px;
    background: var(--accent);
    border-radius: 1px;
  }
  .tally.busy {
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .word {
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
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
  @media (max-width: 860px) {
    header {
      height: auto;
      flex-wrap: wrap;
      padding: 6px 12px;
      row-gap: 6px;
    }
    .tools {
      order: 10;
      width: 100%;
      flex-wrap: wrap;
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
