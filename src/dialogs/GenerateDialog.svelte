<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { addGenerator } from '../lib/media';
  import { GENERATORS } from '../engine/args';
  let seconds = $state(4);
  let busy = $state(false);
  async function add(id: string) {
    busy = true;
    try {
      await addGenerator(id, seconds);
      store.ui.dialog = null;
    } catch (e) {
      store.toast('Could not generate: ' + (e as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Generate a clip">
  <p class="small muted">Procedural footage rendered by the video engine.</p>
  <label class="row small len">Length <input type="number" min="1" max="30" bind:value={seconds} /> seconds</label>
  <div class="grid">
    {#each GENERATORS as g}
      <button disabled={busy} onclick={() => add(g.id)}>{g.name}</button>
    {/each}
  </div>
  {#if busy}<p class="small muted">Generating…</p>{/if}
</Modal>

<style>
  .len {
    margin-top: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 12px;
  }
  .grid button {
    height: 34px;
    justify-content: flex-start;
  }
</style>
