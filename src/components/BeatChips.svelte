<script lang="ts">
  // Set a length in beats of the music: ¼, ½, 1, 2… beats at its tempo (shown once the beats are known).
  import { beatInfo } from '../lib/beatinfo.svelte';

  let { onpick, counts = [0.25, 0.5, 1, 2] }: { onpick: (seconds: number) => void; counts?: number[] } = $props();
  const label = (n: number) => (n === 0.25 ? '¼' : n === 0.5 ? '½' : String(n));
</script>

{#if beatInfo.status === 'ready' && beatInfo.bpm > 0}
  <div class="beats" role="group" aria-label="Length in beats">
    <span class="small faint">beats</span>
    {#each counts as n}
      <button class="ghost small" onclick={() => onpick(Math.round(((n * 60) / beatInfo.bpm) * 1000) / 1000)} title={`${label(n)} beat${n > 1 ? 's' : ''} at ${Math.round(beatInfo.bpm)} BPM`}>{label(n)}</button>
    {/each}
  </div>
{/if}

<style>
  .beats {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }
  .beats button {
    min-width: 26px;
    padding: 1px 6px;
  }
</style>
