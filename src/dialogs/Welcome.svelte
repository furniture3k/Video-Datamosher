<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { localSet } from '../lib/storage';
  import { addGenerator } from '../lib/media';
  import { PRESETS, applyPreset } from '../engine/presets';
  import type { Project } from '../engine/types';

  function close() {
    store.ui.welcome = false;
    localSet('seenWelcome', true);
  }
  let busy = $state(false);
  async function demo() {
    busy = true;
    try {
      await addGenerator('testsrc2', 3);
      await addGenerator('mandelbrot', 4);
      store.set(applyPreset($state.snapshot(store.project) as Project, PRESETS.find((p) => p.id === 'transitions')!, store.totalFrames, store.cuts));
      close();
      store.toast('Demo loaded: a test pattern melting into a fractal. Press Space to play.');
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Welcome to MOSHPIT" onclose={close}>
  <div class="col welcome">
    <p>
      <b>Datamoshing</b> is the art of breaking video compression on purpose, so scenes melt, smear and bloom into each other. MOSHPIT does it for real by
      editing the compressed frames themselves, then lets you control every part of the process.
    </p>
    <ol>
      <li><b>Add clips</b>: drop videos anywhere, record your webcam, or generate one.</li>
      <li><b>Pick a preset</b> or press <b>🎲 Chaos</b> to roll something random.</li>
      <li><b>Tweak</b>: drag effect bars on the timeline, change any setting, lock 🔒 what you like, automate 〰 anything over time.</li>
      <li><b>Export</b> MP4, WebM, GIF, PNG frames or the raw broken AVI.</li>
    </ol>
    <p class="small muted">Everything runs locally in your browser. Your videos are never uploaded. The video engine (≈30&nbsp;MB) loads once.</p>
  </div>
  {#snippet footer()}
    <button onclick={() => ((store.ui.dialog = 'help'), close())}>Learn more</button>
    <button onclick={demo} disabled={busy}>{busy ? 'Loading…' : '▶ Try a demo'}</button>
    <button class="primary" onclick={close}>Start moshing</button>
  {/snippet}
</Modal>

<style>
  .welcome {
    line-height: 1.55;
  }
  p,
  ol {
    margin: 0;
  }
</style>
