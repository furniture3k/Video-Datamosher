<script lang="ts">
  // A strip of frames showing what an effect does to the video: which frames are repeated,
  // moved, removed, damaged or borrowed from elsewhere.
  import type { Cell } from '../lib/effectguide';
  let { cells }: { cells: Cell[] } = $props();
  const TIP: Record<string, string> = {
    removed: 'removed',
    repeat: 'repeated',
    moved: 'moved',
    from: 'motion from elsewhere',
    glitch: 'damaged',
    vector: 'motion rewritten',
  };
</script>

<div class="strip" aria-hidden="true">
  {#each cells as c}
    <span class="cell {c.m ?? ''}" class:key={c.k === 'I'} title={c.m ? TIP[c.m] : c.k === 'I' ? 'full picture' : 'motion frame'}>
      {c.k === 'I' ? 'I' : c.n}
    </span>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    gap: 2px;
  }
  .cell {
    width: 16px;
    height: 20px;
    display: grid;
    place-items: center;
    font: 500 10px var(--mono);
    color: var(--text-2);
    background: var(--surface-3);
    border-radius: 2px;
  }
  .key {
    color: var(--bg);
    background: var(--f-i);
  }
  .removed {
    background: none;
    outline: 1px dashed var(--text-3);
    outline-offset: -1px;
    color: var(--text-3);
    text-decoration: line-through;
  }
  .repeat {
    background: var(--f-dup);
    color: var(--bg);
  }
  .moved {
    background: var(--f-moved);
    color: var(--bg);
  }
  .from {
    background: var(--f-spliced);
    color: var(--bg);
  }
  .glitch {
    background: var(--f-glitch);
    color: var(--bg);
  }
  .vector {
    background: var(--f-replaced);
    color: var(--bg);
  }
</style>
