<script lang="ts">
  // Code from a recipe, share code or project someone else made: shown, and run only if allowed.
  import Modal from '../components/Modal.svelte';
  import { scripts, answerConsent } from '../lib/scripts.svelte';
</script>

{#if scripts.consent}
  <Modal title="This mosh contains code" onclose={() => answerConsent(false)}>
    <div class="col">
      <p class="small">
        It has a <b>Script</b> effect: code someone wrote, which reorders the frames. It runs in a sandbox with no network and no access to your files or the editor,
        but only run code you're happy to run. Until you allow it, the effect does nothing.
      </p>
      <pre class="mono">{scripts.consent.code}</pre>
    </div>
    {#snippet footer()}
      <button onclick={() => answerConsent(false)}>Don't run it</button>
      <button class="primary" onclick={() => answerConsent(true)}>Run it</button>
    {/snippet}
  </Modal>
{/if}

<style>
  pre {
    max-height: 320px;
    overflow: auto;
    padding: 10px;
    background: var(--surface-2);
    border-radius: var(--r);
    font-size: 11.5px;
    white-space: pre-wrap;
  }
</style>
