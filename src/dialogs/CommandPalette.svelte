<script lang="ts">
  // Find a command (Ctrl/⌘ P): every editor command, every effect to add, and every preset, with
  // their keys. Type a few letters of what you want and press Enter.
  import { onMount, tick } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { commands, runCommand } from '../lib/commands.svelte';
  import { keysOf, isMac } from '../lib/keymap';
  import { keyLabel } from '../lib/commandlist';
  import { fuzzyFilter } from '../lib/fuzzy';
  import { ALL_EFFECTS } from '../engine/effects';
  import { PRESETS, applyPreset } from '../engine/presets';
  import { cutsOf } from '../lib/renderer';
  import { takeSnapshot } from '../lib/snapshots.svelte';
  import { localGet, localSet } from '../lib/storage';
  import type { Project } from '../engine/types';

  interface Item {
    id: string;
    title: string;
    group: string;
    keys: string[];
    words: string;
    run: () => void;
  }

  const hasClips = store.project.clips.length > 0;
  const items: Item[] = [
    ...commands()
      .filter((c) => c.enabled && c.id !== 'palette')
      .map((c) => ({ id: c.id, title: c.title, group: c.group, keys: keysOf(c.id), words: c.words ?? '', run: () => runCommand(c.id) })),
    ...(hasClips
      ? ALL_EFFECTS.map((d) => ({
          id: 'fx:' + d.type,
          title: `Add effect: ${d.name}`,
          group: 'Effect',
          keys: [],
          words: d.icon + ' ' + d.description,
          run: () => store.addEffect(d.type),
        }))
      : []),
    ...(hasClips
      ? PRESETS.map((p) => ({
          id: 'preset:' + p.id,
          title: `Preset: ${p.name}`,
          group: 'Preset',
          keys: [],
          words: p.description,
          run: async () => {
            if (store.project.effects.length) await takeSnapshot('Before ' + p.name, true);
            const pr = $state.snapshot(store.project) as Project;
            store.set(applyPreset(pr, p, store.totalFrames, cutsOf(pr)));
            store.toast(`${p.name}. Undo to take it off.`, 'ok');
          },
        }))
      : []),
  ];

  // what was used lately comes first before anything is typed
  const recent = localGet<string[]>('recentCommands', []);
  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement;
  let list = $state<HTMLElement>();

  const shown = $derived.by(() => {
    if (query.trim()) return fuzzyFilter(query, items, (x) => `${x.title} ${x.group} ${x.words}`).slice(0, 60);
    const byRecent = recent.map((id) => items.find((x) => x.id === id)).filter((x): x is Item => !!x);
    return [...byRecent, ...items.filter((x) => !recent.includes(x.id) && !x.id.includes(':'))].slice(0, 60);
  });
  $effect(() => {
    void query;
    active = 0;
  });

  function choose(it: Item) {
    localSet('recentCommands', [it.id, ...recent.filter((x) => x !== it.id)].slice(0, 6));
    store.ui.dialog = null;
    // after the palette closes, so commands that open a dialog can
    tick().then(it.run);
  }

  async function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') active = Math.min(shown.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter' && shown[active]) choose(shown[active]);
    else if (e.key === 'Escape') store.ui.dialog = null;
    else return;
    e.preventDefault();
    e.stopPropagation();
    await tick();
    list?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  onMount(() => input.focus());
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="back" onclick={(e) => e.target === e.currentTarget && (store.ui.dialog = null)}>
  <div class="pal" role="dialog" aria-modal="true" aria-label="Find a command">
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onKey}
      placeholder="Type a command, an effect or a preset…"
      aria-label="Command"
      role="combobox"
      aria-expanded="true"
      aria-controls="pal-list"
      aria-activedescendant={shown[active] ? 'pal-' + shown[active].id : undefined}
      spellcheck="false"
      autocomplete="off"
    />
    <div class="list" id="pal-list" role="listbox" bind:this={list}>
      {#each shown as it, i (it.id)}
        <button class="row" class:on={i === active} id={'pal-' + it.id} role="option" aria-selected={i === active} onmousemove={() => (active = i)} onclick={() => choose(it)}>
          <span class="t">{it.title}</span>
          <span class="g faint small">{it.group}</span>
          {#if it.keys[0]}<span class="kbd">{keyLabel(it.keys[0], isMac)}</span>{/if}
        </button>
      {:else}
        <p class="faint small none">Nothing matches “{query}”.</p>
      {/each}
    </div>
    <div class="foot faint small"><span>↑ ↓ to choose · Enter to run · Esc to close</span></div>
  </div>
</div>

<style>
  .back {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 12vh 16px 16px;
    animation: fade 0.1s ease-out;
  }
  .pal {
    width: min(620px, 100%);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  input {
    height: 52px;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
    padding: 0 18px;
    font-size: 16px;
    outline: none;
  }
  .list {
    overflow: auto;
    padding: 6px;
    overscroll-behavior: contain;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 12px;
    border: none;
    background: none;
    border-radius: var(--r);
    text-align: left;
  }
  .row.on {
    background: var(--accent-soft);
  }
  /* the dim text stays readable on the highlight */
  .row.on .faint,
  .row.on .kbd {
    color: var(--text-2);
    opacity: 1;
  }
  .t {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kbd {
    font-family: var(--mono);
    font-size: 11px;
    padding: 1px 6px;
    border: 1px solid var(--line-2);
    border-radius: 4px;
    color: var(--text-2);
  }
  .none {
    padding: 12px;
  }
  .foot {
    padding: 8px 18px;
    border-top: 1px solid var(--line);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (max-width: 860px) {
    .back {
      padding-top: max(16px, env(safe-area-inset-top));
    }
  }
</style>
