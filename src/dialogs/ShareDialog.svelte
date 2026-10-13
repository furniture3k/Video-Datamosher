<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { shareCode, applyShareCode } from '../lib/projectio.svelte';
  let code = $state('');
  let paste = $state('');
  shareCode().then((c) => (code = c));
  async function copy() {
    await navigator.clipboard.writeText(code);
    store.toast('Mosh code copied', 'ok');
  }
  async function apply() {
    try {
      await applyShareCode(paste);
      store.ui.dialog = null;
      store.toast('Mosh code applied', 'ok');
    } catch {
      store.toast('That code could not be read', 'error');
    }
  }
</script>

<Modal title="Share a mosh recipe">
  <div class="col">
    <p class="small muted">
      A mosh code holds all your effects, automation, seeds and encoder settings (not the video). Paste it into MOSHPIT with any footage to recreate the
      recipe.
    </p>
    <textarea readonly rows="4" value={code} onfocus={(e) => (e.target as HTMLTextAreaElement).select()}></textarea>
    <button onclick={copy} disabled={!code}>📋 Copy code</button>
    <hr />
    <span class="section-title">Paste a code</span>
    <textarea rows="4" bind:value={paste} placeholder="MOSH:…"></textarea>
    <button class="primary" disabled={!paste.trim()} onclick={apply}>Apply to my project</button>
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
  }
  p {
    margin: 0;
  }
</style>
