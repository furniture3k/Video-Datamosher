<script lang="ts" module>
  import { releases, VERSION } from '../lib/about';
  import { releasesSince, compareVersions, type Release } from '../engine/changelog';
  import { localGet, localSet } from '../lib/storage';

  /** what the dialog shows: set at start-up after an update, else the latest few releases */
  let pending: Release[] | null = null;

  /**
   * Called once at start-up. After an update, returns true and the dialog shows what changed since
   * the version this browser last ran. A first visit just records the version.
   */
  export function checkWhatsNew(): boolean {
    let used = false;
    try {
      used = Object.keys(localStorage).some((k) => k.startsWith('moshpit:') && k !== 'moshpit:busy');
    } catch {
      /* no storage */
    }
    // people who used moshpit before this dialog existed last saw 1.4.0
    const seen = localGet<string>('lastVersion', used ? '1.4.0' : VERSION);
    localSet('lastVersion', VERSION);
    if (compareVersions(seen, VERSION) >= 0) return false;
    pending = releasesSince(releases, seen, VERSION);
    return pending.length > 0;
  }
</script>

<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { REPO } from '../lib/about';

  const list = pending ?? releases.filter((r) => compareVersions(r.version, VERSION) <= 0).slice(0, 3);
  const updated = !!pending;
  pending = null;
</script>

<Modal title={updated ? `moshpit ${VERSION}: what's new` : "What's new"}>
  {#each list as r, i (r.version)}
    <section class:first={i === 0}>
      <h4 class="mono">{r.version}{#if r.version === VERSION}<span class="now">this version</span>{/if}</h4>
      <ul>
        {#each r.items as runs}
          <li>{#each runs as run}{#if run.bold}<b>{run.text}</b>{:else}{run.text}{/if}{/each}</li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="muted">No release notes for this version.</p>
  {/each}
  {#snippet footer()}
    <a class="small" href="{REPO}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Full changelog</a>
    <span class="grow"></span>
    <button class="primary" onclick={() => (store.ui.dialog = null)}>Got it</button>
  {/snippet}
</Modal>

<style>
  section + section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  h4 {
    font-size: 13px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .now {
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 1px 7px;
    border-radius: 99px;
  }
  ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    line-height: 1.45;
  }
  .grow {
    flex: 1;
  }
</style>
