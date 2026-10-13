<script lang="ts">
  import { store } from '../lib/store.svelte';
  import { saveProjectFile, loadProjectFile } from '../lib/projectio.svelte';
  import { randomSeed } from '../engine/rng';
  let { onchaos, onmutate }: { onchaos: () => void; onmutate: () => void } = $props();
  let loadInput: HTMLInputElement;
  let menuOpen = $state(false);
</script>

<header>
  <div class="brand" title="MOSHPIT, a datamosh studio">
    <span class="logo">MOSH<span>PIT</span></span>
  </div>
  <input
    class="name"
    value={store.project.name}
    aria-label="Project name"
    onchange={(e) => store.edit((p) => (p.name = (e.target as HTMLInputElement).value))}
  />

  <div class="group">
    <button class="icon ghost" title="Undo (Ctrl+Z)" disabled={!store.historySize.undo} onclick={() => store.undo()}>↶</button>
    <button class="icon ghost" title="Redo (Ctrl+Shift+Z)" disabled={!store.historySize.redo} onclick={() => store.redo()}>↷</button>
  </div>

  <div class="group creative">
    <button onclick={() => (store.ui.dialog = 'presets')} title="Preset gallery (P)">✨ Presets</button>
    <button class="chaos" onclick={onchaos} disabled={!store.project.clips.length} title="Roll a random mosh (R). Locked settings and pinned effects are kept.">🎲 Chaos</button>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      bind:value={store.ui.chaosIntensity}
      title="Chaos intensity: {Math.round(store.ui.chaosIntensity * 100)}%"
      aria-label="Chaos intensity"
      class="intensity"
    />
    <button onclick={onmutate} disabled={!store.project.effects.length} title="Nudge all unlocked settings a little (M)">🧬 Mutate</button>
    <button onclick={() => (store.ui.dialog = 'variations')} disabled={!store.project.clips.length} title="Render a grid of variations and pick one (V)">▦ Variations</button>
  </div>

  <div class="group seed" title="Global seed: every random choice derives from this. Same seed gives the same result.">
    <span class="small muted">seed</span>
    <input
      type="number"
      value={store.project.globalSeed}
      onchange={(e) => store.edit((p) => (p.globalSeed = +(e.target as HTMLInputElement).value || 0))}
    />
    <button class="icon ghost" title="New random seed" onclick={() => store.edit((p) => (p.globalSeed = randomSeed()))}>⟳</button>
  </div>

  <div class="spacer"></div>

  <label class="row small mode" title="Advanced mode shows every setting">
    <span class:active={!store.ui.advanced}>Simple</span>
    <input type="checkbox" class="switch" checked={store.ui.advanced} onchange={(e) => store.setPref('advanced', (e.target as HTMLInputElement).checked)} />
    <span class:active={store.ui.advanced}>Advanced</span>
  </label>

  <button onclick={() => (store.ui.dialog = 'live')} title="Real-time flow mosh with webcam or video">◉ Live</button>
  <button class="primary" onclick={() => (store.ui.dialog = 'export')} disabled={!store.project.clips.length} title="Export (E)">⇩ Export</button>

  <div class="menu-wrap">
    <button class="icon ghost" onclick={() => (menuOpen = !menuOpen)} aria-label="More" title="More">☰</button>
    {#if menuOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="menu panel" onclick={() => (menuOpen = false)}>
        <button class="ghost" onclick={saveProjectFile}>💾 Save project…<span class="kbd">Ctrl S</span></button>
        <button class="ghost" onclick={() => loadInput.click()}>📂 Load project…</button>
        <button class="ghost" onclick={() => (store.ui.dialog = 'share')}>🔗 Share / paste mosh code…</button>
        <hr />
        <button class="ghost" onclick={() => store.setPref('autoRender', !store.ui.autoRender)}>{store.ui.autoRender ? '☑' : '☐'} Auto-render on change</button>
        <button class="ghost" onclick={() => store.setPref('theme', store.ui.theme === 'dark' ? 'light' : 'dark')}>◑ {store.ui.theme === 'dark' ? 'Light' : 'Dark'} theme</button>
        <button
          class="ghost"
          onclick={() => {
            if (confirm('Start a new project? Your current clips and effects will be cleared (unsaved work is lost).')) {
              store.set({ ...$state.snapshot(store.project), clips: [], effects: [], name: 'Untitled mosh' } as never);
              store.render = null;
            }
          }}>🗋 New project</button
        >
        <hr />
        <button class="ghost" onclick={() => (store.ui.dialog = 'help')}>❓ Help & shortcuts<span class="kbd">?</span></button>
        <button class="ghost" onclick={() => (store.ui.welcome = true)}>👋 Show welcome</button>
      </div>
    {/if}
  </div>
  <input bind:this={loadInput} type="file" accept=".json,application/json" hidden onchange={(e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) loadProjectFile(f);
    (e.target as HTMLInputElement).value = '';
  }} />
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    flex-wrap: wrap;
  }
  .brand .logo {
    font-weight: 700;
    font-size: 20px;
    letter-spacing: 0.04em;
    font-family: var(--mono);
    text-shadow: 2px 0 var(--accent), -2px 0 var(--accent2);
  }
  .brand .logo span {
    color: var(--accent);
    text-shadow: 2px 0 var(--accent2), -1px 0 var(--accent3);
  }
  .name {
    background: transparent;
    border-color: transparent;
    font-weight: 500;
    width: 170px;
  }
  .name:hover {
    border-color: var(--line);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .creative {
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  .chaos {
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 35%, var(--panel2)), color-mix(in srgb, var(--accent2) 30%, var(--panel2)));
    font-weight: 700;
  }
  .intensity {
    width: 60px;
  }
  .seed input {
    width: 96px;
  }
  .spacer {
    flex: 1;
  }
  .mode span {
    color: var(--faint);
  }
  .mode span.active {
    color: var(--text);
    font-weight: 700;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 110%;
    z-index: 40;
    display: flex;
    flex-direction: column;
    padding: 6px;
    min-width: 250px;
    box-shadow: var(--shadow);
  }
  .menu button {
    text-align: left;
    display: flex;
    justify-content: space-between;
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--line);
    width: 100%;
  }
</style>
