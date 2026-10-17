<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { shareCode, applyShareCode } from '../lib/projectio.svelte';
  let code = $state('');
  let paste = $state('');
  shareCode().then((c) => (code = c));
  async function copy() {
    await navigator.clipboard.writeText(code);
    store.toast('Copied.', 'ok');
  }
  async function apply() {
    try {
      await applyShareCode(paste);
      store.ui.dialog = null;
      store.toast('Applied.', 'ok');
    } catch {
      store.toast('That code could not be read.', 'error');
    }
  }
</script>

<Modal title="Share code">
  <div class="col">
    <p class="small muted">
      A code holds the effect stack, automation, seeds and encoder settings, not the footage. Paste it into another project to reuse the recipe.
    </p>
    <textarea readonly rows="4" aria-label="Share code" value={code} onfocus={(e) => (e.target as HTMLTextAreaElement).select()}></textarea>
    <button onclick={copy} disabled={!code}>Copy</button>
    <hr />
    <span class="label">Paste a code</span>
    <textarea rows="4" aria-label="Paste a share code" bind:value={paste} placeholder="MOSH:…"></textarea>
    <button class="primary" disabled={!paste.trim()} onclick={apply}>Apply to this project</button>
  </div>
</Modal>

<style>
  textarea {
    width: 100%;
    font-family: var(--mono);
    font-size: 11px;
    resize: vertical;
  }
  hr {
    border: none;
    border-top: 1px solid var(--line);
    width: 100%;
    margin: 6px 0;
  }
  button {
    align-self: flex-start;
  }
  p {
    margin: 0;
  }
</style>
