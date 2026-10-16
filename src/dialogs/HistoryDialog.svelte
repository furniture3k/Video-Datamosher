<script lang="ts">
  // Every step undo can take you back through, named by what changed. Click one to go back (or
  // forward) to it; nothing is lost until you make a new change from an earlier step.
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { describeChange } from '../engine/history';
  import type { Project } from '../engine/types';

  interface Row {
    label: string;
    /** steps from now: negative = undo, positive = redo */
    at: number;
  }

  const rows = $derived.by((): Row[] => {
    void store.historySize;
    const { past, current, future } = store.historyStates();
    const states = [...past, current, ...future];
    const now = past.length;
    const parsed = new Map<number, Project>();
    const get = (i: number) => {
      if (!parsed.has(i)) parsed.set(i, JSON.parse(states[i]) as Project);
      return parsed.get(i)!;
    };
    const out: Row[] = [{ label: 'Opened', at: -now }];
    for (let i = 1; i < states.length; i++) {
      let label = 'Edit';
      try {
        label = describeChange(get(i - 1), get(i));
      } catch {
        /* an old version that doesn't parse: keep the plain name */
      }
      out.push({ label, at: i - now });
    }
    return out.reverse();
  });
</script>

<Modal title="History">
  <p class="small faint">Newest first. Click a step to go back to it; Redo brings you forward again until you change something.</p>
  <ol class="steps">
    {#each rows as r (r.at)}
      <li>
        <button class="row" class:now={r.at === 0} class:future={r.at > 0} onclick={() => store.jumpHistory(r.at)} disabled={r.at === 0}>
          <span class="dot"></span>
          <span class="grow">{r.label}</span>
          {#if r.at === 0}<span class="tag small">now</span>{:else if r.at > 0}<span class="faint small">redo</span>{/if}
        </button>
      </li>
    {/each}
  </ol>
  {#snippet footer()}
    <span class="faint small grow">{store.historySize.undo} step{store.historySize.undo === 1 ? '' : 's'} back · up to 200 are kept</span>
    <button class="primary" onclick={() => (store.ui.dialog = null)}>Done</button>
  {/snippet}
</Modal>

<style>
  .steps {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    max-height: 60vh;
    overflow: auto;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border: none;
    background: none;
    border-radius: var(--r);
    text-align: left;
  }
  .row:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .row:disabled {
    opacity: 1;
    cursor: default;
  }
  .row.now {
    background: var(--accent-soft);
    font-weight: 600;
  }
  .row.future {
    color: var(--text-3);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--line-2);
    flex: none;
  }
  .now .dot {
    background: var(--accent);
  }
  .grow {
    flex: 1;
  }
  .tag {
    color: var(--accent);
  }
</style>
