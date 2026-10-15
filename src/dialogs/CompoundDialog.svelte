<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { compoundJob, cancelCompound } from '../lib/compound.svelte';
  import { ffmpeg } from '../lib/ffmpeg';

  function cancel() {
    cancelCompound();
    ffmpeg.cancel();
    store.ui.dialog = null;
  }
</script>

<Modal title="Compound clip" onclose={() => (compoundJob.running ? cancel() : (store.ui.dialog = null))}>
  <div class="col">
    {#if compoundJob.error}
      <div class="small err">{compoundJob.error}</div>
    {:else}
      <p class="small muted">Rendering the compound's timeline into a clip, so it plays and moshes like footage.</p>
      <div class="prog">
        <div class="bar"><div style="width:{Math.round(compoundJob.progress * 100)}%"></div></div>
        <span class="small mono">{compoundJob.stage || 'Starting'}… {Math.round(compoundJob.progress * 100)}%</span>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    {#if compoundJob.running}<button onclick={cancel}>Cancel</button>{:else}<button onclick={() => ((compoundJob.error = ''), (store.ui.dialog = null))}>Close</button>{/if}
  {/snippet}
</Modal>

<style>
  .prog {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .bar {
    flex: 1;
    height: 2px;
    background: var(--line-2);
  }
  .bar div {
    height: 100%;
    background: var(--accent);
  }
  .err {
    color: var(--danger);
  }
</style>
