<script lang="ts">
  // Every command with its keys, in groups. Click a command's keys to change them: press the new
  // combination (Esc to cancel, Backspace to remove the shortcut). Changes stay in this browser.
  import { COMMANDS, GROUPS, MOUSE_HINTS, keyLabel } from '../lib/commandlist';
  import { keysOf, setKeys, resetKeys, conflictsWith, comboOf, changedKeys, isMac } from '../lib/keymap';
  import { store } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  let version = $state(0);
  let editing = $state<string | null>(null);
  let filter = $state('');
  const title = (id: string) => COMMANDS.find((c) => c.id === id)?.title ?? id;

  const groups = $derived.by(() => {
    void version;
    const f = filter.trim().toLowerCase();
    return GROUPS.map((g) => ({
      g,
      rows: COMMANDS.filter((c) => c.group === g && (!f || c.title.toLowerCase().includes(f) || keysOf(c.id).some((k) => keyLabel(k, isMac).toLowerCase().includes(f)))).map((c) => ({ ...c, now: keysOf(c.id) })),
    })).filter((x) => x.rows.length);
  });

  function capture(e: KeyboardEvent) {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    const id = editing;
    if (e.key === 'Escape') return void (editing = null);
    if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      setKeys(id, []);
      editing = null;
      version++;
      return;
    }
    const combo = comboOf(e);
    const taken = conflictsWith(combo, id);
    setKeys(id, [combo, ...keysOf(id).filter((k) => k !== combo)].slice(0, 2));
    if (taken.length) store.toast(`${keyLabel(combo, isMac)} moved from “${title(taken[0])}”.`, 'info', 5000);
    editing = null;
    version++;
  }

  function reset() {
    resetKeys();
    version++;
    store.toast('Shortcuts are back to the defaults.', 'ok');
  }

  /** A printable page of every shortcut (as you've set them). */
  function cheatSheet() {
    const rows = GROUPS.map((g) => {
      const list = COMMANDS.filter((c) => c.group === g && keysOf(c.id).length);
      if (!list.length) return '';
      return `<h2>${g}</h2><table>${list.map((c) => `<tr><td>${keysOf(c.id).map((k) => `<kbd>${keyLabel(k, isMac)}</kbd>`).join(' ')}</td><td>${c.title}</td></tr>`).join('')}</table>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) return store.toast('Allow pop-ups to print the cheat sheet.', 'error');
    w.document.write(`<!doctype html><title>moshpit shortcuts</title><style>body{font:13px/1.4 system-ui,sans-serif;columns:3;column-gap:28px;margin:24px}h1{column-span:all;font-size:18px}h2{font-size:13px;margin:14px 0 4px;break-after:avoid}table{border-collapse:collapse;width:100%;break-inside:avoid}td{padding:2px 4px;vertical-align:top}td:first-child{white-space:nowrap}kbd{border:1px solid #999;border-radius:3px;padding:0 4px;font:11px ui-monospace,monospace}@media print{body{margin:0}}</style><h1>moshpit keyboard shortcuts</h1>${rows}`);
    w.document.close();
    w.focus();
    w.print();
  }
</script>

<svelte:window onkeydowncapture={capture} />

<div class="head">
  <input class="find" placeholder="Find a shortcut" bind:value={filter} aria-label="Find a shortcut" />
  <button class="small ghost" onclick={cheatSheet} title="A printable page of every shortcut"><Icon name="file" size={13} />Print</button>
  {#if changedKeys() || version}<button class="small ghost" onclick={reset}>Defaults</button>{/if}
</div>
<p class="small faint">Click a shortcut to change it, then press the new keys. Backspace removes it, Esc cancels.</p>
{#each groups as { g, rows } (g)}
  <h5>{g}</h5>
  <table>
    <tbody>
      {#each rows as c (c.id)}
        <tr>
          <td class="small">{c.title}</td>
          <td class="keys">
            <button class="keybtn" class:editing={editing === c.id} onclick={() => (editing = editing === c.id ? null : c.id)} aria-label="Change the shortcut for {c.title}">
              {#if editing === c.id}
                <span class="faint">press keys…</span>
              {:else if c.now.length}
                {#each c.now as k}<span class="kbd">{keyLabel(k, isMac)}</span>{/each}
              {:else}
                <span class="faint">none</span>
              {/if}
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/each}
{#if !filter}
  <h5>Mouse</h5>
  <table>
    <tbody>
      {#each MOUSE_HINTS as [k, d]}<tr><td class="small">{d}</td><td class="keys"><span class="kbd">{k}</span></td></tr>{/each}
    </tbody>
  </table>
{/if}

<style>
  .head {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .find {
    flex: 1;
    min-width: 0;
  }
  h5 {
    margin: 12px 0 2px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 2px 4px;
    vertical-align: middle;
  }
  td.keys {
    text-align: right;
    white-space: nowrap;
  }
  .keybtn {
    height: auto;
    min-height: 24px;
    padding: 2px 4px;
    background: none;
    border: 1px solid transparent;
    display: inline-flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .keybtn:hover,
  .keybtn.editing {
    border-color: var(--line-2);
  }
  .keybtn.editing {
    border-color: var(--accent);
  }
</style>
