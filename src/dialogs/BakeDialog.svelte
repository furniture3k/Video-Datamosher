<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { bakeToClip } from '../lib/bake.svelte';
  import { Cancelled } from '../lib/renderer';
  import { ffmpeg } from '../lib/ffmpeg';
  import { onDestroy } from 'svelte';

  let running = $state(false);
  let stage = $state('');
  let progress = $state(0);
  let error = $state('');
  let signal = { cancelled: false };

  async function go(replace: boolean) {
    running = true;
    error = '';
    const my = (signal = { cancelled: false });
    try {
      const m = await bakeToClip(replace, (s, p) => my === signal && ((stage = s), (progress = p)), my);
      if (!m) throw new Error('Nothing came out of the render.');
      // done just as it was cancelled: the clip is in, but whatever dialog is open now stays
      if (!my.cancelled) store.ui.dialog = null;
      store.toast(replace ? 'Baked. The timeline is now one clip of the mosh: mosh it again.' : 'Baked clip added to the media library.', 'ok', 5000);
    } catch (e) {
      if (!(e instanceof Cancelled) && !my.cancelled) error = (e as Error).message;
    } finally {
      // a cancelled bake that ends late mustn't mark a newer one as finished
      if (my === signal) running = false;
    }
  }
  function cancel() {
    signal.cancelled = true;
    ffmpeg.cancel();
    running = false;
  }
  // closed mid-bake (also by the editor's Escape, which skips onclose): stop it
  onDestroy(() => running && cancel());
</script>

<Modal title="Bake the mosh into a clip" onclose={() => (running ? cancel() : null, (store.ui.dialog = null))}>
  <div class="col">
    <p class="small muted">
      Renders the whole mosh, sound included, to a video file and brings it back as media. A baked clip behaves like footage: cut it, speed it up, or mosh it again for a melt of a melt.
    </p>
    {#if running}
      <div class="prog">
        <div class="bar"><div style="width:{Math.round(progress * 100)}%"></div></div>
        <span class="small mono">{stage}… {Math.round(progress * 100)}%</span>
      </div>
    {/if}
    {#if error}<div class="small err">{error}</div>{/if}
  </div>
  {#snippet footer()}
    {#if running}
      <button onclick={cancel}>Cancel</button>
    {:else}
      <button onclick={() => go(false)} title="Keep the timeline as it is">Add to media</button>
      <button class="primary" onclick={() => go(true)} title="The baked clip replaces the timeline and the effects (a snapshot keeps what you had)">Replace the timeline</button>
    {/if}
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
